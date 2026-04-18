import os
import uuid
import aiofiles
from fastapi import UploadFile
from pathlib import Path

UPLOAD_ROOT = Path("data/uploads")

ALLOWED_MIME = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/pdf",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

MAX_SIZE_MB = 10


async def save_upload(file: UploadFile, type_parent: str, parent_id: int) -> dict:
    if file.content_type not in ALLOWED_MIME:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Type de fichier non autorisé : {file.content_type}")

    dest_dir = UPLOAD_ROOT / type_parent / str(parent_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename).suffix.lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = dest_dir / unique_name

    content = await file.read()
    if len(content) > MAX_SIZE_MB * 1024 * 1024:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Fichier trop volumineux (max {MAX_SIZE_MB} Mo)")

    async with aiofiles.open(dest_path, "wb") as f:
        await f.write(content)

    return {
        "nom_original": file.filename,
        "chemin": str(dest_path),
        "mime_type": file.content_type,
    }


async def delete_file(chemin: str) -> None:
    try:
        os.remove(chemin)
    except FileNotFoundError:
        pass