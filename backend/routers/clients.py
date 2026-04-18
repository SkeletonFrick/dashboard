from fastapi import APIRouter, Depends, HTTPException, Query
from backend.database import get_db
from backend.auth import get_current_user, require_role
from backend.models import ClientCreate, ClientUpdate
import aiosqlite
import json

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("")
async def list_clients(
    search: str = Query(default="", alias="search"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    conditions = []
    params = []

    if search:
        conditions.append(
            "(nom LIKE ? OR telephone LIKE ? OR email LIKE ?)"
        )
        like = f"%{search}%"
        params.extend([like, like, like])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total_row = await db.execute_fetchall(
        f"SELECT COUNT(*) as n FROM clients {where}", params
    )
    total = total_row[0]["n"]

    rows = await db.execute_fetchall(
        f"""
        SELECT c.*,
               COUNT(r.id) as nb_reparations
        FROM clients c
        LEFT JOIN reparations r ON r.client_id = c.id
        {where}
        GROUP BY c.id
        ORDER BY c.nom ASC
        LIMIT ? OFFSET ?
        """,
        params + [limit, skip],
    )

    return {"total": total, "items": [dict(r) for r in rows]}


@router.get("/{client_id}")
async def get_client(
    client_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        """
        SELECT c.*,
               COUNT(r.id) as nb_reparations
        FROM clients c
        LEFT JOIN reparations r ON r.client_id = c.id
        WHERE c.id = ?
        GROUP BY c.id
        """,
        [client_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Client introuvable")

    reps = await db.execute_fetchall(
        """
        SELECT id, date_reception, appareil, marque, modele,
               statut, prix_facture, created_at
        FROM reparations
        WHERE client_id = ?
        ORDER BY date_reception DESC
        """,
        [client_id],
    )

    client = dict(rows[0])
    client["reparations"] = [dict(r) for r in reps]
    return client


@router.post("", status_code=201)
async def create_client(
    payload: ClientCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    cur = await db.execute(
        """
        INSERT INTO clients (nom, telephone, email, notes)
        VALUES (?, ?, ?, ?)
        """,
        [payload.nom, payload.telephone, payload.email, payload.notes],
    )
    await db.commit()
    client_id = cur.lastrowid

    await db.execute(
        """
        INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
        VALUES (?, 'create', 'client', ?, ?)
        """,
        [current_user["id"], client_id, json.dumps({"nom": payload.nom})],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM clients WHERE id = ?", [client_id]
    )
    return dict(rows[0])


@router.put("/{client_id}")
async def update_client(
    client_id: int,
    payload: ClientUpdate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.execute_fetchall(
        "SELECT id FROM clients WHERE id = ?", [client_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Client introuvable")

    data = payload.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")

    sets = ", ".join(f"{k} = ?" for k in data)
    vals = list(data.values()) + [client_id]
    await db.execute(
        f"UPDATE clients SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        vals,
    )
    await db.execute(
        """
        INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
        VALUES (?, 'update', 'client', ?, ?)
        """,
        [current_user["id"], client_id, json.dumps(data)],
    )
    await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM clients WHERE id = ?", [client_id]
    )
    return dict(rows[0])


@router.delete("/{client_id}", status_code=204)
async def delete_client(
    client_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(require_role("admin")),
):
    rows = await db.execute_fetchall(
        "SELECT id FROM clients WHERE id = ?", [client_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Client introuvable")

    linked = await db.execute_fetchall(
        "SELECT COUNT(*) as n FROM reparations WHERE client_id = ?", [client_id]
    )
    if linked[0]["n"] > 0:
        raise HTTPException(
            status_code=400,
            detail="Impossible de supprimer un client ayant des réparations",
        )

    await db.execute("DELETE FROM clients WHERE id = ?", [client_id])
    await db.execute(
        """
        INSERT INTO logs (utilisateur_id, action, entite, entite_id, details)
        VALUES (?, 'delete', 'client', ?, ?)
        """,
        [current_user["id"], client_id, json.dumps({"client_id": client_id})],
    )
    await db.commit()