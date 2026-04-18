// Dans frontend/js/parametres.js
// Remplacer uniquement la fonction setupExports()

import { apiFetch, showToast, formatEur, formatBytes } from "./app.js";

export function setupExports() {
  // Export Stock CSV
  const btnStock = document.getElementById("btn-export-stock");
  if (btnStock) {
    btnStock.onclick = () => {
      window.open("/api/export/stock-csv", "_blank");
      showToast("📊 Export CSV lancé", "info");
    };
  }

  // Backup DB
  const btnBackup = document.getElementById("btn-backup-db");
  if (btnBackup) {
    btnBackup.onclick = async () => {
      const statusEl = document.getElementById("backup-status");

      btnBackup.disabled = true;
      btnBackup.innerHTML =
        '<span class="loading loading-spinner loading-xs"></span> Sauvegarde…';

      try {
        // apiFetch retourne déjà l'objet JSON parsé — pas besoin de .json()
        const info = await apiFetch("/api/export/backup", { method: "POST" });

        statusEl.className = "alert alert-success w-full mt-2";
        statusEl.classList.remove("hidden");
        statusEl.innerHTML = `
          ✅ Backup créé : <strong>${info.backup_file}</strong><br/>
          📏 ${formatBytes(info.size_bytes)} · ${info.backup_dir}
        `;

        showToast(`💾 Backup OK : ${info.backup_file}`, "success");
        loadBackupsList();
      } catch (e) {
        statusEl.className = "alert alert-error w-full mt-2";
        statusEl.classList.remove("hidden");
        statusEl.textContent = `❌ Erreur : ${e.message}`;
        showToast("❌ Erreur backup", "error");
      } finally {
        btnBackup.disabled = false;
        btnBackup.innerHTML = "🚀 Créer backup";
        setTimeout(() => {
          statusEl.classList.add("hidden");
        }, 10000);
      }
    };
  }

  // Export JSON complet
  const btnJson = document.getElementById("btn-export-json");
  if (btnJson) {
    btnJson.onclick = () => {
      window.open("/api/export/json-complet", "_blank");
      showToast("🌐 Export JSON lancé", "info");
    };
  }
}