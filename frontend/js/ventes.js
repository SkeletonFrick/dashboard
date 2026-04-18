import { requireAuth, logout } from "./auth.js";
import {
  apiFetch,
  showToast,
  formatDate,
  formatEur,
  tableLoading,
  tableEmpty,
  confirmAction,
  escHtml,
} from "./app.js";

requireAuth();
window.logout = logout;

const STATE = {
  page: 0,
  limit: 50,
  search: "",
  categorie: "",
  plateforme: "",
  total: 0,
  editId: null,
  detailId: null,
  achats: [],
  flips: [],
};

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  setupSidebar();

  const form = document.querySelector('[name="date"]');
  if (form) form.value = new Date().toISOString().split("T")[0];

  await Promise.all([
    loadCategories(),
    loadPlateformes(),
    loadAchats(),
    loadFlips(),
  ]);
  await Promise.all([loadVentes(), loadStats()]);
}

function setupSidebar() {
  const user = JSON.parse(localStorage.getItem("current_user") || "{}");
  const el = document.getElementById("sidebar-username");
  const ini = document.getElementById("sidebar-initial");
  if (el) el.textContent = user.username || "";
  if (ini) ini.textContent = (user.username || "?")[0].toUpperCase();
}

// ── Données annexes ───────────────────────────────────────────────────────────

async function loadCategories() {
  const data = await apiFetch("/api/parametres/categories?type=vente");
  if (!data) return;
  const cats = data.items || data || [];
  const selForm = document.querySelector('form [name="categorie"]');
  const selFilter = document.getElementById("filter-categorie");
  cats.forEach((c) => {
    [selForm, selFilter].forEach((sel) => {
      if (!sel) return;
      const opt = document.createElement("option");
      opt.value = c.nom;
      opt.textContent = c.nom;
      sel.appendChild(opt);
    });
  });
}

async function loadPlateformes() {
  const data = await apiFetch("/api/parametres/plateformes?type=vente");
  if (!data) return;
  const plats = data.items || data || [];
  const selForm = document.querySelector('form [name="plateforme"]');
  const selFilter = document.getElementById("filter-plateforme");
  plats.forEach((p) => {
    [selForm, selFilter].forEach((sel) => {
      if (!sel) return;
      const opt = document.createElement("option");
      opt.value = p.nom;
      opt.textContent = p.nom;
      sel.appendChild(opt);
    });
  });
}

async function loadAchats() {
  const data = await apiFetch("/api/achats?limit=500");
  if (data) {
    STATE.achats = data.items || [];
    const sel = document.getElementById("select-achat");
    STATE.achats.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.nom} (${formatEur(a.prix_achat)})`;
      sel.appendChild(opt);
    });
  }
}

async function loadFlips() {
  const data = await apiFetch("/api/flips?limit=500&statut=pret_a_vendre");
  if (data) {
    STATE.flips = data.items || [];
    const sel = document.getElementById("select-flip");
    STATE.flips.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = `${f.nom} — ${f.marque || ""} ${f.modele || ""}`.trim();
      sel.appendChild(opt);
    });
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  const data = await apiFetch("/api/ventes/stats");
  if (!data) return;

  const ca = document.getElementById("stat-ca");
  const nb = document.getElementById("stat-nb");
  const plats = document.getElementById("stat-plateformes");

  if (ca) ca.textContent = formatEur(data.totaux?.ca_total || 0);
  if (nb) nb.textContent = data.totaux?.nb || 0;

  if (plats && data.par_plateforme?.length) {
    plats.innerHTML = data.par_plateforme
      .map(
        (p) =>
          `<span class="badge badge-outline badge-sm">
            ${escHtml(p.plateforme)} · ${formatEur(p.ca)}
           </span>`
      )
      .join("");
  } else if (plats) {
    plats.innerHTML =
      `<span class="text-base-content/40 text-xs">Aucune vente</span>`;
  }
}

// ── Chargement ventes ─────────────────────────────────────────────────────────

async function loadVentes() {
  const tbody = document.getElementById("ventes-tbody");
  tableLoading(tbody, 8);

  const params = new URLSearchParams({
    skip: STATE.page * STATE.limit,
    limit: STATE.limit,
    search: STATE.search,
    categorie: STATE.categorie,
    plateforme: STATE.plateforme,
  });

  const data = await apiFetch(`/api/ventes?${params}`);
  if (!data) return;

  STATE.total = data.total;
  renderTable(data.items);
  renderPagination();
}

function renderTable(items) {
  const tbody = document.getElementById("ventes-tbody");
  if (!items.length) {
    tableEmpty(tbody, 8, "Aucune vente trouvée");
    return;
  }

  tbody.innerHTML = items
    .map((v) => {
      const margeClass =
        v.marge == null ? "" : v.marge >= 0 ? "text-success" : "text-error";
      const source = v.flip_id
        ? `<span class="badge badge-accent badge-sm">Flip #${v.flip_id}</span>`
        : v.achat_id
          ? `<span class="badge badge-ghost badge-sm">Achat #${v.achat_id}</span>`
          : `<span class="text-base-content/40">—</span>`;

      return `
        <tr class="hover cursor-pointer" onclick="openDetail(${v.id})">
          <td>${formatDate(v.date)}</td>
          <td class="font-medium">${escHtml(v.nom)}</td>
          <td>${escHtml(v.categorie || "—")}</td>
          <td>${escHtml(v.plateforme || "—")}</td>
          <td>${source}</td>
          <td class="text-right font-medium">${formatEur(v.prix_vente)}</td>
          <td class="text-right font-medium ${margeClass}">
            ${v.marge != null ? formatEur(v.marge) : "—"}
          </td>
          <td onclick="event.stopPropagation()">
            <div class="flex gap-1">
              <button class="btn btn-xs btn-ghost"
                onclick="openVenteModal(${v.id})" title="Modifier">✏️</button>
              <button class="btn btn-xs btn-ghost text-error"
                onclick="deleteVente(${v.id})" title="Supprimer">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    })
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
  loadVentes();
};

// ── Filtres ───────────────────────────────────────────────────────────────────

let _searchTimer = null;
window.debouncedSearch = () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    STATE.search = document.getElementById("search-input").value;
    STATE.page = 0;
    loadVentes();
  }, 350);
};

window.applyFilters = () => {
  STATE.categorie = document.getElementById("filter-categorie").value;
  STATE.plateforme = document.getElementById("filter-plateforme").value;
  STATE.page = 0;
  loadVentes();
};

window.resetFilters = () => {
  STATE.search = "";
  STATE.categorie = "";
  STATE.plateforme = "";
  STATE.page = 0;
  document.getElementById("search-input").value = "";
  document.getElementById("filter-categorie").value = "";
  document.getElementById("filter-plateforme").value = "";
  loadVentes();
};

// ── Validation source ─────────────────────────────────────────────────────────

window.onSourceChange = () => {
  const achatId = document.getElementById("select-achat").value;
  const flipId = document.getElementById("select-flip").value;
  const warn = document.getElementById("source-warning");
  if (achatId && flipId) {
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
};

// ── Modal création/édition ────────────────────────────────────────────────────

window.openVenteModal = async (id = null) => {
  STATE.editId = id;
  const modal = document.getElementById("vente-modal");
  const form = document.getElementById("vente-form");
  const title = document.getElementById("vente-modal-title");

  form.reset();
  document.getElementById("source-warning").classList.add("hidden");
  form.date.value = new Date().toISOString().split("T")[0];

  if (id) {
    title.textContent = "Modifier la vente";
    const vente = await apiFetch(`/api/ventes/${id}`);
    if (!vente) return;

    form.date.value = vente.date?.split("T")[0] || "";
    form.nom.value = vente.nom || "";
    form.prix_vente.value = vente.prix_vente ?? "";
    form.categorie.value = vente.categorie || "";
    form.plateforme.value = vente.plateforme || "";
    form.achat_id.value = vente.achat_id || "";
    form.flip_id.value = vente.flip_id || "";
    form.notes.value = vente.notes || "";
  } else {
    title.textContent = "Nouvelle vente";
  }

  modal.showModal();
};

window.submitVente = async (e) => {
  e.preventDefault();
  const form = e.target;

  const achatId = form.achat_id.value;
  const flipId = form.flip_id.value;

  if (achatId && flipId) {
    showToast("Sélectionnez un achat ou un flip, pas les deux", "error");
    return;
  }

  const payload = {
    date: form.date.value,
    nom: form.nom.value.trim(),
    prix_vente: parseFloat(form.prix_vente.value),
    categorie: form.categorie.value || null,
    plateforme: form.plateforme.value || null,
    achat_id: achatId ? parseInt(achatId, 10) : null,
    flip_id: flipId ? parseInt(flipId, 10) : null,
    notes: form.notes.value.trim() || null,
  };

  const url = STATE.editId ? `/api/ventes/${STATE.editId}` : "/api/ventes";
  const method = STATE.editId ? "PUT" : "POST";

  const result = await apiFetch(url, {
    method,
    body: JSON.stringify(payload),
  });

  if (result) {
    showToast(
      STATE.editId ? "Vente mise à jour" : "Vente enregistrée",
      "success"
    );
    document.getElementById("vente-modal").close();
    await Promise.all([loadVentes(), loadStats()]);
  }
};

// ── Suppression ───────────────────────────────────────────────────────────────

window.deleteVente = async (id) => {
  if (!confirmAction("Supprimer cette vente ?")) return;
  const res = await apiFetch(`/api/ventes/${id}`, { method: "DELETE" });
  if (res !== null) {
    showToast("Vente supprimée", "success");
    await Promise.all([loadVentes(), loadStats()]);
  }
};

// ── Modal détail ──────────────────────────────────────────────────────────────

window.openDetail = async (id) => {
  STATE.detailId = id;
  const vente = await apiFetch(`/api/ventes/${id}`);
  if (!vente) return;

  document.getElementById("detail-vente-title").textContent =
    `Vente — ${vente.nom}`;

  const margeClass =
    vente.marge == null
      ? ""
      : vente.marge >= 0
        ? "text-success"
        : "text-error";

  const source = vente.flip_id
    ? `<a href="/flips.html" class="link link-primary">
         Flip #${vente.flip_id} — ${escHtml(vente.flip_nom || "")}
       </a>`
    : vente.achat_id
      ? `<a href="/achats.html" class="link link-primary">
           Achat #${vente.achat_id} — ${escHtml(vente.achat_nom || "")}
         </a>`
      : "—";

  // Fichiers
  const fichiersHtml =
    vente.fichiers?.length
      ? `<div class="flex flex-wrap gap-2">
          ${vente.fichiers
            .map((f) => {
              const isImg = f.mime_type?.startsWith("image/");
              return isImg
                ? `<div class="relative group">
                    <img src="/uploads/${f.chemin}"
                         class="h-20 w-20 object-cover rounded-lg" />
                    <button
                      class="absolute top-1 right-1 btn btn-xs btn-error
                             opacity-0 group-hover:opacity-100 transition-opacity"
                      onclick="deleteFichier(${f.id}, ${id})">✕</button>
                  </div>`
                : `<a href="/uploads/${f.chemin}" target="_blank"
                      class="btn btn-xs btn-ghost">
                     📎 ${escHtml(f.nom_original)}
                   </a>`;
            })
            .join("")}
        </div>`
      : `<p class="text-sm text-base-content/50">Aucun fichier</p>`;

  document.getElementById("detail-vente-body").innerHTML = `
    <div class="stats stats-horizontal shadow w-full">
      <div class="stat place-items-center p-3">
        <div class="stat-title text-xs">Prix vente</div>
        <div class="stat-value text-base font-bold">
          ${formatEur(vente.prix_vente)}
        </div>
      </div>
      <div class="stat place-items-center p-3">
        <div class="stat-title text-xs">Marge</div>
        <div class="stat-value text-base font-bold ${margeClass}">
          ${vente.marge != null ? formatEur(vente.marge) : "—"}
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 text-sm">
      <div>
        <div class="text-xs text-base-content/50 uppercase tracking-wide">Date</div>
        <div>${formatDate(vente.date)}</div>
      </div>
      <div>
        <div class="text-xs text-base-content/50 uppercase tracking-wide">Plateforme</div>
        <div>${escHtml(vente.plateforme || "—")}</div>
      </div>
      <div>
        <div class="text-xs text-base-content/50 uppercase tracking-wide">Catégorie</div>
        <div>${escHtml(vente.categorie || "—")}</div>
      </div>
      <div>
        <div class="text-xs text-base-content/50 uppercase tracking-wide">Source</div>
        <div>${source}</div>
      </div>
    </div>

    ${
      vente.notes
        ? `<div>
            <div class="text-xs text-base-content/50 uppercase tracking-wide mb-1">Notes</div>
            <p class="text-sm text-base-content/70">${escHtml(vente.notes)}</p>
          </div>`
        : ""
    }

    <div>
      <div class="text-xs text-base-content/50 uppercase tracking-wide mb-2">
        Fichiers joints
      </div>
      ${fichiersHtml}
      <div class="mt-3 flex gap-2 items-center">
        <input type="file" id="fichier-input"
               class="file-input file-input-bordered file-input-sm flex-1"
               accept="image/*,.pdf,.csv,.xlsx" />
        <button class="btn btn-sm btn-secondary"
                onclick="uploadFichier(${id})">
          Joindre
        </button>
      </div>
    </div>
  `;

  document.getElementById("vente-detail-modal").showModal();
};

// ── Fichiers ──────────────────────────────────────────────────────────────────

window.uploadFichier = async (venteId) => {
  const input = document.getElementById("fichier-input");
  if (!input.files.length) {
    showToast("Sélectionnez un fichier", "warning");
    return;
  }
  const form = new FormData();
  form.append("file", input.files[0]);

  const result = await apiFetch(`/api/ventes/${venteId}/fichiers`, {
    method: "POST",
    body: form,
  });
  if (result) {
    showToast("Fichier joint", "success");
    input.value = "";
    await openDetail(venteId);
  }
};

window.deleteFichier = async (fichierId, venteId) => {
  if (!confirmAction("Supprimer ce fichier ?")) return;
  const res = await apiFetch(
    `/api/ventes/${venteId}/fichiers/${fichierId}`,
    { method: "DELETE" }
  );
  if (res !== null) {
    showToast("Fichier supprimé", "success");
    await openDetail(venteId);
  }
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

init();