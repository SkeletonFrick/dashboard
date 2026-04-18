from fastapi import APIRouter, Depends
from backend.auth import get_current_user
from backend.database import get_db
import aiosqlite

router = APIRouter(prefix="/api/budget", tags=["budget"])


@router.get("")
async def get_budget(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    # --- Paramètres métier ---
     params = {}
    async with db.execute(
        "SELECT cle, valeur FROM parametres WHERE cle IN ("
        "'urssaf_pct','reinvest_pct','perso_pct',"
        "'objectif_mensuel')"          # ✅ était objectif_marge + charges_fixes_total
    ) as cur:
        async for row in cur:
            params[row["cle"]] = row["valeur"]

    urssaf_pct  = float(params.get("urssaf_pct", 0.246))
    reinvest_pct = float(params.get("reinvest_pct", 0.30))
    perso_pct   = float(params.get("perso_pct", 0.454))
    objectif_mensuel = float(params.get("objectif_mensuel", 1000)) 

    # --- Charges fixes actives ---
    charges_fixes = []
    async with db.execute(
        "SELECT nom, montant, periodicite FROM charges_fixes WHERE actif = 1"
    ) as cur:
        async for row in cur:
            charges_fixes.append(dict(row))

   def mensualiser(montant: float, periodicite: str) -> float:
        mapping = {
            "mensuelle":      1,        # ✅ était "mensuelle" — cohérent avec seed corrigé
            "trimestrielle":  1 / 3,
            "semestrielle":   1 / 6,
            "annuelle":       1 / 12,
        }
        return montant * mapping.get(periodicite, 1)

    total_charges_mensuelles = sum(
        mensualiser(c["montant"], c["periodicite"]) for c in charges_fixes
    )

    # --- CA du mois en cours ---
    async with db.execute(
        """
        SELECT COALESCE(SUM(prix_vente), 0) AS ca
        FROM ventes
        WHERE strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
        """
    ) as cur:
        row = await cur.fetchone()
        ca_mois = float(row["ca"])

    # --- CA des 12 derniers mois (pour graphique) ---
    historique = []
    async with db.execute(
        """
        SELECT strftime('%Y-%m', date) AS mois,
               COALESCE(SUM(prix_vente), 0) AS ca
        FROM ventes
        WHERE date >= date('now', '-11 months', 'start of month')
        GROUP BY mois
        ORDER BY mois
        """
    ) as cur:
        async for row in cur:
            historique.append({"mois": row["mois"], "ca": float(row["ca"])})

    # --- Marges du mois ---
    async with db.execute(
        """
        SELECT
            COALESCE(SUM(v.prix_vente), 0) AS ca,
            COALESCE(SUM(
                CASE
                    WHEN v.flip_id IS NOT NULL
                        THEN v.prix_vente - COALESCE(f.prix_achat,0)
                             - COALESCE(f.cout_pieces,0)
                    WHEN v.achat_id IS NOT NULL
                        THEN v.prix_vente - COALESCE(a.prix_achat,0)
                    ELSE v.prix_vente
                END
            ), 0) AS marge_brute
        FROM ventes v
        LEFT JOIN flips f ON v.flip_id = f.id
        LEFT JOIN achats a ON v.achat_id = a.id
        WHERE strftime('%Y-%m', v.date) = strftime('%Y-%m', 'now')
        """
    ) as cur:
        row = await cur.fetchone()
        marge_brute_mois = float(row["marge_brute"])

    # --- Nb réparations livrées ce mois ---
    async with db.execute(
        """
        SELECT COALESCE(SUM(prix_facture), 0) AS ca_rep,
               COUNT(*) AS nb_rep
        FROM reparations
        WHERE statut = 'livre'
          AND strftime('%Y-%m', date_restitution) = strftime('%Y-%m', 'now')
        """
    ) as cur:
        row = await cur.fetchone()
        ca_reparations_mois = float(row["ca_rep"])
        nb_reparations_mois = int(row["nb_rep"])

    # --- CA total toutes sources ---
    ca_total_mois = ca_mois + ca_reparations_mois

    # --- Répartition budget ---
    montant_urssaf = round(ca_total_mois * urssaf_pct, 2)
    montant_reinvest = round(ca_total_mois * reinvest_pct, 2)
    montant_perso = round(ca_total_mois * perso_pct, 2)
    net_apres_charges = round(montant_perso - total_charges_mensuelles, 2)

    # --- Déclaration AE : base imposable recommandée ---
    # Pour AE : CA ventes = total ventes (pas les réparations séparément)
    # On expose le CA déclarable (ventes + réparations = tout)
    ca_declarable = ca_total_mois

    # --- Avancement objectif ---
    avancement_pct = (
        round((ca_total_mois / objectif_mensuel) * 100, 1)
        if objectif_mensuel > 0
        else 0
    )

    return {
        "ca_mois": ca_mois,
        "ca_reparations_mois": ca_reparations_mois,
        "ca_total_mois": ca_total_mois,
        "marge_brute_mois": marge_brute_mois,
        "nb_reparations_mois": nb_reparations_mois,
        "objectif_mensuel": objectif_mensuel,
        "avancement_pct": avancement_pct,
        "repartition": {
            "urssaf_pct": urssaf_pct,
            "reinvest_pct": reinvest_pct,
            "perso_pct": perso_pct,
            "montant_urssaf": montant_urssaf,
            "montant_reinvest": montant_reinvest,
            "montant_perso": montant_perso,
        },
        "charges_fixes": {
            "liste": charges_fixes,
            "total_mensuel": round(total_charges_mensuelles, 2),
        },
        "net_apres_charges": net_apres_charges,
        "ca_declarable": ca_declarable,
        "historique_12m": historique,
    }