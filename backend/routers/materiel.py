from fastapi import APIRouter, Depends, HTTPException
from backend.auth import get_current_user, require_role
from backend.database import get_db
from backend.models import MaterielCreate, MaterielUpdate
import aiosqlite
from datetime import datetime, timezone

router = APIRouter(prefix="/api/materiel", tags=["materiel"])

PRIORITE_ORDER = {"haute": 0, "normale": 1, "basse": 2}


@router.get("")
async def list_materiel(
    search: str = "",
    statut: str = "",
    priorite: str = "",
    skip: int = 0,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    where = "WHERE 1=1"
    params = []

    if search:
        where += " AND (article LIKE ? OR notes LIKE ?)"
        params += [f"%{search}%"] * 2
    if statut:
        where += " AND statut = ?"
        params.append(statut)
    if priorite:
        where += " AND priorite = ?"
        params.append(priorite)

    async with db.execute(
        f"""
        SELECT * FROM materiel
        {where}
        ORDER BY
            CASE priorite
                WHEN 'haute'   THEN 0
                WHEN 'normale' THEN 1
                WHEN 'basse'   THEN 2
                ELSE 3
            END,
            CASE statut
                WHEN 'a_acheter' THEN 0
                WHEN 'achete'    THEN 1
                WHEN 'abandonne' THEN 2
                ELSE 3
            END,
            created_at DESC
        LIMIT ? OFFSET ?
        """,
        (*params, limit, skip),
    ) as cur:
        rows = await cur.fetchall()

    async with db.execute(
        f"SELECT COUNT(*) AS total FROM materiel {where}", params
    ) as cur:
        total = (await cur.fetchone())["total"]

    return {"items": [dict(r) for r in rows], "total": total}


@router.get("/{id}")
async def get_materiel(
    id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT * FROM materiel WHERE id = ?", (id,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Article introuvable")
    return dict(row)


@router.post("", status_code=201)
async def create_materiel(
    body: MaterielCreate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    now = datetime.now(timezone.utc).isoformat()
    async with db.execute(
        """
        INSERT INTO materiel (article, lien, prix_estime, priorite, notes,
                              statut, date_achat, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
        """,
        (body.article, body.lien, body.prix_estime, body.priorite,
         body.notes, body.statut, body.date_achat, now, now),
    ) as cur:
        row = await cur.fetchone()
    await db.commit()
    await db.execute(
        "INSERT INTO logs (utilisateur_id, action, entite, entite_id, created_at)"
        " VALUES (?, 'create', 'materiel', ?, ?)",
        (current_user["id"], row["id"], now),
    )
    await db.commit()
    return {"id": row["id"]}


@router.put("/{id}")
async def update_materiel(
    id: int,
    body: MaterielUpdate,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT id FROM materiel WHERE id = ?", (id,)
    ) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Article introuvable")

    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")

    now = datetime.now(timezone.utc).isoformat()
    fields["updated_at"] = now
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    await db.execute(
        f"UPDATE materiel SET {set_clause} WHERE id = ?",
        (*fields.values(), id),
    )
    await db.commit()
    await db.execute(
        "INSERT INTO logs (utilisateur_id, action, entite, entite_id, created_at)"
        " VALUES (?, 'update', 'materiel', ?, ?)",
        (current_user["id"], id, now),
    )
    await db.commit()
    return {"ok": True}


@router.patch("/{id}/statut")
async def change_statut(
    id: int,
    body: dict,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    statut = body.get("statut")
    if statut not in ("a_acheter", "achete", "abandonne"):
        raise HTTPException(status_code=400, detail="Statut invalide")

    now = datetime.now(timezone.utc).isoformat()
    extra = {}
    if statut == "achete":
        extra["date_achat"] = body.get("date_achat") or now[:10]

    fields = {"statut": statut, "updated_at": now, **extra}
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    await db.execute(
        f"UPDATE materiel SET {set_clause} WHERE id = ?",
        (*fields.values(), id),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{id}")
async def delete_materiel(
    id: int,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT id FROM materiel WHERE id = ?", (id,)
    ) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Article introuvable")

    await db.execute("DELETE FROM materiel WHERE id = ?", (id,))
    await db.commit()
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO logs (utilisateur_id, action, entite, entite_id, created_at)"
        " VALUES (?, 'delete', 'materiel', ?, ?)",
        (current_user["id"], id, now),
    )
    await db.commit()
    return {"ok": True}