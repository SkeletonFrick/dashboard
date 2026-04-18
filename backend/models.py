from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import date

# --- Auth ---

class UserLogin(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "admin"


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    actif: bool
    created_at: str
    last_login_at: Optional[str] = None 


# --- Paramètres ---

class ParamUpdate(BaseModel):
    valeur: str


class ParamsMetier(BaseModel):
    urssaf_pct: float
    reinvest_pct: float
    perso_pct: float
    objectif_mensuel: Optional[float] = None
    garantie_mois: Optional[int] = None
    seuil_alerte_multiplicateur: Optional[float] = None
    notifications_actives: Optional[str] = None
    societe_nom: Optional[str] = None
    societe_siret: Optional[str] = None
    societe_adresse: Optional[str] = None
    societe_telephone: Optional[str] = None
    societe_email: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    free_mobile_user: Optional[str] = None
    free_mobile_pass: Optional[str] = None

    @field_validator("urssaf_pct", "reinvest_pct", "perso_pct")
    @classmethod
    def pct_range(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            raise ValueError("Le pourcentage doit être entre 0 et 1")
        return v


# --- Clients ---

class ClientCreate(BaseModel):
    nom: str
    telephone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class ClientUpdate(BaseModel):
    nom: Optional[str] = None
    telephone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


# --- Fournisseurs ---

class FournisseurCreate(BaseModel):
    nom: str
    lien: Optional[str] = None
    contact: Optional[str] = None
    delai_moyen_jours: Optional[int] = None
    notes: Optional[str] = None


class FournisseurUpdate(BaseModel):
    nom: Optional[str] = None
    lien: Optional[str] = None
    contact: Optional[str] = None
    delai_moyen_jours: Optional[int] = None
    notes: Optional[str] = None


# --- Achats ---

# backend/models.py
# Remplacer uniquement AchatCreate et AchatUpdate

class AchatCreate(BaseModel):
    date: str
    nom: str
    type_achat: str = "autre"
    categorie: Optional[str] = None       # ✅ string, pas categorie_id
    plateforme: Optional[str] = None      # ✅ string, pas plateforme_id
    fournisseur_id: Optional[int] = None
    prix_achat: float = 0                 # ✅ était prix
    quantite: int = 1                     # ✅ était qte
    est_lot: bool = False
    lot_id: Optional[int] = None
    ajout_stock_auto: bool = False
    notes: Optional[str] = None


class AchatUpdate(BaseModel):
    date: Optional[str] = None
    nom: Optional[str] = None
    type_achat: Optional[str] = None
    categorie: Optional[str] = None       # ✅ string
    plateforme: Optional[str] = None      # ✅ string
    prix_achat: Optional[float] = Field(default=None, ge=0)  # ✅ était prix
    quantite: Optional[int] = Field(default=None, ge=1)      # ✅ était qte
    fournisseur_id: Optional[int] = None
    lot_id: Optional[int] = None
    ajout_stock_auto: Optional[bool] = None
    notes: Optional[str] = None


# --- Ventes ---

class VenteCreate(BaseModel):
    date: str
    nom: str
    categorie: Optional[str] = None
    plateforme: Optional[str] = None
    prix_vente: float = 0
    achat_id: Optional[int] = None
    flip_id: Optional[int] = None
    notes: Optional[str] = None


class VenteUpdate(BaseModel):
    date: Optional[str] = None
    nom: Optional[str] = None
    categorie: Optional[str] = None
    plateforme: Optional[str] = None
    prix_vente: Optional[float] = None
    achat_id: Optional[int] = None
    flip_id: Optional[int] = None
    notes: Optional[str] = None


# --- Flips ---

class FlipCreate(BaseModel):
    achat_id: Optional[int] = None
    nom: str
    marque: Optional[str] = None
    modele: Optional[str] = None
    imei: Optional[str] = None
    etat_initial: Optional[str] = None
    statut: Optional[str] = "a_diagnostiquer"
    notes: Optional[str] = None
    prix_achat: Optional[float] = None


class FlipUpdate(BaseModel):
    nom: Optional[str] = None
    marque: Optional[str] = None
    modele: Optional[str] = None
    imei: Optional[str] = None
    etat_initial: Optional[str] = None
    statut: Optional[str] = None
    notes: Optional[str] = None
    prix_achat: Optional[float] = None
    vente_id: Optional[int] = None


class FlipPieceCreate(BaseModel):
    stock_id: int
    quantite: float
    prix_unitaire: Optional[float] = None


# --- Réparations ---

class ReparationCreate(BaseModel):
    date_reception: str
    client_id: Optional[int] = None
    telephone: Optional[str] = None
    appareil: str
    marque: Optional[str] = None
    modele: Optional[str] = None
    panne_decrite: Optional[str] = None
    diagnostic: Optional[str] = None
    reparation_effectuee: Optional[str] = None
    statut: str = "recu"
    prix_facture: float = 0
    acompte: float = 0
    notes: Optional[str] = None


class ReparationUpdate(BaseModel):
    date_reception: Optional[str] = None
    client_id: Optional[int] = None
    telephone: Optional[str] = None
    appareil: Optional[str] = None
    marque: Optional[str] = None
    modele: Optional[str] = None
    panne_decrite: Optional[str] = None
    diagnostic: Optional[str] = None
    reparation_effectuee: Optional[str] = None
    statut: Optional[str] = None
    prix_facture: Optional[float] = None
    acompte: Optional[float] = None
    date_restitution: Optional[str] = None
    date_fin_garantie: Optional[str] = None
    notes: Optional[str] = None


class ReparationPieceCreate(BaseModel):
    stock_id: int
    quantite: int = 1
    prix_unitaire: Optional[float] = None


# --- Stock ---

class StockCreate(BaseModel):
    nom: str
    categorie: Optional[str] = None
    quantite: int = 0
    unite: str = "pcs"
    stock_minimal: int = 1
    fournisseur_id: Optional[int] = None
    reference: Optional[str] = None
    emplacement: Optional[str] = None
    notes: Optional[str] = None


class StockUpdate(BaseModel):
    # quantite absent volontairement — passer par /mouvement
    nom: Optional[str] = None
    categorie: Optional[str] = None
    unite: Optional[str] = None
    stock_minimal: Optional[int] = None
    fournisseur_id: Optional[int] = None
    reference: Optional[str] = None
    emplacement: Optional[str] = None
    notes: Optional[str] = None


class StockMouvementCreate(BaseModel):
    type_mouvement: str
    quantite: int
    motif: Optional[str] = None
    reference_id: Optional[int] = None
    reference_type: Optional[str] = None


class StockCommandeUpdate(BaseModel):
    commande_en_cours: bool
    quantite_commandee: int = 0
    date_arrivee_prevue: Optional[str] = None


# --- Matériel ---

class MaterielCreate(BaseModel):
    article: str
    lien: Optional[str] = None
    prix_estime: Optional[float] = None
    priorite: str = "normale"
    notes: Optional[str] = None
    statut: str = "a_acheter"
    date_achat: Optional[str] = None


class MaterielUpdate(BaseModel):
    article: Optional[str] = None
    lien: Optional[str] = None
    prix_estime: Optional[float] = None
    priorite: Optional[str] = None
    notes: Optional[str] = None
    statut: Optional[str] = None
    date_achat: Optional[str] = None


# --- Lots ---

class LotCreate(BaseModel):
    date: str
    nom_lot: str
    prix_total: float = 0
    plateforme: Optional[str] = None
    notes: Optional[str] = None


class LotElementCreate(BaseModel):
    type_element: str
    nom: str
    categorie: Optional[str] = None
    prix_attribue: float = 0
    destination: Optional[str] = None
    notes: Optional[str] = None