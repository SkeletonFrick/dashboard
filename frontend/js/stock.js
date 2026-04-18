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
async function init() {
  await loadFournisseurs();
  await loadAlertes();
  await loadStock();
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
  if (!section || !count) return;
  if (rows.length > 0) {
    section.classList.remove("hidden");
    count.textContent = rows.length;
  } else {
    section.classList.add("hidden");
  }
}

// ── Chargement liste ─────────────────────────────────────────────────────────
async function loadStock() {
  const tbody = document.getElementById("stock-tbody");
  tableLoading(tbody, 7);

  const search = document.getElementById("filter-search")?.value || "";
  const categorie = document.getElementById("filter-categorie")?.value || "";

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

  form.reset();
  if (titleEl) {
    titleEl.textContent = article ? "Modifier article" : "Nouvel article";
  }

  if (article) {
    form.nom.value = article.nom || "";
    form.categorie.value = article.categorie || "piece";
    if (form.fournisseur_id) {
      form.fournisseur_id.value = article.fournisseur_id || "";
    }
    // quantite et stock_minimal ne passent pas par StockUpdate
    // on les affiche juste en lecture dans le modal d'édition
    if (form.quantite) form.quantite.value = article.quantite ?? 0;
    if (form.stock_minimal) {
      form.stock_minimal.value = article.stock_minimal ?? 1;
    }
  }

  document.getElementById("modal-article").showModal();
};

window.submitArticle = async (e) => {
  e.preventDefault();
  const form = e.target;

  // En création : on envoie quantite (stock initial)
  // En édition : StockUpdate ignore quantite — passer par /mouvement
  const payload = STATE.editId
    ? {
        nom: form.nom.value.trim(),
        categorie: form.categorie.value || null,
        fournisseur_id: form.fournisseur_id?.value
          ? parseInt(form.fournisseur_id.value)
          : null,
        stock_minimal: parseInt(form.stock_minimal?.value) || 1,
      }
    : {
        nom: form.nom.value.trim(),
        categorie: form.categorie.value || null,
        fournisseur_id: form.fournisseur_id?.value
          ? parseInt(form.fournisseur_id.value)
          : null,
        quantite: parseInt(form.quantite?.value) || 0,
        stock_minimal: parseInt(form.stock_minimal?.value) || 1,
      };

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