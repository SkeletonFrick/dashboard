import { requireAuth, logout } from "./auth.js";
import {
  apiFetch,
  showToast,
  formatDate,
  formatEur,
  statutBadge,
  tableLoading,
  tableEmpty,
  confirmAction,
  escHtml,
} from "./app.js";

import {
  checkboxHtml,
  printButtonHtml,
  selectAllHtml,
  clearSelection,
} from "./labels.js";

requireAuth();
window.logout = logout;

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUT_MAP = {
  recu: "badge-info",
  diagnostic_en_cours: "badge-warning",
  en_attente_accord: "badge-warning",
  en_attente_pieces: "badge-warning",
  en_cours_reparation: "badge-primary",
  pret: "badge-success",
  livre: "badge-ghost",
  annule: "badge-error",
};

const STATUT_LABELS = {
  recu: "Reçu",
  diagnostic_en_cours: "Diagnostic",
  en_attente_accord: "Attente accord",
  en_attente_pieces: "Attente pièces",
  en_cours_reparation: "En cours",
  pret: "Prêt",
  livre: "Livré",
  annule: "Annulé",
};

const STATE = {
  page: 0,
  limit: 50,
  search: "",
  statut: "",
  total: 0,
  editId: null,
  detailId: null,
  clients: [],
  stockItems: [],
};

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  setupSidebar();

  // Pré-remplir la date du jour
  const dateInput = document.querySelector('[name="date_reception"]');
  if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];

  // Vérifier si on arrive depuis un lien avec ?id=
  const urlId = new URLSearchParams(window.location.search).get("id");

  await Promise.all([loadClients(), loadStockItems()]);
  await loadReparations();

  if (urlId) openDetail(parseInt(urlId, 10));
}

function setupSidebar() {
  const user = JSON.parse(localStorage.getItem("current_user") || "{}");
  const el = document.getElementById("sidebar-username");
  const ini = document.getElementById("sidebar-initial");
  if (el) el.textContent = user.username || "";
  if (ini) ini.textContent = (user.username || "?")[0].toUpperCase();
}

// ── Données annexes ───────────────────────────────────────────────────────────

async function loadClients() {
  const data = await apiFetch("/api/clients?limit=500");
  if (data) STATE.clients = data.items || [];
}

async function loadStockItems() {
  const data = await apiFetch("/api/stock?limit=500&actif=1");
  if (data) STATE.stockItems = (data.items || []).filter((s) => s.quantite > 0);
}

// ── Chargement réparations ────────────────────────────────────────────────────

async function loadReparations() {
  const tbody = document.getElementById("reparations-tbody");
  tableLoading(tbody, 7);

  const params = new URLSearchParams({
    skip: STATE.page * STATE.limit,
    limit: STATE.limit,
    search: STATE.search,
    statut: STATE.statut,
  });

  const data = await apiFetch(`/api/reparations?${params}`);
  if (!data) return;

  STATE.total = data.total;
  renderTable(data.items);
  renderPagination();
}

// frontend/js/reparations.js
// Remplacer uniquement la fonction renderTable()

function renderTable(items) {
  const tbody = document.getElementById("reparations-tbody");
  if (!items.length) {
    tableEmpty(tbody, 7, "Aucune réparation trouvée");
    return;
  }

  tbody.innerHTML = items
    .map(
      (r) => `
    <tr class="hover cursor-pointer" onclick="openDetail(${r.id})">
      <td class="font-mono text-xs text-base-content/50">#${r.id}</td>
      <td>${formatDate(r.date_reception)}</td>
      <td>${escHtml(r.client_nom || r.telephone || "—")}</td>
      <td>
        <div class="font-medium">${escHtml(r.appareil)}</div>
        <div class="text-xs text-base-content/50">
          ${escHtml([r.marque, r.modele].filter(Boolean).join(" ") || "")}
        </div>
      </td>
      <td>${statutBadge(r.statut, STATUT_MAP, STATUT_LABELS)}</td>
      <td class="text-right font-medium">
        ${r.prix_facture != null ? formatEur(r.prix_facture) : "—"}
      </td>
      <td onclick="event.stopPropagation()">
        <div class="flex gap-1">
          <button
            class="btn btn-xs btn-ghost"
            onclick="openRepModal(${r.id})"
            title="Modifier"
          >✏️</button>
          <button
            class="btn btn-xs btn-ghost text-error"
            onclick="deleteRep(${r.id})"
            title="Supprimer"
          >🗑️</button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function renderPagination() {
  const el = document.getElementById("pagination");
  const start = STATE.page * STATE.limit + 1;
  const end = Math.min((STATE.page + 1) * STATE.limit, STATE.total);
  const totalPages = Math.ceil(STATE.total / STATE.limit);

  el.innerHTML = `
    <span>${STATE.total > 0 ? `${start}–${end} sur ${STATE.total}` : "Aucun résultat"}</span>
    <div class="flex gap-2">
      <button class="btn btn-sm btn-ghost" ${STATE.page === 0 ? "disabled" : ""}
        onclick="changePage(-1)">← Préc.</button>
      <button class="btn btn-sm btn-ghost"
        ${STATE.page >= totalPages - 1 ? "disabled" : ""}
        onclick="changePage(1)">Suiv. →</button>
    </div>
  `;
}

window.changePage = (dir) => {
  STATE.page = Math.max(0, STATE.page + dir);
  loadReparations();
};

// ── Filtres ───────────────────────────────────────────────────────────────────

let _searchTimer = null;
window.debouncedSearch = () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    STATE.search = document.getElementById("search-input").value;
    STATE.page = 0;
    loadReparations();
  }, 350);
};

window.applyFilters = () => {
  STATE.statut = document.getElementById("filter-statut").value;
  STATE.page = 0;
  loadReparations();
};

window.resetFilters = () => {
  STATE.search = "";
  STATE.statut = "";
  STATE.page = 0;
  document.getElementById("search-input").value = "";
  document.getElementById("filter-statut").value = "";
  loadReparations();
};

// ── Autocomplétion client ─────────────────────────────────────────────────────

let _clientTimer = null;
window.onClientSearch = (val) => {
  clearTimeout(_clientTimer);
  document.getElementById("client-id-hidden").value = "";

  if (!val.trim()) {
    hideSuggestions();
    return;
  }

  _clientTimer = setTimeout(() => {
    const q = val.toLowerCase();
    const matches = STATE.clients.filter(
      (c) =>
        c.nom.toLowerCase().includes(q) ||
        (c.telephone || "").includes(q)
    );
    showSuggestions(matches, val);
  }, 200);
};

function showSuggestions(matches, query) {
  const ul = document.getElementById("client-suggestions");
  ul.innerHTML = "";

  if (matches.length === 0) {
    const li = document.createElement("li");
    li.className =
      "px-3 py-2 text-sm text-base-content/50 italic cursor-pointer hover:bg-base-200";
    li.textContent = `Créer "${query}"`;
    li.onclick = () => createClientInline(query);
    ul.appendChild(li);
  } else {
    matches.slice(0, 8).forEach((c) => {
      const li = document.createElement("li");
      li.className =
        "px-3 py-2 text-sm cursor-pointer hover:bg-base-200";
      li.textContent = `${c.nom}${c.telephone ? ` — ${c.telephone}` : ""}`;
      li.onclick = () => selectClient(c);
      ul.appendChild(li);
    });
  }

  ul.classList.remove("hidden");
}

function hideSuggestions() {
  document.getElementById("client-suggestions").classList.add("hidden");
}

function selectClient(client) {
  document.getElementById("client-search").value = client.nom;
  document.getElementById("client-id-hidden").value = client.id;
  // Pré-remplir téléphone si vide
  const telInput = document.querySelector('[name="telephone"]');
  if (telInput && !telInput.value && client.telephone) {
    telInput.value = client.telephone;
  }
  hideSuggestions();
}

async function createClientInline(nom) {
  hideSuggestions();
  const result = await apiFetch("/api/clients", {
    method: "POST",
    body: JSON.stringify({ nom }),
  });
  if (result) {
    STATE.clients.push(result);
    selectClient(result);
    showToast(`Client "${nom}" créé`, "success");
  }
}

// Fermer suggestions en cliquant ailleurs
document.addEventListener("click", (e) => {
  if (!e.target.closest("#client-search")) hideSuggestions();
});

// ── Modal création/édition ────────────────────────────────────────────────────

window.openRepModal = async (id = null) => {
  STATE.editId = id;
  const modal = document.getElementById("rep-modal");
  const form = document.getElementById("rep-form");
  const title = document.getElementById("rep-modal-title");

  form.reset();
  document.getElementById("client-search").value = "";
  document.getElementById("client-id-hidden").value = "";

  // Date par défaut = aujourd'hui
  form.date_reception.value = new Date().toISOString().split("T")[0];

  if (id) {
    title.textContent = "Modifier la réparation";
    const rep = await apiFetch(`/api/reparations/${id}`);
    if (!rep) return;

    form.date_reception.value = rep.date_reception?.split("T")[0] || "";
    form.telephone.value = rep.telephone || "";
    form.appareil.value = rep.appareil || "";
    form.marque.value = rep.marque || "";
    form.modele.value = rep.modele || "";
    form.statut.value = rep.statut || "recu";
    form.prix_facture.value = rep.prix_facture ?? "";
    form.acompte.value = rep.acompte ?? "";
    form.date_restitution.value = rep.date_restitution?.split("T")[0] || "";
    form.panne_decrite.value = rep.panne_decrite || "";
    form.diagnostic.value = rep.diagnostic || "";
    form.reparation_effectuee.value = rep.reparation_effectuee || "";
    form.notes.value = rep.notes || "";

    if (rep.client_id && rep.client_nom) {
      document.getElementById("client-search").value = rep.client_nom;
      document.getElementById("client-id-hidden").value = rep.client_id;
    }
  } else {
    title.textContent = "Nouvelle réparation";
  }

  modal.showModal();
};

window.submitRep = async (e) => {
  e.preventDefault();
  const form = e.target;

  const clientId = document.getElementById("client-id-hidden").value;
  const payload = {
    date_reception: form.date_reception.value,
    client_id: clientId ? parseInt(clientId, 10) : null,
    telephone: form.telephone.value.trim() || null,
    appareil: form.appareil.value.trim(),
    marque: form.marque.value.trim() || null,
    modele: form.modele.value.trim() || null,
    statut: form.statut.value,
    prix_facture: form.prix_facture.value
      ? parseFloat(form.prix_facture.value)
      : null,
    acompte: form.acompte.value ? parseFloat(form.acompte.value) : null,
    date_restitution: form.date_restitution.value || null,
    panne_decrite: form.panne_decrite.value.trim() || null,
    diagnostic: form.diagnostic.value.trim() || null,
    reparation_effectuee: form.reparation_effectuee.value.trim() || null,
    notes: form.notes.value.trim() || null,
  };

  const url = STATE.editId
    ? `/api/reparations/${STATE.editId}`
    : "/api/reparations";
  const method = STATE.editId ? "PUT" : "POST";

  const result = await apiFetch(url, {
    method,
    body: JSON.stringify(payload),
  });

  if (result) {
    showToast(
      STATE.editId ? "Réparation mise à jour" : "Réparation créée",
      "success"
    );
    document.getElementById("rep-modal").close();
    loadReparations();
  }
};

// ── Suppression ───────────────────────────────────────────────────────────────

window.deleteRep = async (id) => {
  if (!confirmAction("Supprimer cette réparation ?")) return;

  const res = await apiFetch(`/api/reparations/${id}`, { method: "DELETE" });
  if (res !== null) {
    showToast("Réparation supprimée", "success");
    loadReparations();
  }
};

// ── Modal détail ──────────────────────────────────────────────────────────────

window.openDetail = async (id) => {
  STATE.detailId = id;
  await refreshDetail(id);
  document.getElementById("rep-detail-modal").showModal();
};

async function refreshDetail(id) {
  const rep = await apiFetch(`/api/reparations/${id}`);
  if (!rep) return;

  const marge =
    rep.prix_facture != null
      ? rep.prix_facture - (rep.cout_pieces || 0)
      : null;

  const statutOptions = Object.entries(STATUT_LABELS)
    .map(
      ([v, l]) =>
        `<option value="${v}" ${rep.statut === v ? "selected" : ""}>${l}</option>`
    )
    .join("");

  // Pièces
  const piecesHtml =
    rep.pieces?.length
      ? `<table class="table table-xs w-full">
          <thead>
            <tr>
              <th>Article</th>
              <th class="text-center">Qté</th>
              <th class="text-right">P.U.</th>
              <th class="text-right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rep.pieces
              .map(
                (p) => `
              <tr>
                <td>${escHtml(p.stock_nom)}</td>
                <td class="text-center">${p.quantite}</td>
                <td class="text-right">${formatEur(p.prix_unitaire)}</td>
                <td class="text-right">${formatEur(p.quantite * p.prix_unitaire)}</td>
                <td>
                  <button
                    class="btn btn-xs btn-ghost text-error"
                    onclick="removePiece(${p.id}, ${id})"
                  >✕</button>
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>`
      : `<p class="text-sm text-base-content/50">Aucune pièce</p>`;

  // Select stock pour ajout pièce
  const stockOptions = STATE.stockItems
    .map((s) => `<option value="${s.id}">${escHtml(s.nom)} (dispo: ${s.quantite})</option>`)
    .join("");

  // Photos
  const photosHtml =
    rep.fichiers?.length
      ? `<div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
          ${rep.fichiers
            .map(
              (f) => `
            <div class="relative group">
              <img
                src="/uploads/${f.chemin}"
                class="w-full h-24 object-cover rounded-lg"
                alt="${escHtml(f.nom_original)}"
              />
              <button
                class="absolute top-1 right-1 btn btn-xs btn-error opacity-0
                       group-hover:opacity-100 transition-opacity"
                onclick="deletePhoto(${f.id}, ${id})"
              >✕</button>
            </div>
          `
            )
            .join("")}
        </div>`
      : `<p class="text-sm text-base-content/50">Aucune photo</p>`;

  document.getElementById("detail-rep-title").textContent =
    `#${rep.id} — ${rep.appareil}` +
    (rep.marque || rep.modele
      ? ` ${[rep.marque, rep.modele].filter(Boolean).join(" ")}`
      : "");

  document.getElementById("detail-rep-body").innerHTML = `
    <!-- Infos client -->
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
      <div>
        <div class="text-base-content/50 text-xs uppercase tracking-wide">Client</div>
        <div class="font-medium">${escHtml(rep.client_nom || "—")}</div>
      </div>
      <div>
        <div class="text-base-content/50 text-xs uppercase tracking-wide">Téléphone</div>
        <div>${escHtml(rep.telephone || rep.client_telephone || "—")}</div>
      </div>
      <div>
        <div class="text-base-content/50 text-xs uppercase tracking-wide">Réception</div>
        <div>${formatDate(rep.date_reception)}</div>
      </div>
      <div>
        <div class="text-base-content/50 text-xs uppercase tracking-wide">Restitution</div>
        <div>${rep.date_restitution ? formatDate(rep.date_restitution) : "—"}</div>
      </div>
      <div>
        <div class="text-base-content/50 text-xs uppercase tracking-wide">Fin garantie</div>
        <div>${rep.date_fin_garantie ? formatDate(rep.date_fin_garantie) : "—"}</div>
      </div>
      <div>
        <div class="text-base-content/50 text-xs uppercase tracking-wide">Statut</div>
        <div>${statutBadge(rep.statut, STATUT_MAP, STATUT_LABELS)}</div>
      </div>
    </div>

    <!-- Stats financières -->
    <div class="stats stats-horizontal shadow w-full">
      <div class="stat place-items-center p-3">
        <div class="stat-title text-xs">Coût pièces</div>
        <div class="stat-value text-sm">${formatEur(rep.cout_pieces || 0)}</div>
      </div>
      <div class="stat place-items-center p-3">
        <div class="stat-title text-xs">Prix facturé</div>
        <div class="stat-value text-sm">
          ${rep.prix_facture != null ? formatEur(rep.prix_facture) : "—"}
        </div>
      </div>
      <div class="stat place-items-center p-3">
        <div class="stat-title text-xs">Acompte</div>
        <div class="stat-value text-sm">
          ${rep.acompte ? formatEur(rep.acompte) : "—"}
        </div>
      </div>
      <div class="stat place-items-center p-3">
        <div class="stat-title text-xs">Marge</div>
        <div class="stat-value text-sm ${marge != null ? (marge >= 0 ? "text-success" : "text-error") : ""}">
          ${marge != null ? formatEur(marge) : "—"}
        </div>
      </div>
    </div>

    <!-- Panne / Diagnostic / Réparation -->
    ${
      rep.panne_decrite || rep.diagnostic || rep.reparation_effectuee
        ? `<div class="space-y-2 text-sm">
          ${
            rep.panne_decrite
              ? `<div>
              <span class="font-medium">Panne décrite :</span>
              <p class="text-base-content/70">${escHtml(rep.panne_decrite)}</p>
            </div>`
              : ""
          }
          ${
            rep.diagnostic
              ? `<div>
              <span class="font-medium">Diagnostic :</span>
              <p class="text-base-content/70">${escHtml(rep.diagnostic)}</p>
            </div>`
              : ""
          }
          ${
            rep.reparation_effectuee
              ? `<div>
              <span class="font-medium">Réparation effectuée :</span>
              <p class="text-base-content/70">${escHtml(rep.reparation_effectuee)}</p>
            </div>`
              : ""
          }
        </div>`
        : ""
    }

    <!-- Changement statut rapide -->
    <div class="card bg-base-200 p-3">
      <div class="text-sm font-medium mb-2">Changer le statut</div>
      <div class="flex gap-2">
        <select id="detail-statut-select" class="select select-bordered select-sm flex-1">
          ${statutOptions}
        </select>
        <button class="btn btn-sm btn-primary" onclick="changeStatut(${id})">
          Appliquer
        </button>
      </div>
    </div>

    <!-- Pièces -->
    <div>
      <div class="font-semibold mb-2">Pièces utilisées</div>
      ${piecesHtml}

      <!-- Ajout pièce -->
      <div class="mt-3 p-3 bg-base-200 rounded-lg">
        <div class="text-sm font-medium mb-2">Ajouter une pièce</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select id="piece-stock-select" class="select select-bordered select-sm">
            <option value="">— Sélectionner —</option>
            ${stockOptions}
          </select>
          <input
            type="number"
            id="piece-qte"
            placeholder="Qté"
            min="1"
            value="1"
            class="input input-bordered input-sm"
          />
          <input
            type="number"
            id="piece-prix"
            placeholder="Prix unitaire (optionnel)"
            step="0.01"
            min="0"
            class="input input-bordered input-sm"
          />
        </div>
        <button
          class="btn btn-sm btn-primary mt-2"
          onclick="addPiece(${id})"
        >
          + Ajouter
        </button>
      </div>
    </div>

    <!-- Photos -->
    <div>
      <div class="font-semibold mb-2">Photos</div>
      ${photosHtml}
      <div class="mt-3">
        <input
          type="file"
          id="photo-input"
          accept="image/jpeg,image/png,image/webp,image/gif"
          class="file-input file-input-bordered file-input-sm w-full max-w-xs"
        />
        <button
          class="btn btn-sm btn-secondary mt-2"
          onclick="uploadPhoto(${id})"
        >
          Envoyer la photo
        </button>
      </div>
    </div>

    <!-- Notes -->
    ${
      rep.notes
        ? `<div>
        <div class="font-semibold mb-1">Notes</div>
        <p class="text-sm text-base-content/70">${escHtml(rep.notes)}</p>
      </div>`
        : ""
    }
  `;
}

// ── Actions détail ────────────────────────────────────────────────────────────

window.changeStatut = async (id) => {
  const statut = document.getElementById("detail-statut-select").value;
  const result = await apiFetch(`/api/reparations/${id}`, {
    method: "PUT",
    body: JSON.stringify({ statut }),
  });
  if (result) {
    showToast("Statut mis à jour", "success");
    await refreshDetail(id);
    loadReparations();
  }
};

window.addPiece = async (repId) => {
  const stockId = document.getElementById("piece-stock-select").value;
  const qte = parseInt(document.getElementById("piece-qte").value, 10);
  const prix = document.getElementById("piece-prix").value;

  if (!stockId) {
    showToast("Sélectionnez un article", "warning");
    return;
  }
  if (!qte || qte < 1) {
    showToast("Quantité invalide", "warning");
    return;
  }

  const payload = {
    stock_id: parseInt(stockId, 10),
    quantite: qte,
    prix_unitaire: prix ? parseFloat(prix) : null,
  };

  const result = await apiFetch(`/api/reparations/${repId}/pieces`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (result) {
    showToast("Pièce ajoutée", "success");
    await loadStockItems();
    await refreshDetail(repId);
  }
};

window.removePiece = async (pieceId, repId) => {
  if (!confirmAction("Retirer cette pièce et réintégrer le stock ?")) return;

  const res = await apiFetch(
    `/api/reparations/${repId}/pieces/${pieceId}`,
    { method: "DELETE" }
  );
  if (res !== null) {
    showToast("Pièce retirée", "success");
    await loadStockItems();
    await refreshDetail(repId);
  }
};

window.uploadPhoto = async (repId) => {
  const input = document.getElementById("photo-input");
  if (!input.files.length) {
    showToast("Sélectionnez une photo", "warning");
    return;
  }

  const form = new FormData();
  form.append("file", input.files[0]);

  const result = await apiFetch(`/api/reparations/${repId}/fichiers`, {
    method: "POST",
    body: form,
  });

  if (result) {
    showToast("Photo envoyée", "success");
    input.value = "";
    await refreshDetail(repId);
  }
};

window.deletePhoto = async (fichierId, repId) => {
  if (!confirmAction("Supprimer cette photo ?")) return;

  const res = await apiFetch(
    `/api/reparations/${repId}/fichiers/${fichierId}`,
    { method: "DELETE" }
  );
  if (res !== null) {
    showToast("Photo supprimée", "success");
    await refreshDetail(repId);
  }
};

// ── Reçu imprimable ───────────────────────────────────────────────────────────

window.printRecu = async () => {
  if (!STATE.detailId) return;
  const rep = await apiFetch(`/api/reparations/${STATE.detailId}/recu`);
  if (!rep) return;

  const soc = rep.societe || {};
  const totalPieces = (rep.pieces || []).reduce(
    (s, p) => s + p.quantite * p.prix_unitaire,
    0
  );
  const resteAPayer =
    rep.prix_facture != null
      ? rep.prix_facture - (rep.acompte || 0)
      : null;

  const piecesRows = (rep.pieces || [])
    .map(
      (p) => `
    <tr>
      <td style="padding:4px 8px">${escHtml(p.stock_nom)}</td>
      <td style="padding:4px 8px;text-align:center">${p.quantite}</td>
      <td style="padding:4px 8px;text-align:right">${p.prix_unitaire.toFixed(2)} €</td>
      <td style="padding:4px 8px;text-align:right">${(p.quantite * p.prix_unitaire).toFixed(2)} €</td>
    </tr>
  `
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Reçu #${rep.id}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px;
           max-width: 700px; margin: 0 auto; padding: 20px; color: #222; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 20px; font-size: 12px; }
    .section { margin-bottom: 16px; }
    .label { color: #666; font-size: 11px; text-transform: uppercase;
             letter-spacing: 0.05em; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #f3f4f6; text-align: left; padding: 6px 8px;
         font-size: 12px; }
    td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; }
    .total-row td { font-weight: bold; border-top: 2px solid #222;
                    border-bottom: none; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px;
             background: #e5e7eb; font-size: 11px; font-weight: bold; }
    .footer { margin-top: 32px; font-size: 11px; color: #999;
              border-top: 1px solid #e5e7eb; padding-top: 12px; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <h1>${escHtml(soc.societe_nom || "AQ Réparation")}</h1>
      <div class="subtitle">
        ${escHtml(soc.societe_adresse || "")}
        ${soc.societe_telephone ? `· ${escHtml(soc.societe_telephone)}` : ""}
        ${soc.societe_email ? `· ${escHtml(soc.societe_email)}` : ""}
        ${soc.societe_siret ? `<br/>SIRET : ${escHtml(soc.societe_siret)}` : ""}
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:bold">Reçu #${rep.id}</div>
      <div class="subtitle">
        Reçu le ${formatDate(rep.date_reception)}
        ${rep.date_restitution ? `<br/>Restitué le ${formatDate(rep.date_restitution)}` : ""}
      </div>
      <div class="badge">${STATUT_LABELS[rep.statut] || rep.statut}</div>
    </div>
  </div>

  <hr style="margin:16px 0;border:none;border-top:2px solid #222"/>

  <div class="grid2 section">
    <div>
      <div class="label">Client</div>
      <div style="font-weight:bold">${escHtml(rep.client_nom || "—")}</div>
      <div>${escHtml(rep.telephone || rep.client_telephone || "")}</div>
      <div>${escHtml(rep.client_email || "")}</div>
    </div>
    <div>
      <div class="label">Appareil</div>
      <div style="font-weight:bold">${escHtml(rep.appareil)}</div>
      <div>${escHtml([rep.marque, rep.modele].filter(Boolean).join(" ") || "")}</div>
    </div>
  </div>

  ${
    rep.panne_decrite
      ? `<div class="section">
          <div class="label">Panne décrite</div>
          <div>${escHtml(rep.panne_decrite)}</div>
        </div>`
      : ""
  }

  ${
    rep.reparation_effectuee
      ? `<div class="section">
          <div class="label">Réparation effectuée</div>
          <div>${escHtml(rep.reparation_effectuee)}</div>
        </div>`
      : ""
  }

  ${
    rep.pieces?.length
      ? `<div class="section">
          <div class="label">Pièces utilisées</div>
          <table>
            <thead>
              <tr>
                <th>Article</th>
                <th style="text-align:center">Qté</th>
                <th style="text-align:right">P.U.</th>
                <th style="text-align:right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${piecesRows}
              <tr class="total-row">
                <td colspan="3">Total pièces</td>
                <td style="text-align:right">${totalPieces.toFixed(2)} €</td>
              </tr>
            </tbody>
          </table>
        </div>`
      : ""
  }

  <div class="section">
    <div class="label">Facturation</div>
    <table>
      <tbody>
        <tr>
          <td>Prix facturé</td>
          <td style="text-align:right;font-weight:bold">
            ${rep.prix_facture != null ? rep.prix_facture.toFixed(2) + " €" : "—"}
          </td>
        </tr>
        ${
          rep.acompte
            ? `<tr>
                <td>Acompte versé</td>
                <td style="text-align:right">− ${rep.acompte.toFixed(2)} €</td>
              </tr>`
            : ""
        }
        ${
          resteAPayer != null
            ? `<tr class="total-row">
                <td>Reste à payer</td>
                <td style="text-align:right">${resteAPayer.toFixed(2)} €</td>
              </tr>`
            : ""
        }
      </tbody>
    </table>
  </div>

  ${
    rep.date_fin_garantie
      ? `<div class="section">
          <div class="label">Garantie</div>
          <div>Valable jusqu'au <strong>${formatDate(rep.date_fin_garantie)}</strong></div>
        </div>`
      : ""
  }

  ${
    rep.notes
      ? `<div class="section">
          <div class="label">Notes</div>
          <div>${escHtml(rep.notes)}</div>
        </div>`
      : ""
  }

  <div class="footer">
    Document généré le ${new Date().toLocaleDateString("fr-FR")}
    — ${escHtml(soc.societe_nom || "AQ Réparation")}
  </div>

  <br/>
  <button onclick="window.print()"
    style="padding:8px 16px;background:#2563eb;color:white;
           border:none;border-radius:6px;cursor:pointer;font-size:13px">
    🖨️ Imprimer
  </button>
</body>
</html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

init();