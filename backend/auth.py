# backend/routers/auth.py — fichier complet corrigé

from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    require_role,
    verify_password,
)
from backend.database import DB_PATH
from backend.models import UserCreate, UserLogin, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
async def login(payload: UserLogin):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM utilisateurs WHERE username = ? AND actif = 1",
            (payload.username,),
        ) as cur:
            user = await cur.fetchone()

    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants invalides",
        )

    # Mise à jour last_login_at — nom unifié avec database.py
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE utilisateurs SET last_login_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), user["id"]),
        )
        await db.commit()

    token = create_access_token(
        {
            "sub": str(user["id"]),
            "username": user["username"],
            "role": user["role"],
        }
    )
    return {"access_token": token, "token_type": "bearer"}


@router.post("/logout")
async def logout(_user=Depends(get_current_user)):
    # JWT stateless : le logout est géré côté client
    return {"message": "Déconnecté"}


@router.get("/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT id, username, role, actif, created_at, last_login_at
            FROM utilisateurs
            WHERE id = ?
            """,
            (user["id"],),
        ) as cur:
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    return UserOut(**dict(row))


@router.post("/users", response_model=UserOut)
async def create_user(
    payload: UserCreate,
    _admin=Depends(require_role("admin")),
):
    """Création d'un utilisateur (admin uniquement)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        async with db.execute(
            "SELECT id FROM utilisateurs WHERE username = ?",
            (payload.username,),
        ) as cur:
            if await cur.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail="Nom d'utilisateur déjà pris",
                )

        async with db.execute(
            """
            INSERT INTO utilisateurs (username, password_hash, role, actif)
            VALUES (?, ?, ?, 1)
            """,
            (payload.username, hash_password(payload.password), payload.role),
        ) as cur:
            new_id = cur.lastrowid

        await db.commit()

        async with db.execute(
            """
            SELECT id, username, role, actif, created_at, last_login_at
            FROM utilisateurs
            WHERE id = ?
            """,
            (new_id,),
        ) as cur:
            row = await cur.fetchone()

    return UserOut(**dict(row))