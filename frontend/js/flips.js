import { requireAuth, logout } from "./auth.js";
import {
  apiFetch,
  showToast,
  formatEur,
  formatDate,
  tableLoading,
  tableEmpty,
  confirmAction,
} from "./app.js";

requireAuth();

// ── Sidebar user info ────────────────────────────────────────────────────────
const u = JSON.parse(localStorage.getItem("currentUser") || "{}");
const el = (id) => document.getElementById(id);
if (u.username) {
  el("sidebarUsername").textContent = u.username;
  el("sidebarRole").textContent = u.role;
  el("sidebarInitiale").textContent = u.username[0].toUpperCase();
}

// Highlight page active
document.querySelectorAll("[data-page]").forEach((a) => {
  if (a.dataset.page === "flips") a.classList.add("btn-active");
});

window.logout = logout;

// ── State ────────────────────────────────────────────────────────────────────
const STATE = {
  skip: 0,
  limit: 50,
  total: 0,
  editId: null,
  detailId: null,
  achats: [],
  stockItems: [],
};
window.STATE = STATE;

// ── Statuts ──────────────────────────────────────────────────────────────────
const STATUT_MAP = {
  a_diagnostiquer: { label: "À diagnostiquer", cls: "badge-warning" },
  en_attente_pieces: { label: "En attente pièces", cls: "badge-info" },
  en_reparation: { label: "En réparation", cls: "badge-primary" },
  pret_a_vendre: { label: "Prêt à vendre", cls: "badge-success" },
  en_vente: { label: "En vente", cls: "badge-accent" },
  vendu: { label: "Vendu", cls: "badge-neutral" },
  annule: { label: "Annulé", cls: "badge-error" },
};

function statutBadgeHtml(statut) {
  const s = STATUT_MAP[statut] || { label: statut, cls: "badge-ghost" };
  return `<span class="badge ${s.cls} badge-sm">${escHtml(s.label)}</span>`;
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([loadAchats(), loadStockItems()]);
  await loadFlips();
}

async function loadAchats() {
  try {
    const data = await apiFetch("/api/achats?limit=500");
    STATE.achats = data.items || [];
    const sel = el("fAchatId");
    STATE.achats.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `#${a.id} — ${a.nom} (${formatEur(a.prix_achat)})`;
      sel.appendChild(opt);
    });
  } catch {
    // non bloquant
  }
}

async function loadStockItems() {
  try {
    const data = await apiFetch("/api/stock?limit=500");
    STATE.stockItems = (data.items || []).filter((s) => s.quantite > 0);
    const sel = el("pieceStockSelect");
    sel.innerHTML = '<option value="">— Choisir —</option>';
    STATE.stockItems.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.nom} (dispo: ${s.quantite} ${s.unite || ""})`;
      sel.appendChild(opt);
    });
  } catch {
    // non bloquant
  }
}

// ── Chargement liste ─────────────────────────────────────────────────────────
async function loadFlips() {
  const tbody = el("flipsTableBody");
  tableLoading(tbody, 9);

  const params = new URLSearchParams({
    skip: STATE.skip,
    limit: STATE.limit,
  });
  const search = el("searchInput").value.trim();
  const statut = el("statutFilter").value;
  if (search) params.set("search", search);
  if (statut) params.set("statut", statut);

  try {
    const data = await apiFetch(`/api/flips?${params}`);
    STATE.total = data.total;
    renderTable(data.items || []);
    renderPagination();
  } catch {
    tableEmpty(tbody, 9, "Erreur de chargement");
  }
}
window.loadFlips = loadFlips;

function renderTable(items) {
  const tbody = el("flipsTableBody");
  if (!items.length) {
    tableEmpty(tbody, 9, "Aucun flip");
    return;
  }
  tbody.innerHTML = items
    .map((f) => {
      const prixVente = f.prix_vente || 0;
      const marge = prixVente - (f.prix_achat || 0) - (f.cout_pieces || 0);
      const margeHtml =
        f.statut === "vendu"
          ? `<span class="${marge >= 0 ? "text-success" : "text-error"} font-semibold">${formatEur(marge)}</span>`
          : `<span class="text-base-content/40">—</span>`;
      return `
      <tr class="hover cursor-pointer" onclick="openDetail(${f.id})">
        <td class="font-mono text-xs text-base-content/50">#${f.id}</td>
        <td>
          <div class="font-medium">${escHtml(f.nom)}</div>
          <div class="text-xs text-base-content/50">${escHtml(f.marque || "")} ${escHtml(f.modele || "")}</div>
        </td>
        <td class="font-mono text-xs">${escHtml(f.imei || "—")}</td>
        <td>${statutBadgeHtml(f.statut)}</td>
        <td class="text-right">${formatEur(f.prix_achat)}</td>
        <td class="text-right">${formatEur(f.cout_pieces)}</td>
        <td class="text-right">${f.statut === "vendu" ? formatEur(prixVente) : "—"}</td>
        <td class="text-right">${margeHtml}</td>
        <td onclick="event.stopPropagation()">
          <div class="flex gap-1 justify-end">
            <button class="btn btn-ghost btn-xs" onclick="openFlipModal(${f.id})">✏️</button>
            <button class="btn btn-ghost btn-xs text-error" onclick="deleteFlip(${f.id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function renderPagination() {
  const pages = Math.ceil(STATE.total / STATE.limit);
  const current = Math.floor(STATE.skip / STATE.limit) + 1;
  el("pagination").innerHTML = `
    <span>${STATE.total} flip(s) — page ${current}/${pages || 1}</span>
    <div class="flex gap-2">
      <button class="btn btn-xs btn-ghost" ${STATE.skip === 0 ? "disabled" : ""}
        onclick="STATE.skip=Math.max(0,STATE.skip-STATE.limit);loadFlips()">◀ Préc.</button>
      <button class="btn btn-xs btn-ghost" ${STATE.skip + STATE.limit >= STATE.total ? "disabled" : ""}
        onclick="STATE.skip+=STATE.limit;loadFlips()">Suiv. ▶</button>
    </div>`;
}

// ── Création / Édition ───────────────────────────────────────────────────────
window.openFlipModal = async function (id = null) {
  STATE.editId = id;
  el("flipForm").reset();
  el("flipModalTitle").textContent = id ? "Modifier le flip" : "Nouveau flip";
  el("prixAchatField").style.display = "";

  if (id) {
    try {
      const flip = await apiFetch(`/api/flips/${id}`);
      el("fNom").value = flip.nom || "";
      el("fMarque").value = flip.marque || "";
      el("fModele").value = flip.modele || "";
      el("fImei").value = flip.imei || "";
      el("fEtatInitial").value = flip.etat_initial || "";
      el("fStatut").value = flip.statut || "a_diagnostiquer";
      el("fNotes").value = flip.notes || "";
      el("fPrixAchat").value = flip.prix_achat || "";
      if (flip.achat_id) {
        el("fAchatId").value = flip.achat_id;
        el("prixAchatField").style.display = "none";
      }
    } catch {
      showToast("Impossible de charger le flip", "error");
      return;
    }
  }
  el("flipModal").showModal();
};

window.submitFlip = async function (e) {
  e.preventDefault();
  const achatId = el("fAchatId").value;
  const body = {
    nom: el("fNom").value.trim(),
    marque: el("fMarque").value.trim() || null,
    modele: el("fModele").value.trim() || null,
    imei: el("fImei").value.trim() || null,
    etat_initial: el("fEtatInitial").value.trim() || null,
    statut: el("fStatut").value,
    notes: el("fNotes").value.trim() || null,
  };
  if (achatId) {
    body.achat_id = parseInt(achatId);
  } else {
    const p = parseFloat(el("fPrixAchat").value);
    if (!isNaN(p)) body.prix_achat = p;
  }

  try {
    if (STATE.editId) {
      await apiFetch(`/api/flips/${STATE.editId}`, { method: "PUT", body: JSON.stringify(body) });
      showToast("Flip mis à jour", "success");
    } else {
      await apiFetch("/api/flips", { method: "POST", body: JSON.stringify(body) });
      showToast("Flip créé", "success");
    }
    el("flipModal").close();
    STATE.skip = 0;
    loadFlips();
  } catch (err) {
    showToast(err.message || "Erreur", "error");
  }
};

// ── Suppression ──────────────────────────────────────────────────────────────
window.deleteFlip = async function (id) {
  if (!confirmAction("Supprimer ce flip ? Cette action est irréversible.")) return;
  try {
    await apiFetch(`/api/flips/${id}`, { method: "DELETE" });
    showToast("Flip supprimé", "success");
    loadFlips();
  } catch (err) {
    showToast(err.message || "Erreur suppression", "error");
  }
};

// ── Détail ───────────────────────────────────────────────────────────────────
window.openDetail = async function (id) {
  STATE.detailId = id;
  el("detailModal").showModal();
  await refreshDetail(id);
};

async function refreshDetail(id) {
  try {
    const flip = await apiFetch(`/api/flips/${id}`);
    const prixVente = flip.prix_vente || 0;
    const marge = prixVente - (flip.prix_achat || 0) - (flip.cout_pieces || 0);

    el("detailNom").textContent = flip.nom;
    el("detailSub").textContent =
      [flip.marque, flip.modele, flip.imei ? `IMEI: ${flip.imei}` : ""]
        .filter(Boolean)
        .join(" · ");
    el("detailStatutBadge").innerHTML = statutBadgeHtml(flip.statut);
    el("detailStatutSelect").value = flip.statut;
    el("detailPrixAchat").textContent = formatEur(flip.prix_achat);
    el("detailCoutPieces").textContent = formatEur(flip.cout_pieces);
    el("detailPrixVente").textContent =
      flip.statut === "vendu" ? formatEur(prixVente) : "—";
    el("detailMarge").innerHTML =
      flip.statut === "vendu"
        ? `<span class="${marge >= 0 ? "text-success" : "text-error"}">${formatEur(marge)}</span>`
        : "—";
    el("detailNotes").textContent = flip.notes || "—";

    // Pièces
    renderPieces(flip.pieces || [], flip.statut);

    // Photos
    renderPhotos(flip.fichiers || [], id);
  } catch {
    showToast("Erreur chargement détail", "error");
  }
}

function renderPieces(pieces, statut) {
  const tbody = el("piecesTableBody");
  if (!pieces.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="text-center text-base-content/40 py-3">Aucune pièce</td></tr>';
    return;
  }
  tbody.innerHTML = pieces
    .map(
      (p) => `
    <tr>
      <td>${escHtml(p.stock_nom || "—")}</td>
      <td class="text-right">${p.quantite} ${escHtml(p.unite || "")}</td>
      <td class="text-right">${formatEur(p.prix_unitaire)}</td>
      <td class="text-right">${formatEur(p.quantite * p.prix_unitaire)}</td>
      <td>
        ${
          statut !== "vendu"
            ? `<button class="btn btn-ghost btn-xs text-error"
                onclick="removePiece(${p.id})">✕</button>`
            : ""
        }
      </td>
    </tr>`
    )
    .join("");
}

function renderPhotos(fichiers, flipId) {
  const grid = el("photosGrid");
  if (!fichiers.length) {
    grid.innerHTML =
      '<p class="text-xs text-base-content/40">Aucune photo</p>';
    return;
  }
  grid.innerHTML = fichiers
    .map(
      (f) => `
    <div class="relative group w-20 h-20">
      <img src="/uploads/${f.chemin}" alt="${escHtml(f.nom_original)}"
           class="w-20 h-20 object-cover rounded-box cursor-pointer"
           onclick="window.open('/uploads/${f.chemin}','_blank')" />
      <button class="btn btn-error btn-xs absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition"
        onclick="deletePhoto(${f.id}, ${flipId})">✕</button>
    </div>`
    )
    .join("");
}

// ── Statut rapide ─────────────────────────────────────────────────────────────
window.changeStatut = async function () {
  const statut = el("detailStatutSelect").value;
  try {
    await apiFetch(`/api/flips/${STATE.detailId}/statut`, {
      method: "PATCH",
      body: JSON.stringify({ statut }),
    });
    showToast("Statut mis à jour", "success");
    await refreshDetail(STATE.detailId);
    loadFlips();
  } catch (err) {
    showToast(err.message || "Erreur", "error");
  }
};

// ── Pièces ────────────────────────────────────────────────────────────────────
window.addPiece = async function () {
  const stockId = parseInt(el("pieceStockSelect").value);
  const qte = parseFloat(el("pieceQte").value);
  const prix = parseFloat(el("piecePrix").value);

  if (!stockId) return showToast("Choisir un article stock", "warning");
  if (!qte || qte <= 0) return showToast("Quantité invalide", "warning");

  const body = { stock_id: stockId, quantite: qte };
  if (!isNaN(prix) && prix >= 0) body.prix_unitaire = prix;

  try {
    await apiFetch(`/api/flips/${STATE.detailId}/pieces`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    showToast("Pièce ajoutée", "success");
    el("pieceQte").value = "1";
    el("piecePrix").value = "";
    el("pieceStockSelect").value = "";
    await refreshDetail(STATE.detailId);
    await loadStockItems(); // refresh dispo
    loadFlips();
  } catch (err) {
    showToast(err.message || "Stock insuffisant", "error");
  }
};

window.removePiece = async function (pieceId) {
  if (!confirmAction("Retirer cette pièce ? Le stock sera réintégré.")) return;
  try {
    await apiFetch(`/api/flips/${STATE.detailId}/pieces/${pieceId}`, {
      method: "DELETE",
    });
    showToast("Pièce retirée, stock réintégré", "success");
    await refreshDetail(STATE.detailId);
    await loadStockItems();
    loadFlips();
  } catch (err) {
    showToast(err.message || "Erreur", "error");
  }
};

// ── Photos ────────────────────────────────────────────────────────────────────
window.uploadPhoto = async function () {
  const input = el("photoInput");
  if (!input.files.length) return showToast("Choisir un fichier", "warning");

  const fd = new FormData();
  fd.append("file", input.files[0]);

  try {
    await apiFetch(`/api/flips/${STATE.detailId}/fichiers`, {
      method: "POST",
      body: fd,
    });
    showToast("Photo envoyée", "success");
    input.value = "";
    await refreshDetail(STATE.detailId);
  } catch (err) {
    showToast(err.message || "Erreur upload", "error");
  }
};

window.deletePhoto = async function (fichierId, flipId) {
  if (!confirmAction("Supprimer cette photo ?")) return;
  try {
    await apiFetch(`/api/flips/${flipId}/fichiers/${fichierId}`, {
      method: "DELETE",
    });
    showToast("Photo supprimée", "success");
    await refreshDetail(flipId);
  } catch (err) {
    showToast(err.message || "Erreur", "error");
  }
};

// ── Filtres / recherche ───────────────────────────────────────────────────────
let searchTimer;
window.debouncedSearch = function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    STATE.skip = 0;
    loadFlips();
  }, 350);
};

window.resetFilters = function () {
  el("searchInput").value = "";
  el("statutFilter").value = "";
  STATE.skip = 0;
  loadFlips();
};

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Expose l'achat lié → masque champ prix manuel
el("fAchatId").addEventListener("change", function () {
  el("prixAchatField").style.display = this.value ? "none" : "";
  if (this.value) el("fPrixAchat").value = "";
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
init();