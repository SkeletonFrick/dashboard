from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from backend import database, auth
from backend.models import UserOut
import qrcode
from io import StringIO
from typing import List

router = APIRouter(prefix="/api/labels", tags=["labels"])

class LabelRequest(BaseModel):
    ids: List[int]
    type_entite: str  # "flip" | "reparation"

@router.post("/print")
async def generate_labels(request: LabelRequest, 
                         current_user: UserOut = Depends(auth.get_current_user)):
    """Génère page étiquettes imprimables"""
    
    conn = await database.get_db()
    labels_html = StringIO()
    
    # Template HTML de base
    labels_html.write("""
<!DOCTYPE html>
<html>
<head>
    <title>Étiquettes - AQ Réparation</title>
    <meta charset="utf-8">
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    <style>
        @media print { 
            body { margin: 0; padding: 1rem; } 
            .no-print { display: none !important; }
        }
        .label { 
            width: 100px; height: 70px; 
            border: 1px solid #333; 
            margin: 4px; 
            page-break-inside: avoid;
            display: flex; flex-direction: column; 
            justify-content: space-between; 
            padding: 4px; font-size: 9px; font-family: monospace;
        }
        .qr-code { width: 32px; height: 32px; }
    </style>
</head>
<body class="p-8 bg-gray-100">
    <div class="no-print text-center mb-8 p-6 bg-white shadow-lg rounded-lg mx-auto max-w-4xl">
        <h1 class="text-3xl font-bold text-gray-800 mb-4">🏷️ Étiquettes AQ Réparation</h1>
        <p class="text-lg text-gray-600 mb-4">Imprimez et collez sur vos appareils</p>
        <button onclick="window.print()" class="btn bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold text-lg shadow-lg">
            🖨️ IMPRIMER
        </button>
        <div class="mt-4 text-sm text-gray-500">Nombre d'étiquettes: {} | {}</div>
    </div>
    <div id="labels-container" class="flex flex-wrap justify-center gap-2 print:justify-start print:gap-0 print:-ml-1"></div>
    
    <script>
    """.format(len(request.ids), request.type_entite))
    
    # Générer étiquette pour chaque ID
    for entite_id in request.ids:
        table = "flips" if request.type_entite == "flip" else "reparations"
        
        # Requête simplifiée
        query = f"""
        SELECT nom, statut, created_at, 
               COALESCE((SELECT nom FROM clients c WHERE c.id = r.client_id), '') as client_nom
        FROM {table} WHERE id = ?
        """
        
        result = await conn.execute(query, (entite_id,))
        row = result.fetchone()
        
        if not row:
            continue
            
        nom = str(row[0] or "N/A")[:20]
        statut = str(row[1] or "unknown")[:8]
        created = row[2].strftime('%d/%m') if row[2] else ""
        client = str(row[3] or "")[:12]
        qr_data = f"{request.type_entite}:{entite_id}"
        
        # HTML étiquette
        labels_html.write(f"""
        document.getElementById('labels-container').innerHTML += `
            <div class="label bg-white shadow-sm border-gray-300 print:shadow-none print:border-black print:bg-white">
                <div class="font-bold text-xs truncate">{escHtml(nom)}</div>
                <div class="text-gray-600 text-[8px]">{escHtml(client)}</div>
                <div class="text-[10px] font-semibold text-center px-1 py-0.5 rounded bg-blue-100 text-blue-800 print:bg-transparent print:text-black">
                    {escHtml(statut)}
                </div>
                <div class="text-[8px] text-gray-500 text-center">{created}</div>
                <canvas id="qr-{entite_id}" class="qr-code mx-auto"></canvas>
            </div>
        `;
        QRCode.toCanvas(document.getElementById('qr-{entite_id}'), '{qr_data}', {{ 
            width: 32, errorCorrectionLevel: 'H', margin: 0 
        }});
        """)
    
    labels_html.write("""
        console.log('Étiquettes générées:', {});  
    </script>
</body>
</html>
    """.format(len(request.ids)))
    
    return HTMLResponse(content=labels_html.getvalue())

def escHtml(s):
    """Escape HTML pour JS"""
    return (str(s or "")
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&#39;'))