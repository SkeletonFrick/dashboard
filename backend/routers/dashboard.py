# backend/routers/dashboard.py

from fastapi import APIRouter, Depends, Query
import aiosqlite
from backend.auth import get_current_user
from backend.database import get_db
from datetime import date as date_type

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    # ── CA ventes du mois ────────────────────────────────────────────────────
    async with db.execute(
        """
        SELECT COALESCE(SUM(prix_vente), 0) AS ca
        FROM ventes
        WHERE strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
        """
    ) as cur:
        ca_ventes = float((await cur.fetchone())["ca"])

    # ── CA réparations du mois ───────────────────────────────────────────────
    async with db.execute(
        """
        SELECT COALESCE(SUM(prix_facture), 0) AS ca
        FROM reparations
        WHERE statut = 'livre'
          AND strftime('%Y-%m', date_restitution) = strftime('%Y-%m', 'now')
        """
    ) as cur:
        ca_reparations = float((await cur.fetchone())["ca"])

    ca_total = ca_ventes + ca_reparations

    # ── Marge brute du mois ──────────────────────────────────────────────────
    async with db.execute(
        """
        SELECT COALESCE(SUM(
            CASE
                WHEN v.flip_id IS NOT NULL
                    THEN v.prix_vente
                         - COALESCE(f.prix_achat, 0)
                         - COALESCE(f.cout_pieces, 0)
                WHEN v.achat_id IS NOT NULL
                    THEN v.prix_vente - COALESCE(a.prix_achat, 0)
                ELSE v.prix_vente
            END
        ), 0) AS marge
        FROM ventes v
        LEFT JOIN flips f  ON v.flip_id  = f.id
        LEFT JOIN achats a ON v.achat_id = a.id
        WHERE strftime('%Y-%m', v.date) = strftime('%Y-%m', 'now')
        """
    ) as cur:
        marge_brute = float((await cur.fetchone())["marge"])

    # ── Réparations en cours ─────────────────────────────────────────────────
    async with db.execute(
        """
        SELECT COUNT(*) AS nb
        FROM reparations
        WHERE statut NOT IN ('livre', 'annule')
        """
    ) as cur:
        nb_reparations_en_cours = int((await cur.fetchone())["nb"])

    # ── Alertes stock ─────────────────────────────────────────────────────────
    async with db.execute(
        """
        SELECT COUNT(*) AS nb
        FROM stock
        WHERE actif = 1 AND quantite <= stock_minimal
        """
    ) as cur:
        nb_alertes_stock = int((await cur.fetchone())["nb"])

    # ── Ruptures (quantite = 0) ──────────────────────────────────────────────
    async with db.execute(
        """
        SELECT COUNT(*) AS nb
        FROM stock
        WHERE actif = 1 AND quantite = 0
        """
    ) as cur:
        nb_ruptures = int((await cur.fetchone())["nb"])

    # ── Commandes en retard ──────────────────────────────────────────────────
    today = date_type.today().isoformat()
    async with db.execute(
        """
        SELECT COUNT(*) AS nb
        FROM stock
        WHERE actif = 1
          AND commande_en_cours = 1
          AND date_arrivee_prevue IS NOT NULL
          AND date_arrivee_prevue < ?
        """,
        (today,),
    ) as cur:
        nb_commandes_retard = int((await cur.fetchone())["nb"])

    # ── Détail alertes stock ─────────────────────────────────────────────────
    async with db.execute(
        """
        SELECT s.id, s.nom, s.quantite, s.stock_minimal,
               s.commande_en_cours, s.date_arrivee_prevue,
               f.nom AS fournisseur_nom
        FROM stock s
        LEFT JOIN fournisseurs f ON f.id = s.fournisseur_id
        WHERE s.actif = 1 AND s.quantite <= s.stock_minimal
        ORDER BY s.quantite ASC
        LIMIT 10
        """
    ) as cur:
        alertes_stock = [dict(r) for r in await cur.fetchall()]

    # ── Activité récente ─────────────────────────────────────────────────────
    async with db.execute(
        """
        SELECT r.id, r.date_reception, r.appareil,
               r.marque, r.modele, r.statut,
               c.nom AS client_nom
        FROM reparations r
        LEFT JOIN clients c ON c.id = r.client_id
        WHERE r.statut NOT IN ('livre', 'annule')
        ORDER BY r.date_reception DESC
        LIMIT 5
        """
    ) as cur:
        reparations_recentes = [dict(r) for r in await cur.fetchall()]

    async with db.execute(
        """
        SELECT id, nom, marque, modele, statut,
               prix_achat, cout_pieces
        FROM flips
        WHERE statut NOT IN ('vendu', 'annule')
        ORDER BY created_at DESC
        LIMIT 5
        """
    ) as cur:
        flips_recents = [dict(r) for r in await cur.fetchall()]

    async with db.execute(
        """
        SELECT id, date, nom, prix_vente, plateforme
        FROM ventes
        ORDER BY date DESC, id DESC
        LIMIT 5
        """
    ) as cur:
        ventes_recentes = [dict(r) for r in await cur.fetchall()]

    return {
        "kpi": {
            "ca_total_mois": ca_total,
            "ca_ventes_mois": ca_ventes,
            "ca_reparations_mois": ca_reparations,
            "marge_brute_mois": marge_brute,
            "nb_reparations_en_cours": nb_reparations_en_cours,
            "nb_alertes_stock": nb_alertes_stock,
            "nb_ruptures": nb_ruptures,
            "nb_commandes_retard": nb_commandes_retard,
        },
        "alertes_stock": alertes_stock,
        "activite": {
            "reparations_en_cours": reparations_recentes,
            "flips_en_cours": flips_recents,
            "dernieres_ventes": ventes_recentes,
        },
    }


@router.get("/journal")
async def get_journal(
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    offset = (page - 1) * per_page

    async with db.execute("SELECT COUNT(*) AS nb FROM logs") as cur:
        total = (await cur.fetchone())["nb"]

    async with db.execute(
        """
        SELECT l.*, u.username
        FROM logs l
        LEFT JOIN utilisateurs u ON u.id = l.utilisateur_id
        ORDER BY l.created_at DESC
        LIMIT ? OFFSET ?
        """,
        (per_page, offset),
    ) as cur:
        rows = [dict(r) for r in await cur.fetchall()]

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": rows,
    }