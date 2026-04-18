from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional
import aiosqlite
from backend.database import get_db
from backend.auth import get_current_user
from backend.models import AchatCreate, AchatUpdate, LotCreate, LotElementCreate
from backend.services.stock_service import integrer_achat_stock
from backend.services.files_service import save_upload, delete_file
import logging

router = APIRouter(prefix="/api/achats", tags=["achats"])
logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_achat_or_404(db: aiosqlite.Connection, achat_id: int) -> dict:
    async with db.execute(
        """
        SELECT a.*, f.nom AS fournisseur_nom
        FROM achats a
        LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
        WHERE a.id = ?
        """,
        (achat_id,),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Achat introuvable")
    return dict(row)


async def _log(db, user_id, action, entite_id, details=""):
    await db.execute(
        """
        INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
        VALUES (?, ?, 'achat', ?, ?)
        """,
        (user_id, action, entite_id, details),
    )


# ── Lots — déclarés EN PREMIER pour éviter le conflit avec /{achat_id} ────────

@router.get("/lots/list")
async def list_lots(
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    async with db.execute(
        """
        SELECT l.*,
               COUNT(le.id)          AS nb_elements,
               SUM(le.prix_attribue) AS total_attribue
        FROM lots_achat l
        LEFT JOIN lot_elements le ON le.lot_id = l.id
        GROUP BY l.id
        ORDER BY l.date DESC
        """
    ) as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.post("/lots", status_code=201)
async def create_lot(
    payload: LotCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    async with db.execute(
        """
        INSERT INTO lots_achat (date, nom_lot, prix_total, plateforme, notes)
        VALUES (?, ?, ?, ?, ?)
        """,
        (payload.date, payload.nom_lot, payload.prix_total,
         payload.plateforme, payload.notes),
    ) as cur:
        lot_id = cur.lastrowid
    await db.commit()
    return {"id": lot_id, "nom_lot": payload.nom_lot}


@router.get("/lots/{lot_id}")
async def get_lot(
    lot_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    async with db.execute(
        "SELECT * FROM lots_achat WHERE id = ?", (lot_id,)
    ) as cur:
        lot = await cur.fetchone()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot introuvable")

    async with db.execute(
        "SELECT * FROM lot_elements WHERE lot_id = ?", (lot_id,)
    ) as cur:
        elements = [dict(r) for r in await cur.fetchall()]

    return {**dict(lot), "elements": elements}


@router.post("/lots/{lot_id}/elements", status_code=201)
async def add_lot_element(
    lot_id: int,
    payload: LotElementCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    async with db.execute(
        "SELECT prix_total FROM lots_achat WHERE id = ?", (lot_id,)
    ) as cur:
        lot = await cur.fetchone()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot introuvable")

    async with db.execute(
        "SELECT COALESCE(SUM(prix_attribue), 0) FROM lot_elements WHERE lot_id = ?",
        (lot_id,),
    ) as cur:
        total_actuel = (await cur.fetchone())[0]

    if total_actuel + payload.prix_attribue > lot["prix_total"] + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Dépassement du prix total du lot ({lot['prix_total']} €)",
        )

    async with db.execute(
        """
        INSERT INTO lot_elements
            (lot_id, type_element, nom, prix_attribue, destination)
        VALUES (?, ?, ?, ?, ?)
        """,
        (lot_id, payload.type_element, payload.nom,
         payload.prix_attribue, payload.destination),
    ) as cur:
        elem_id = cur.lastrowid
    await db.commit()
    return {"id": elem_id}


# ── Liste ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_achats(
    search: Optional[str] = Query(None),
    type_achat: Optional[str] = Query(None),
    fournisseur_id: Optional[int] = Query(None),
    lot_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    conditions = ["1=1"]
    params: list = []

    if search:
        conditions.append("(a.nom LIKE ? OR a.notes LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    if type_achat:
        conditions.append("a.type_achat = ?")
        params.append(type_achat)
    if fournisseur_id:
        conditions.append("a.fournisseur_id = ?")
        params.append(fournisseur_id)
    if lot_id:
        conditions.append("a.lot_id = ?")
        params.append(lot_id)

    where = " AND ".join(conditions)

    async with db.execute(
        f"""
        SELECT a.*, f.nom AS fournisseur_nom
        FROM achats a
        LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
        WHERE {where}
        ORDER BY a.date DESC, a.id DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ) as cur:
        rows = [dict(r) for r in await cur.fetchall()]

    async with db.execute(
        f"SELECT COUNT(*) FROM achats a WHERE {where}", params
    ) as cur:
        total = (await cur.fetchone())[0]

    return {"items": rows, "total": total, "limit": limit, "offset": offset}


# ── Détail ────────────────────────────────────────────────────────────────────

@router.get("/{achat_id}")
async def get_achat(
    achat_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    achat = await _get_achat_or_404(db, achat_id)

    async with db.execute(
        "SELECT * FROM fichiers WHERE type_parent = 'achat' AND parent_id = ?",
        (achat_id,),
    ) as cur:
        achat["fichiers"] = [dict(r) for r in await cur.fetchall()]

    if achat.get("lot_id"):
        async with db.execute(
            "SELECT * FROM lot_elements WHERE lot_id = ?", (achat["lot_id"],)
        ) as cur:
            achat["lot_elements"] = [dict(r) for r in await cur.fetchall()]

    return achat


# ── Création ──────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_achat(
    payload: AchatCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    async with db.execute(
        """
        INSERT INTO achats
            (date, nom, type_achat, categorie, plateforme,
             fournisseur_id, prix_achat, quantite,
             est_lot, lot_id, ajout_stock_auto, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.date, payload.nom, payload.type_achat,
            payload.categorie, payload.plateforme, payload.fournisseur_id,
            payload.prix_achat, payload.quantite, payload.est_lot,
            payload.lot_id, payload.ajout_stock_auto, payload.notes,
        ),
    ) as cur:
        achat_id = cur.lastrowid

    await db.commit()

    if payload.type_achat == "piece" and payload.ajout_stock_auto:
        await integrer_achat_stock(db, achat_id, current_user["id"])
        await db.commit()

    await _log(db, current_user["id"], "create", achat_id, payload.nom)
    await db.commit()

    return await _get_achat_or_404(db, achat_id)


# ── Mise à jour ───────────────────────────────────────────────────────────────

@router.put("/{achat_id}")
async def update_achat(
    achat_id: int,
    payload: AchatUpdate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await _get_achat_or_404(db, achat_id)

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=422, detail="Aucun champ à mettre à jour")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    set_clause += ", updated_at = datetime('now')"
    values = list(fields.values())

    await db.execute(
        f"UPDATE achats SET {set_clause} WHERE id = ?",
        values + [achat_id],
    )
    await _log(db, current_user["id"], "update", achat_id, str(fields))
    await db.commit()

    return await _get_achat_or_404(db, achat_id)


# ── Suppression ───────────────────────────────────────────────────────────────

@router.delete("/{achat_id}", status_code=204)
async def delete_achat(
    achat_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    achat = await _get_achat_or_404(db, achat_id)

    async with db.execute(
        "SELECT chemin FROM fichiers WHERE type_parent = 'achat' AND parent_id = ?",
        (achat_id,),
    ) as cur:
        for row in await cur.fetchall():
            await delete_file(row["chemin"])

    await db.execute(
        "DELETE FROM fichiers WHERE type_parent = 'achat' AND parent_id = ?",
        (achat_id,),
    )
    await db.execute("DELETE FROM achats WHERE id = ?", (achat_id,))
    await _log(db, current_user["id"], "delete", achat_id, achat["nom"])
    await db.commit()


# ── Intégration manuelle stock ────────────────────────────────────────────────

@router.post("/{achat_id}/integrer-stock")
async def integrer_stock(
    achat_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    achat = await _get_achat_or_404(db, achat_id)
    if achat["type_achat"] != "piece":
        raise HTTPException(
            status_code=400,
            detail="Seuls les achats de type 'piece' peuvent être intégrés au stock",
        )
    result = await integrer_achat_stock(db, achat_id, current_user["id"])
    await _log(db, current_user["id"], "integrer_stock", achat_id)
    await db.commit()
    return result


# ── Fichiers ──────────────────────────────────────────────────────────────────

@router.post("/{achat_id}/fichiers", status_code=201)
async def upload_fichier(
    achat_id: int,
    file: UploadFile = File(...),
    categorie: str = "document",
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await _get_achat_or_404(db, achat_id)
    saved = await save_upload(file, "achat", achat_id)

    async with db.execute(
        """
        INSERT INTO fichiers
            (type_parent, parent_id, nom_original, chemin,
             mime_type, taille, categorie)
        VALUES ('achat', ?, ?, ?, ?, ?, ?)
        """,
        (
            achat_id, saved["nom_original"], saved["chemin"],
            saved["mime_type"], saved.get("taille", 0), categorie,
        ),
    ) as cur:
        fichier_id = cur.lastrowid

    await db.commit()
    return {"id": fichier_id, **saved}


@router.delete("/{achat_id}/fichiers/{fichier_id}", status_code=204)
async def delete_fichier(
    achat_id: int,
    fichier_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    async with db.execute(
        """
        SELECT chemin FROM fichiers
        WHERE id = ? AND parent_id = ? AND type_parent = 'achat'
        """,
        (fichier_id, achat_id),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    await delete_file(row["chemin"])
    await db.execute("DELETE FROM fichiers WHERE id = ?", (fichier_id,))
    await db.commit()