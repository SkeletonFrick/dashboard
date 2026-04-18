# backend/routers/labels.py

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List
from backend.auth import get_current_user
import aiosqlite
from backend.database import DB_PATH

router = APIRouter(prefix="/api/labels", tags=["labels"])


class LabelRequest(BaseModel):
    ids: List[int]
    type_entite: str  # "flip" | "reparation"


def _esc_html(s) -> str:
    return (
        str(s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


@router.post("/print", response_class=HTMLResponse)
async def generate_labels(
    request: LabelRequest,
    current_user: dict = Depends(get_current_user),
):
    if request.type_entite not in ("flip", "reparation"):
        raise HTTPException(status_code=400, detail="type_entite invalide")

    labels_data = []

    async with aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row

        for entite_id in request.ids:
            if request.type_entite == "flip":
                async with conn.execute(
                    """
                    SELECT nom, statut, created_at
                    FROM flips
                    WHERE id = ?
                    """,
                    (entite_id,),
                ) as cur:
                    row = await cur.fetchone()

                if not row:
                    continue

                labels_data.append(
                    {
                        "id": entite_id,
                        "nom": str(row["nom"] or "N/A")[:20],
                        "statut": str(row["statut"] or "")[:12],
                        "client": "",
                        "created": str(row["created_at"] or "")[:10],
                        "qr_data": f"flip:{entite_id}",
                    }
                )

            else:  # reparation
                async with conn.execute(
                    """
                    SELECT r.statut, r.created_at,
                           r.appareil,
                           COALESCE(c.nom, '') as client_nom
                    FROM reparations r
                    LEFT JOIN clients c ON c.id = r.client_id
                    WHERE r.id = ?
                    """,
                    (entite_id,),
                ) as cur:
                    row = await cur.fetchone()

                if not row:
                    continue

                labels_data.append(
                    {
                        "id": entite_id,
                        "nom": str(row["appareil"] or "N/A")[:20],
                        "statut": str(row["statut"] or "")[:12],
                        "client": str(row["client_nom"] or "")[:12],
                        "created": str(row["created_at"] or "")[:10],
                        "qr_data": f"reparation:{entite_id}",
                    }
                )

    # Génération des étiquettes JS inline
    labels_js = "\n".join(
        f"""
        addLabel(
            {l['id']},
            {repr(l['nom'])},
            {repr(l['statut'])},
            {repr(l['client'])},
            {repr(l['created'])},
            {repr(l['qr_data'])}
        );"""
        for l in labels_data
    )

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8"/>
    <title>Étiquettes — AQ Réparation</title>
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    <style>
        body {{ font-family: monospace; background: #f3f4f6; padding: 1rem; }}
        .no-print {{ text-align: center; margin-bottom: 1.5rem; padding: 1rem;
                     background: white; border-radius: 8px; box-shadow: 0 2px 8px #0002; }}
        .no-print h1 {{ font-size: 1.4rem; margin-bottom: .5rem; }}
        .no-print button {{ padding: .6rem 1.6rem; background: #2563eb; color: white;
                            border: none; border-radius: 6px; font-size: 1rem;
                            cursor: pointer; font-weight: bold; }}
        #labels-container {{ display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }}
        .label {{ width: 110px; border: 1px solid #333; background: white;
                  padding: 4px; font-size: 9px; page-break-inside: avoid;
                  display: flex; flex-direction: column; gap: 2px; }}
        .label-nom {{ font-weight: bold; font-size: 10px; overflow: hidden;
                      white-space: nowrap; text-overflow: ellipsis; }}
        .label-client {{ color: #555; font-size: 8px; }}
        .label-statut {{ font-size: 8px; font-weight: bold; text-align: center;
                         background: #e0e7ff; padding: 1px 3px; border-radius: 3px; }}
        .label-date {{ font-size: 7px; color: #888; text-align: center; }}
        .label canvas {{ display: block; margin: 0 auto; }}
        @media print {{
            body {{ background: white; padding: 0; }}
            .no-print {{ display: none !important; }}
            #labels-container {{ justify-content: flex-start; gap: 2px; }}
        }}
    </style>
</head>
<body>
    <div class="no-print">
        <h1>🏷️ Étiquettes AQ Réparation</h1>
        <p style="color:#666;margin-bottom:.8rem">
            {len(labels_data)} étiquette(s) — {_esc_html(request.type_entite)}
        </p>
        <button onclick="window.print()">🖨️ Imprimer</button>
    </div>

    <div id="labels-container"></div>

    <script>
    function escHtml(s) {{
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }}

    function addLabel(id, nom, statut, client, created, qrData) {{
        const container = document.getElementById("labels-container");

        const div = document.createElement("div");
        div.className = "label";
        div.innerHTML = `
            <div class="label-nom" title="${{escHtml(nom)}}">${{escHtml(nom)}}</div>
            ${{client ? `<div class="label-client">${{escHtml(client)}}</div>` : ""}}
            <div class="label-statut">${{escHtml(statut)}}</div>
            <div class="label-date">${{escHtml(created)}}</div>
            <canvas id="qr-${{id}}"></canvas>
        `;
        container.appendChild(div);

        QRCode.toCanvas(
            document.getElementById("qr-" + id),
            qrData,
            {{ width: 48, margin: 0, errorCorrectionLevel: "M" }},
            function(err) {{
                if (err) console.error("QR error:", id, err);
            }}
        );
    }}

    // Données injectées côté serveur
    {labels_js}
    </script>
</body>
</html>"""

    return HTMLResponse(content=html)