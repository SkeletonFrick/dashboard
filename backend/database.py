import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "aq_reparation.db")

async def get_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await _create_tables(db)
        await _seed_default_data(db)
        await db.commit()

async def _create_tables(db):

    # Utilisateurs
    await db.execute("""
        CREATE TABLE IF NOT EXISTS utilisateurs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'admin',
            actif INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_login_at TEXT
        )
    """)

    # Clients
    await db.execute("""
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            telephone TEXT,
            email TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Fournisseurs
    await db.execute("""
        CREATE TABLE IF NOT EXISTS fournisseurs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            lien TEXT,
            contact TEXT,
            delai_moyen_jours INTEGER,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Catégories
    await db.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            nom TEXT NOT NULL,
            actif INTEGER NOT NULL DEFAULT 1,
            ordre INTEGER NOT NULL DEFAULT 0
        )
    """)

    # Plateformes
    await db.execute("""
        CREATE TABLE IF NOT EXISTS plateformes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            nom TEXT NOT NULL,
            actif INTEGER NOT NULL DEFAULT 1,
            ordre INTEGER NOT NULL DEFAULT 0
        )
    """)

    # Paramètres
    await db.execute("""
        CREATE TABLE IF NOT EXISTS parametres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cle TEXT NOT NULL UNIQUE,
            valeur TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Charges fixes
    await db.execute("""
        CREATE TABLE IF NOT EXISTS charges_fixes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            montant REAL NOT NULL,
            periodicite TEXT NOT NULL DEFAULT 'mensuel',
            actif INTEGER NOT NULL DEFAULT 1,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Achats
    await db.execute("""
        CREATE TABLE IF NOT EXISTS achats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            nom TEXT NOT NULL,
            type_achat TEXT NOT NULL DEFAULT 'autre',
            categorie TEXT,
            plateforme TEXT,
            fournisseur_id INTEGER REFERENCES fournisseurs(id),
            prix_achat REAL NOT NULL DEFAULT 0,
            quantite INTEGER NOT NULL DEFAULT 1,
            est_lot INTEGER NOT NULL DEFAULT 0,
            lot_id INTEGER REFERENCES lots_achat(id),
            ajout_stock_auto INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Lots d'achat
    await db.execute("""
        CREATE TABLE IF NOT EXISTS lots_achat (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            nom_lot TEXT NOT NULL,
            prix_total REAL NOT NULL DEFAULT 0,
            plateforme TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Éléments de lot
    await db.execute("""
        CREATE TABLE IF NOT EXISTS lot_elements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lot_id INTEGER NOT NULL REFERENCES lots_achat(id),
            type_element TEXT NOT NULL,
            nom TEXT NOT NULL,
            categorie TEXT,
            prix_attribue REAL NOT NULL DEFAULT 0,
            destination TEXT,
            achat_id INTEGER REFERENCES achats(id),
            notes TEXT
        )
    """)

    # Ventes
    await db.execute("""
        CREATE TABLE IF NOT EXISTS ventes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            nom TEXT NOT NULL,
            categorie TEXT,
            plateforme TEXT,
            prix_vente REAL NOT NULL DEFAULT 0,
            achat_id INTEGER REFERENCES achats(id),
            flip_id INTEGER REFERENCES flips(id),
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Flips
    await db.execute("""
        CREATE TABLE IF NOT EXISTS flips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            achat_id INTEGER REFERENCES achats(id),
            nom TEXT NOT NULL,
            marque TEXT,
            modele TEXT,
            imei TEXT,
            etat_initial TEXT,
            statut TEXT NOT NULL DEFAULT 'a_diagnostiquer',
            notes TEXT,
            prix_achat REAL NOT NULL DEFAULT 0,
            cout_pieces REAL NOT NULL DEFAULT 0,
            vente_id INTEGER REFERENCES ventes(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Pièces utilisées dans les flips
    await db.execute("""
        CREATE TABLE IF NOT EXISTS flip_pieces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            flip_id INTEGER NOT NULL REFERENCES flips(id),
            stock_id INTEGER NOT NULL REFERENCES stock(id),
            quantite INTEGER NOT NULL DEFAULT 1,
            prix_unitaire REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Réparations
    await db.execute("""
        CREATE TABLE IF NOT EXISTS reparations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date_reception TEXT NOT NULL,
            client_id INTEGER REFERENCES clients(id),
            telephone TEXT,
            appareil TEXT NOT NULL,
            marque TEXT,
            modele TEXT,
            panne_decrite TEXT,
            diagnostic TEXT,
            reparation_effectuee TEXT,
            statut TEXT NOT NULL DEFAULT 'recu',
            cout_pieces REAL NOT NULL DEFAULT 0,
            prix_facture REAL NOT NULL DEFAULT 0,
            acompte REAL NOT NULL DEFAULT 0,
            date_restitution TEXT,
            date_fin_garantie TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Pièces utilisées dans les réparations
    await db.execute("""
        CREATE TABLE IF NOT EXISTS reparation_pieces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reparation_id INTEGER NOT NULL REFERENCES reparations(id),
            stock_id INTEGER NOT NULL REFERENCES stock(id),
            quantite INTEGER NOT NULL DEFAULT 1,
            prix_unitaire REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Stock
    await db.execute("""
        CREATE TABLE IF NOT EXISTS stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            categorie TEXT,
            quantite INTEGER NOT NULL DEFAULT 0,
            unite TEXT NOT NULL DEFAULT 'pcs',
            stock_minimal INTEGER NOT NULL DEFAULT 1,
            commande_en_cours INTEGER NOT NULL DEFAULT 0,
            quantite_commandee INTEGER NOT NULL DEFAULT 0,
            date_arrivee_prevue TEXT,
            fournisseur_id INTEGER REFERENCES fournisseurs(id),
            reference TEXT,
            emplacement TEXT,
            notes TEXT,
            actif INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Mouvements de stock
    await db.execute("""
        CREATE TABLE IF NOT EXISTS stock_mouvements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_id INTEGER NOT NULL REFERENCES stock(id),
            type_mouvement TEXT NOT NULL,
            quantite INTEGER NOT NULL,
            motif TEXT,
            reference_id INTEGER,
            reference_type TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Matériel
    await db.execute("""
        CREATE TABLE IF NOT EXISTS materiel (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article TEXT NOT NULL,
            lien TEXT,
            prix_estime REAL,
            priorite TEXT NOT NULL DEFAULT 'normale',
            notes TEXT,
            statut TEXT NOT NULL DEFAULT 'a_acheter',
            date_achat TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Fichiers / justificatifs
    await db.execute("""
        CREATE TABLE IF NOT EXISTS fichiers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type_parent TEXT NOT NULL,
            parent_id INTEGER NOT NULL,
            nom_original TEXT NOT NULL,
            chemin TEXT NOT NULL,
            mime_type TEXT,
            taille INTEGER,
            categorie TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Logs d'activité
    await db.execute("""
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            utilisateur_id INTEGER REFERENCES utilisateurs(id),
            action TEXT NOT NULL,
            entite TEXT,
            entite_id INTEGER,
            details TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Index utiles
    await db.execute("CREATE INDEX IF NOT EXISTS idx_achats_date ON achats(date)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_achats_type ON achats(type_achat)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(date)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_flips_statut ON flips(statut)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_reparations_statut ON reparations(statut)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_reparations_client ON reparations(client_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_stock_mouvements_stock ON stock_mouvements(stock_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_fichiers_parent ON fichiers(type_parent, parent_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)")

async def _seed_default_data(db):
    """Insère les données par défaut si absentes."""

    params_defaut = [
        ("urssaf_pct", "0.246"),
        ("reinvest_pct", "0.30"),
        ("perso_pct", "0.454"),
        ("objectif_mensuel", "1000"),       # ✅ était "objectif_marge"
        ("garantie_mois", "3"),
        ("seuil_alerte_multiplicateur", "1.25"),
        ("notifications_actives", "0"),
        ("notification_canal", ""),
        ("notification_destinataire", ""),
        ("societe_nom", "AQ Réparation"),
        ("societe_telephone", ""),
        ("societe_email", ""),
        ("societe_adresse", ""),
        ("societe_siret", ""),              # ✅ manquait, utilisé dans recu
        ("telegram_bot_token", ""),         # ✅ manquait, utilisé dans parametres
        ("telegram_chat_id", ""),           # ✅ manquait
        ("free_mobile_user", ""),           # ✅ manquait
        ("free_mobile_pass", ""),           # ✅ manquait
    ]
    for cle, valeur in params_defaut:
        await db.execute(
            "INSERT OR IGNORE INTO parametres (cle, valeur) VALUES (?, ?)",
            (cle, valeur),
        )

    # Catégories par défaut — inchangées
    categories_defaut = [
        ("achat", "Smartphone"),
        ("achat", "Tablette"),
        ("achat", "PC portable"),
        ("achat", "Console"),
        ("achat", "Accessoire"),
        ("achat", "Pièce détachée"),
        ("achat", "Matériel atelier"),
        ("achat", "Autre"),
        ("vente", "Smartphone"),
        ("vente", "Tablette"),
        ("vente", "PC portable"),
        ("vente", "Console"),
        ("vente", "Accessoire"),
        ("vente", "Autre"),
        ("stock", "Écran"),
        ("stock", "Batterie"),
        ("stock", "Connecteur"),
        ("stock", "Nappe"),
        ("stock", "Vitre"),
        ("stock", "Châssis"),
        ("stock", "Autre"),
    ]
    for i, (type_cat, nom) in enumerate(categories_defaut):
        await db.execute(
            "INSERT OR IGNORE INTO categories (type, nom, ordre) VALUES (?, ?, ?)",
            (type_cat, nom, i),
        )

    # Plateformes par défaut — inchangées
    plateformes_defaut = [
        ("achat", "eBay"),
        ("achat", "Vinted"),
        ("achat", "LeBonCoin"),
        ("achat", "AliExpress"),
        ("achat", "Amazon"),
        ("achat", "Rakuten"),
        ("achat", "Fournisseur direct"),
        ("achat", "Autre"),
        ("vente", "eBay"),
        ("vente", "Vinted"),
        ("vente", "LeBonCoin"),
        ("vente", "Rakuten"),
        ("vente", "Remise en main propre"),
        ("vente", "Autre"),
    ]
    for i, (type_pf, nom) in enumerate(plateformes_defaut):
        await db.execute(
            "INSERT OR IGNORE INTO plateformes (type, nom, ordre) VALUES (?, ?, ?)",
            (type_pf, nom, i),
        )

    # Création admin par défaut
    async with db.execute("SELECT COUNT(*) FROM utilisateurs") as cur:
        count = (await cur.fetchone())[0]

    if count == 0:
        from backend.auth import hash_password

        await db.execute(
            """
            INSERT INTO utilisateurs (username, password_hash, role, actif)
            VALUES ('admin', ?, 'admin', 1)
            """,
            (hash_password("admin"),),
        )
        print("✅ Utilisateur admin créé (mot de passe : admin) — changez-le !")

    await db.commit()
    """Insère les données par défaut si absentes."""

    # Paramètres par défaut
    params_defaut = [
        ("urssaf_pct", "0.246"),
        ("reinvest_pct", "0.30"),
        ("perso_pct", "0.454"),
        ("objectif_marge", "1000"),
        ("garantie_mois", "3"),
        ("seuil_alerte_multiplicateur", "1.25"),
        ("notifications_actives", "0"),
        ("notification_canal", ""),
        ("notification_destinataire", ""),
        ("societe_nom", "AQ Réparation"),
        ("societe_telephone", ""),
        ("societe_email", ""),
        ("societe_adresse", ""),
    ]
    for cle, valeur in params_defaut:
        await db.execute(
            "INSERT OR IGNORE INTO parametres (cle, valeur) VALUES (?, ?)",
            (cle, valeur),
        )

    # Catégories par défaut
    categories_defaut = [
        ("achat", "Smartphone"),
        ("achat", "Tablette"),
        ("achat", "PC portable"),
        ("achat", "Console"),
        ("achat", "Accessoire"),
        ("achat", "Pièce détachée"),
        ("achat", "Matériel atelier"),
        ("achat", "Autre"),
        ("vente", "Smartphone"),
        ("vente", "Tablette"),
        ("vente", "PC portable"),
        ("vente", "Console"),
        ("vente", "Accessoire"),
        ("vente", "Autre"),
        ("stock", "Écran"),
        ("stock", "Batterie"),
        ("stock", "Connecteur"),
        ("stock", "Nappe"),
        ("stock", "Vitre"),
        ("stock", "Châssis"),
        ("stock", "Autre"),
    ]
    for i, (type_cat, nom) in enumerate(categories_defaut):
        await db.execute(
            "INSERT OR IGNORE INTO categories (type, nom, ordre) VALUES (?, ?, ?)",
            (type_cat, nom, i),
        )

    # Plateformes par défaut
    plateformes_defaut = [
        ("achat", "eBay"),
        ("achat", "Vinted"),
        ("achat", "LeBonCoin"),
        ("achat", "AliExpress"),
        ("achat", "Amazon"),
        ("achat", "Rakuten"),
        ("achat", "Fournisseur direct"),
        ("achat", "Autre"),
        ("vente", "eBay"),
        ("vente", "Vinted"),
        ("vente", "LeBonCoin"),
        ("vente", "Rakuten"),
        ("vente", "Remise en main propre"),
        ("vente", "Autre"),
    ]
    for i, (type_pf, nom) in enumerate(plateformes_defaut):
        await db.execute(
            "INSERT OR IGNORE INTO plateformes (type, nom, ordre) VALUES (?, ?, ?)",
            (type_pf, nom, i),
        )

    # --- Création admin par défaut (premier démarrage) ---
    async with db.execute("SELECT COUNT(*) FROM utilisateurs") as cur:
        count = (await cur.fetchone())[0]

    if count == 0:
        from backend.auth import hash_password

        await db.execute(
            """INSERT INTO utilisateurs (username, password_hash, role, actif)
               VALUES ('admin', ?, 'admin', 1)""",
            (hash_password("admin"),),
        )
        print("✅ Utilisateur admin créé (mot de passe : admin) — changez-le !")

    await db.commit()