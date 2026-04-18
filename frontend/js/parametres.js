import { apiFetch, showToast, formatEur, formatBytes } from "./app.js";

// ── État ──────────────────────────────────────────────────────────────────────

let _currentTab = "metier";

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initParametres() {
  setupPctListeners();
  setupFormListeners();
  setupExports();
  await loadParams();
  await loadCategories();
  await loadPlateformes();
  await loadChargesFixes();
  await loadBackupsList();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export function switchTab(tabName) {
  _currentTab = tabName;

  document.querySelectorAll(".tab-content").forEach((el) => {
    el.classList.add("hidden");
  });
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.classList.remove("tab-active");
  });

  const content = document.getElementById(`tab-${tabName}`);
  if (content) content.classList.remove("hidden");

  const tab = document.querySelector(`[data-tab="${tabName}"]`);
  if (tab) tab.classList.add("tab-active");
}

// ── Chargement paramètres ─────────────────────────────────────────────────────

export async function loadParams() {
  try {
    const params = await apiFetch("/api/parametres");
    if (!params) return;

    // Onglet Métier
    const urssaf = parseFloat(params.urssaf_pct || 0) * 100;
    const reinvest = parseFloat(params.reinvest_pct || 0) * 100;
    const perso = parseFloat(params.perso_pct || 0) * 100;

    _setVal("p-urssaf", urssaf.toFixed(1));
    _setVal("p-reinvest", reinvest.toFixed(1));
    _setVal("p-perso", perso.toFixed(1));
    _setVal("p-objectif", params.objectif_mensuel || "");
    _setVal("p-garantie", params.garantie_mois || "");
    _setVal("p-seuil", params.seuil_alerte_multiplicateur || "");
    updatePctTotal();

    // Onglet Société
    _setVal("s-nom", params.societe_nom || "");
    _setVal("s-siret", params.societe_siret || "");
    _setVal("s-adresse", params.societe_adresse || "");
    _setVal("s-telephone", params.societe_telephone || "");
    _setVal("s-email", params.societe_email || "");

    // Onglet Notifications
    const actif = document.getElementById("n-actif");
    if (actif) actif.checked = params.notifications_actives === "1";
    _setVal("n-tg-token", params.telegram_bot_token || "");
    _setVal("n-tg-chat", params.telegram_chat_id || "");
    _setVal("n-fm-user", params.free_mobile_user || "");
    _setVal("n-fm-pass", params.free_mobile_pass || "");
  } catch (e) {
    showToast("Erreur chargement paramètres", "error");
  }
}

// ── Listeners formulaires ─────────────────────────────────────────────────────

function setupFormListeners() {
  // Formulaire Métier
  const formMetier = document.getElementById("form-metier");
  if (formMetier) {
    formMetier.addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveMetier();
    });
  }

  // Formulaire Société
  const formSociete = document.getElementById("form-societe");
  if (formSociete) {
    formSociete.addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveSociete();
    });
  }

  // Formulaire Notifications
  const formNotifs = document.getElementById("form-notifs");
  if (formNotifs) {
    formNotifs.addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveNotifs();
    });
  }
}

// ── Sauvegarde Métier ─────────────────────────────────────────────────────────

async function saveMetier() {
  const urssaf = parseFloat(_getVal("p-urssaf")) / 100;
  const reinvest = parseFloat(_getVal("p-reinvest")) / 100;
  const perso = parseFloat(_getVal("p-perso")) / 100;

  const total = Math.round((urssaf + reinvest + perso) * 1000) / 1000;
  if (Math.abs(total - 1.0) > 0.001) {
    showToast(
      `Le total des pourcentages doit être 100% (actuellement ${Math.round(total * 100)}%)`,
      "error"
    );
    return;
  }

  const payload = {
    urssaf_pct: urssaf,
    reinvest_pct: reinvest,
    perso_pct: perso,
    objectif_mensuel: parseFloat(_getVal("p-objectif")) || null,
    garantie_mois: parseInt(_getVal("p-garantie")) || null,
    seuil_alerte_multiplicateur:
      parseFloat(_getVal("p-seuil")) || null,
  };

  try {
    await apiFetch("/api/parametres", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    showToast("Paramètres métier enregistrés", "success");
  } catch (e) {
    showToast(e.message || "Erreur sauvegarde", "error");
  }
}

// ── Sauvegarde Société ────────────────────────────────────────────────────────

async function saveSociete() {
  const fields = {
    societe_nom: _getVal("s-nom"),
    societe_siret: _getVal("s-siret"),
    societe_adresse: _getVal("s-adresse"),
    societe_telephone: _getVal("s-telephone"),
    societe_email: _getVal("s-email"),
  };

  try {
    for (const [cle, valeur] of Object.entries(fields)) {
      await apiFetch(`/api/parametres/param/${cle}`, {
        method: "PUT",
        body: JSON.stringify({ valeur }),
      });
    }
    showToast("Informations société enregistrées", "success");
  } catch (e) {
    showToast(e.message || "Erreur sauvegarde", "error");
  }
}

// ── Sauvegarde Notifications ──────────────────────────────────────────────────

async function saveNotifs() {
  const actifEl = document.getElementById("n-actif");
  const fields = {
    notifications_actives: actifEl?.checked ? "1" : "0",
    telegram_bot_token: _getVal("n-tg-token"),
    telegram_chat_id: _getVal("n-tg-chat"),
    free_mobile_user: _getVal("n-fm-user"),
    free_mobile_pass: _getVal("n-fm-pass"),
  };

  try {
    for (const [cle, valeur] of Object.entries(fields)) {
      await apiFetch(`/api/parametres/param/${cle}`, {
        method: "PUT",
        body: JSON.stringify({ valeur }),
      });
    }
    showToast("Notifications enregistrées", "success");
  } catch (e) {
    showToast(e.message || "Erreur sauvegarde", "error");
  }
}

// ── Indicateur pourcentages ───────────────────────────────────────────────────

function setupPctListeners() {
  ["p-urssaf", "p-reinvest", "p-perso"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updatePctTotal);
  });
}

function updatePctTotal() {
  const urssaf = parseFloat(_getVal("p-urssaf")) || 0;
  const reinvest = parseFloat(_getVal("p-reinvest")) || 0;
  const perso = parseFloat(_getVal("p-perso")) || 0;
  const total = Math.round((urssaf + reinvest + perso) * 10) / 10;

  const totalEl = document.getElementById("pct-total");
  const indicator = document.getElementById("pct-indicator");
  if (!totalEl || !indicator) return;

  totalEl.textContent = `${total} %`;
  const ok = Math.abs(total - 100) < 0.1;
  indicator.textContent = ok ? "✅ OK" : `⚠️ ${total > 100 ? "Trop élevé" : "Insuffisant"}`;
  indicator.className = `ml-auto badge badge-sm ${ok ? "badge-success" : "badge-error"}`;
}

// ── Catégories ────────────────────────────────────────────────────────────────

export async function loadCategories() {
  const typeFilter = document.getElementById("cat-type-filter")?.value || "";
  const url = typeFilter
    ? `/api/parametres/categories?type=${typeFilter}`
    : "/api/parametres/categories";

  try {
    const data = await apiFetch(url);
    const container = document.getElementById("categories-list");
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `
        <p class="text-center text-base-content/40 py-4">
          Aucune catégorie
        </p>`;
      return;
    }

    container.innerHTML = data
      .map(
        (c) => `
      <div class="flex items-center justify-between py-2 px-3
                  bg-base-200 rounded-lg ${c.actif ? "" : "opacity-50"}">
        <div class="flex items-center gap-2">
          <span class="badge badge-xs badge-ghost">${escHtml(c.type)}</span>
          <span class="text-sm font-medium">${escHtml(c.nom)}</span>
        </div>
        <div class="flex gap-1">
          <button
            class="btn btn-xs btn-ghost"
            onclick="toggleCategorie(${c.id}, ${c.actif ? 0 : 1})"
            title="${c.actif ? "Désactiver" : "Activer"}"
          >${c.actif ? "⏸" : "▶️"}</button>
          <button
            class="btn btn-xs btn-ghost text-error"
            onclick="deleteCategorie(${c.id})"
            title="Supprimer"
          >🗑️</button>
        </div>
      </div>`
      )
      .join("");
  } catch (e) {
    showToast("Erreur chargement catégories", "error");
  }
}

export async function addCategorie() {
  const type = document.getElementById("new-cat-type")?.value;
  const nom = document.getElementById("new-cat-nom")?.value.trim();

  if (!nom) {
    showToast("Nom requis", "warning");
    return;
  }

  try {
    await apiFetch("/api/parametres/categories", {
      method: "POST",
      body: JSON.stringify({ type, nom }),
    });
    showToast("Catégorie ajoutée", "success");
    document.getElementById("new-cat-nom").value = "";
    await loadCategories();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
}

window.toggleCategorie = async (id, actif) => {
  try {
    await apiFetch(`/api/parametres/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ actif }),
    });
    await loadCategories();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
};

window.deleteCategorie = async (id) => {
  if (!confirm("Supprimer cette catégorie ?")) return;
  try {
    await apiFetch(`/api/parametres/categories/${id}`, { method: "DELETE" });
    showToast("Catégorie supprimée", "success");
    await loadCategories();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
};

// ── Plateformes ───────────────────────────────────────────────────────────────

export async function loadPlateformes() {
  const typeFilter = document.getElementById("plat-type-filter")?.value || "";
  const url = typeFilter
    ? `/api/parametres/plateformes?type=${typeFilter}`
    : "/api/parametres/plateformes";

  try {
    const data = await apiFetch(url);
    const container = document.getElementById("plateformes-list");
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `
        <p class="text-center text-base-content/40 py-4">
          Aucune plateforme
        </p>`;
      return;
    }

    container.innerHTML = data
      .map(
        (p) => `
      <div class="flex items-center justify-between py-2 px-3
                  bg-base-200 rounded-lg ${p.actif ? "" : "opacity-50"}">
        <div class="flex items-center gap-2">
          <span class="badge badge-xs badge-ghost">${escHtml(p.type)}</span>
          <span class="text-sm font-medium">${escHtml(p.nom)}</span>
        </div>
        <div class="flex gap-1">
          <button
            class="btn btn-xs btn-ghost"
            onclick="togglePlateforme(${p.id}, ${p.actif ? 0 : 1})"
            title="${p.actif ? "Désactiver" : "Activer"}"
          >${p.actif ? "⏸" : "▶️"}</button>
          <button
            class="btn btn-xs btn-ghost text-error"
            onclick="deletePlateforme(${p.id})"
            title="Supprimer"
          >🗑️</button>
        </div>
      </div>`
      )
      .join("");
  } catch (e) {
    showToast("Erreur chargement plateformes", "error");
  }
}

export async function addPlateforme() {
  const type = document.getElementById("new-plat-type")?.value;
  const nom = document.getElementById("new-plat-nom")?.value.trim();

  if (!nom) {
    showToast("Nom requis", "warning");
    return;
  }

  try {
    await apiFetch("/api/parametres/plateformes", {
      method: "POST",
      body: JSON.stringify({ type, nom }),
    });
    showToast("Plateforme ajoutée", "success");
    document.getElementById("new-plat-nom").value = "";
    await loadPlateformes();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
}

window.togglePlateforme = async (id, actif) => {
  try {
    await apiFetch(`/api/parametres/plateformes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ actif }),
    });
    await loadPlateformes();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
};

window.deletePlateforme = async (id) => {
  if (!confirm("Supprimer cette plateforme ?")) return;
  try {
    await apiFetch(`/api/parametres/plateformes/${id}`, { method: "DELETE" });
    showToast("Plateforme supprimée", "success");
    await loadPlateformes();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
};

// ── Charges fixes ─────────────────────────────────────────────────────────────

async function loadChargesFixes() {
  try {
    const data = await apiFetch("/api/parametres/charges-fixes");
    const tbody = document.getElementById("charges-fixes-tbody");
    if (!tbody) return;

    const perioMap = {
      mensuelle: "/ mois",
      trimestrielle: "/ trim.",
      semestrielle: "/ sem.",
      annuelle: "/ an",
    };

    const mensualiser = (montant, periodicite) => {
      const mapping = {
        mensuelle: 1,
        trimestrielle: 1 / 3,
        semestrielle: 1 / 6,
        annuelle: 1 / 12,
      };
      return montant * (mapping[periodicite] ?? 1);
    };

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-base-content/40 py-6">
            Aucune charge fixe
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = data
      .map(
        (c) => `
      <tr class="${c.actif ? "" : "opacity-50"}">
        <td class="font-medium">${escHtml(c.nom)}</td>
        <td class="font-mono text-right">${formatEur(c.montant)}</td>
        <td class="text-base-content/60 text-sm">
          ${perioMap[c.periodicite] || c.periodicite}
        </td>
        <td class="font-mono text-right text-sm">
          ${formatEur(mensualiser(c.montant, c.periodicite))}
        </td>
        <td class="text-center">
          <input
            type="checkbox"
            class="checkbox checkbox-sm checkbox-primary"
            ${c.actif ? "checked" : ""}
            onchange="toggleCharge(${c.id}, this.checked ? 1 : 0)"
          />
        </td>
        <td>
          <button
            class="btn btn-xs btn-ghost text-error"
            onclick="deleteCharge(${c.id})"
          >🗑️</button>
        </td>
      </tr>`
      )
      .join("");
  } catch (e) {
    showToast("Erreur chargement charges fixes", "error");
  }
}

export async function addCharge() {
  const nom = document.getElementById("new-charge-nom")?.value.trim();
  const montant = parseFloat(
    document.getElementById("new-charge-montant")?.value
  );
  const periodicite =
    document.getElementById("new-charge-periodicite")?.value || "mensuelle";

  if (!nom) {
    showToast("Nom requis", "warning");
    return;
  }
  if (isNaN(montant) || montant <= 0) {
    showToast("Montant invalide", "warning");
    return;
  }

  try {
    await apiFetch("/api/parametres/charges-fixes", {
      method: "POST",
      body: JSON.stringify({ nom, montant, periodicite }),
    });
    showToast("Charge ajoutée", "success");
    document.getElementById("new-charge-nom").value = "";
    document.getElementById("new-charge-montant").value = "";
    await loadChargesFixes();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
}

window.toggleCharge = async (id, actif) => {
  try {
    await apiFetch(`/api/parametres/charges-fixes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ actif }),
    });
    await loadChargesFixes();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
};

window.deleteCharge = async (id) => {
  if (!confirm("Supprimer cette charge ?")) return;
  try {
    await apiFetch(`/api/parametres/charges-fixes/${id}`, { method: "DELETE" });
    showToast("Charge supprimée", "success");
    await loadChargesFixes();
  } catch (e) {
    showToast(e.message || "Erreur", "error");
  }
};

// ── Exports & Backups ─────────────────────────────────────────────────────────

export function setupExports() {
  const btnStock = document.getElementById("btn-export-stock");
  if (btnStock) {
    btnStock.onclick = () => {
      window.open("/api/export/stock-csv", "_blank");
      showToast("Export CSV lancé", "info");
    };
  }

  const btnJson = document.getElementById("btn-export-json");
  if (btnJson) {
    btnJson.onclick = () => {
      window.open("/api/export/json-complet", "_blank");
      showToast("Export JSON lancé", "info");
    };
  }

  const btnBackup = document.getElementById("btn-backup-db");
  if (btnBackup) {
    btnBackup.onclick = async () => {
      const statusEl = document.getElementById("backup-status");
      btnBackup.disabled = true;
      btnBackup.innerHTML =
        '<span class="loading loading-spinner loading-xs"></span> Sauvegarde…';

      try {
        const info = await apiFetch("/api/export/backup", { method: "POST" });
        if (statusEl) {
          statusEl.className = "alert alert-success w-full mt-2 text-xs";
          statusEl.classList.remove("hidden");
          statusEl.innerHTML = `
            ✅ <strong>${info.backup_file}</strong>
            — ${formatBytes(info.size_bytes)}`;
        }
        showToast(`Backup créé : ${info.backup_file}`, "success");
        await loadBackupsList();
      } catch (e) {
        if (statusEl) {
          statusEl.className = "alert alert-error w-full mt-2 text-xs";
          statusEl.classList.remove("hidden");
          statusEl.textContent = `❌ ${e.message}`;
        }
        showToast("Erreur backup", "error");
      } finally {
        btnBackup.disabled = false;
        btnBackup.innerHTML = "🚀 Créer backup";
        setTimeout(() => statusEl?.classList.add("hidden"), 10000);
      }
    };
  }
}

export async function loadBackupsList() {
  const container = document.getElementById("backups-list");
  if (!container) return;

  try {
    // L'API n'expose pas de liste de backups — on lit le résultat du dernier backup
    // ou on affiche un message statique
    container.innerHTML = `
      <div class="col-span-3 text-center text-base-content/40 py-8 text-sm">
        Les backups sont stockés dans <code>data/backups/</code>
        et conservés sur les 10 derniers fichiers.
      </div>`;
  } catch {
    // Silencieux
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _setVal(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tagName === "TEXTAREA") {
    el.value = value ?? "";
  } else {
    el.value = value ?? "";
  }
}

function _getVal(id) {
  return document.getElementById(id)?.value ?? "";
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}