# backend/services/stock_service.py — fichier complet corrigé

import aiosqlite
from fastapi import HTTPException


async def integrer_achat_stock(
    db: aiosqlite.Connection,
    achat_id: int,
    user_id: int,
) -> dict:
    """
    Intègre un achat de type 'piece' dans le stock.
    - Cherche un article actif par nom + fournisseur_id
    - Crée l'article si absent
    - Incrémente la quantité sinon
    - Trace un mouvement d'entrée
    """
    async with db.execute(
        "SELECT * FROM achats WHERE id = ?", (achat_id,)
    ) as cur:
        achat = await cur.fetchone()

    if not achat:
        raise HTTPException(status_code=404, detail="Achat introuvable")
    if achat["type_achat"] != "piece":
        raise HTTPException(
            status_code=400, detail="Type d'achat non compatible"
        )

    nom = achat["nom"]
    qte = achat["quantite"] or 1
    fournisseur_id = achat["fournisseur_id"]

    # ✅ WHERE actif = 1 — on ignore les articles archivés
    query = "SELECT * FROM stock WHERE nom = ? AND actif = 1"
    params: list = [nom]
    if fournisseur_id:
        query += " AND fournisseur_id = ?"
        params.append(fournisseur_id)

    async with db.execute(query, params) as cur:
        article = await cur.fetchone()

    if article:
        stock_id = article["id"]
        await db.execute(
            """
            UPDATE stock
            SET quantite   = quantite + ?,
                updated_at = datetime('now')
            WHERE id = ?
            """,
            (qte, stock_id),
        )
        action = "incremented"
    else:
        async with db.execute(
            """
            INSERT INTO stock
                (nom, quantite, stock_minimal, fournisseur_id,
                 unite, actif)
            VALUES (?, ?, 1, ?, 'pcs', 1)
            """,
            (nom, qte, fournisseur_id),
        ) as cur:
            stock_id = cur.lastrowid
        action = "created"

    # Mouvement d'entrée
    await db.execute(
        """
        INSERT INTO stock_mouvements
            (stock_id, type_mouvement, quantite, motif,
             reference_id, reference_type)
        VALUES (?, 'entree', ?, 'achat', ?, 'achat')
        """,
        (stock_id, qte, achat_id),
    )

    return {
        "stock_id": stock_id,
        "action": action,
        "quantite_ajoutee": qte,
    }


async def decrementer_stock(
    db: aiosqlite.Connection,
    stock_id: int,
    quantite: int,
    reference_id: int,
    reference_type: str,  # 'flip' | 'reparation'
) -> None:
    """
    Décrémente le stock et trace un mouvement de sortie.
    Lève HTTP 400 si stock insuffisant, HTTP 404 si article absent.
    """
    async with db.execute(
        "SELECT quantite, nom FROM stock WHERE id = ? AND actif = 1",
        (stock_id,),
    ) as cur:
        article = await cur.fetchone()

    if not article:
        raise HTTPException(
            status_code=404,
            detail=f"Article stock #{stock_id} introuvable ou archivé",
        )

    if article["quantite"] < quantite:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Stock insuffisant pour '{article['nom']}' "
                f"(dispo : {article['quantite']}, demandé : {quantite})"
            ),
        )

    await db.execute(
        """
        UPDATE stock
        SET quantite   = quantite - ?,
            updated_at = datetime('now')
        WHERE id = ?
        """,
        (quantite, stock_id),
    )
    await db.execute(
        """
        INSERT INTO stock_mouvements
            (stock_id, type_mouvement, quantite, motif,
             reference_id, reference_type)
        VALUES (?, 'sortie', ?, ?, ?, ?)
        """,
        (stock_id, quantite, reference_type, reference_id, reference_type),
    )