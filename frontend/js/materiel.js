import { apiFetch, showToast, formatEur, formatDate } from "./app.js";

const STATE = {
  page: 0,
  limit: 50,
  total: 0,
  search: "",
  statut: "",
  priorite: "",
  editId: null,
  detailId: null,
};

let searchTimer = null;

const STATUT_MAP = {
  a_acheter: { label: "À acheter", cls: "badge-warning" },
  achete: { label: "Acheté", cls: "badge-success" },
  abandonne: { label: "Abandonné", cls: "badge-ghost" },
};

const PRIORITE_MAP = {
  haute: { label: "🔴 Haute", cls: "badge-error" },
  normale: { label: "🟡 Normale", cls: "badge-warning" },
  basse: { label: "🟢 Basse", cls: "badge-success" },
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function init() {
  await loadMateriel();
}

// ---------------------------------------------------------------------------
// Chargement liste
// ---------------------------------------------------------------------------

export async function loadMateriel() {
  const tbody = document.getElementById("materiel-tbody");
  tbody.innerHTML =
    `<tr><td colspan="6" class="text-center">
      <span class="loading loading-spinner loading-sm"></span>
    </td></tr>`;

  const params = new URLSearchParams({
    skip: STATE.page * STATE.limit,
    limit: STATE.limit,
    ...(STATE.search && { search: STATE.search }),
    ...(STATE.statut && { statut: STATE.statut }),
    ...(STATE.priorite && { priorite: STATE.priorite }),
  });

  try {
    const data = await apiFetch(`/api/materiel?${params}`);
    STATE.total = data.total;
    renderTable(data.items);
    renderPagination();
  } catch {
    tbody.innerHTML =
      `<tr><td colspan="6" class="text-center text-error">
        Erreur de chargement
      </td></tr>`;
  }
}

// ---------------------------------------------------------------------------
// Rendu tableau
// ---------------------------------------------------------------------------

function renderTable(items) {
  const tbody = document.getElementById("materiel-tbody");
  if (!items.length) {
    tbody.innerHTML =
      `<tr><td colspan="6" class="text-center text-base-content/40">
        Aucun article
      </td></tr>`;
    return;
  }

  tbody.innerHTML = items
    .map((m) => {
      const s = STATUT_MAP[m.statut] ?? { label: m.statut, cls: "badge-ghost" };
      const p = PRIORITE_MAP[m.priorite] ?? {
        label: m.priorite,
        cls: "badge-ghost",
      };
      const rowOpacity =
        m.statut === "abandonne" ? "opacity-50" : "";

      return `<tr class="hover cursor-pointer ${rowOpacity}"
                  onclick="openDetail(${m.id})">
        <td>
          <span class="badge badge-sm ${p.cls}">${p.label}</span>
        </td>
        <td class="font-medium">${escHtml(m.article)}</td>
        <td class="font-mono">
          ${m.prix_estime != null ? formatEur(m.prix_estime) : "—"}
        </td>
        <td>
          <span class="badge badge-sm ${s.cls}">${s.label}</span>
        </td>
        <td class="text-base-content/60">
          ${m.date_achat ? formatDate(m.date_achat) : "—"}
        </td>
        <td onclick="event.stopPropagation()">
          <div class="flex justify-end gap-1">
            <button class="btn btn-ghost btn-xs"
              onclick="openMaterielModal(${m.id})">✏️</button>
            <button class="btn btn-ghost btn-xs text-error"
              onclick="deleteMateriel(${m.id})">🗑️</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  window.openDetail = openDetail;
  window.deleteMateriel = deleteMateriel;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function renderPagination() {
  const el = document.getElementById("pagination");
  const totalPages = Math.ceil(STATE.total / STATE.limit);
  const current = STATE.page + 1;

  el.innerHTML = `
    <span class="text-base-content/50">${STATE.total} article(s)</span>
    <div class="flex gap-2">
      <button class="btn btn-sm btn-ghost"
        ${STATE.page === 0 ? "disabled" : ""}
        onclick="prevPage()">← Préc.</button>
      <span class="btn btn-sm btn-ghost no-animation">
        ${current} / ${totalPages || 1}
      </span>
      <button class="btn btn-sm btn-ghost"
        ${STATE.page >= totalPages - 1 ? "disabled" : ""}
        onclick="nextPage()">Suiv. →</button>
    </div>`;

  window.prevPage = () => { STATE.page--; loadMateriel(); };
  window.nextPage = () => { STATE.page++; loadMateriel(); };
}

// ---------------------------------------------------------------------------
// Modal création / édition
// ---------------------------------------------------------------------------

export async function openMaterielModal(id = null) {
  STATE.editId = id;
  document.getElementById("modal-title").textContent =
    id ? "Modifier l'article" : "Ajouter du matériel";

  // Reset
  ["m-article", "m-lien", "m-prix", "m-notes", "m-date-achat"].forEach(
    (fid) => {
      const el = document.getElementById(fid);
      if (el) el.value = "";
    }
  );
  document.getElementById("m-priorite").value = "normale";
  document.getElementById("m-statut").value = "a_acheter";
  toggleDateAchat();

  if (id) {
    try {
      const m = await apiFetch(`/api/materiel/${id}`);
      document.getElementById("m-article").value = m.article ?? "";
      document.getElementById("m-lien").value = m.lien ?? "";
      document.getElementById("m-prix").value = m.prix_estime ?? "";
      document.getElementById("m-priorite").value = m.priorite ?? "normale";
      document.getElementById("m-statut").value = m.statut ?? "a_acheter";
      document.getElementById("m-date-achat").value = m.date_achat ?? "";
      document.getElementById("m-notes").value = m.notes ?? "";
      toggleDateAchat();
    } catch {
      showToast("Erreur chargement", "error");
      return;
    }
  }

  document.getElementById("modal-materiel").showModal();
}

export function toggleDateAchat() {
  const statut = document.getElementById("m-statut")?.value;
  const wrap = document.getElementById("date-achat-wrap");
  if (wrap) {
    wrap.classList.toggle("hidden", statut !== "achete");
  }
}

export async function submitMateriel(e) {
  e.preventDefault();
  const statut = document.getElementById("m-statut").value;
  const body = {
    article: document.getElementById("m-article").value.trim(),
    lien: document.getElementById("m-lien").value.trim() || null,
    prix_estime:
      parseFloat(document.getElementById("m-prix").value) || null,
    priorite: document.getElementById("m-priorite").value,
    statut,
    date_achat:
      statut === "achete"
        ? document.getElementById("m-date-achat").value || null
        : null,
    notes: document.getElementById("m-notes").value.trim() || null,
  };

  try {
    if (STATE.editId) {
      await apiFetch(`/api/materiel/${STATE.editId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      showToast("Article mis à jour", "success");
    } else {
      await apiFetch("/api/materiel", {
        method: "POST",
        body: JSON.stringify(body),
      });
      showToast("Article ajouté", "success");
    }
    document.getElementById("modal-materiel").close();
    STATE.page = 0;
    await loadMateriel();
  } catch (err) {
    showToast(err.message || "Erreur", "error");
  }
}

// ---------------------------------------------------------------------------
// Modal détail
// ---------------------------------------------------------------------------

export async function openDetail(id) {
  STATE.detailId = id;
  try {
    const m = await apiFetch(`/api/materiel/${id}`);
    renderDetail(m);
    document.getElementById("modal-detail").showModal();
  } catch {
    showToast("Erreur chargement", "error");
  }
}

function renderDetail(m) {
  document.getElementById("detail-article").textContent = m.article;

  const lienWrap = document.getElementById("detail-lien-wrap");
  const lienEl = document.getElementById("detail-lien");
  if (m.lien) {
    lienEl.href = m.lien;
    lienEl.textContent = `🔗 ${m.lien}`;
    lienWrap.classList.remove("hidden");
  } else {
    lienWrap.classList.add("hidden");
  }

  const s = STATUT_MAP[m.statut] ?? { label: m.statut, cls: "badge-ghost" };
  const p = PRIORITE_MAP[m.priorite] ?? {
    label: m.priorite,
    cls: "badge-ghost",
  };

  const statutBadge = document.getElementById("detail-statut-badge");
  statutBadge.textContent = s.label;
  statutBadge.className = `badge badge-lg ${s.cls}`;

  const prioriteBadge = document.getElementById("detail-priorite-badge");
  prioriteBadge.textContent = p.label;
  prioriteBadge.className = `badge badge-lg badge-outline ${p.cls}`;

  // Pré-remplir select changement statut
  document.getElementById("detail-statut-select").value = m.statut;
  document.getElementById("detail-date-achat").value = m.date_achat ?? "";

  document.getElementById("detail-prix").textContent =
    m.prix_estime != null ? formatEur(m.prix_estime) : "—";
  document.getElementById("detail-date").textContent = m.date_achat
    ? formatDate(m.date_achat)
    : "—";
  document.getElementById("detail-created").textContent = formatDate(
    m.created_at
  );

  const notesWrap = document.getElementById("detail-notes-wrap");
  if (m.notes) {
    document.getElementById("detail-notes").textContent = m.notes;
    notesWrap.classList.remove("hidden");
  } else {
    notesWrap.classList.add("hidden");
  }
}

export function editFromDetail() {
  document.getElementById("modal-detail").close();
  openMaterielModal(STATE.detailId);
}

export async function applyStatut() {
  const statut = document.getElementById("detail-statut-select").value;
  const dateAchat = document.getElementById("detail-date-achat").value;
  try {
    await apiFetch(`/api/materiel/${STATE.detailId}/statut`, {
      method: "PATCH",
      body: JSON.stringify({ statut, date_achat: dateAchat || null }),
    });
    showToast("Statut mis à jour", "success");
    document.getElementById("modal-detail").close();
    await loadMateriel();
  } catch (err) {
    showToast(err.message || "Erreur", "error");
  }
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

async function deleteMateriel(id) {
  if (!confirm("Supprimer cet article ?")) return;
  try {
    await apiFetch(`/api/materiel/${id}`, { method: "DELETE" });
    showToast("Article supprimé", "success");
    await loadMateriel();
  } catch (err) {
    showToast(err.message || "Erreur suppression", "error");
  }
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

export function debouncedSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    STATE.search = document.getElementById("search-input").value;
    STATE.page = 0;
    loadMateriel();
  }, 350);
}

export function applyFilters() {
  STATE.statut = document.getElementById("filter-statut").value;
  STATE.priorite = document.getElementById("filter-priorite").value;
  STATE.page = 0;
  loadMateriel();
}

export function resetFilters() {
  document.getElementById("search-input").value = "";
  document.getElementById("filter-statut").value = "";
  document.getElementById("filter-priorite").value = "";
  STATE.search = "";
  STATE.statut = "";
  STATE.priorite = "";
  STATE.page = 0;
  loadMateriel();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}