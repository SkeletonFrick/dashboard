from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from backend.database import get_db
from backend.auth import get_current_user, require_role
from backend.models import FlipCreate, FlipUpdate, FlipPieceCreate
from backend.services.stock_service import decrementer_stock
from backend.services.files_service import save_upload, delete_file
import aiosqlite
from typing import Optional
from datetime import datetime

router = APIRouter(prefix="/api/flips", tags=["flips"])


# ─── Helpers ────────────────────────────────────────────────────────────────

async def _get_flip_or_404(db: aiosqlite.Connection, flip_id: int) -> dict:
    row = await db.execute_fetchall(
        """
        SELECT f.*, a.nom AS achat_nom, a.prix_achat AS achat_prix,
               v.prix_vente, v.date AS date_vente, v.plateforme AS vente_plateforme
        FROM flips f
        LEFT JOIN achats a ON a.id = f.achat_id
        LEFT JOIN ventes v ON v.id = f.vente_id
        WHERE f.id = ?
        """,
        (flip_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Flip introuvable")
    return dict(row[0])


async def _recalc_cout_pieces(db: aiosqlite.Connection, flip_id: int):
    rows = await db.execute_fetchall(
        "SELECT SUM(quantite * prix_unitaire) AS total FROM flip_pieces WHERE flip_id = ?",
        (flip_id,),
    )
    total = rows[0]["total"] or 0.0
    await db.execute(
        "UPDATE flips SET cout_pieces = ?, updated_at = ? WHERE id = ?",
        (total, datetime.utcnow().isoformat(), flip_id),
    )


async def _get_pieces(db: aiosqlite.Connection, flip_id: int) -> list[dict]:
    rows = await db.execute_fetchall(
        """
        SELECT fp.*, s.nom AS stock_nom, s.unite
        FROM flip_pieces fp
        JOIN stock s ON s.id = fp.stock_id
        WHERE fp.flip_id = ?
        ORDER BY fp.created_at
        """,
        (flip_id,),
    )
    return [dict(r) for r in rows]


async def _get_fichiers(db: aiosqlite.Connection, flip_id: int) -> list[dict]:
    rows = await db.execute_fetchall(
        "SELECT * FROM fichiers WHERE type_parent = 'flip' AND parent_id = ? ORDER BY created_at",
        (flip_id,),
    )
    return [dict(r) for r in rows]


async def _log(db, user_id, action, entite_id, details=""):
    await db.execute(
        "INSERT INTO logs (utilisateur_id, action, entite, entite_id, details, created_at) VALUES (?,?,?,?,?,?)",
        (user_id, action, "flip", entite_id, details, datetime.utcnow().isoformat()),
    )


# ─── CRUD Flips ─────────────────────────────────────────────────────────────

@router.get("")
async def list_flips(
    search: Optional[str] = None,
    statut: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    where, params = ["1=1"], []
    if search:
        where.append("(f.nom LIKE ? OR f.marque LIKE ? OR f.modele LIKE ? OR f.imei LIKE ?)")
        params.extend([f"%{search}%"] * 4)
    if statut:
        where.append("f.statut = ?")
        params.append(statut)

    base = f"""
        FROM flips f
        LEFT JOIN achats a ON a.id = f.achat_id
        WHERE {" AND ".join(where)}
    """
    total_row = await db.execute_fetchall(f"SELECT COUNT(*) AS n {base}", params)
    total = total_row[0]["n"]

    rows = await db.execute_fetchall(
        f"""
        SELECT f.*, a.nom AS achat_nom, a.prix_achat AS achat_prix
        {base}
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, skip],
    )
    return {"total": total, "items": [dict(r) for r in rows]}


@router.get("/{flip_id}")
async def get_flip(flip_id: int, db=Depends(get_db), user=Depends(get_current_user)):
    flip = await _get_flip_or_404(db, flip_id)
    flip["pieces"] = await _get_pieces(db, flip_id)
    flip["fichiers"] = await _get_fichiers(db, flip_id)
    return flip


@router.post("", status_code=201)
async def create_flip(
    payload: FlipCreate, db=Depends(get_db), user=Depends(get_current_user)
):
    now = datetime.utcnow().isoformat()

    # Vérification achat si fourni
    if payload.achat_id:
        row = await db.execute_fetchall(
            "SELECT id, prix_achat FROM achats WHERE id = ?", (payload.achat_id,)
        )
        if not row:
            raise HTTPException(status_code=404, detail="Achat introuvable")
        prix_achat = row[0]["prix_achat"]
    else:
        prix_achat = payload.prix_achat or 0.0

    cur = await db.execute(
        """
        INSERT INTO flips
            (achat_id, nom, marque, modele, imei, etat_initial, statut,
             notes, prix_achat, cout_pieces, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,0,?,?)
        """,
        (
            payload.achat_id,
            payload.nom,
            payload.marque,
            payload.modele,
            payload.imei,
            payload.etat_initial,
            payload.statut or "a_diagnostiquer",
            payload.notes,
            prix_achat,
            now,
            now,
        ),
    )
    flip_id = cur.lastrowid
    await _log(db, user["id"], "create", flip_id, payload.nom)
    await db.commit()
    return await get_flip(flip_id, db, user)


@router.put("/{flip_id}")
async def update_flip(
    flip_id: int,
    payload: FlipUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    await _get_flip_or_404(db, flip_id)
    data = payload.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")
    data["updated_at"] = datetime.utcnow().isoformat()
    sets = ", ".join(f"{k} = ?" for k in data)
    await db.execute(
        f"UPDATE flips SET {sets} WHERE id = ?", list(data.values()) + [flip_id]
    )
    await _log(db, user["id"], "update", flip_id, str(data))
    await db.commit()
    return await get_flip(flip_id, db, user)


@router.delete("/{flip_id}", status_code=204)
async def delete_flip(
    flip_id: int,
    db=Depends(get_db),
    user=Depends(get_current_user),
    _=Depends(require_role("admin")),
):
    flip = await _get_flip_or_404(db, flip_id)
    if flip["statut"] == "vendu":
        raise HTTPException(
            status_code=400,
            detail="Impossible de supprimer un flip vendu"
        )

    # ✅ await manquant sur delete_file
    fichiers = await _get_fichiers(db, flip_id)
    for f in fichiers:
        await delete_file(f["chemin"])

    await db.execute(
        "DELETE FROM fichiers WHERE type_parent = 'flip' AND parent_id = ?",
        (flip_id,),
    )
    await db.execute("DELETE FROM flip_pieces WHERE flip_id = ?", (flip_id,))
    await db.execute("DELETE FROM flips WHERE id = ?", (flip_id,))
    await _log(db, user["id"], "delete", flip_id, flip["nom"])
    await db.commit()


# ─── Statut ─────────────────────────────────────────────────────────────────

@router.patch("/{flip_id}/statut")
async def change_statut(
    flip_id: int,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    statuts_valides = [
        "a_diagnostiquer", "en_attente_pieces", "en_reparation",
        "pret_a_vendre", "en_vente", "vendu", "annule",
    ]
    statut = body.get("statut")
    if statut not in statuts_valides:
        raise HTTPException(status_code=400, detail="Statut invalide")

    flip = await _get_flip_or_404(db, flip_id)
    if flip["statut"] == "vendu" and statut != "vendu":
        raise HTTPException(status_code=400, detail="Flip déjà vendu")

    now = datetime.utcnow().isoformat()
    await db.execute(
        "UPDATE flips SET statut = ?, updated_at = ? WHERE id = ?",
        (statut, now, flip_id),
    )
    await _log(db, user["id"], "statut", flip_id, statut)
    await db.commit()
    return await get_flip(flip_id, db, user)


# ─── Pièces ─────────────────────────────────────────────────────────────────

@router.post("/{flip_id}/pieces", status_code=201)
async def add_piece(
    flip_id: int,
    payload: FlipPieceCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    await _get_flip_or_404(db, flip_id)

    # Vérifie que l'article stock existe et récupère son prix unitaire moyen
    rows = await db.execute_fetchall(
        "SELECT id, nom, quantite FROM stock WHERE id = ? AND actif = 1",
        (payload.stock_id,),
    )
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"Article stock #{payload.stock_id} introuvable ou archivé",
        )

    # Décrémente stock (lève 400 si insuffisant)
    await decrementer_stock(
        db,
        payload.stock_id,
        payload.quantite,
        reference_id=flip_id,
        reference_type="flip",
    )

    # ✅ Prix : fourni par l'utilisateur, sinon 0.0
    # Le frontend affiche un champ optionnel pour saisir le prix unitaire
    prix = payload.prix_unitaire if payload.prix_unitaire is not None else 0.0

    now = datetime.utcnow().isoformat()
    await db.execute(
        """
        INSERT INTO flip_pieces
            (flip_id, stock_id, quantite, prix_unitaire, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (flip_id, payload.stock_id, payload.quantite, prix, now),
    )
    await _recalc_cout_pieces(db, flip_id)
    await _log(
        db,
        user["id"],
        "add_piece",
        flip_id,
        f"stock_id={payload.stock_id} qte={payload.quantite} prix={prix}",
    )
    await db.commit()
    return await get_flip(flip_id, db, user)


@router.delete("/{flip_id}/pieces/{piece_id}", status_code=204)
async def remove_piece(
    flip_id: int,
    piece_id: int,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT * FROM flip_pieces WHERE id = ? AND flip_id = ?", (piece_id, flip_id)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Pièce introuvable")
    piece = dict(rows[0])

    # Ré-incrémente le stock (mouvement retour)
    now = datetime.utcnow().isoformat()
    await db.execute(
        "UPDATE stock SET quantite = quantite + ?, updated_at = ? WHERE id = ?",
        (piece["quantite"], now, piece["stock_id"]),
    )
    await db.execute(
        """
        INSERT INTO stock_mouvements
            (stock_id, type_mouvement, quantite, motif, reference_id, reference_type, created_at)
        VALUES (?,?,?,?,?,?,?)
        """,
        (piece["stock_id"], "entree", piece["quantite"], "retrait pièce flip", flip_id, "flip", now),
    )
    await db.execute("DELETE FROM flip_pieces WHERE id = ?", (piece_id,))
    await _recalc_cout_pieces(db, flip_id)
    await _log(db, user["id"], "remove_piece", flip_id, f"piece_id={piece_id}")
    await db.commit()


# ─── Fichiers ────────────────────────────────────────────────────────────────

@router.post("/{flip_id}/fichiers", status_code=201)
async def upload_fichier(
    flip_id: int,
    file: UploadFile = File(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    await _get_flip_or_404(db, flip_id)
    meta = await save_upload(file, "flip", flip_id)
    now = datetime.utcnow().isoformat()
    cur = await db.execute(
        """
        INSERT INTO fichiers
            (type_parent, parent_id, nom_original, chemin, mime_type, taille, categorie, created_at)
        VALUES (?,?,?,?,?,?,?,?)
        """,
        ("flip", flip_id, meta["nom_original"], meta["chemin"],
         meta["mime_type"], meta["taille"], "photo", now),
    )
    await db.commit()
    row = await db.execute_fetchall("SELECT * FROM fichiers WHERE id = ?", (cur.lastrowid,))
    return dict(row[0])


@router.delete("/{flip_id}/fichiers/{fichier_id}", status_code=204)
async def delete_fichier(
    flip_id: int,
    fichier_id: int,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT * FROM fichiers WHERE id = ? AND type_parent = 'flip' AND parent_id = ?",
        (fichier_id, flip_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    # ✅ await manquant
    await delete_file(rows[0]["chemin"])
    await db.execute("DELETE FROM fichiers WHERE id = ?", (fichier_id,))
    await db.commit()