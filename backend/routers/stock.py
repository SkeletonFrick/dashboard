from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query
from backend.database import get_db
from backend.auth import get_current_user, require_role
from backend.models import (
    StockCreate,
    StockUpdate,
    StockMouvementCreate,
    StockCommandeUpdate,
)
from backend.services.stock_service import decrementer_stock

router = APIRouter(prefix="/api/stock", tags=["stock"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_404(db, stock_id: int):
    async with db.execute(
        "SELECT * FROM stock WHERE id = ? AND actif = 1", (stock_id,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Article introuvable")
    return row


async def _log(db, user_id: int, action: str, entite_id: int, details: str = ""):
    await db.execute(
        """INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
           VALUES (?, ?, 'stock', ?, ?)""",
        (user_id, action, entite_id, details),
    )


# ── Liste ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_stock(
    search: str = Query(""),
    alerte_seulement: bool = Query(False),
    categorie: str = Query(""),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    conditions = ["s.actif = 1"]
    params: list = []

    if search:
        conditions.append("s.nom LIKE ?")
        params.append(f"%{search}%")
    if categorie:
        conditions.append("s.categorie = ?")
        params.append(categorie)
    if alerte_seulement:
        conditions.append("s.quantite <= s.stock_minimal")

    where = " AND ".join(conditions)

    async with db.execute(
        f"SELECT COUNT(*) FROM stock s WHERE {where}", params
    ) as cur:
        total = (await cur.fetchone())[0]

    offset = (page - 1) * per_page
    async with db.execute(
        f"""SELECT s.*, f.nom as fournisseur_nom
            FROM stock s
            LEFT JOIN fournisseurs f ON f.id = s.fournisseur_id
            WHERE {where}
            ORDER BY s.nom ASC
            LIMIT ? OFFSET ?""",
        [*params, per_page, offset],
    ) as cur:
        rows = await cur.fetchall()

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [dict(r) for r in rows],
    }


# ── Alertes ───────────────────────────────────────────────────────────────────

@router.get("/alertes")
async def get_alertes(
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    async with db.execute(
        """SELECT s.*, f.nom as fournisseur_nom
           FROM stock s
           LEFT JOIN fournisseurs f ON f.id = s.fournisseur_id
           WHERE s.actif = 1 AND s.quantite <= s.stock_minimal
           ORDER BY (s.stock_minimal - s.quantite) DESC"""
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


# ── Commandes en retard ───────────────────────────────────────────────────────

@router.get("/commandes-en-retard")
async def get_commandes_en_retard(
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    today = date_type.today().isoformat()
    async with db.execute(
        """
        SELECT s.*, f.nom as fournisseur_nom
        FROM stock s
        LEFT JOIN fournisseurs f ON f.id = s.fournisseur_id
        WHERE s.actif = 1
          AND s.commande_en_cours = 1
          AND s.date_arrivee_prevue IS NOT NULL
          AND s.date_arrivee_prevue < ?
        ORDER BY s.date_arrivee_prevue ASC
        """,
        (today,),
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


# ── Catégories stock ──────────────────────────────────────────────────────────

@router.get("/categories")
async def get_categories_stock(
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Retourne les catégories distinctes des articles stock actifs."""
    async with db.execute(
        """SELECT DISTINCT categorie FROM stock
           WHERE actif = 1 AND categorie IS NOT NULL AND categorie != ''
           ORDER BY categorie ASC"""
    ) as cur:
        rows = await cur.fetchall()
    return [r[0] for r in rows]


# ── Détail ────────────────────────────────────────────────────────────────────

@router.get("/{stock_id}")
async def get_article(
    stock_id: int,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    async with db.execute(
        """SELECT s.*, f.nom as fournisseur_nom
           FROM stock s
           LEFT JOIN fournisseurs f ON f.id = s.fournisseur_id
           WHERE s.id = ? AND s.actif = 1""",
        (stock_id,),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Article introuvable")
    return dict(row)


# ── Créer ─────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_article(
    data: StockCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    async with db.execute(
        """INSERT INTO stock
               (nom, categorie, quantite, stock_minimal, fournisseur_id,
                unite, reference, emplacement, notes, commande_en_cours)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
        (
            data.nom, data.categorie, data.quantite, data.stock_minimal,
            data.fournisseur_id, data.unite, data.reference,
            data.emplacement, data.notes,
        ),
    ) as cur:
        stock_id = cur.lastrowid

    if data.quantite > 0:
        await db.execute(
            """INSERT INTO stock_mouvements
                   (stock_id, type_mouvement, quantite, motif)
               VALUES (?, 'entree', ?, 'Stock initial')""",
            (stock_id, data.quantite),
        )

    await _log(db, user["id"], "create", stock_id, data.nom)
    await db.commit()
    return {"id": stock_id}


# ── Modifier ──────────────────────────────────────────────────────────────────

@router.put("/{stock_id}")
async def update_article(
    stock_id: int,
    data: StockUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    await _get_or_404(db, stock_id)

    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "Aucun champ à mettre à jour")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    set_clause += ", updated_at = datetime('now')"
    values = [*fields.values(), stock_id]

    await db.execute(f"UPDATE stock SET {set_clause} WHERE id = ?", values)
    await _log(db, user["id"], "update", stock_id, str(fields))
    await db.commit()

    async with db.execute(
        """SELECT s.*, f.nom as fournisseur_nom
           FROM stock s
           LEFT JOIN fournisseurs f ON f.id = s.fournisseur_id
           WHERE s.id = ? AND s.actif = 1""",
        (stock_id,),
    ) as cur:
        row = await cur.fetchone()
    return dict(row)


# ── Supprimer (archivage) ─────────────────────────────────────────────────────

@router.delete("/{stock_id}", status_code=204)
async def delete_article(
    stock_id: int,
    db=Depends(get_db),
    user=Depends(require_role("admin")),
):
    await _get_or_404(db, stock_id)
    await db.execute(
        "UPDATE stock SET actif = 0, updated_at = datetime('now') WHERE id = ?",
        (stock_id,),
    )
    await _log(db, user["id"], "archive", stock_id)
    await db.commit()


# ── Mouvement manuel ──────────────────────────────────────────────────────────

@router.post("/{stock_id}/mouvement", status_code=201)
async def add_mouvement(
    stock_id: int,
    data: StockMouvementCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    await _get_or_404(db, stock_id)

    if data.type_mouvement == "sortie":
        await decrementer_stock(
            db, stock_id, data.quantite,
            data.reference_id or 0, data.reference_type or "manuel",
        )
    elif data.type_mouvement == "entree":
        await db.execute(
            "UPDATE stock SET quantite = quantite + ?, updated_at = datetime('now') WHERE id = ?",
            (data.quantite, stock_id),
        )
        await db.execute(
            """INSERT INTO stock_mouvements
                   (stock_id, type_mouvement, quantite, motif, reference_id, reference_type)
               VALUES (?, 'entree', ?, ?, ?, ?)""",
            (stock_id, data.quantite, data.motif or "Entrée manuelle",
             data.reference_id, data.reference_type),
        )
    elif data.type_mouvement == "correction":
        if data.quantite < 0:
            raise HTTPException(400, "La quantité de correction doit être >= 0")
        await db.execute(
            "UPDATE stock SET quantite = ?, updated_at = datetime('now') WHERE id = ?",
            (data.quantite, stock_id),
        )
        await db.execute(
            """INSERT INTO stock_mouvements
                   (stock_id, type_mouvement, quantite, motif)
               VALUES (?, 'correction', ?, ?)""",
            (stock_id, data.quantite, data.motif or "Correction inventaire"),
        )
    else:
        raise HTTPException(400, f"Type de mouvement inconnu : {data.type_mouvement}")

    await _log(db, user["id"], "mouvement", stock_id,
               f"{data.type_mouvement} {data.quantite}")
    await db.commit()
    return {"ok": True}


# ── Historique mouvements ─────────────────────────────────────────────────────

@router.get("/{stock_id}/mouvements")
async def get_mouvements(
    stock_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    await _get_or_404(db, stock_id)

    async with db.execute(
        "SELECT COUNT(*) FROM stock_mouvements WHERE stock_id = ?", (stock_id,)
    ) as cur:
        total = (await cur.fetchone())[0]

    offset = (page - 1) * per_page
    async with db.execute(
        """SELECT * FROM stock_mouvements
           WHERE stock_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?""",
        (stock_id, per_page, offset),
    ) as cur:
        rows = await cur.fetchall()

    return {
        "total": total, "page": page, "per_page": per_page,
        "items": [dict(r) for r in rows],
    }


# ── Commande ──────────────────────────────────────────────────────────────────

@router.patch("/{stock_id}/commande")
async def update_commande(
    stock_id: int,
    data: StockCommandeUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    await _get_or_404(db, stock_id)
    await db.execute(
        """UPDATE stock
           SET commande_en_cours = ?,
               quantite_commandee = ?,
               date_arrivee_prevue = ?,
               updated_at = datetime('now')
           WHERE id = ?""",
        (1 if data.commande_en_cours else 0,
         data.quantite_commandee or 0,
         data.date_arrivee_prevue, stock_id),
    )
    await _log(db, user["id"], "commande", stock_id,
               f"commande_en_cours={data.commande_en_cours}")
    await db.commit()
    return {"ok": True}


# ── Réceptionner ──────────────────────────────────────────────────────────────

@router.post("/{stock_id}/receptionner")
async def receptionner(
    stock_id: int,
    quantite: int = Query(..., ge=1),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    await _get_or_404(db, stock_id)
    await db.execute(
        """UPDATE stock
           SET quantite = quantite + ?,
               commande_en_cours = 0,
               quantite_commandee = 0,
               date_arrivee_prevue = NULL,
               updated_at = datetime('now')
           WHERE id = ?""",
        (quantite, stock_id),
    )
    await db.execute(
        """INSERT INTO stock_mouvements
               (stock_id, type_mouvement, quantite, motif)
           VALUES (?, 'entree', ?, 'Réception commande')""",
        (stock_id, quantite),
    )
    await _log(db, user["id"], "receptionner", stock_id, f"+{quantite}")
    await db.commit()
    return {"ok": True}