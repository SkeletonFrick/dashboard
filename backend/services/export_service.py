# backend/services/export_service.py

import csv
import json
import io
from datetime import datetime
from fastapi.responses import StreamingResponse
import aiosqlite

from backend.database import DB_PATH


async def export_json_complet(current_user: dict):
    """Export JSON complet de toutes les données"""

    tables = [
        "utilisateurs",
        "clients",
        "fournisseurs",
        "achats",
        "ventes",
        "flips",
        "reparations",
        "stock",
        "categories",
        "plateformes",
        "parametres",
        "charges_fixes",
        "materiel",
    ]

    data = {}
    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        for table in tables:
            try:
                async with conn.execute(f"SELECT * FROM {table}") as cur:
                    rows = await cur.fetchall()
                data[table] = [dict(r) for r in rows]
            except Exception:
                data[table] = []

    content = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    filename = f"aq_reparation_{datetime.now().strftime('%Y%m%d_%H%M')}.json"

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def export_csv_stock(current_user: dict):
    """Export CSV stock avec alertes"""

    query = """
        SELECT s.nom, s.categorie, s.quantite, s.stock_minimal,
               f.nom as fournisseur,
               CASE WHEN s.quantite <= s.stock_minimal THEN 'ALERTE' ELSE 'OK' END as alerte
        FROM stock s
        LEFT JOIN fournisseurs f ON s.fournisseur_id = f.id
        WHERE s.actif = 1
        ORDER BY s.quantite ASC
    """

    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(query) as cur:
            rows = await cur.fetchall()

    output = io.StringIO()
    fieldnames = ["nom", "categorie", "quantite", "stock_minimal", "fournisseur", "alerte"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows([dict(r) for r in rows])

    filename = f"stock_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    content = output.getvalue().encode("utf-8-sig")  # BOM pour Excel

    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )