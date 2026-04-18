import { apiFetch, showToast, formatEur, formatBytes } from "./app.js";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function switchTab(name) {
  // Vérification défensive
  const target = document.getElementById(`tab-${name}`);
  if (!target) {
    console.error(`❌ Onglet introuvable: tab-${name}`);
    return;
  }

  // Masquer tous les onglets
  document.querySelectorAll(".tab-content").forEach((el) => {
    el.classList.add("hidden");
  });
  target.classList.remove("hidden");

  // Activer le bon bouton
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("tab-active", btn.dataset.tab === name);
  });

  // Chargement lazy selon onglet
  switch (name) {
    case "listes":
      loadCategories();
      loadPlateformes();
      break;
    case "charges":
      loadChargesFixes();
      break;
    case "exports":
      setupExports();
      loadBackupsList();
      break;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function initParametres() {
  await loadParams();
  setupForms();
  // Forcer l'affichage du premier onglet actif
  const activeBtn = document.querySelector("[data-tab].tab-active");
  const firstName = activeBtn?.dataset.tab ?? "metier";
  switchTab(firstName);
}


// ---------------------------------------------------------------------------
// Paramètres généraux
// ---------------------------------------------------------------------------

async function loadParams() {
  try {
    const params = await apiFetch("/api/parametres");
    
    // Métier (% → affichage décimal)
    setValue("p-urssaf", toPercent(params.urssaf_pct));
    setValue("p-reinvest", toPercent(params.reinvest_pct));
    setValue("p-perso", toPercent(params.perso_pct));
    setValue("p-objectif", params.objectif_mensuel ?? "");
    setValue("p-garantie", params.garantie_mois ?? "");
    setValue("p-seuil", params.seuil_alerte_multiplicateur ?? "");

    // Société
    setValue("s-nom", params.societe_nom ?? "");
    setValue("s-siret", params.societe_siret ?? "");
    setValue("s-adresse", params.societe_adresse ?? "");
    setValue("s-telephone", params.societe_telephone ?? "");
    setValue("s-email", params.societe_email ?? "");

    // Notifications
    setChecked("n-actif", params.notifications_actives === "true" || params.notifications_actives === "1");
    setValue("n-tg-token", params.telegram_bot_token ?? "");
    setValue("n-tg-chat", params.telegram_chat_id ?? "");
    setValue("n-fm-user", params.free_mobile_user ?? "");
    setValue("n-fm-pass", params.free_mobile_pass ?? "");

    updatePctTotal();
  } catch (e) {
    showToast("❌ Erreur chargement paramètres", "error");
  }
}

// ---------------------------------------------------------------------------
// Forms handlers
// ---------------------------------------------------------------------------

function setupForms() {
  // Listener total pourcentages en temps réel
  ["p-urssaf", "p-reinvest", "p-perso"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updatePctTotal);
  });

  // === FORM MÉTIER ===
  const formMetier = document.getElementById("form-metier");
  if (formMetier) {
    formMetier.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const urssaf = parseFloat(document.getElementById("p-urssaf").value) / 100;
      const reinvest = parseFloat(document.getElementById("p-reinvest").value) / 100;
      const perso = parseFloat(document.getElementById("p-perso").value) / 100;
      const total = urssaf + reinvest + perso;

      if (Math.abs(total - 1.0) > 0.001) {
        showToast(`❌ Somme invalide: ${Math.round(total * 100)}% (doit = 100%)`, "error");
        return;
      }

      const btn = document.getElementById("btn-save-metier");
      btn.classList.add("loading");

      try {
        await apiFetch("/api/parametres", {
          method: "PUT",
          body: JSON.stringify({
            urssaf_pct: urssaf,
            reinvest_pct: reinvest,
            perso_pct: perso,
            objectif_mensuel: parseFloat(document.getElementById("p-objectif").value) || null,
            garantie_mois: parseInt(document.getElementById("p-garantie").value) || null,
            seuil_alerte_multiplicateur: parseFloat(document.getElementById("p-seuil").value) || null,
          }),
        });
        showToast("✅ Paramètres métier enregistrés", "success");
      } catch (e) {
        showToast(e.message || "❌ Erreur sauvegarde", "error");
      } finally {
        btn.classList.remove("loading");
      }
    });
  }

  // === FORM SOCIÉTÉ ===
  const formSociete = document.getElementById("form-societe");
  if (formSociete) {
    formSociete.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fields = {
        societe_nom: getValue("s-nom"),
        societe_siret: getValue("s-siret"),
        societe_adresse: getValue("s-adresse"),
        societe_telephone: getValue("s-telephone"),
        societe_email: getValue("s-email"),
      };

      try {
        await Promise.all(
          Object.entries(fields).map(([cle, valeur]) =>
            apiFetch(`/api/parametres/param/${cle}`, {
              method: "PUT",
              body: JSON.stringify({ valeur }),
            })
          )
        );
        showToast("✅ Société mise à jour", "success");
      } catch (e) {
        showToast("❌ Erreur", "error");
      }
    });
  }

  // === FORM NOTIFICATIONS ===
  const formNotifs = document.getElementById("form-notifs");
  if (formNotifs) {
    formNotifs.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fields = {
        notifications_actives: document.getElementById("n-actif").checked ? "true" : "false",
        telegram_bot_token: getValue("n-tg-token"),
        telegram_chat_id: getValue("n-tg-chat"),
        free_mobile_user: getValue("n-fm-user"),
        free_mobile_pass: getValue("n-fm-pass"),
      };

      try {
        await Promise.all(
          Object.entries(fields).map(([cle, valeur]) =>
            apiFetch(`/api/parametres/param/${cle}`, {
              method: "PUT",
              body: JSON.stringify({ valeur }),
            })
          )
        );
        showToast("✅ Notifications configurées", "success");
      } catch (e) {
        showToast("❌ Erreur configuration", "error");
      }
    });
  }
}

function updatePctTotal() {
  const u = parseFloat(document.getElementById("p-urssaf")?.value) || 0;
  const r = parseFloat(document.getElementById("p-reinvest")?.value) || 0;
  const p = parseFloat(document.getElementById("p-perso")?.value) || 0;
  const total = u + r + p;
  
  const elTotal = document.getElementById("pct-total");
  const indicator = document.getElementById("pct-indicator");
  
  if (elTotal) {
    elTotal.textContent = `${Math.round(total * 10) / 10} %`;
    elTotal.className = `font-mono font-bold text-xl ${
      Math.abs(total - 100) < 0.1 ? "text-success" : "text-error"
    }`;
  }
  
  if (indicator) {
    const ok = Math.abs(total - 100) < 0.1;
    indicator.className = `badge badge-sm ml-auto ${ok ? "badge-success" : "badge-error"}`;
    indicator.textContent = ok ? "✓ Parfait" : "⚠️ Corriger";
  }
}

// ---------------------------------------------------------------------------
// EXPORTS (PHASE 3C)
// ---------------------------------------------------------------------------

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
      const btn = btnBackup;
      const statusEl = document.getElementById("backup-status");
      
      btn.disabled = true;
      btn.innerHTML = '<span class="loading loading-spinner"></span> Sauvegarde...';
      
      try {
        const res = await apiFetch("/api/export/backup", { method: "POST" });
        const info = await res.json();
        
        statusEl.className = "alert alert-success w-full mt-2 !block";
        statusEl.innerHTML = `
          ✅ Backup créé: <strong>${info.backup_file}</strong><br>
          📏 ${formatBytes(info.size_bytes)} • ${info.backup_dir}
        `;
        
        showToast(`💾 Backup OK: ${info.backup_file}`, "success");
        loadBackupsList(); // Refresh liste
      } catch (e) {
        statusEl.className = "alert alert-error w-full mt-2 !block";
        statusEl.textContent = `❌ Erreur: ${e.message}`;
        showToast("❌ Erreur backup", "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = "🚀 Créer backup";
        setTimeout(() => statusEl.classList.add("hidden"), 10000);
      }
    };
  }

  // Export JSON complet
  const btnJson = document.getElementById("btn-export-json");
  if (btnJson) {
    btnJson.onclick = () => {
      window.open("/api/export/json-complet", "_blank");
      showToast("🌐 Export JSON lancé (admin)", "info");
    };
  }
}

async function loadBackupsList() {
  try {
    // Simulation liste backups (à connecter backend si endpoint dédié)
    const backupsEl = document.getElementById("backups-list");
    backupsEl.innerHTML = `
      <div class="text-center py-8 col-span-full text-base-content/40">
        <span class="loading loading-spinner"></span><br>
        Backups dans data/backups/
      </div>
    `;
    
    // TODO: endpoint dédié /api/export/backups-list
  } catch (e) {
    console.error("Erreur liste backups:", e);
  }
}

// ---------------------------------------------------------------------------
// CATÉGORIES
// ---------------------------------------------------------------------------

export async function loadCategories() {
  const type = document.getElementById("cat-type-filter")?.value || "";
  const url = type ? `/api/parametres/categories?type=${type}` : "/api/parametres/categories";
  
  try {
    const cats = await apiFetch(url);
    const el = document.getElementById("categories-list");
    
    if (!cats?.length) {
      el.innerHTML = '<p class="text-center py-8 text-base-content/40">Aucune catégorie</p>';
      return;
    }
    
    el.innerHTML = cats.map(c => `
      <div class="flex items-center justify-between py-2 px-2 bg-base-200 rounded-lg group hover:bg-base-300 transition-all">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <span class="badge badge-outline badge-xs">${escHtml(c.type)}</span>
          <span class="text-sm font-medium truncate ${!c.actif ? 'line-through opacity-50' : ''}">
            ${escHtml(c.nom)}
          </span>
        </div>
        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <button onclick="toggleCategorie(${c.id}, ${c.actif})" 
                  class="btn btn-ghost btn-xs ${c.actif ? '' : 'btn-success'}" 
                  title="${c.actif ? 'Désactiver' : 'Activer'}">
            ${c.actif ? '🔕' : '🔔'}
          </button>
          <button onclick="deleteCategorie(${c.id})" 
                  class="btn btn-ghost btn-xs btn-error" 
                  title="Supprimer">
            ✕
          </button>
        </div>
      </div>
    `).join("");
  } catch (e) {
    showToast("❌ Erreur catégories", "error");
  }
}

export async function addCategorie() {
  const type = document.getElementById("new-cat-type").value;
  const nom = document.getElementById("new-cat-nom").value.trim();
  
  if (!nom) {
    showToast("❌ Nom requis", "error");
    return;
  }
  
  try {
    await apiFetch("/api/parametres/categories", {
      method: "POST",
      body: JSON.stringify({ type, nom }),
    });
    document.getElementById("new-cat-nom").value = "";
    showToast("✅ Catégorie ajoutée", "success");
    loadCategories();
  } catch (e) {
    showToast("❌ Erreur ajout", "error");
  }
}

// Global functions pour onclick inline
window.toggleCategorie = async (id, actif) => {
  try {
    await apiFetch(`/api/parametres/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ actif: actif ? 0 : 1 }),
    });
    showToast(actif ? "🔕 Désactivée" : "🔔 Activée", "success");
    loadCategories();
  } catch (e) {
    showToast("❌ Erreur", "error");
  }
};

window.deleteCategorie = async (id) => {
  if (!confirm("🗑️ Supprimer définitivement cette catégorie ?")) return;
  try {
    await apiFetch(`/api/parametres/categories/${id}`, { method: "DELETE" });
    showToast("✅ Supprimée", "success");
    loadCategories();
  } catch (e) {
    showToast("❌ Erreur suppression", "error");
  }
};

// ---------------------------------------------------------------------------
// PLATEFORMES (identique aux catégories)
// ---------------------------------------------------------------------------

export async function loadPlateformes() {
  const type = document.getElementById("plat-type-filter")?.value || "";
  const url = type ? `/api/parametres/plateformes?type=${type}` : "/api/parametres/plateformes";
  
  try {
    const plats = await apiFetch(url);
    const el = document.getElementById("plateformes-list");
    
    if (!plats?.length) {
      el.innerHTML = '<p class="text-center py-8 text-base-content/40">Aucune plateforme</p>';
      return;
    }
    
    el.innerHTML = plats.map(p => `
      <div class="flex items-center justify-between py-2 px-2 bg-base-200 rounded-lg group hover:bg-base-300 transition-all">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <span class="badge badge-outline badge-xs">${escHtml(p.type)}</span>
          <span class="text-sm font-medium truncate ${!p.actif ? 'line-through opacity-50' : ''}">
            ${escHtml(p.nom)}
          </span>
        </div>
        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <button onclick="togglePlateforme(${p.id}, ${p.actif})" 
                  class="btn btn-ghost btn-xs ${p.actif ? '' : 'btn-success'}" 
                  title="${p.actif ? 'Désactiver' : 'Activer'}">
            ${p.actif ? '🔕' : '🔔'}
          </button>
          <button onclick="deletePlateforme(${p.id})" 
                  class="btn btn-ghost btn-xs btn-error" 
                  title="Supprimer">
            ✕
          </button>
        </div>
      </div>
    `).join("");
  } catch (e) {
    showToast("❌ Erreur plateformes", "error");
  }
}

export async function addPlateforme() {
  const type = document.getElementById("new-plat-type").value;
  const nom = document.getElementById("new-plat-nom").value.trim();
  
  if (!nom) {
    showToast("❌ Nom requis", "error");
    return;
  }
  
  try {
    await apiFetch("/api/parametres/plateformes", {
      method: "POST",
      body: JSON.stringify({ type, nom }),
    });
    document.getElementById("new-plat-nom").value = "";
    showToast("✅ Plateforme ajoutée", "success");
    loadPlateformes();
  } catch (e) {
    showToast("❌ Erreur ajout", "error");
  }
}

window.togglePlateforme = async (id, actif) => {
  try {
    await apiFetch(`/api/parametres/plateformes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ actif: actif ? 0 : 1 }),
    });
    showToast(actif ? "🔕 Désactivée" : "🔔 Activée", "success");
    loadPlateformes();
  } catch (e) {
    showToast("❌ Erreur", "error");
  }
};

window.deletePlateforme = async (id) => {
  if (!confirm("🗑️ Supprimer définitivement cette plateforme ?")) return;
  try {
    await apiFetch(`/api/parametres/plateformes/${id}`, { method: "DELETE" });
    showToast("✅ Supprimée", "success");
    loadPlateformes();
  } catch (e) {
    showToast("❌ Erreur suppression", "error");
  }
};

// ---------------------------------------------------------------------------
// CHARGES FIXES
// ---------------------------------------------------------------------------

async function loadChargesFixes() {
  try {
    const charges = await apiFetch("/api/parametres/charges-fixes");
    const tbody = document.getElementById("charges-fixes-tbody");
    const perioMap = {
      mensuelle: "📅 Mensuelle",
      trimestrielle: "📅 Trimestrielle", 
      semestrielle: "📅 Semestrielle",
      annuelle: "📅 Annuelle",
    };

    if (!charges?.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-base-content/40">Aucune charge fixe</td></tr>';
      return;
    }

    tbody.innerHTML = charges.map(c => `
      <tr class="hover">
        <td class="font-medium">${escHtml(c.nom)}</td>
        <td class="font-mono font-bold text-success">${formatEur(c.montant)}</td>
        <td>${perioMap[c.periodicite] || c.periodicite}</td>
        <td class="text-center">
          <input type="checkbox" 
                 class="toggle toggle-sm ${c.actif ? 'toggle-success' : 'toggle-error'}"
                 ${c.actif ? 'checked' : ''} 
                 onchange="toggleCharge(${c.id}, this.checked)" />
        </td>
        <td class="text-right">
          <button onclick="deleteCharge(${c.id})" 
                  class="btn btn-ghost btn-xs btn-square btn-error">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"></path>
            </svg>
          </button>
        </td>
      </tr>
    `).join("");
  } catch (e) {
    showToast("❌ Erreur charges fixes", "error");
  }
}

export async function addCharge() {
  const nom = document.getElementById("new-charge-nom").value.trim();
  const montant = parseFloat(document.getElementById("new-charge-montant").value);
  const periodicite = document.getElementById("new-charge-periodicite").value;
  
  if (!nom || isNaN(montant) || montant <= 0) {
    showToast("❌ Nom et montant (>0) requis", "error");
    return;
  }
  
  try {
    await apiFetch("/api/parametres/charges-fixes", {
      method: "POST",
      body: JSON.stringify({ nom, montant, periodicite }),
    });
    
    // Reset form
    document.getElementById("new-charge-nom").value = "";
    document.getElementById("new-charge-montant").value = "";
    
    showToast("✅ Charge ajoutée", "success");
    loadChargesFixes();
  } catch (e) {
    showToast("❌ Erreur ajout charge", "error");
  }
}

window.toggleCharge = async (id, actif) => {
  try {
    await apiFetch(`/api/parametres/charges-fixes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ actif: actif ? 1 : 0 }),
    });
    showToast(actif ? "✅ Activée" : "🔕 Désactivée", "success");
  } catch (e) {
    showToast("❌ Erreur", "error");
  }
};

window.deleteCharge = async (id) => {
  if (!confirm("🗑️ Supprimer définitivement cette charge ?")) return;
  try {
    await apiFetch(`/api/parametres/charges-fixes/${id}`, { method: "DELETE" });
    showToast("✅ Charge supprimée", "success");
    loadChargesFixes();
  } catch (e) {
    showToast("❌ Erreur suppression", "error");
  }
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function toPercent(v) {
  return v == null ? "" : Math.round(parseFloat(v) * 1000) / 10;
}

function getValue(id) {
  return document.getElementById(id)?.value ?? "";
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ?? "";
}

function setChecked(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}