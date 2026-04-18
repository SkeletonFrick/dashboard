from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from backend import database, auth, services
from backend.models import UserOut

router = APIRouter(prefix="/api/export", tags=["exports"])

@router.get("/json-complet")
async def api_export_json(current_user: UserOut = Depends(auth.get_current_user)):
    """Export JSON complet (admin uniquement)"""
    return await services.export_service.export_json_complet(current_user)

@router.get("/stock-csv")
async def api_export_stock_csv(current_user: UserOut = Depends(auth.get_current_user)):
    """Export CSV articles stock"""
    return await services.export_service.export_csv_stock(current_user)

@router.post("/backup")
async def api_create_backup(backup_info: dict = None, 
                          current_user: UserOut = Depends(auth.get_current_user)):
    """Création backup DB + timestamp"""
    return await services.backup_service.create_db_backup(current_user)