import { requireAuth, logout } from "./auth.js";
import {
  apiFetch,
  showToast,
  formatEur,
  formatDate,
  statutBadge,
  tableLoading,
  tableEmpty,
  confirmAction,
  escHtml
} from "./app.js";

requireAuth();

// ─────────────────────────────────────────────
// ÉTAT
// ─────────────────────────────────────────────
const STATE = {
  achats: [],
  total: 0,
  offset: 0,
  limit: 50,
  editId: null,
  fournisseurs: [],
  plateformes: [],
};

const TYPE_LABELS = {
  piece: "Pièce",
  appareil_flip: "Flip",
  appareil_revente: "Revente",
  autre: "Autre",
};

const TYPE_BADGE = {
  piece: "badge-info",
  appareil_flip: "badge-warning",
  appareil_revente: "badge-accent",
  autre: "badge-ghost",
};

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
async function init() {
  await Promise.all([loadFournisseurs(), loadPlateformes()]);
  await loadAchats();
}

function renderSidebar() {
  const nav = document.getElementById("sidebar-nav");
  if (!nav) return;
  const pages = [
    { href: "/index.html", label: "🏠 Dashboard" },
    { href: "/achats.html", label: "🛒 Achats" },
    { href: "/ventes.html", label: "💰 Ventes" },
    { href: "/flips.html", label: "🔄 Flips" },
    { href: "/reparations.html", label: "🔧 Réparations" },
    { href: "/stock.html", label: "📦 Stock" },
    { href: "/clients.html", label: "👤 Clients" },
    { href: "/fournisseurs.html", label: "🏭 Fournisseurs" },
    { href: "/materiel.html", label: "🛠️ Matériel" },
    { href: "/budget.html", label: "📊 Budget" },
    { href: "/parametres.html", label: "⚙️ Paramètres" },
  ];
  nav.innerHTML = pages
    .map((p) => {
      const active = window.location.pathname === p.href;
      return `<a href="${p.href}"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm
               ${active ? "bg-primary text-primary-content font-semibold" : "hover:bg-base-200"}">
        ${p.label}
      </a>`;
    })
    .join("");
}

function renderUserInfo() {
  const user = JSON.parse(localStorage.getItem("current_user") || "{}");
  const el = (id) => document.getElementById(id);
  if (el("user-name")) el("user-name").textContent = user.username || "";
  if (el("user-role")) el("user-role").textContent = user.role || "";
  if (el("user-initial"))
    el("user-initial").textContent = (user.username || "?")[0].toUpperCase();
}

// ─────────────────────────────────────────────
// CHARGEMENT DONNÉES
// ─────────────────────────────────────────────
async function loadFournisseurs() {
  try {
    const data = await apiFetch("/api/fournisseurs");
    STATE.fournisseurs = data.items || data;
    const selects = ["select-fournisseur"];
    selects.forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      STATE.fournisseurs.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.nom;
        sel.appendChild(opt);
      });
    });
  } catch {
    // Silencieux — fournisseurs optionnels
  }
}

async function loadPlateformes() {
  try {
    const data = await apiFetch("/api/parametres/plateformes?type=achat");
    STATE.plateformes = data;
    ["select-plateforme", "select-plateforme-lot"].forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      data.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.nom;
        sel.appendChild(opt);
      });
    });
  } catch {
    // Silencieux
  }
}

window.loadAchats = async function () {
  const tbody = document.getElementById("achats-tbody");
  tableLoading(tbody, 8);

  const search = document.getElementById("search-input")?.value || "";
  const type = document.getElementById("filter-type")?.value || "";

  const params = new URLSearchParams({
    limit: STATE.limit,
    offset: STATE.offset,
  });
  if (search) params.set("search", search);
  if (type) params.set("type_achat", type);

  try {
    const data = await apiFetch(`/api/achats?${params}`);
    STATE.achats = data.items;
    STATE.total = data.total;
    renderTable();
    renderPagination();
  } catch (e) {
    showToast("Erreur lors du chargement des achats", "error");
    tableEmpty(tbody, 8, "Erreur de chargement");
  }
};

// ─────────────────────────────────────────────
// RENDU TABLE
// ─────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById("achats-tbody");
  if (!STATE.achats.length) {
    tableEmpty(tbody, 8, "Aucun achat enregistré");
    return;
  }

  tbody.innerHTML = STATE.achats
    .map(
      (a) => `
    <tr class="hover cursor-pointer" onclick="openDetail(${a.id})">
      <td class="whitespace-nowrap">${formatDate(a.date)}</td>
      <td>
        <div class="font-medium">${escHtml(a.nom)}</div>
        ${a.notes ? `<div class="text-xs text-base-content/50 truncate max-w-[200px]">${escHtml(a.notes)}</div>` : ""}
      </td>
      <td>
        <span class="badge badge-sm ${TYPE_BADGE[a.type_achat] || "badge-ghost"}">
          ${TYPE_LABELS[a.type_achat] || a.type_achat}
        </span>
      </td>
     <td>${a.quantite}</td>
<td class="font-mono">${formatEur(a.prix_achat)}</td>
      <td class="text-sm">${escHtml(a.fournisseur_nom || "—")}</td>
      <td>
        ${
          a.type_achat === "piece"
            ? a.ajout_stock_auto
              ? '<span class="badge badge-success badge-xs">Auto</span>'
              : '<span class="badge badge-ghost badge-xs">Manuel</span>'
            : "—"
        }
      </td>
      <td class="text-right" onclick="event.stopPropagation()">
        <div class="flex gap-1 justify-end">
          ${
            a.type_achat === "piece"
              ? `<button class="btn btn-xs btn-ghost" title="Intégrer au stock"
                onclick="integrerStock(${a.id})">📦</button>`
              : ""
          }
          <button class="btn btn-xs btn-ghost" onclick="openEditModal(${a.id})">✏️</button>
          <button class="btn btn-xs btn-ghost text-error" onclick="deleteAchat(${a.id})">🗑️</button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function renderPagination() {
  const info = document.getElementById("pagination-info");
  const prev = document.getElementById("btn-prev");
  const next = document.getElementById("btn-next");

  const from = STATE.total ? STATE.offset + 1 : 0;
  const to = Math.min(STATE.offset + STATE.limit, STATE.total);
  if (info) info.textContent = `${from}–${to} sur ${STATE.total}`;
  if (prev) prev.disabled = STATE.offset === 0;
  if (next) next.disabled = STATE.offset + STATE.limit >= STATE.total;
}

window.changePage = function (dir) {
  STATE.offset = Math.max(0, STATE.offset + dir * STATE.limit);
  loadAchats();
};

// ─────────────────────────────────────────────
// DÉTAIL
// ─────────────────────────────────────────────
window.openDetail = async function (id) {
  const modal = document.getElementById("modal-detail");
  const content = document.getElementById("detail-content");
  const title = document.getElementById("detail-title");
  content.innerHTML = `<div class="flex justify-center py-8">
    <span class="loading loading-spinner loading-lg"></span></div>`;
  modal.showModal();

  try {
    const a = await apiFetch(`/api/achats/${id}`);
    title.textContent = a.nom;
    content.innerHTML = `
      <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
        <div><span class="font-medium">Date :</span> ${formatDate(a.date)}</div>
        <div><span class="font-medium">Type :</span>
          <span class="badge badge-sm ${TYPE_BADGE[a.type_achat] || ""}">${TYPE_LABELS[a.type_achat] || a.type_achat}</span>
        </div>
        <div><span class="font-medium">Prix :</span> ${formatEur(a.prix_achat)}</div>
        <div><span class="font-medium">Quantité :</span> ${a.quantite}</div>
        <div><span class="font-medium">Fournisseur :</span> ${escHtml(a.fournisseur_nom || "—")}</div>
        <div><span class="font-medium">Plateforme :</span> ${escHtml(a.plateforme || "—")}</div>
        ${a.notes ? `<div class="col-span-2"><span class="font-medium">Notes :</span> ${escHtml(a.notes)}</div>` : ""}
      </div>

      ${
        a.fichiers?.length
          ? `<div class="mb-4">
          <p class="font-medium text-sm mb-2">Fichiers joints (${a.fichiers.length})</p>
          <div class="flex flex-wrap gap-2">
            ${a.fichiers
              .map(
                (f) =>
                  `<a href="/uploads/${f.chemin.split("data/uploads/")[1]}"
                target="_blank"
                class="btn btn-xs btn-outline gap-1">
                📎 ${escHtml(f.nom_original)}
              </a>`
              )
              .join("")}
          </div>
        </div>`
          : ""
      }

      <!-- Upload -->
      <div class="border-t pt-3">
        <p class="font-medium text-sm mb-2">Ajouter un fichier</p>
        <div class="flex gap-2">
          <input type="file" id="upload-file-input"
            class="file-input file-input-bordered file-input-sm flex-1"
            accept="image/*,.pdf" />
          <button class="btn btn-sm btn-primary"
            onclick="uploadFichier(${a.id})">Envoyer</button>
        </div>
      </div>
    `;
  } catch {
    content.innerHTML = `<p class="text-error">Impossible de charger le détail.</p>`;
  }
};

// ─────────────────────────────────────────────
// MODAL ACHAT — OUVERTURE / FERMETURE
// ─────────────────────────────────────────────
window.openAchatModal = function (achat = null) {
  STATE.editId = achat?.id || null;
  const modal = document.getElementById("modal-achat");
  const form = document.getElementById("form-achat");
  const title = document.getElementById("modal-achat-title");

  form.reset();
  // Date par défaut = aujourd'hui
  form.date.value = new Date().toISOString().slice(0, 10);

  if (achat) {
    title.textContent = "Modifier l'achat";
    form.date.value = achat.date?.slice(0, 10) || "";
    form.nom.value = achat.nom || "";
    form.type_achat.value = achat.type_achat || "";
    form.prix.value = achat.prix_achat ?? "";
    form.qte.value = achat.quantite ?? 1;
    form.notes.value = achat.notes || "";
    if (form.fournisseur_id) form.fournisseur_id.value = achat.fournisseur_id || "";
    if (form.plateforme_id) form.plateforme_id.value = achat.plateforme || "";
    form.ajout_stock_auto.checked = !!achat.ajout_stock_auto;
    onTypeChange(form.type_achat);
  } else {
    title.textContent = "Nouvel achat";
  }

  modal.showModal();
};

window.closeAchatModal = function () {
  document.getElementById("modal-achat").close();
};

window.onTypeChange = function (sel) {
  const field = document.getElementById("field-stock-auto");
  if (!field) return;
  field.classList.toggle("hidden", sel.value !== "piece");
};

// ─────────────────────────────────────────────
// SOUMISSION ACHAT
// ─────────────────────────────────────────────
window.submitAchat = async function (e) {
  e.preventDefault();
  const form = e.target;

  const payload = {
    date: form.date.value,
    nom: form.nom.value,
    type_achat: form.type_achat.value,
    prix_achat: parseFloat(form.prix.value),   // ✅ était prix
    quantite: parseInt(form.qte.value) || 1,          // ✅ était qte (name HTML conservé)
    fournisseur_id: form.fournisseur_id?.value
      ? parseInt(form.fournisseur_id.value)
      : null,
    plateforme: form.plateforme_id?.value             // ✅ string du nom, pas d'ID
      ? form.plateforme_id.options[form.plateforme_id.selectedIndex].text
      : null,
    categorie: null,                                  // ✅ pas de categorie dans ce form
    ajout_stock_auto: form.ajout_stock_auto?.checked || false,
    notes: form.notes.value || null,
  };

  try {
    if (STATE.editId) {
      await apiFetch(`/api/achats/${STATE.editId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      showToast("Achat modifié", "success");
    } else {
      await apiFetch("/api/achats", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast(
        payload.ajout_stock_auto && payload.type_achat === "piece"
          ? "Achat enregistré et stock mis à jour"
          : "Achat enregistré",
        "success"
      );
    }
    closeAchatModal();
    await loadAchats();
  } catch (err) {
    showToast(err.message || "Erreur lors de l'enregistrement", "error");
  }
};

// ─────────────────────────────────────────────
// MODIFIER
// ─────────────────────────────────────────────
window.openEditModal = async function (id) {
  try {
    const achat = await apiFetch(`/api/achats/${id}`);
    openAchatModal(achat);
  } catch {
    showToast("Impossible de charger l'achat", "error");
  }
};

// ─────────────────────────────────────────────
// SUPPRIMER
// ─────────────────────────────────────────────
window.deleteAchat = async function (id) {
  if (!confirmAction("Supprimer cet achat ? Cette action est irréversible."))
    return;
  try {
    await apiFetch(`/api/achats/${id}`, { method: "DELETE" });
    showToast("Achat supprimé", "success");
    await loadAchats();
  } catch (err) {
    showToast(err.message || "Erreur lors de la suppression", "error");
  }
};

// ─────────────────────────────────────────────
// INTÉGRER AU STOCK
// ─────────────────────────────────────────────
window.integrerStock = async function (id) {
  if (!confirmAction("Intégrer cet achat dans le stock ?")) return;
  try {
    const result = await apiFetch(`/api/achats/${id}/integrer-stock`, {
      method: "POST",
    });
    const msg =
      result.action === "created"
        ? `Article créé dans le stock (+${result.quantite_ajoutee})`
        : `Stock incrémenté (+${result.quantite_ajoutee})`;
    showToast(msg, "success");
    await loadAchats();
  } catch (err) {
    showToast(err.message || "Erreur intégration stock", "error");
  }
};

// ─────────────────────────────────────────────
// UPLOAD FICHIER
// ─────────────────────────────────────────────
window.uploadFichier = async function (achatId) {
  const input = document.getElementById("upload-file-input");
  if (!input?.files?.length) {
    showToast("Sélectionne un fichier d'abord", "warning");
    return;
  }
  const formData = new FormData();
  formData.append("file", input.files[0]);

  try {
    await apiFetch(`/api/achats/${achatId}/fichiers?categorie=document`, {
      method: "POST",
      body: formData,
      // Ne pas mettre Content-Type : laissé au navigateur pour multipart
      headers: {},
    });
    showToast("Fichier envoyé", "success");
    await openDetail(achatId);
  } catch (err) {
    showToast(err.message || "Erreur upload", "error");
  }
};

// ─────────────────────────────────────────────
// LOT
// ─────────────────────────────────────────────
window.openLotModal = function () {
  const form = document.getElementById("form-lot");
  form.reset();
  form.date.value = new Date().toISOString().slice(0, 10);
  document.getElementById("modal-lot").showModal();
};

window.submitLot = async function (e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    date: form.date.value,
    nom_lot: form.nom_lot.value,
    prix_total: parseFloat(form.prix_total.value),
    plateforme_id: form.plateforme_id?.value
      ? parseInt(form.plateforme_id.value)
      : null,
    notes: form.notes.value || null,
  };

  try {
    const result = await apiFetch("/api/achats/lots", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast(`Lot "${payload.nom_lot}" créé (id: ${result.id})`, "success");
    document.getElementById("modal-lot").close();
  } catch (err) {
    showToast(err.message || "Erreur création lot", "error");
  }
};

// ─────────────────────────────────────────────
// RECHERCHE DEBOUNCÉE
// ─────────────────────────────────────────────
let searchTimer;
window.debouncedSearch = function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    STATE.offset = 0;
    loadAchats();
  }, 350);
};

window.resetFilters = function () {
  document.getElementById("search-input").value = "";
  document.getElementById("filter-type").value = "";
  STATE.offset = 0;
  loadAchats();
};

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────

window.logout = logout;

// ─────────────────────────────────────────────
// LANCEMENT
// ─────────────────────────────────────────────
init();