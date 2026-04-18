from fastapi import APIRouter, Depends, HTTPException
from backend.auth import get_current_user, require_role
from backend.database import get_db
from backend.models import FournisseurCreate, FournisseurUpdate
import aiosqlite
from datetime import datetime, timezone

router = APIRouter(prefix="/api/fournisseurs", tags=["fournisseurs"])


@router.get("")
async def list_fournisseurs(
    search: str = "",
    skip: int = 0,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    where = "WHERE 1=1"
    params = []
    if search:
        where += " AND (f.nom LIKE ? OR f.contact LIKE ? OR f.lien LIKE ?)"
        params += [f"%{search}%"] * 3

    async with db.execute(
        f"""
        SELECT f.*,
               COUNT(a.id)            AS nb_achats,
               COALESCE(SUM(a.prix_achat), 0) AS total_achats
        FROM fournisseurs f
        LEFT JOIN achats a ON a.fournisseur_id = f.id
        {where}
        GROUP BY f.id
        ORDER BY f.nom
        LIMIT ? OFFSET ?
        """,
        (*params, limit, skip),
    ) as cur:
        rows = await cur.fetchall()

    async with db.execute(
        f"SELECT COUNT(*) AS total FROM fournisseurs f {where}", params
    ) as cur:
        total = (await cur.fetchone())["total"]

    return {"items": [dict(r) for r in rows], "total": total}


@router.get("/{id}")
async def get_fournisseur(
    id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT * FROM fournisseurs WHERE id = ?", (id,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Fournisseur introuvable")

    # Historique achats
    async with db.execute(
        """
        SELECT id, date, nom, type_achat, prix_achat, quantite, categorie
        FROM achats
        WHERE fournisseur_id = ?
        ORDER BY date DESC
        LIMIT 50
        """,
        (id,),
    ) as cur:
        achats = await cur.fetchall()

    return {**dict(row), "achats": [dict(a) for a in achats]}


@router.post("", status_code=201)
async def create_fournisseur(
    body: FournisseurCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    now = datetime.now(timezone.utc).isoformat()
    async with db.execute(
        """
        INSERT INTO fournisseurs (nom, lien, contact, delai_moyen_jours, notes,
                                  created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
        """,
        (body.nom, body.lien, body.contact, body.delai_moyen_jours,
         body.notes, now, now),
    ) as cur:
        row = await cur.fetchone()
    await db.commit()
    await db.execute(
        "INSERT INTO logs (utilisateur_id, action, entite, entite_id, created_at)"
        " VALUES (?, 'create', 'fournisseurs', ?, ?)",
        (current_user["id"], row["id"], now),
    )
    await db.commit()
    return {"id": row["id"]}


@router.put("/{id}")
async def update_fournisseur(
    id: int,
    body: FournisseurUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT id FROM fournisseurs WHERE id = ?", (id,)
    ) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Fournisseur introuvable")

    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")

    now = datetime.now(timezone.utc).isoformat()
    fields["updated_at"] = now
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    await db.execute(
        f"UPDATE fournisseurs SET {set_clause} WHERE id = ?",
        (*fields.values(), id),
    )
    await db.commit()
    await db.execute(
        "INSERT INTO logs (utilisateur_id, action, entite, entite_id, created_at)"
        " VALUES (?, 'update', 'fournisseurs', ?, ?)",
        (current_user["id"], id, now),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{id}")
async def delete_fournisseur(
    id: int,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Bloqué si achats liés
    async with db.execute(
        "SELECT COUNT(*) AS nb FROM achats WHERE fournisseur_id = ?", (id,)
    ) as cur:
        nb = (await cur.fetchone())["nb"]
    if nb > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Impossible : {nb} achat(s) lié(s) à ce fournisseur",
        )

    # Bloqué si articles stock liés
    async with db.execute(
        "SELECT COUNT(*) AS nb FROM stock WHERE fournisseur_id = ? AND actif = 1",
        (id,),
    ) as cur:
        nb_stock = (await cur.fetchone())["nb"]
    if nb_stock > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Impossible : {nb_stock} article(s) stock lié(s) à ce fournisseur",
        )

    await db.execute("DELETE FROM fournisseurs WHERE id = ?", (id,))
    await db.commit()
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO logs (utilisateur_id, action, entite, entite_id, created_at)"
        " VALUES (?, 'delete', 'fournisseurs', ?, ?)",
        (current_user["id"], id, now),
    )
    await db.commit()
    return {"ok": True}