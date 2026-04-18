import shutil
import os
from pathlib import Path
from datetime import datetime
from fastapi import HTTPException
from backend.auth import get_current_user
from backend.models import UserOut

BACKUP_DIR = Path("data/backups")

async def create_db_backup(current_user: UserOut):
    """Crée backup DB timestampé"""
    BACKUP_DIR.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    db_path = Path("data/aq_reparation.db")
    backup_path = BACKUP_DIR / f"aq_reparation_{timestamp}.db"
    
    if not db_path.exists():
        raise HTTPException(404, "Base de données introuvable")
    
    shutil.copy2(db_path, backup_path)
    
    # Nettoyage (garder 10 derniers)
    backups = sorted(BACKUP_DIR.glob("aq_reparation_*.db"))
    for old in backups[:-10]:
        old.unlink()
    
    return {
        "success": True,
        "backup_file": backup_path.name,
        "size_bytes": backup_path.stat().st_size,
        "backup_dir": str(BACKUP_DIR)
    }