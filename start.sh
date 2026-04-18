#!/bin/bash
cd "$(dirname "$0")"

echo "🚀 Démarrage AQ Réparation..."

# Vérif Python 3.10+
if ! python3 --version | grep -q "3.10\|3.11\|3.12"; then
    echo "❌ Python 3.10+ requis"
    exit 1
fi

# Créer venv si absente
if [ ! -d "venv" ]; then
    echo "📦 Création venv..."
    python3 -m venv venv
fi

# Activer venv
source venv/bin/activate || {
    echo "❌ Erreur activation venv"
    exit 1
}

# Upgrade pip + install
echo "📥 Installation dépendances..."
pip install --upgrade pip
pip install -r requirements.txt

# Vérif uvicorn
if ! command -v uvicorn &> /dev/null; then
    echo "❌ uvicorn manquant, réinstallation..."
    pip install "uvicorn[standard]"
    exit 1
fi

# Lancement
echo "✅ Démarrage sur http://0.0.0.0:8000"
echo "Arrêt: Ctrl+C"
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload