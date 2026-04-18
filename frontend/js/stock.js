import { requireAuth, logout } from "./auth.js";
import {
  apiFetch,
  showToast,
  formatDate,
  tableLoading,
  tableEmpty,
  confirmAction,
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
  const data = await apiFetch("/api/fournisseurs?per_page=200").catch(
    () => null
  );
  STATE.fournisseurs = data?.items || [];
  const sel = document.getElementById("form-fournisseur");
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
  if (rows.length > 0) {
    section.classList.remove("hidden");
    count.textContent = rows.length;
  } else {
    section.classList.add("hidden");
  }
}

// ── Load liste ───────────────────────────────────────────────────────────────
async function loadStock() {
  const tbody = document.getElementById("stock-tbody");
  tableLoading(tbody, 7);

  const search = document.getElementById("filter-search").value;
  const categorie = document.getElementById("filter-categorie").value;

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

      return `<tr class="${alerte ? "bg-error/5" : ""}">
        <td class="font-medium">${escHtml(a.nom)}</td>
        <td><span class="badge badge-ghost badge-sm">${escHtml(a.categorie)}</span></td>
        <td class="text-center">${qteBadge}</td>
        <td class="text-center text-base-content/60">${a.stock_minimal}</td>
        <td>${escHtml(a.fournisseur_nom || "—")}</td>
        <td>
          ${alerte && !a.commande_en_cours ? `<span class="badge badge-warning badge-xs">Alerte</span>` : ""}
          ${commandeBadge}
          ${!alerte && !a.commande_en_cours ? `<span class="badge badge-ghost badge-xs">OK</span>` : ""}
        </td>
        <td class="text-right">
          <div class="join">
            <button class="join-item btn btn-xs btn-ghost"
              onclick="openDetail(${a.id})">Détail</button>
            <button class="join-item btn btn-xs btn-ghost"
              onclick="openArticleModal(${JSON.stringify(a).replace(/"/g, "&quot;")})">✏️</button>
            ${
              a.commande_en_cours
                ? `<button class="join-item btn btn-xs btn-accent"
                onclick="receptionner(${a.id})">Réceptionner</button>`
                : `<button class="join-item btn btn-xs btn-outline"
                onclick="toggleCommande(${a.id}, true)">Commander</button>`
            }
            <button class="join-item btn btn-xs btn-error btn-outline"
              onclick="deleteArticle(${a.id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function renderPagination() {
  const totalPages = Math.ceil(STATE.total / STATE.perPage);
  document.getElementById("pagination-info").textContent =
    `${STATE.total} article(s) — page ${STATE.page}/${totalPages || 1}`;
  document.getElementById("btn-prev").disabled = STATE.page <= 1;
  document.getElementById("btn-next").disabled = STATE.page >= totalPages;
}

window.changePage = (delta) => {
  STATE.page = Math.max(1, STATE.page + delta);
  loadStock();
};

// ── Filtres ──────────────────────────────────────────────────────────────────
let searchTimer = null;
window.debouncedSearch = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    STATE.page = 1;
    loadStock();
  }, 350);
};

window.resetFilters = () => {
  document.getElementById("filter-search").value = "";
  document.getElementById("filter-categorie").value = "";
  STATE.alerteOnly = false;
  STATE.page = 1;
  document.getElementById("btn-alerte-filter").textContent = "Voir uniquement";
  loadStock();
};

window.toggleAlerteFilter = () => {
  STATE.alerteOnly = !STATE.alerteOnly;
  STATE.page = 1;
  document.getElementById("btn-alerte-filter").textContent = STATE.alerteOnly
    ? "Voir tout"
    : "Voir uniquement";
  loadStock();
};

// ── Modal article ────────────────────────────────────────────────────────────
window.openArticleModal = (article = null) => {
  STATE.editId = article?.id || null;
  const form = document.getElementById("form-article");
  form.reset();
  document.getElementById("modal-article-title").textContent = article
    ? "Modifier article"
    : "Nouvel article";

  if (article) {
    form.nom.value = article.nom || "";
    form.categorie.value = article.categorie || "piece";
    form.fournisseur_id.value = article.fournisseur_id || "";
    form.quantite.value = article.quantite ?? 0;
    form.stock_minimal.value = article.stock_minimal ?? 1;
  }
  document.getElementById("modal-article").showModal();
};

window.submitArticle = async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    nom: form.nom.value.trim(),
    categorie: form.categorie.value,
    fournisseur_id: form.fournisseur_id.value
      ? parseInt(form.fournisseur_id.value)
      : null,
    quantite: parseInt(form.quantite.value) || 0,
    stock_minimal: parseInt(form.stock_minimal.value) || 1,
  };

  const url = STATE.editId ? `/api/stock/${STATE.editId}` : "/api/stock";
  const method = STATE.editId ? "PUT" : "POST";

  const res = await apiFetch(url, {
    method,
    body: JSON.stringify(payload),
  }).catch(() => null);

  if (res !== null) {
    showToast(
      STATE.editId ? "Article mis à jour" : "Article créé",
      "success"
    );
    document.getElementById("modal-article").close();
    await loadAlertes();
    await loadStock();
  }
};

// ── Suppression ──────────────────────────────────────────────────────────────
window.deleteArticle = async (id) => {
  if (!confirmAction("Supprimer cet article ?")) return;
  await apiFetch(`/api/stock/${id}`, { method: "DELETE" });
  showToast("Article supprimé", "success");
  await loadAlertes();
  await loadStock();
};

// ── Commande ─────────────────────────────────────────────────────────────────
window.toggleCommande = async (id, state) => {
  await apiFetch(`/api/stock/${id}/commande`, {
    method: "PATCH",
    body: JSON.stringify({ commande_en_cours: state }),
  });
  showToast(state ? "Marqué comme commandé" : "Commande annulée", "info");
  await loadAlertes();
  await loadStock();
};

window.receptionner = async (id) => {
  const qte = prompt("Quantité reçue ?", "1");
  if (!qte || isNaN(parseInt(qte))) return;
  const res = await apiFetch(
    `/api/stock/${id}/receptionner?quantite=${parseInt(qte)}`,
    { method: "POST" }
  ).catch(() => null);
  if (res) {
    showToast("Stock mis à jour ✓", "success");
    await loadAlertes();
    await loadStock();
  }
};

// ── Détail + mouvements ──────────────────────────────────────────────────────
window.openDetail = async (id) => {
  document.getElementById("detail-content").innerHTML =
    `<div class="flex justify-center py-4">
      <span class="loading loading-spinner"></span>
    </div>`;
  document.getElementById("mouvements-content").innerHTML = "";
  document.getElementById("mouvement-stock-id").value = id;
  document.getElementById("modal-detail").showModal();

  const [article, mouvs] = await Promise.all([
    apiFetch(`/api/stock/${id}`),
    apiFetch(`/api/stock/${id}/mouvements`),
  ]);

  document.getElementById("detail-title").textContent = article.nom;

  const alerte = article.quantite <= article.stock_minimal;
  document.getElementById("detail-content").innerHTML = `
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div><span class="text-base-content/50">Catégorie</span>
        <p class="font-medium">${escHtml(article.categorie)}</p></div>
      <div><span class="text-base-content/50">Quantité</span>
        <p class="font-bold text-lg ${alerte ? "text-error" : "text-success"}">
          ${article.quantite}
        </p></div>
      <div><span class="text-base-content/50">Seuil minimal</span>
        <p>${article.stock_minimal}</p></div>
      <div><span class="text-base-content/50">Fournisseur</span>
        <p>${escHtml(article.fournisseur_nom || "—")}</p></div>
      <div><span class="text-base-content/50">Commande en cours</span>
        <p>${article.commande_en_cours ? "✅ Oui" : "Non"}</p></div>
    </div>`;

  const items = mouvs.items || [];
  if (!items.length) {
    document.getElementById("mouvements-content").innerHTML =
      `<p class="text-sm text-base-content/50">Aucun mouvement enregistré.</p>`;
  } else {
    document.getElementById("mouvements-content").innerHTML = `
      <div class="overflow-x-auto max-h-48">
        <table class="table table-xs">
          <thead><tr>
            <th>Date</th><th>Type</th><th>Qté</th><th>Motif</th>
          </tr></thead>
          <tbody>
            ${items
              .map(
                (m) => `<tr>
              // Ligne à corriger dans renderTable / openDetail
<td>${formatDate(m.created_at)}</td>  // ← était m.date
              <td>
                <span class="badge badge-xs ${
                  m.type_mouvement === "entree"
                    ? "badge-success"
                    : m.type_mouvement === "sortie"
                      ? "badge-error"
                      : "badge-warning"
                }">
                  ${m.type_mouvement}
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
};

window.submitMouvement = async (e) => {
  e.preventDefault();
  const form = e.target;
  const stockId = document.getElementById("mouvement-stock-id").value;
  const payload = {
    type_mouvement: form.type_mouvement.value,
    quantite: parseInt(form.quantite.value),
    motif: form.motif.value || null,
  };

  const res = await apiFetch(`/api/stock/${stockId}/mouvement`, {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch(() => null);

  if (res !== null) {
    showToast("Mouvement enregistré", "success");
    form.reset();
    await openDetail(parseInt(stockId));
    await loadAlertes();
    await loadStock();
  }
};

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();