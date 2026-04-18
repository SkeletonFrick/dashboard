// frontend/js/app.js

// ── Fetch authentifié ─────────────────────────────────────────────────────────

/**
 * fetch authentifié — redirige vers login si 401
 * @param {string} url
 * @param {RequestInit} options
 */
async function apiFetch(url, options = {}) {
  const { getToken, clearToken } = await import("./auth.js");
  const { headers: extraHeaders = {}, body, ...rest } = options;

  const headers = {
    Authorization: `Bearer ${getToken()}`,
    ...(typeof body === "string"
      ? { "Content-Type": "application/json" }
      : {}),
    ...extraHeaders,
  };

  const res = await fetch(url, { ...rest, headers, body });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login.html";
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Erreur serveur");
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Toast ─────────────────────────────────────────────────────────────────────

/**
 * Affiche un toast DaisyUI (injecté dynamiquement)
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration ms
 */
function showToast(message, type = "info", duration = 3500) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const colorMap = {
    success: "alert-success",
    error: "alert-error",
    warning: "alert-warning",
    info: "alert-info",
  };

  const alert = document.createElement("div");
  alert.className = `alert ${colorMap[type] ?? "alert-info"} shadow-lg text-sm`;
  alert.innerHTML = `<span>${escHtml(message)}</span>`;
  container.appendChild(alert);

  setTimeout(() => alert.remove(), duration);
}

// ── Formatage ─────────────────────────────────────────────────────────────────

/**
 * Formate un montant en euros
 * @param {number} value
 */
function formatEur(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value ?? 0);
}

/**
 * Formate une date ISO en dd/mm/yyyy
 * @param {string} iso
 */
function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
}

/**
 * Formate une taille en octets lisible
 * @param {number} bytes
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Retourne un badge DaisyUI coloré selon statut
 * @param {string} statut
 * @param {Record<string, string>} colorMap   ex: { vendu: 'badge-success' }
 * @param {Record<string, string>} labelMap   ex: { vendu: 'Vendu' }
 */
function statutBadge(statut, colorMap = {}, labelMap = {}) {
  const cls = colorMap[statut] ?? "badge-ghost";
  const label = labelMap[statut] ?? statut.replace(/_/g, " ");
  return `<span class="badge ${cls} badge-sm">${escHtml(label)}</span>`;
}

/**
 * Vide un <tbody> et affiche une ligne "chargement…"
 * @param {HTMLElement} tbody
 * @param {number} colspan
 */
function tableLoading(tbody, colspan = 5) {
  tbody.innerHTML = `
    <tr>
      <td colspan="${colspan}"
          class="text-center py-8 text-base-content/50">
        <span class="loading loading-spinner loading-sm mr-2"></span>
        Chargement…
      </td>
    </tr>`;
}

/**
 * Affiche une ligne "aucun résultat" dans un <tbody>
 * @param {HTMLElement} tbody
 * @param {number} colspan
 * @param {string} message
 */
function tableEmpty(tbody, colspan = 5, message = "Aucun résultat") {
  tbody.innerHTML = `
    <tr>
      <td colspan="${colspan}"
          class="text-center py-8 text-base-content/40">
        ${escHtml(message)}
      </td>
    </tr>`;
}

/**
 * Confirme une action destructrice via dialog natif
 * @param {string} message
 */
function confirmAction(message = "Confirmer cette action ?") {
  return window.confirm(message);
}

/**
 * Sanitise une chaîne pour injection HTML
 * @param {string} str
 */
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Pagination ────────────────────────────────────────────────────────────────

/**
 * Génère le HTML d'une pagination DaisyUI complète
 * @param {object} opts
 * @param {number} opts.total
 * @param {number} opts.page        page courante (base 1)
 * @param {number} opts.perPage
 * @param {string} opts.onChangeFn  nom de la fonction globale à appeler ex: "changePage"
 */
function renderPaginationHTML({ total, page, perPage, onChangeFn }) {
  const totalPages = Math.ceil(total / perPage);
  const from = total ? (page - 1) * perPage + 1 : 0;
  const to = Math.min(page * perPage, total);

  return `
    <span class="text-sm text-base-content/50">
      ${from}–${to} sur ${total}
    </span>
    <div class="join">
      <button
        class="join-item btn btn-sm"
        ${page <= 1 ? "disabled" : ""}
        onclick="${escHtml(onChangeFn)}(-1)"
      >«</button>
      <button class="join-item btn btn-sm no-animation">
        ${page} / ${totalPages || 1}
      </button>
      <button
        class="join-item btn btn-sm"
        ${page >= totalPages ? "disabled" : ""}
        onclick="${escHtml(onChangeFn)}(1)"
      >»</button>
    </div>`;
}

// ── Miniatures images ─────────────────────────────────────────────────────────

/**
 * Retourne une balise <img> miniature cliquable ou un placeholder
 * @param {string} chemin   chemin stocké en DB (ex: data/uploads/flip/1/xxx.jpg)
 * @param {string} alt
 * @param {string} size     classes Tailwind ex: "w-12 h-12"
 */
function imgThumb(chemin, alt = "", size = "w-12 h-12") {
  if (!chemin) {
    return `
      <div class="${size} rounded bg-base-200 flex items-center
                   justify-center text-base-content/30 text-xs
                   shrink-0">
        📎
      </div>`;
  }
  const src = `/uploads/${chemin.replace(/^data\/uploads\//, "")}`;
  return `
    <img
      src="${src}"
      alt="${escHtml(alt)}"
      class="${size} object-cover rounded cursor-pointer shrink-0"
      loading="lazy"
      onerror="this.replaceWith(Object.assign(document.createElement('div'),
        {className:'${size} rounded bg-base-200 flex items-center justify-center text-xs',
         textContent:'📎'}))"
      onclick="window.open('${src}','_blank')"
    />`;
}

// ── Filtres persistants ───────────────────────────────────────────────────────

/**
 * Sauvegarde les filtres d'une page dans localStorage
 * @param {string} pageKey   ex: "stock", "achats", "reparations"
 * @param {Record<string, any>} filters
 */
function saveFilters(pageKey, filters) {
  try {
    localStorage.setItem(`filters_${pageKey}`, JSON.stringify(filters));
  } catch {
    // Silencieux — localStorage indisponible
  }
}

/**
 * Restaure les filtres d'une page depuis localStorage
 * @param {string} pageKey
 * @returns {Record<string, any>}
 */
function loadFilters(pageKey) {
  try {
    return JSON.parse(
      localStorage.getItem(`filters_${pageKey}`) || "{}"
    );
  } catch {
    return {};
  }
}

/**
 * Efface les filtres sauvegardés d'une page
 * @param {string} pageKey
 */
function clearFilters(pageKey) {
  try {
    localStorage.removeItem(`filters_${pageKey}`);
  } catch {
    // Silencieux
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  apiFetch,
  showToast,
  formatEur,
  formatDate,
  formatBytes,
  statutBadge,
  tableLoading,
  tableEmpty,
  confirmAction,
  escHtml,
  renderPaginationHTML,
  imgThumb,
  saveFilters,
  loadFilters,
  clearFilters,
};