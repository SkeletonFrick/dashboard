from fastapi import APIRouter, Depends
from backend.auth import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(current_user=Depends(get_current_user)):
    return {"message": "dashboard ok"}