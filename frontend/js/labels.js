import { apiFetch, showToast } from "./app.js";

// ── État ──────────────────────────────────────────────────────────────────────

const STATE = {
  selected: new Set(),
  type_entite: null, // "flip" | "reparation"
};

// ── Impression unitaire ───────────────────────────────────────────────────────

/**
 * Impression directe d'une seule étiquette
 * @param {number} id
 * @param {"flip"|"reparation"} type_entite
 */
export async function printLabel(id, type_entite) {
  try {
    await _sendAndOpen([id], type_entite);
  } catch (e) {
    showToast(e.message || "Erreur impression", "error");
  }
}

// ── Sélection multiple ────────────────────────────────────────────────────────

/**
 * À appeler quand une checkbox de ligne est cochée/décochée
 * @param {number} id
 * @param {"flip"|"reparation"} type_entite
 * @param {boolean} checked
 */
export function toggleSelection(id, type_entite, checked) {
  // Si on change de type, on réinitialise
  if (STATE.type_entite && STATE.type_entite !== type_entite) {
    STATE.selected.clear();
  }
  STATE.type_entite = type_entite;

  if (checked) {
    STATE.selected.add(id);
  } else {
    STATE.selected.delete(id);
  }

  _updateFloatingBar();
}

/**
 * Tout sélectionner / désélectionner
 * @param {"flip"|"reparation"} type_entite
 * @param {number[]} ids
 * @param {boolean} checked
 */
export function toggleSelectAll(type_entite, ids, checked) {
  STATE.type_entite = type_entite;
  if (checked) {
    ids.forEach((id) => STATE.selected.add(id));
  } else {
    ids.forEach((id) => STATE.selected.delete(id));
    if (STATE.selected.size === 0) STATE.type_entite = null;
  }
  _updateFloatingBar();
}

/**
 * Réinitialise la sélection (à appeler après rechargement du tableau)
 */
export function clearSelection() {
  STATE.selected.clear();
  STATE.type_entite = null;
  _updateFloatingBar();
}

/**
 * Retourne true si l'id est sélectionné (pour pré-cocher les checkboxes)
 * @param {number} id
 */
export function isSelected(id) {
  return STATE.selected.has(id);
}

// ── Impression multi-sélection ────────────────────────────────────────────────

export async function printSelected() {
  if (!STATE.selected.size) {
    showToast("Aucun élément sélectionné", "warning");
    return;
  }
  try {
    await _sendAndOpen([...STATE.selected], STATE.type_entite);
  } catch (e) {
    showToast(e.message || "Erreur impression", "error");
  }
}

// ── Barre flottante ───────────────────────────────────────────────────────────

function _updateFloatingBar() {
  let bar = document.getElementById("labels-floating-bar");

  if (STATE.selected.size === 0) {
    bar?.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement("div");
    bar.id = "labels-floating-bar";
    bar.className = `
      fixed bottom-6 left-1/2 -translate-x-1/2 z-50
      flex items-center gap-3
      bg-neutral text-neutral-content
      px-5 py-3 rounded-full shadow-2xl
      transition-all duration-200
    `;
    document.body.appendChild(bar);
  }

  const type_label =
    STATE.type_entite === "flip" ? "flip(s)" : "réparation(s)";

  bar.innerHTML = `
    <span class="text-sm font-medium">
      🏷️ <strong>${STATE.selected.size}</strong> ${type_label} sélectionné(s)
    </span>
    <button
      class="btn btn-sm btn-primary"
      onclick="window._printSelected()"
    >
      Imprimer les étiquettes
    </button>
    <button
      class="btn btn-sm btn-ghost btn-circle"
      onclick="window._clearSelection()"
      title="Annuler la sélection"
    >✕</button>
  `;
}

// Exposé globalement pour les onclick inline de la barre flottante
window._printSelected = printSelected;
window._clearSelection = () => {
  clearSelection();
  // Décocher toutes les checkboxes visibles
  document
    .querySelectorAll(".label-checkbox")
    .forEach((cb) => (cb.checked = false));
  const selectAll = document.getElementById("label-select-all");
  if (selectAll) selectAll.checked = false;
};

// ── Envoi au backend ──────────────────────────────────────────────────────────

async function _sendAndOpen(ids, type_entite) {
  if (!ids.length) {
    showToast("Aucun élément à imprimer", "warning");
    return;
  }

  const res = await fetch("/api/labels/print", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("token")}`,
    },
    body: JSON.stringify({ ids, type_entite }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Erreur serveur");
  }

  const html = await res.text();
  const win = window.open("", "_blank");
  if (!win) {
    showToast("Popup bloquée — autorisez les popups pour ce site", "warning");
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ── Helpers HTML (utilisés par flips.js et reparations.js) ───────────────────

/**
 * Génère la checkbox de sélection pour une ligne de tableau
 * @param {number} id
 * @param {"flip"|"reparation"} type_entite
 */
export function checkboxHtml(id, type_entite) {
  const checked = isSelected(id) ? "checked" : "";
  return `
    <input
      type="checkbox"
      class="checkbox checkbox-sm checkbox-primary label-checkbox"
      ${checked}
      onchange="window._toggleSelection(${id}, '${type_entite}', this.checked)"
    />`;
}

/**
 * Génère le bouton d'impression unitaire pour une ligne de tableau
 * @param {number} id
 * @param {"flip"|"reparation"} type_entite
 */
export function printButtonHtml(id, type_entite) {
  return `
    <button
      class="btn btn-xs btn-ghost"
      title="Imprimer l'étiquette"
      onclick="window._printLabel(${id}, '${type_entite}')"
    >🏷️</button>`;
}

/**
 * Génère la checkbox "tout sélectionner" pour le thead
 * @param {"flip"|"reparation"} type_entite
 * @param {number[]} ids  ids visibles dans le tableau courant
 */
export function selectAllHtml(type_entite, ids) {
  return `
    <input
      type="checkbox"
      id="label-select-all"
      class="checkbox checkbox-sm checkbox-primary"
      onchange="window._toggleSelectAll('${type_entite}', ${JSON.stringify(ids)}, this.checked)"
    />`;
}

// Expositions globales pour les onclick inline
window._toggleSelection = toggleSelection;
window._toggleSelectAll = toggleSelectAll;
window._printLabel = printLabel;