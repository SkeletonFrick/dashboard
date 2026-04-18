from fastapi import APIRouter, Depends, HTTPException
from backend.auth import get_current_user, require_role
from backend.database import get_db
from backend.models import ParamUpdate, ParamsMetier
import aiosqlite
from datetime import datetime, timezone

router = APIRouter(prefix="/api/parametres", tags=["parametres"])


# ---------------------------------------------------------------------------
# Paramètres généraux
# ---------------------------------------------------------------------------


@router.get("")
async def get_parametres(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    params = {}
    async with db.execute("SELECT cle, valeur FROM parametres") as cur:
        async for row in cur:
            params[row["cle"]] = row["valeur"]
    return params


@router.put("")
async def update_parametres(
    body: ParamsMetier,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Validation somme pourcentages
    total = round(body.urssaf_pct + body.reinvest_pct + body.perso_pct, 10)
    if abs(total - 1.0) > 1e-6:
        raise HTTPException(
            status_code=400,
            detail=f"urssaf_pct + reinvest_pct + perso_pct doit être égal à 1.00 (actuellement {total})",
        )

    updates = body.model_dump(exclude_none=True)
    now = datetime.now(timezone.utc).isoformat()
    for cle, valeur in updates.items():
        await db.execute(
            """
            INSERT INTO parametres (cle, valeur, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur,
                                           updated_at = excluded.updated_at
            """,
            (cle, str(valeur), now),
        )
    await db.commit()
    await db.execute(
        "INSERT INTO logs (utilisateur_id, action, entite, details, created_at)"
        " VALUES (?, 'update', 'parametres', ?, ?)",
        (current_user["id"], str(list(updates.keys())), now),
    )
    await db.commit()
    return {"ok": True}


@router.put("/param/{cle}")
async def update_one_param(
    cle: str,
    body: ParamUpdate,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """
        INSERT INTO parametres (cle, valeur, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur,
                                       updated_at = excluded.updated_at
        """,
        (cle, str(body.valeur), now),
    )
    await db.commit()
    return {"ok": True, "cle": cle, "valeur": body.valeur}


# ---------------------------------------------------------------------------
# Catégories
# ---------------------------------------------------------------------------


@router.get("/categories")
async def get_categories(
    type: str | None = None,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if type:
        async with db.execute(
            "SELECT * FROM categories WHERE type = ? ORDER BY ordre, nom",
            (type,),
        ) as cur:
            rows = await cur.fetchall()
    else:
        async with db.execute(
            "SELECT * FROM categories ORDER BY type, ordre, nom"
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("/categories")
async def create_categorie(
    body: dict,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    type_ = body.get("type")
    nom = body.get("nom", "").strip()
    if not type_ or not nom:
        raise HTTPException(status_code=400, detail="type et nom requis")
    async with db.execute(
        "SELECT MAX(ordre) AS max_ordre FROM categories WHERE type = ?", (type_,)
    ) as cur:
        row = await cur.fetchone()
        ordre = (row["max_ordre"] or 0) + 1
    async with db.execute(
        "INSERT INTO categories (type, nom, actif, ordre) VALUES (?, ?, 1, ?)"
        " RETURNING id",
        (type_, nom, ordre),
    ) as cur:
        row = await cur.fetchone()
    await db.commit()
    return {"id": row["id"], "type": type_, "nom": nom, "actif": 1, "ordre": ordre}


@router.put("/categories/{id}")
async def update_categorie(
    id: int,
    body: dict,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    fields = {k: v for k, v in body.items() if k in ("nom", "actif", "ordre")}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    await db.execute(
        f"UPDATE categories SET {set_clause} WHERE id = ?",
        (*fields.values(), id),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/categories/{id}")
async def delete_categorie(
    id: int,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute("DELETE FROM categories WHERE id = ?", (id,))
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Plateformes
# ---------------------------------------------------------------------------


@router.get("/plateformes")
async def get_plateformes(
    type: str | None = None,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if type:
        async with db.execute(
            "SELECT * FROM plateformes WHERE type = ? ORDER BY ordre, nom",
            (type,),
        ) as cur:
            rows = await cur.fetchall()
    else:
        async with db.execute(
            "SELECT * FROM plateformes ORDER BY type, ordre, nom"
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("/plateformes")
async def create_plateforme(
    body: dict,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    type_ = body.get("type")
    nom = body.get("nom", "").strip()
    if not type_ or not nom:
        raise HTTPException(status_code=400, detail="type et nom requis")
    async with db.execute(
        "SELECT MAX(ordre) AS max_ordre FROM plateformes WHERE type = ?", (type_,)
    ) as cur:
        row = await cur.fetchone()
        ordre = (row["max_ordre"] or 0) + 1
    async with db.execute(
        "INSERT INTO plateformes (type, nom, actif, ordre) VALUES (?, ?, 1, ?)"
        " RETURNING id",
        (type_, nom, ordre),
    ) as cur:
        row = await cur.fetchone()
    await db.commit()
    return {"id": row["id"], "type": type_, "nom": nom, "actif": 1, "ordre": ordre}


@router.put("/plateformes/{id}")
async def update_plateforme(
    id: int,
    body: dict,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    fields = {k: v for k, v in body.items() if k in ("nom", "actif", "ordre")}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    await db.execute(
        f"UPDATE plateformes SET {set_clause} WHERE id = ?",
        (*fields.values(), id),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/plateformes/{id}")
async def delete_plateforme(
    id: int,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute("DELETE FROM plateformes WHERE id = ?", (id,))
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Charges fixes
# ---------------------------------------------------------------------------


@router.get("/charges-fixes")
async def get_charges_fixes(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT * FROM charges_fixes ORDER BY actif DESC, nom"
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("/charges-fixes")
async def create_charge_fixe(
    body: dict,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    nom = body.get("nom", "").strip()
    montant = body.get("montant")
    periodicite = body.get("periodicite", "mensuelle")
    notes = body.get("notes", "")
    if not nom or montant is None:
        raise HTTPException(status_code=400, detail="nom et montant requis")
    now = datetime.now(timezone.utc).isoformat()
    async with db.execute(
        "INSERT INTO charges_fixes (nom, montant, periodicite, actif, notes, created_at)"
        " VALUES (?, ?, ?, 1, ?, ?) RETURNING id",
        (nom, float(montant), periodicite, notes, now),
    ) as cur:
        row = await cur.fetchone()
    await db.commit()
    return {"id": row["id"], "nom": nom, "montant": montant,
            "periodicite": periodicite, "actif": 1, "notes": notes}


@router.put("/charges-fixes/{id}")
async def update_charge_fixe(
    id: int,
    body: dict,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    fields = {k: v for k, v in body.items()
              if k in ("nom", "montant", "periodicite", "actif", "notes")}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    await db.execute(
        f"UPDATE charges_fixes SET {set_clause} WHERE id = ?",
        (*fields.values(), id),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/charges-fixes/{id}")
async def delete_charge_fixe(
    id: int,
    current_user: dict = Depends(require_role("admin")),
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute("DELETE FROM charges_fixes WHERE id = ?", (id,))
    await db.commit()
    return {"ok": True}