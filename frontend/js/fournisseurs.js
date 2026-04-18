import { apiFetch, showToast, formatEur, formatDate } from "./app.js";

const STATE = {
  page: 0,
  limit: 50,
  total: 0,
  search: "",
  editId: null,
  detailId: null,
};

let searchTimer = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function init() {
  await loadFournisseurs();
}

// ---------------------------------------------------------------------------
// Chargement liste
// ---------------------------------------------------------------------------

export async function loadFournisseurs() {
  const tbody = document.getElementById("fournisseurs-tbody");
  tbody.innerHTML =
    `<tr><td colspan="6" class="text-center">
      <span class="loading loading-spinner loading-sm"></span>
    </td></tr>`;

  const params = new URLSearchParams({
    skip: STATE.page * STATE.limit,
    limit: STATE.limit,
    ...(STATE.search && { search: STATE.search }),
  });

  try {
    const data = await apiFetch(`/api/fournisseurs?${params}`);
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
  const tbody = document.getElementById("fournisseurs-tbody");
  if (!items.length) {
    tbody.innerHTML =
      `<tr><td colspan="6" class="text-center text-base-content/40">
        Aucun fournisseur
      </td></tr>`;
    return;
  }

  tbody.innerHTML = items
    .map(
      (f) => `<tr class="hover cursor-pointer" onclick="openDetail(${f.id})">
      <td class="font-medium">${escHtml(f.nom)}</td>
      <td class="text-base-content/60">${escHtml(f.contact ?? "—")}</td>
      <td>
        ${
          f.delai_moyen_jours
            ? `<span class="badge badge-ghost badge-sm">
                ${f.delai_moyen_jours} j
               </span>`
            : `<span class="text-base-content/30">—</span>`
        }
      </td>
      <td class="text-right">${f.nb_achats}</td>
      <td class="text-right font-mono">${formatEur(f.total_achats)}</td>
      <td onclick="event.stopPropagation()">
        <div class="flex justify-end gap-1">
          <button
            class="btn btn-ghost btn-xs"
            onclick="openFournisseurModal(${f.id})"
          >✏️</button>
          <button
            class="btn btn-ghost btn-xs text-error"
            onclick="deleteFournisseur(${f.id})"
          >🗑️</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  // expose globalement (appelé depuis le HTML inline)
  window.openDetail = openDetail;
  window.deleteFournisseur = deleteFournisseur;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function renderPagination() {
  const el = document.getElementById("pagination");
  const totalPages = Math.ceil(STATE.total / STATE.limit);
  const current = STATE.page + 1;

  el.innerHTML = `
    <span class="text-base-content/50">
      ${STATE.total} fournisseur(s)
    </span>
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

  window.prevPage = () => { STATE.page--; loadFournisseurs(); };
  window.nextPage = () => { STATE.page++; loadFournisseurs(); };
}

// ---------------------------------------------------------------------------
// Modal création / édition
// ---------------------------------------------------------------------------

export async function openFournisseurModal(id = null) {
  STATE.editId = id;
  const modal = document.getElementById("modal-fournisseur");
  document.getElementById("modal-title").textContent =
    id ? "Modifier le fournisseur" : "Nouveau fournisseur";

  // Reset
  ["f-nom", "f-lien", "f-contact", "f-delai", "f-notes"].forEach((fid) => {
    const el = document.getElementById(fid);
    if (el) el.value = "";
  });

  if (id) {
    try {
      const f = await apiFetch(`/api/fournisseurs/${id}`);
      document.getElementById("f-nom").value = f.nom ?? "";
      document.getElementById("f-lien").value = f.lien ?? "";
      document.getElementById("f-contact").value = f.contact ?? "";
      document.getElementById("f-delai").value = f.delai_moyen_jours ?? "";
      document.getElementById("f-notes").value = f.notes ?? "";
    } catch {
      showToast("Erreur chargement", "error");
      return;
    }
  }

  modal.showModal();
}

export async function submitFournisseur(e) {
  e.preventDefault();
  const body = {
    nom: document.getElementById("f-nom").value.trim(),
    lien: document.getElementById("f-lien").value.trim() || null,
    contact: document.getElementById("f-contact").value.trim() || null,
    delai_moyen_jours:
      parseInt(document.getElementById("f-delai").value) || null,
    notes: document.getElementById("f-notes").value.trim() || null,
  };

  try {
    if (STATE.editId) {
      await apiFetch(`/api/fournisseurs/${STATE.editId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      showToast("Fournisseur mis à jour", "success");
    } else {
      await apiFetch("/api/fournisseurs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      showToast("Fournisseur créé", "success");
    }
    document.getElementById("modal-fournisseur").close();
    STATE.page = 0;
    await loadFournisseurs();
  } catch (err) {
    showToast(err.message || "Erreur", "error");
  }
}

// ---------------------------------------------------------------------------
// Modal détail
// ---------------------------------------------------------------------------

export async function openDetail(id) {
  STATE.detailId = id;
  const modal = document.getElementById("modal-detail");

  try {
    const f = await apiFetch(`/api/fournisseurs/${id}`);
    renderDetail(f);
    modal.showModal();
  } catch {
    showToast("Erreur chargement détail", "error");
  }
}

function renderDetail(f) {
  document.getElementById("detail-nom").textContent = f.nom;

  const lienWrap = document.getElementById("detail-lien-wrap");
  const lienEl = document.getElementById("detail-lien");
  if (f.lien) {
    lienEl.href = f.lien;
    lienEl.textContent = `🔗 ${f.lien}`;
    lienWrap.classList.remove("hidden");
  } else {
    lienWrap.classList.add("hidden");
  }

  document.getElementById("detail-nb-achats").textContent = f.nb_achats ?? 0;
  document.getElementById("detail-total").textContent = formatEur(
    f.total_achats ?? 0
  );
  document.getElementById("detail-delai").textContent = f.delai_moyen_jours
    ? `${f.delai_moyen_jours} j`
    : "—";
  document.getElementById("detail-contact").textContent = f.contact || "—";
  document.getElementById("detail-created").textContent = formatDate(
    f.created_at
  );

  const notesWrap = document.getElementById("detail-notes-wrap");
  if (f.notes) {
    document.getElementById("detail-notes").textContent = f.notes;
    notesWrap.classList.remove("hidden");
  } else {
    notesWrap.classList.add("hidden");
  }

  // Historique achats
  const tbody = document.getElementById("detail-achats-tbody");
  if (!f.achats?.length) {
    tbody.innerHTML =
      `<tr><td colspan="5" class="text-center text-base-content/40">
        Aucun achat lié
      </td></tr>`;
  } else {
    tbody.innerHTML = f.achats
      .map(
        (a) => `<tr>
        <td>${formatDate(a.date)}</td>
        <td>${escHtml(a.nom)}</td>
        <td><span class="badge badge-ghost badge-xs">${escHtml(a.type_achat)}</span></td>
        <td class="text-right font-mono">${formatEur(a.prix_achat)}</td>
        <td class="text-right">${a.quantite}</td>
      </tr>`
      )
      .join("");
  }
}

export function editFromDetail() {
  document.getElementById("modal-detail").close();
  openFournisseurModal(STATE.detailId);
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

async function deleteFournisseur(id) {
  if (!confirm("Supprimer ce fournisseur ?")) return;
  try {
    await apiFetch(`/api/fournisseurs/${id}`, { method: "DELETE" });
    showToast("Fournisseur supprimé", "success");
    await loadFournisseurs();
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
    loadFournisseurs();
  }, 350);
}

export function resetFilters() {
  document.getElementById("search-input").value = "";
  STATE.search = "";
  STATE.page = 0;
  loadFournisseurs();
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