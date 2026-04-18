// frontend/js/stock.js

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

// ── Injection user sidebar ───────────────────────────────────────────────────
(function () {
  const u = JSON.parse(localStorage.getItem("current_user") || "{}");
  if (u.username) {
    document.getElementById("user-name").textContent = u.username;
    document.getElementById("user-role").textContent = u.role || "";
    document.getElementById("user-initial").textContent =
      u.username[0].toUpperCase();
  }
  window.logout = logout;
})();

// ── Highlight sidebar ────────────────────────────────────────────────────────
document.querySelectorAll("[data-page]").forEach((el) => {
  if (
    el.dataset.page === "stock" ||
    window.location.pathname.includes("stock")
  ) {
    el.classList.add("active");
  }
});

// ── State ────────────────────────────────────────────────────────────────────
const STATE = {
  page: 1,
  perPage: 50,
  total: 0,
  editId: null,
  alerteOnly: false,
  fournisseurs: [],
};

// ── Init ─────────────────────────────────────────────────────────────────────
// frontend/js/stock.js
// Remplacer init() pour charger les filtres sauvegardés

async function init() {
  _restoreFilters();
  await loadFournisseurs();
  await loadCategories();
  await loadAlertes();
  await loadStock();
}

function _restoreFilters() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("stock_filters") || "{}"
    );
    const searchEl = document.getElementById("filter-search");
    const catEl = document.getElementById("filter-categorie");
    if (searchEl && saved.search) searchEl.value = saved.search;
    if (catEl && saved.categorie) catEl.value = saved.categorie;
    if (saved.alerteOnly) STATE.alerteOnly = saved.alerteOnly;
  } catch {
    // Silencieux
  }
}

function _saveFilters() {
  localStorage.setItem(
    "stock_filters",
    JSON.stringify({
      search: document.getElementById("filter-search")?.value || "",
      categorie: document.getElementById("filter-categorie")?.value || "",
      alerteOnly: STATE.alerteOnly,
    })
  );
}

async function loadFournisseurs() {
  const data = await apiFetch("/api/fournisseurs?limit=200").catch(() => null);
  STATE.fournisseurs = data?.items || [];
  const sel = document.getElementById("form-fournisseur");
  if (!sel) return;
  STATE.fournisseurs.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.nom;
    sel.appendChild(opt);
  });
}

async function loadAlertes() {
  const rows = await apiFetch("/api/stock/alertes").catch(() => []);
  const section = document.getElementById("alertes-section");
  const count = document.getElementById("alerte-count");
  const bandeau = document.getElementById("alertes-bandeau");

  // ── Compteur navbar ───────────────────────────────────────────────────────
  if (section && count) {
    if (rows.length > 0) {
      section.classList.remove("hidden");
      count.textContent = rows.length;
    } else {
      section.classList.add("hidden");
    }
  }

  // ── Bandeau alertes visuelles ─────────────────────────────────────────────
  if (!bandeau) return;

  const ruptures = rows.filter((r) => r.quantite === 0);
  const bas = rows.filter((r) => r.quantite > 0);

  const alertes = [];

  if (ruptures.length > 0) {
    const noms = ruptures
      .slice(0, 3)
      .map((r) => `<strong>${escHtml(r.nom)}</strong>`)
      .join(", ");
    const suite =
      ruptures.length > 3 ? ` et ${ruptures.length - 3} autre(s)` : "";
    alertes.push(`
      <div class="alert alert-error shadow-sm py-2 text-sm">
        <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
             viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0
                   001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2
                   2 0 00-3.42 0z"/>
        </svg>
        <span>
          🚨 Rupture totale : ${noms}${suite}
        </span>
      </div>`);
  }

  if (bas.length > 0) {
    const noms = bas
      .slice(0, 3)
      .map(
        (r) =>
          `<strong>${escHtml(r.nom)}</strong>
           <span class="opacity-70">(${r.quantite}/${r.stock_minimal})</span>`
      )
      .join(", ");
    const suite = bas.length > 3 ? ` et ${bas.length - 3} autre(s)` : "";
    alertes.push(`
      <div class="alert alert-warning shadow-sm py-2 text-sm">
        <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
             viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0
                   001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2
                   2 0 00-3.42 0z"/>
        </svg>
        <span>
          ⚠️ Stock bas : ${noms}${suite}
        </span>
      </div>`);
  }

  // Commandes en retard
  const retard = await apiFetch("/api/stock/commandes-en-retard").catch(
    () => []
  );
  if (retard.length > 0) {
    const noms = retard
      .slice(0, 3)
      .map(
        (r) =>
          `<strong>${escHtml(r.nom)}</strong>
           <span class="opacity-70">(prévu : ${formatDate(r.date_arrivee_prevue)})</span>`
      )
      .join(", ");
    const suite =
      retard.length > 3 ? ` et ${retard.length - 3} autre(s)` : "";
    alertes.push(`
      <div class="alert alert-info shadow-sm py-2 text-sm">
        <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor"
             viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>
          📦 Commande(s) en retard : ${noms}${suite}
        </span>
      </div>`);
  }

  bandeau.innerHTML = alertes.join("");
  bandeau.classList.toggle("hidden", alertes.length === 0);
}

// ── Chargement liste ─────────────────────────────────────────────────────────
// frontend/js/stock.js
// Remplacer loadStock() pour sauvegarder les filtres

// ✅ AJOUTER une fonction loadCategories() dans init()

async function loadCategories() {
  const data = await apiFetch("/api/stock/categories").catch(() => []);
  const sel = document.getElementById("filter-categorie");
  if (!sel) return;
  data.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    sel.appendChild(opt);
  });
}

async function loadStock() {
  const tbody = document.getElementById("stock-tbody");
  tableLoading(tbody, 7);

  const search = document.getElementById("filter-search")?.value || "";
  const categorie = document.getElementById("filter-categorie")?.value || "";

  _saveFilters();   // ✅ persistance

  const params = new URLSearchParams({
    page: STATE.page,
    per_page: STATE.perPage,
    search,
    categorie,
    alerte_seulement: STATE.alerteOnly,
  });

  const data = await apiFetch(`/api/stock?${params}`).catch(() => null);
  if (!data) {
    tableEmpty(tbody, 7, "Erreur de chargement");
    return;
  }

  STATE.total = data.total;
  renderTable(data.items);
  renderPagination();
}
// ── Rendu tableau ─────────────────────────────────────────────────────────────
function renderTable(items) {
  const tbody = document.getElementById("stock-tbody");
  if (!items.length) {
    tableEmpty(tbody, 7, "Aucun article en stock");
    return;
  }

  tbody.innerHTML = items
    .map((a) => {
      const alerte = a.quantite <= a.stock_minimal;

      const qteBadge = alerte
        ? `<span class="badge badge-error badge-sm font-bold">${a.quantite}</span>`
        : `<span class="badge badge-success badge-sm">${a.quantite}</span>`;

      const commandeBadge = a.commande_en_cours
        ? `<span class="badge badge-info badge-xs ml-1">Commandé</span>`
        : "";

      // Sérialisation sécurisée pour le passage en onclick
      const articleJson = escHtml(JSON.stringify(a));

      return `
        <tr class="${alerte ? "bg-error/5" : ""}">
          <td class="font-medium">${escHtml(a.nom)}</td>
          <td>
            <span class="badge badge-ghost badge-sm">
              ${escHtml(a.categorie || "—")}
            </span>
          </td>
          <td class="text-center">${qteBadge}</td>
          <td class="text-center text-base-content/60">${a.stock_minimal}</td>
          <td>${escHtml(a.fournisseur_nom || "—")}</td>
          <td>
            ${alerte && !a.commande_en_cours
              ? `<span class="badge badge-warning badge-xs">Alerte</span>`
              : ""}
            ${commandeBadge}
            ${!alerte && !a.commande_en_cours
              ? `<span class="badge badge-ghost badge-xs">OK</span>`
              : ""}
          </td>
          <td class="text-right">
            <div class="join">
              <button
                class="join-item btn btn-xs btn-ghost"
                onclick="openDetail(${a.id})"
              >Détail</button>
              <button
                class="join-item btn btn-xs btn-ghost"
                onclick="openArticleModal(JSON.parse(this.dataset.article))"
                data-article="${articleJson}"
              >✏️</button>
              ${a.commande_en_cours
                ? `<button
                    class="join-item btn btn-xs btn-accent"
                    onclick="receptionner(${a.id})"
                  >Réceptionner</button>`
                : `<button
                    class="join-item btn btn-xs btn-outline"
                    onclick="toggleCommande(${a.id}, true)"
                  >Commander</button>`
              }
              <button
                class="join-item btn btn-xs btn-error btn-outline"
                onclick="deleteArticle(${a.id})"
              >🗑</button>
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination() {
  const totalPages = Math.ceil(STATE.total / STATE.perPage);
  const infoEl = document.getElementById("pagination-info");
  const prevEl = document.getElementById("btn-prev");
  const nextEl = document.getElementById("btn-next");

  if (infoEl) {
    infoEl.textContent =
      `${STATE.total} article(s) — page ${STATE.page}/${totalPages || 1}`;
  }
  if (prevEl) prevEl.disabled = STATE.page <= 1;
  if (nextEl) nextEl.disabled = STATE.page >= totalPages;
}

window.changePage = (delta) => {
  STATE.page = Math.max(1, STATE.page + delta);
  loadStock();
};

// ── Filtres ───────────────────────────────────────────────────────────────────
let searchTimer = null;

window.debouncedSearch = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    STATE.page = 1;
    loadStock();
  }, 350);
};

window.resetFilters = () => {
  const searchEl = document.getElementById("filter-search");
  const catEl = document.getElementById("filter-categorie");
  const btnEl = document.getElementById("btn-alerte-filter");
  if (searchEl) searchEl.value = "";
  if (catEl) catEl.value = "";
  if (btnEl) btnEl.textContent = "Voir uniquement";
  STATE.alerteOnly = false;
  STATE.page = 1;
  loadStock();
};

window.toggleAlerteFilter = () => {
  STATE.alerteOnly = !STATE.alerteOnly;
  STATE.page = 1;
  const btnEl = document.getElementById("btn-alerte-filter");
  if (btnEl) {
    btnEl.textContent = STATE.alerteOnly ? "Voir tout" : "Voir uniquement";
  }
  loadStock();
};

// ── Modal article (création / édition) ───────────────────────────────────────
window.openArticleModal = (article = null) => {
  STATE.editId = article?.id || null;
  const form = document.getElementById("form-article");
  const titleEl = document.getElementById("modal-article-title");
  const qteField = document.getElementById("field-quantite");
  const qteWarning = document.getElementById("qte-warning");

  form.reset();

  if (article) {
    // ── Mode édition ──────────────────────────────────────────────────────
    if (titleEl) titleEl.textContent = "Modifier l'article";

    form.nom.value = article.nom || "";
    form.categorie.value = article.categorie || "piece";
    if (form.fournisseur_id) {
      form.fournisseur_id.value = article.fournisseur_id || "";
    }
    if (form.stock_minimal) {
      form.stock_minimal.value = article.stock_minimal ?? 1;
    }
    if (form.reference) form.reference.value = article.reference || "";
    if (form.emplacement) form.emplacement.value = article.emplacement || "";
    if (form.notes) form.notes.value = article.notes || "";

    // En édition : masquer le champ quantite, afficher l'avertissement
    if (qteField) qteField.classList.add("hidden");
    if (qteWarning) qteWarning.classList.remove("hidden");
  } else {
    // ── Mode création ─────────────────────────────────────────────────────
    if (titleEl) titleEl.textContent = "Nouvel article";
    if (qteField) qteField.classList.remove("hidden");
    if (qteWarning) qteWarning.classList.add("hidden");
  }

  document.getElementById("modal-article").showModal();
};

window.submitArticle = async (e) => {
  e.preventDefault();
  const form = e.target;

  let payload;

  if (STATE.editId) {
    // ── PUT — quantite absent de StockUpdate, on ne l'envoie pas ──────────
    payload = {
      nom: form.nom.value.trim(),
      categorie: form.categorie.value || null,
      fournisseur_id: form.fournisseur_id?.value
        ? parseInt(form.fournisseur_id.value)
        : null,
      stock_minimal: parseInt(form.stock_minimal?.value) || 1,
      reference: form.reference?.value.trim() || null,
      emplacement: form.emplacement?.value.trim() || null,
      notes: form.notes?.value.trim() || null,
    };
  } else {
    // ── POST — quantite autorisé en création ──────────────────────────────
    payload = {
      nom: form.nom.value.trim(),
      categorie: form.categorie.value || null,
      fournisseur_id: form.fournisseur_id?.value
        ? parseInt(form.fournisseur_id.value)
        : null,
      quantite: parseInt(form.quantite?.value) || 0,
      stock_minimal: parseInt(form.stock_minimal?.value) || 1,
      reference: form.reference?.value.trim() || null,
      emplacement: form.emplacement?.value.trim() || null,
      notes: form.notes?.value.trim() || null,
    };
  }

  const url = STATE.editId ? `/api/stock/${STATE.editId}` : "/api/stock";
  const method = STATE.editId ? "PUT" : "POST";

  try {
    await apiFetch(url, { method, body: JSON.stringify(payload) });
    showToast(
      STATE.editId ? "Article mis à jour" : "Article créé",
      "success"
    );
    document.getElementById("modal-article").close();
    await loadAlertes();
    await loadStock();
  } catch (err) {
    showToast(err.message || "Erreur lors de l'enregistrement", "error");
  }
};
// ── Suppression ───────────────────────────────────────────────────────────────
window.deleteArticle = async (id) => {
  if (!confirmAction("Archiver cet article ? Il ne sera plus visible dans le stock.")) {
    return;
  }
  try {
    await apiFetch(`/api/stock/${id}`, { method: "DELETE" });
    showToast("Article archivé", "success");
    await loadAlertes();
    await loadStock();
  } catch (err) {
    showToast(err.message || "Erreur lors de la suppression", "error");
  }
};

// ── Commande ──────────────────────────────────────────────────────────────────
window.toggleCommande = async (id, state) => {
  try {
    await apiFetch(`/api/stock/${id}/commande`, {
      method: "PATCH",
      body: JSON.stringify({ commande_en_cours: state }),
    });
    showToast(state ? "Marqué comme commandé" : "Commande annulée", "info");
    await loadAlertes();
    await loadStock();
  } catch (err) {
    showToast(err.message || "Erreur", "error");
  }
};

window.receptionner = async (id) => {
  const qteStr = prompt("Quantité reçue ?", "1");
  if (!qteStr) return;
  const qte = parseInt(qteStr);
  if (isNaN(qte) || qte < 1) {
    showToast("Quantité invalide", "warning");
    return;
  }
  try {
    await apiFetch(`/api/stock/${id}/receptionner?quantite=${qte}`, {
      method: "POST",
    });
    showToast("Stock mis à jour ✓", "success");
    await loadAlertes();
    await loadStock();
  } catch (err) {
    showToast(err.message || "Erreur réception", "error");
  }
};

// ── Détail + mouvements ───────────────────────────────────────────────────────
window.openDetail = async (id) => {
  const detailContent = document.getElementById("detail-content");
  const mouvContent = document.getElementById("mouvements-content");
  const stockIdInput = document.getElementById("mouvement-stock-id");

  detailContent.innerHTML = `
    <div class="flex justify-center py-4">
      <span class="loading loading-spinner"></span>
    </div>`;
  mouvContent.innerHTML = "";
  stockIdInput.value = id;

  document.getElementById("modal-detail").showModal();

  try {
    const [article, mouvs] = await Promise.all([
      apiFetch(`/api/stock/${id}`),
      apiFetch(`/api/stock/${id}/mouvements`),
    ]);

    document.getElementById("detail-title").textContent = article.nom;

    const alerte = article.quantite <= article.stock_minimal;

    detailContent.innerHTML = `
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span class="text-base-content/50 text-xs uppercase">Catégorie</span>
          <p class="font-medium">${escHtml(article.categorie || "—")}</p>
        </div>
        <div>
          <span class="text-base-content/50 text-xs uppercase">Quantité</span>
          <p class="font-bold text-lg ${alerte ? "text-error" : "text-success"}">
            ${article.quantite}
          </p>
        </div>
        <div>
          <span class="text-base-content/50 text-xs uppercase">Seuil minimal</span>
          <p>${article.stock_minimal}</p>
        </div>
        <div>
          <span class="text-base-content/50 text-xs uppercase">Fournisseur</span>
          <p>${escHtml(article.fournisseur_nom || "—")}</p>
        </div>
        <div>
          <span class="text-base-content/50 text-xs uppercase">Référence</span>
          <p>${escHtml(article.reference || "—")}</p>
        </div>
        <div>
          <span class="text-base-content/50 text-xs uppercase">Emplacement</span>
          <p>${escHtml(article.emplacement || "—")}</p>
        </div>
        <div>
          <span class="text-base-content/50 text-xs uppercase">Commande en cours</span>
          <p>${article.commande_en_cours ? "✅ Oui" : "Non"}</p>
        </div>
        ${article.commande_en_cours && article.quantite_commandee
          ? `<div>
              <span class="text-base-content/50 text-xs uppercase">Qté commandée</span>
              <p>${article.quantite_commandee}</p>
            </div>`
          : ""}
        ${article.notes
          ? `<div class="col-span-2">
              <span class="text-base-content/50 text-xs uppercase">Notes</span>
              <p class="text-sm">${escHtml(article.notes)}</p>
            </div>`
          : ""}
      </div>`;

    // Mouvements
    const items = mouvs.items || [];
    if (!items.length) {
      mouvContent.innerHTML = `
        <p class="text-sm text-base-content/50 py-2">
          Aucun mouvement enregistré.
        </p>`;
    } else {
      const typeClass = {
        entree: "badge-success",
        sortie: "badge-error",
        correction: "badge-warning",
      };

      mouvContent.innerHTML = `
        <div class="overflow-x-auto max-h-48">
          <table class="table table-xs">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Qté</th>
                <th>Motif</th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map(
                  (m) => `
                <tr>
                  <td class="whitespace-nowrap">${formatDate(m.created_at)}</td>
                  <td>
                    <span class="badge badge-xs ${typeClass[m.type_mouvement] ?? "badge-ghost"}">
                      ${escHtml(m.type_mouvement)}
                    </span>
                  </td>
                  <td>${m.quantite}</td>
                  <td>${escHtml(m.motif || "—")}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>`;
    }
  } catch (err) {
    detailContent.innerHTML = `
      <p class="text-error text-sm">Erreur de chargement : ${escHtml(err.message)}</p>`;
  }
};

// ── Mouvement manuel ──────────────────────────────────────────────────────────
window.submitMouvement = async (e) => {
  e.preventDefault();
  const form = e.target;
  const stockId = document.getElementById("mouvement-stock-id").value;

  const payload = {
    type_mouvement: form.type_mouvement.value,
    quantite: parseInt(form.quantite.value),
    motif: form.motif.value.trim() || null,
  };

  if (!payload.quantite || payload.quantite < 0) {
    showToast("Quantité invalide", "warning");
    return;
  }

  try {
    await apiFetch(`/api/stock/${stockId}/mouvement`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast("Mouvement enregistré", "success");
    form.reset();
    await openDetail(parseInt(stockId));
    await loadAlertes();
    await loadStock();
  } catch (err) {
    showToast(err.message || "Erreur mouvement", "error");
  }
};

// ── Démarrage ─────────────────────────────────────────────────────────────────
init();