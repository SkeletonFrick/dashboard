import csv
import json
import io
from datetime import datetime
from typing import Dict, Any
from fastapi.responses import StreamingResponse
from backend.auth import get_current_user
from backend.models import UserOut

async def export_json_complet(current_user: UserOut):
    """Export JSON complet de toutes les données"""
    from backend.database import get_db
    conn = await get_db()
    
    tables = [
        'utilisateurs', 'clients', 'fournisseurs', 'achats', 'ventes', 'flips', 
        'reparations', 'stock', 'categories', 'plateformes', 'parametres', 
        'charges_fixes', 'materiel'
    ]
    
    data = {}
    for table in tables:
        try:
            result = await conn.execute(f"SELECT * FROM {table}")
            rows = [dict(row) for row in result.fetchall()]
            data[table] = rows
        except:
            data[table] = []
    
    content = json.dumps(data, indent=2, ensure_ascii=False).encode('utf-8')
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={ "Content-Disposition": f"attachment; filename=aq_reparation_{datetime.now().strftime('%Y%m%d_%H%M')}.json" }
    )

async def export_csv_stock(current_user: UserOut):
    """Export CSV stock avec alertes"""
    from backend.database import get_db
    conn = await get_db()
    
    query = """
    SELECT s.nom, s.categorie, s.quantite, s.stock_minimal, f.nom as fournisseur, 
           CASE WHEN s.quantite <= s.stock_minimal THEN 'ALERTE' ELSE 'OK' END as alerte
    FROM stock s LEFT JOIN fournisseurs f ON s.fournisseur_id = f.id 
    WHERE s.actif = 1 ORDER BY s.quantite ASC
    """
    
    result = await conn.execute(query)
    rows = result.fetchall()
    
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=['nom','categorie','quantite','stock_minimal','fournisseur','alerte'])
    writer.writeheader()
    writer.writerows([dict(row) for row in rows])
    
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        media_type="text/csv",
        headers={ "Content-Disposition": f"attachment; filename=stock_{datetime.now().strftime('%Y%m%d_%H%M')}.csv" }
    )