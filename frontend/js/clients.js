import { requireAuth, logout } from "./auth.js";
import {
  apiFetch,
  showToast,
  formatDate,
  tableLoading,
  tableEmpty,
  confirmAction,
  escHtml,
} from "./app.js";

requireAuth();

// Expose logout globally for inline onclick
window.logout = logout;

const STATE = {
  page: 0,
  limit: 50,
  search: "",
  total: 0,
  editId: null,
};

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  setupSidebar();
  await loadClients();
}

function setupSidebar() {
  const user = JSON.parse(localStorage.getItem("current_user") || "{}");
  const el = document.getElementById("sidebar-username");
  const ini = document.getElementById("sidebar-initial");
  if (el) el.textContent = user.username || "";
  if (ini) ini.textContent = (user.username || "?")[0].toUpperCase();
}

// ── Chargement ────────────────────────────────────────────────────────────────

async function loadClients() {
  const tbody = document.getElementById("clients-tbody");
  tableLoading(tbody, 5);

  const params = new URLSearchParams({
    skip: STATE.page * STATE.limit,
    limit: STATE.limit,
    search: STATE.search,
  });

  const data = await apiFetch(`/api/clients?${params}`);
  if (!data) return;

  STATE.total = data.total;
  renderTable(data.items);
  renderPagination();
}

function renderTable(items) {
  const tbody = document.getElementById("clients-tbody");
  if (!items.length) {
    tableEmpty(tbody, 5, "Aucun client trouvé");
    return;
  }

  tbody.innerHTML = items
    .map(
      (c) => `
    <tr class="hover cursor-pointer" onclick="openDetail(${c.id})">
      <td class="font-medium">${escHtml(c.nom)}</td>
      <td>${escHtml(c.telephone || "—")}</td>
      <td>${escHtml(c.email || "—")}</td>
      <td class="text-center">
        <span class="badge badge-ghost">${c.nb_reparations ?? 0}</span>
      </td>
      <td onclick="event.stopPropagation()">
        <div class="flex gap-1">
          <button
            class="btn btn-xs btn-ghost"
            onclick="openClientModal(${c.id})"
            title="Modifier"
          >✏️</button>
          <button
            class="btn btn-xs btn-ghost text-error"
            onclick="deleteClient(${c.id})"
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
  loadClients();
};

// ── Filtres ───────────────────────────────────────────────────────────────────

let _searchTimer = null;
window.debouncedSearch = () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    STATE.search = document.getElementById("search-input").value;
    STATE.page = 0;
    loadClients();
  }, 350);
};

window.resetFilters = () => {
  STATE.search = "";
  STATE.page = 0;
  document.getElementById("search-input").value = "";
  loadClients();
};

// ── Modal création/édition ────────────────────────────────────────────────────

window.openClientModal = async (id = null) => {
  STATE.editId = id;
  const modal = document.getElementById("client-modal");
  const form = document.getElementById("client-form");
  const title = document.getElementById("client-modal-title");

  form.reset();

  if (id) {
    title.textContent = "Modifier le client";
    const client = await apiFetch(`/api/clients/${id}`);
    if (!client) return;

    form.nom.value = client.nom || "";
    form.telephone.value = client.telephone || "";
    form.email.value = client.email || "";
    form.notes.value = client.notes || "";
  } else {
    title.textContent = "Nouveau client";
  }

  modal.showModal();
};

window.submitClient = async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    nom: form.nom.value.trim(),
    telephone: form.telephone.value.trim() || null,
    email: form.email.value.trim() || null,
    notes: form.notes.value.trim() || null,
  };

  const url = STATE.editId
    ? `/api/clients/${STATE.editId}`
    : "/api/clients";
  const method = STATE.editId ? "PUT" : "POST";

  const result = await apiFetch(url, {
    method,
    body: JSON.stringify(payload),
  });

  if (result) {
    showToast(
      STATE.editId ? "Client mis à jour" : "Client créé",
      "success"
    );
    document.getElementById("client-modal").close();
    loadClients();
  }
};

// ── Suppression ───────────────────────────────────────────────────────────────

window.deleteClient = async (id) => {
  if (!confirmAction("Supprimer ce client ?")) return;

  const res = await apiFetch(`/api/clients/${id}`, { method: "DELETE" });
  if (res !== null) {
    showToast("Client supprimé", "success");
    loadClients();
  }
};

// ── Détail ────────────────────────────────────────────────────────────────────

window.openDetail = async (id) => {
  const client = await apiFetch(`/api/clients/${id}`);
  if (!client) return;

  document.getElementById("detail-client-nom").textContent = client.nom;

  const repsHtml =
    client.reparations?.length
      ? `<table class="table table-xs w-full">
          <thead>
            <tr>
              <th>Date</th><th>Appareil</th><th>Statut</th><th>Prix</th>
            </tr>
          </thead>
          <tbody>
            ${client.reparations
              .map(
                (r) => `
              <tr class="hover cursor-pointer"
                  onclick="window.location='/reparations.html?id=${r.id}'">
                <td>${formatDate(r.date_reception)}</td>
                <td>${escHtml([r.marque, r.modele].filter(Boolean).join(" ") || r.appareil)}</td>
                <td><span class="badge badge-sm">${r.statut}</span></td>
                <td>${r.prix_facture != null ? r.prix_facture.toFixed(2) + " €" : "—"}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>`
      : `<p class="text-base-content/50 text-sm">Aucune réparation</p>`;

  document.getElementById("detail-client-body").innerHTML = `
    <div class="grid grid-cols-2 gap-4 text-sm">
      <div><span class="font-medium">Téléphone :</span> ${escHtml(client.telephone || "—")}</div>
      <div><span class="font-medium">Email :</span> ${escHtml(client.email || "—")}</div>
      <div class="col-span-2">
        <span class="font-medium">Notes :</span>
        <p class="text-base-content/70">${escHtml(client.notes || "—")}</p>
      </div>
    </div>
    <div>
      <h4 class="font-semibold mb-2">
        Réparations (${client.nb_reparations ?? 0})
      </h4>
      ${repsHtml}
    </div>
  `;

  document.getElementById("client-detail-modal").showModal();
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

init();