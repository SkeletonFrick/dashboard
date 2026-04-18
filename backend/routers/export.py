# backend/routers/export.py

from fastapi import APIRouter, Depends
from backend.auth import get_current_user
from backend.services.export_service import export_json_complet, export_csv_stock
from backend.services.backup_service import create_db_backup

router = APIRouter(prefix="/api/export", tags=["exports"])


@router.get("/json-complet")
async def api_export_json(current_user: dict = Depends(get_current_user)):
    """Export JSON complet de toutes les tables"""
    return await export_json_complet(current_user)


@router.get("/stock-csv")
async def api_export_stock_csv(current_user: dict = Depends(get_current_user)):
    """Export CSV articles stock actifs avec alertes"""
    return await export_csv_stock(current_user)


@router.post("/backup")
async def api_create_backup(current_user: dict = Depends(get_current_user)):
    """Création d'une sauvegarde timestampée de la base de données"""
    return await create_db_backup(current_user)