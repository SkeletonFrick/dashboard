from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from backend.database import get_db
from backend.auth import get_current_user, require_role
from backend.models import VenteCreate, VenteUpdate
from backend.services.files_service import save_upload, delete_file
import aiosqlite
import json

router = APIRouter(prefix="/api/ventes", tags=["ventes"])


# ── Liste ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_ventes(
    search: str = Query(default=""),
    categorie: str = Query(default=""),
    plateforme: str = Query(default=""),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    conditions = []
    params = []

    if search:
        conditions.append("(v.nom LIKE ? OR v.notes LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like])

    if categorie:
        conditions.append("v.categorie = ?")
        params.append(categorie)

    if plateforme:
        conditions.append("v.plateforme = ?")
        params.append(plateforme)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total_row = await db.execute_fetchall(
        f"SELECT COUNT(*) as n FROM ventes v {where}", params
    )
    total = total_row[0]["n"]

    rows = await db.execute_fetchall(
        f"""
        SELECT v.*,
               a.nom as achat_nom, a.prix_achat as achat_prix,
               f.nom as flip_nom, f.prix_achat as flip_prix_achat,
               f.cout_pieces as flip_cout_pieces
        FROM ventes v
        LEFT JOIN achats a ON a.id = v.achat_id
        LEFT JOIN flips f ON f.id = v.flip_id
        {where}
        ORDER BY v.date DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, skip],
    )

    items = []
    for r in rows:
        d = dict(r)
        # Calcul marge selon source
        if d.get("flip_id") and d.get("flip_prix_achat") is not None:
            cout = (d["flip_prix_achat"] or 0) + (d["flip_cout_pieces"] or 0)
            d["marge"] = d["prix_vente"] - cout
        elif d.get("achat_id") and d.get("achat_prix") is not None:
            d["marge"] = d["prix_vente"] - d["achat_prix"]
        else:
            d["marge"] = None
        items.append(d)

    return {"total": total, "items": items}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    par_plateforme = await db.execute_fetchall(
        """
        SELECT plateforme,
               COUNT(*) as nb,
               SUM(prix_vente) as ca
        FROM ventes
        WHERE plateforme IS NOT NULL AND plateforme != ''
        GROUP BY plateforme
        ORDER BY ca DESC
        """,
        [],
    )

    par_categorie = await db.execute_fetchall(
        """
        SELECT categorie,
               COUNT(*) as nb,
               SUM(prix_vente) as ca
        FROM ventes
        WHERE categorie IS NOT NULL AND categorie != ''
        GROUP BY categorie
        ORDER BY ca DESC
        """,
        [],
    )

    totaux = await db.execute_fetchall(
        """
        SELECT COUNT(*) as nb,
               COALESCE(SUM(prix_vente), 0) as ca_total
        FROM ventes
        """,
        [],
    )

    return {
        "totaux": dict(totaux[0]) if totaux else {},
        "par_plateforme": [dict(r) for r in par_plateforme],
        "par_categorie": [dict(r) for r in par_categorie],
    }


# ── Détail ────────────────────────────────────────────────────────────────────

@router.get("/{vente_id}")
async def get_vente(
    vente_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        """
        SELECT v.*,
               a.nom as achat_nom, a.prix_achat as achat_prix,
               f.nom as flip_nom, f.prix_achat as flip_prix_achat,
               f.cout_pieces as flip_cout_pieces
        FROM ventes v
        LEFT JOIN achats a ON a.id = v.achat_id
        LEFT JOIN flips f ON f.id = v.flip_id
        WHERE v.id = ?
        """,
        [vente_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Vente introuvable")

    fichiers = await db.execute_fetchall(
        """
        SELECT * FROM fichiers
        WHERE type_parent = 'vente' AND parent_id = ?
        ORDER BY created_at ASC
        """,
        [vente_id],
    )

    d = dict(rows[0])
    if d.get("flip_id") and d.get("flip_prix_achat") is not None:
        cout = (d["flip_prix_achat"] or 0) + (d["flip_cout_pieces"] or 0)
        d["marge"] = d["prix_vente"] - cout
    elif d.get("achat_id") and d.get("achat_prix") is not None:
        d["marge"] = d["prix_vente"] - d["achat_prix"]
    else:
        d["marge"] = None

    d["fichiers"] = [dict(f) for f in fichiers]
    return d


# ── Création ──────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_vente(
    payload: VenteCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    # Si lié à un flip → mettre à jour flip.vente_id + statut vendu
    if payload.flip_id:
        flip_rows = await db.execute_fetchall(
            "SELECT id, statut FROM flips WHERE id = ?", [payload.flip_id]
        )
        if not flip_rows:
            raise HTTPException(status_code=404, detail="Flip introuvable")

    cur = await db.execute(
        """
        INSERT INTO ventes (date, nom, categorie, plateforme,
                            prix_vente, achat_id, flip_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.date,
            payload.nom,
            payload.categorie,
            payload.plateforme,
            payload.prix_vente,
            payload.achat_id,
            payload.flip_id,
            payload.notes,
        ],
    )
    await db.commit()
    vente_id = cur.lastrowid

    # Lier le flip à cette vente et passer en "vendu"
    if payload.flip_id:
        await db.execute(
            """
            UPDATE flips
            SET vente_id = ?, statut = 'vendu',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            [vente_id, payload.flip_id],
        )

    await db.execute(
        """
        INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
        VALUES (?, 'create', 'vente', ?, ?)
        """,
        [current_user["id"], vente_id, json.dumps({"nom": payload.nom})],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM ventes WHERE id = ?", [vente_id]
    )
    return dict(rows[0])


# ── Mise à jour ───────────────────────────────────────────────────────────────

@router.put("/{vente_id}")
async def update_vente(
    vente_id: int,
    payload: VenteUpdate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT * FROM ventes WHERE id = ?", [vente_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Vente introuvable")

    data = payload.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")

    sets = ", ".join(f"{k} = ?" for k in data)
    vals = list(data.values()) + [vente_id]
    await db.execute(
        f"UPDATE ventes SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        vals,
    )
    await db.execute(
        """
        INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
        VALUES (?, 'update', 'vente', ?, ?)
        """,
        [current_user["id"], vente_id, json.dumps(data)],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM ventes WHERE id = ?", [vente_id]
    )
    return dict(rows[0])


# ── Suppression ───────────────────────────────────────────────────────────────

@router.delete("/{vente_id}", status_code=204)
async def delete_vente(
    vente_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(require_role("admin")),
):
    rows = await db.execute_fetchall(
        "SELECT * FROM ventes WHERE id = ?", [vente_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Vente introuvable")

    vente = dict(rows[0])

    # Délier le flip si besoin
    if vente.get("flip_id"):
        await db.execute(
            """
            UPDATE flips
            SET vente_id = NULL, statut = 'pret_a_vendre',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND vente_id = ?
            """,
            [vente["flip_id"], vente_id],
        )

    fichiers = await db.execute_fetchall(
        "SELECT chemin FROM fichiers WHERE type_parent = 'vente' AND parent_id = ?",
        [vente_id],
    )
    for f in fichiers:
        delete_file(f["chemin"])

    await db.execute(
        "DELETE FROM fichiers WHERE type_parent = 'vente' AND parent_id = ?",
        [vente_id],
    )
    await db.execute("DELETE FROM ventes WHERE id = ?", [vente_id])
    await db.execute(
        """
        INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
        VALUES (?, 'delete', 'vente', ?, ?)
        """,
        [current_user["id"], vente_id, json.dumps({"vente_id": vente_id})],
    )
    await db.commit()


# ── Fichiers ──────────────────────────────────────────────────────────────────

@router.post("/{vente_id}/fichiers", status_code=201)
async def upload_fichier(
    vente_id: int,
    file: UploadFile = File(...),
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT id FROM ventes WHERE id = ?", [vente_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Vente introuvable")

    saved = await save_upload(file, "vente", vente_id)

    cur = await db.execute(
        """
        INSERT INTO fichiers
            (type_parent, parent_id, nom_original, chemin, mime_type, taille, categorie)
        VALUES ('vente', ?, ?, ?, ?, ?, 'justificatif')
        """,
        [
            vente_id,
            saved["nom_original"],
            saved["chemin"],
            saved["mime_type"],
            saved["taille"],
        ],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM fichiers WHERE id = ?", [cur.lastrowid]
    )
    return dict(rows[0])


@router.delete("/{vente_id}/fichiers/{fichier_id}", status_code=204)
async def delete_fichier(
    vente_id: int,
    fichier_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        """
        SELECT * FROM fichiers
        WHERE id = ? AND type_parent = 'vente' AND parent_id = ?
        """,
        [fichier_id, vente_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    delete_file(rows[0]["chemin"])
    await db.execute("DELETE FROM fichiers WHERE id = ?", [fichier_id])
    await db.commit()