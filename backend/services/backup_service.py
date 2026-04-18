# backend/services/backup_service.py

import shutil
from pathlib import Path
from datetime import datetime
from fastapi import HTTPException


BACKUP_DIR = Path("data/backups")
DB_PATH_BACKUP = Path("data/aq_reparation.db")


async def create_db_backup(current_user: dict) -> dict:
    """Crée une copie timestampée de la base de données."""

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    if not DB_PATH_BACKUP.exists():
        raise HTTPException(status_code=404, detail="Base de données introuvable")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"aq_reparation_{timestamp}.db"

    shutil.copy2(DB_PATH_BACKUP, backup_path)

    # Nettoyage : garder uniquement les 10 derniers backups
    backups = sorted(BACKUP_DIR.glob("aq_reparation_*.db"))
    for old in backups[:-10]:
        old.unlink()

    return {
        "success": True,
        "backup_file": backup_path.name,
        "size_bytes": backup_path.stat().st_size,
        "backup_dir": str(BACKUP_DIR),
    }