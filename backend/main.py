from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt

from backend.auth import ALGORITHM, SECRET_KEY
from backend.database import init_db
from backend.routers import auth as auth_router
from backend.routers import dashboard, achats, stock
from backend.routers.flips import router as flips_router
from backend.routers.clients import router as clients_router
from backend.routers.reparations import router as reparations_router
from backend.routers.ventes import router as ventes_router
from backend.routers.budget import router as budget_router
from backend.routers.parametres import router as parametres_router
from backend.routers.fournisseurs import router as fournisseurs_router
from backend.routers.materiel import router as materiel_router
from backend.routers import export, labels


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="AQ Réparation", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Chemins ────────────────────────────────────────────────────────────────────
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# ── Fichiers statiques ─────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.mount(
    "/uploads",
    StaticFiles(directory=os.path.join(DATA_DIR, "uploads")),
    name="uploads",
)

# ── Routes publiques (pas de vérification JWT) ─────────────────────────────────
PUBLIC_API_PATHS = {"/api/auth/login"}


# ── Middleware JWT ─────────────────────────────────────────────────────────────
@app.middleware("http")
async def jwt_middleware(request: Request, call_next):
    path = request.url.path

    if not path.startswith("/api/") or path in PUBLIC_API_PATHS:
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(
            status_code=401, content={"detail": "Non authentifié"}
        )

    token = auth_header.split(" ", 1)[1]
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return JSONResponse(
            status_code=401, content={"detail": "Token invalide ou expiré"}
        )

    return await call_next(request)


# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(dashboard.router)
app.include_router(achats.router)
app.include_router(stock.router)
app.include_router(flips_router)
app.include_router(clients_router)
app.include_router(reparations_router)
app.include_router(ventes_router)
app.include_router(budget_router)
app.include_router(parametres_router)
app.include_router(fournisseurs_router)
app.include_router(materiel_router)
app.include_router(export.router)
app.include_router(labels.router)
# ── Serving HTML ───────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/{page}.html")
async def serve_page(page: str):
    path = os.path.join(FRONTEND_DIR, f"{page}.html")
    if os.path.exists(path):
        return FileResponse(path)
    return FileResponse(
        os.path.join(FRONTEND_DIR, "404.html"), status_code=404
    )