from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from backend.database import get_db
from backend.auth import get_current_user, require_role
from backend.models import ReparationCreate, ReparationUpdate, ReparationPieceCreate
from backend.services.stock_service import decrementer_stock
from backend.services.files_service import save_upload, delete_file
import aiosqlite
import json
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

router = APIRouter(prefix="/api/reparations", tags=["reparations"])


async def _get_garantie_mois(db: aiosqlite.Connection) -> int:
    rows = await db.execute_fetchall(
        "SELECT valeur FROM parametres WHERE cle = 'garantie_mois'", []
    )
    if rows:
        try:
            return int(rows[0]["valeur"])
        except (ValueError, TypeError):
            pass
    return 3


async def _recalc_cout_pieces(db: aiosqlite.Connection, reparation_id: int):
    rows = await db.execute_fetchall(
        """SELECT COALESCE(SUM(quantite * prix_unitaire), 0) as total
           FROM reparation_pieces WHERE reparation_id = ?""",
        [reparation_id],
    )
    total = rows[0]["total"] if rows else 0
    await db.execute(
        "UPDATE reparations SET cout_pieces = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [total, reparation_id],
    )


# ── Liste ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_reparations(
    search: str = Query(default=""),
    statut: str = Query(default=""),
    client_id: int = Query(default=0),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    conditions = []
    params = []

    if search:
        conditions.append(
            "(r.appareil LIKE ? OR r.marque LIKE ? OR r.modele LIKE ?"
            " OR r.telephone LIKE ? OR c.nom LIKE ?)"
        )
        like = f"%{search}%"
        params.extend([like, like, like, like, like])
    if statut:
        conditions.append("r.statut = ?")
        params.append(statut)
    if client_id:
        conditions.append("r.client_id = ?")
        params.append(client_id)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total_row = await db.execute_fetchall(
        f"""SELECT COUNT(*) as n FROM reparations r
            LEFT JOIN clients c ON c.id = r.client_id {where}""",
        params,
    )
    total = total_row[0]["n"]

    rows = await db.execute_fetchall(
        f"""SELECT r.*, c.nom as client_nom
            FROM reparations r
            LEFT JOIN clients c ON c.id = r.client_id
            {where}
            ORDER BY r.date_reception DESC
            LIMIT ? OFFSET ?""",
        params + [limit, skip],
    )

    return {"total": total, "items": [dict(r) for r in rows]}


# ── Détail ────────────────────────────────────────────────────────────────────

@router.get("/{rep_id}")
async def get_reparation(
    rep_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        """SELECT r.*, c.nom as client_nom, c.telephone as client_telephone
           FROM reparations r
           LEFT JOIN clients c ON c.id = r.client_id
           WHERE r.id = ?""",
        [rep_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Réparation introuvable")

    pieces = await db.execute_fetchall(
        """SELECT rp.*, s.nom as stock_nom
           FROM reparation_pieces rp
           JOIN stock s ON s.id = rp.stock_id
           WHERE rp.reparation_id = ? ORDER BY rp.created_at ASC""",
        [rep_id],
    )
    fichiers = await db.execute_fetchall(
        """SELECT * FROM fichiers
           WHERE type_parent = 'reparation' AND parent_id = ?
           ORDER BY created_at ASC""",
        [rep_id],
    )

    rep = dict(rows[0])
    rep["pieces"] = [dict(p) for p in pieces]
    rep["fichiers"] = [dict(f) for f in fichiers]
    return rep


# ── Création ──────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_reparation(
    payload: ReparationCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    cur = await db.execute(
        """INSERT INTO reparations (
               date_reception, client_id, telephone, appareil, marque, modele,
               panne_decrite, diagnostic, reparation_effectuee, statut,
               cout_pieces, prix_facture, acompte, date_restitution,
               date_fin_garantie, notes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            payload.date_reception, payload.client_id, payload.telephone,
            payload.appareil, payload.marque, payload.modele,
            payload.panne_decrite, payload.diagnostic,
            payload.reparation_effectuee, payload.statut or "recu",
            0, payload.prix_facture, payload.acompte,
            payload.date_restitution, payload.date_fin_garantie, payload.notes,
        ],
    )
    await db.commit()
    rep_id = cur.lastrowid

    await db.execute(
        """INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
           VALUES (?, 'create', 'reparation', ?, ?)""",
        [current_user["id"], rep_id, json.dumps({"appareil": payload.appareil})],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM reparations WHERE id = ?", [rep_id]
    )
    return dict(rows[0])


# ── Mise à jour ───────────────────────────────────────────────────────────────

@router.put("/{rep_id}")
async def update_reparation(
    rep_id: int,
    payload: ReparationUpdate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT * FROM reparations WHERE id = ?", [rep_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Réparation introuvable")

    current = dict(rows[0])
    data = payload.model_dump(exclude_none=True)

    # Calcul garantie exact avec relativedelta
    if "statut" in data and data["statut"] == "livre":
        date_rest = data.get("date_restitution") or current.get("date_restitution")
        if date_rest and "date_fin_garantie" not in data:
            garantie_mois = await _get_garantie_mois(db)
            if isinstance(date_rest, str):
                date_rest = date.fromisoformat(date_rest)
            data["date_fin_garantie"] = str(
                date_rest + relativedelta(months=garantie_mois)
            )

    if not data:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")

    sets = ", ".join(f"{k} = ?" for k in data)
    vals = list(data.values()) + [rep_id]
    await db.execute(
        f"UPDATE reparations SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        vals,
    )
    await db.execute(
        """INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
           VALUES (?, 'update', 'reparation', ?, ?)""",
        [current_user["id"], rep_id, json.dumps(data)],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM reparations WHERE id = ?", [rep_id]
    )
    return dict(rows[0])


# ── Suppression ───────────────────────────────────────────────────────────────

@router.delete("/{rep_id}", status_code=204)
async def delete_reparation(
    rep_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(require_role("admin")),
):
    rows = await db.execute_fetchall(
        "SELECT statut FROM reparations WHERE id = ?", [rep_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Réparation introuvable")
    if rows[0]["statut"] == "livre":
        raise HTTPException(
            status_code=400,
            detail="Impossible de supprimer une réparation livrée",
        )

    fichiers = await db.execute_fetchall(
        "SELECT chemin FROM fichiers WHERE type_parent = 'reparation' AND parent_id = ?",
        [rep_id],
    )
    for f in fichiers:
        await delete_file(f["chemin"])

    await db.execute("DELETE FROM reparation_pieces WHERE reparation_id = ?", [rep_id])
    await db.execute(
        "DELETE FROM fichiers WHERE type_parent = 'reparation' AND parent_id = ?",
        [rep_id],
    )
    await db.execute("DELETE FROM reparations WHERE id = ?", [rep_id])
    await db.execute(
        """INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
           VALUES (?, 'delete', 'reparation', ?, ?)""",
        [current_user["id"], rep_id, json.dumps({"rep_id": rep_id})],
    )
    await db.commit()


# ── Pièces ────────────────────────────────────────────────────────────────────

@router.post("/{rep_id}/pieces", status_code=201)
async def add_piece(
    rep_id: int,
    payload: ReparationPieceCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT id FROM reparations WHERE id = ?", [rep_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Réparation introuvable")

    stock_rows = await db.execute_fetchall(
        "SELECT nom, prix_unitaire FROM stock WHERE id = ? AND actif = 1",
        [payload.stock_id],
    )
    if not stock_rows:
        raise HTTPException(status_code=404, detail="Article stock introuvable")

    prix = payload.prix_unitaire
    if prix is None:
        prix = stock_rows[0]["prix_unitaire"] or 0

    await decrementer_stock(db, payload.stock_id, payload.quantite, rep_id, "reparation")

    await db.execute(
        """INSERT INTO reparation_pieces
               (reparation_id, stock_id, quantite, prix_unitaire)
           VALUES (?, ?, ?, ?)""",
        [rep_id, payload.stock_id, payload.quantite, prix],
    )
    await _recalc_cout_pieces(db, rep_id)
    await db.execute(
        """INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
           VALUES (?, 'add_piece', 'reparation', ?, ?)""",
        [current_user["id"], rep_id,
         json.dumps({"stock_id": payload.stock_id, "quantite": payload.quantite,
                     "nom": stock_rows[0]["nom"]})],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM reparations WHERE id = ?", [rep_id]
    )
    return dict(rows[0])


@router.delete("/{rep_id}/pieces/{piece_id}", status_code=204)
async def remove_piece(
    rep_id: int,
    piece_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT * FROM reparation_pieces WHERE id = ? AND reparation_id = ?",
        [piece_id, rep_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Pièce introuvable")

    piece = dict(rows[0])
    await db.execute(
        "UPDATE stock SET quantite = quantite + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [piece["quantite"], piece["stock_id"]],
    )
    await db.execute(
        """INSERT INTO stock_mouvements
               (stock_id, type_mouvement, quantite, motif, reference_id, reference_type)
           VALUES (?, 'entree', ?, 'retrait_piece_reparation', ?, 'reparation')""",
        [piece["stock_id"], piece["quantite"], rep_id],
    )
    await db.execute("DELETE FROM reparation_pieces WHERE id = ?", [piece_id])
    await _recalc_cout_pieces(db, rep_id)
    await db.execute(
        """INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
           VALUES (?, 'remove_piece', 'reparation', ?, ?)""",
        [current_user["id"], rep_id, json.dumps({"piece_id": piece_id})],
    )
    await db.commit()


# ── Fichiers ──────────────────────────────────────────────────────────────────

@router.post("/{rep_id}/fichiers", status_code=201)
async def upload_fichier(
    rep_id: int,
    file: UploadFile = File(...),
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT id FROM reparations WHERE id = ?", [rep_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Réparation introuvable")

    saved = await save_upload(file, "reparation", rep_id)
    cur = await db.execute(
        """INSERT INTO fichiers
               (type_parent, parent_id, nom_original, chemin,
                mime_type, taille, categorie)
           VALUES ('reparation', ?, ?, ?, ?, ?, 'photo')""",
        [rep_id, saved["nom_original"], saved["chemin"],
         saved["mime_type"], saved["taille"]],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM fichiers WHERE id = ?", [cur.lastrowid]
    )
    return dict(rows[0])


@router.delete("/{rep_id}/fichiers/{fichier_id}", status_code=204)
async def delete_fichier(
    rep_id: int,
    fichier_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        """SELECT * FROM fichiers
           WHERE id = ? AND type_parent = 'reparation' AND parent_id = ?""",
        [fichier_id, rep_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    await delete_file(rows[0]["chemin"])
    await db.execute("DELETE FROM fichiers WHERE id = ?", [fichier_id])
    await db.commit()


# ── Reçu ──────────────────────────────────────────────────────────────────────

@router.get("/{rep_id}/recu")
async def get_recu(
    rep_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        """SELECT r.*, c.nom as client_nom, c.telephone as client_telephone,
                  c.email as client_email
           FROM reparations r
           LEFT JOIN clients c ON c.id = r.client_id
           WHERE r.id = ?""",
        [rep_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Réparation introuvable")

    params_rows = await db.execute_fetchall(
        """SELECT cle, valeur FROM parametres
           WHERE cle IN ('societe_nom', 'societe_adresse', 'societe_telephone',
                         'societe_email', 'societe_siret')""",
        [],
    )
    societe = {r["cle"]: r["valeur"] for r in params_rows}

    pieces = await db.execute_fetchall(
        """SELECT rp.quantite, rp.prix_unitaire, s.nom as stock_nom
           FROM reparation_pieces rp
           JOIN stock s ON s.id = rp.stock_id
           WHERE rp.reparation_id = ?""",
        [rep_id],
    )

    rep = dict(rows[0])
    rep["pieces"] = [dict(p) for p in pieces]
    rep["societe"] = societe
    return rep