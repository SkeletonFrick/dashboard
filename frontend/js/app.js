// ── Helpers globaux ────────────────────────────────────────────────────────

/**
 * fetch authentifié — redirige vers login si 401
 * @param {string} url
 * @param {RequestInit} options
 */
async function apiFetch(url, options = {}) {
  const { authFetch, getToken, clearToken } = await import("./auth.js");
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
    container.className = "toast toast-end toast-bottom z-50";
    document.body.appendChild(container);
  }

  const alert = document.createElement("div");
  const colorMap = {
    success: "alert-success",
    error: "alert-error",
    warning: "alert-warning",
    info: "alert-info",
  };
  alert.className = `alert ${colorMap[type] ?? "alert-info"} shadow-lg text-sm`;
  alert.innerHTML = `<span>${message}</span>`;
  container.appendChild(alert);

  setTimeout(() => alert.remove(), duration);
}

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
  return d.toLocaleDateString("fr-FR");
}

/**
 * Retourne un badge DaisyUI coloré selon statut
 * @param {string} statut
 * @param {Record<string, string>} map  ex: { vendu: 'badge-success' }
 */
function statutBadge(statut, map = {}) {
  const cls = map[statut] ?? "badge-ghost";
  return `<span class="badge ${cls} badge-sm">${statut.replace(/_/g, " ")}</span>`;
}

/**
 * Vide un <tbody> et affiche une ligne "chargement…"
 * @param {HTMLElement} tbody
 * @param {number} colspan
 */
function tableLoading(tbody, colspan = 5) {
  tbody.innerHTML = `
    <tr>
      <td colspan="${colspan}" class="text-center py-8 text-base-content/50">
        <span class="loading loading-spinner loading-sm mr-2"></span>Chargement…
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
      <td colspan="${colspan}" class="text-center py-8 text-base-content/40">
        ${message}
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

export {
  apiFetch,
  showToast,
  formatEur,
  formatDate,
  statutBadge,
  tableLoading,
  tableEmpty,
  confirmAction,
};