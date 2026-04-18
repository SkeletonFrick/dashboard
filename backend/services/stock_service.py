import aiosqlite
from fastapi import HTTPException


async def integrer_achat_stock(
    db: aiosqlite.Connection,
    achat_id: int,
    user_id: int,
) -> dict:
    """
    Intègre un achat de type 'piece' dans le stock.
    - Crée l'article si absent (recherche par nom + fournisseur)
    - Incrémente la quantité sinon
    - Trace un mouvement d'entrée
    Retourne un dict avec stock_id et action effectuée.
    """
    async with db.execute(
        "SELECT * FROM achats WHERE id = ?", (achat_id,)
    ) as cur:
        achat = await cur.fetchone()

    if not achat:
        raise HTTPException(status_code=404, detail="Achat introuvable")
    if achat["type_achat"] != "piece":
        raise HTTPException(status_code=400, detail="Type d'achat non compatible")

    nom = achat["nom"]
    qte = achat["quantite"] or 1
    fournisseur_id = achat["fournisseur_id"]

    # Cherche article existant (même nom, même fournisseur si renseigné)
    query = "SELECT * FROM stock WHERE nom = ?"
    params: list = [nom]
    if fournisseur_id:
        query += " AND fournisseur_id = ?"
        params.append(fournisseur_id)

    async with db.execute(query, params) as cur:
        article = await cur.fetchone()

    if article:
        stock_id = article["id"]
        nouvelle_qte = article["quantite"] + qte
        await db.execute(
            "UPDATE stock SET quantite = ? WHERE id = ?",
            (nouvelle_qte, stock_id),
        )
        action = "incremented"
    else:
        async with db.execute(
            """
            INSERT INTO stock (nom, quantite, stock_minimal, fournisseur_id)
            VALUES (?, ?, 1, ?)
            """,
            (nom, qte, fournisseur_id),
        ) as cur:
            stock_id = cur.lastrowid
        action = "created"

    # Mouvement d'entrée
    await db.execute(
        """
        INSERT INTO stock_mouvements
          (stock_id, type_mouvement, quantite, motif, reference_id, reference_type)
        VALUES (?, 'entree', ?, 'achat', ?, 'achat')
        """,
        (stock_id, qte, achat_id),
    )

    return {"stock_id": stock_id, "action": action, "quantite_ajoutee": qte}


async def decrementer_stock(
    db: aiosqlite.Connection,
    stock_id: int,
    quantite: int,
    reference_id: int,
    reference_type: str,  # 'flip' | 'reparation'
) -> None:
    """
    Décrémente le stock et trace un mouvement de sortie.
    Lève une erreur si stock insuffisant.
    """
    async with db.execute(
        "SELECT quantite, nom FROM stock WHERE id = ?", (stock_id,)
    ) as cur:
        article = await cur.fetchone()

    if not article:
        raise HTTPException(status_code=404, detail=f"Article stock #{stock_id} introuvable")

    if article["quantite"] < quantite:
        raise HTTPException(
            status_code=400,
            detail=f"Stock insuffisant pour '{article['nom']}' "
                   f"(dispo: {article['quantite']}, demandé: {quantite})",
        )

    await db.execute(
        "UPDATE stock SET quantite = quantite - ? WHERE id = ?",
        (quantite, stock_id),
    )
    await db.execute(
        """
        INSERT INTO stock_mouvements
          (stock_id, type_mouvement, quantite, motif, reference_id, reference_type)
        VALUES (?, 'sortie', ?, ?, ?, ?)
        """,
        (stock_id, quantite, reference_type, reference_id, reference_type),
    )