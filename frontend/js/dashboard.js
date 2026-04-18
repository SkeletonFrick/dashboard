// frontend/js/dashboard.js

import { requireAuth, logout, getCurrentUser } from "./auth.js";
import {
  apiFetch,
  formatEur,
  formatDate,
  escHtml,
  statutBadge,
} from "./app.js";

requireAuth();
window.logout = logout;

// ── Sidebar user info ────────────────────────────────────────────────────────
const user = getCurrentUser();
if (user?.username) {
  const el = (id) => document.getElementById(id);
  if (el("sidebar-avatar"))
    el("sidebar-avatar").textContent = user.username[0].toUpperCase();
  if (el("sidebar-username"))
    el("sidebar-username").textContent = user.username;
  if (el("sidebar-role"))
    el("sidebar-role").textContent = user.role || "";
}

// ── Statuts ──────────────────────────────────────────────────────────────────
const STATUT_REP_MAP = {
  recu: "badge-info",
  diagnostic_en_cours: "badge-warning",
  en_attente_accord: "badge-warning",
  en_attente_pieces: "badge-warning",
  en_cours_reparation: "badge-primary",
  pret: "badge-success",
  livre: "badge-ghost",
  annule: "badge-error",
};
const STATUT_REP_LABELS = {
  recu: "Reçu",
  diagnostic_en_cours: "Diagnostic",
  en_attente_accord: "Attente accord",
  en_attente_pieces: "Attente pièces",
  en_cours_reparation: "En cours",
  pret: "Prêt",
  livre: "Livré",
  annule: "Annulé",
};

const STATUT_FLIP_MAP = {
  a_diagnostiquer: "badge-warning",
  en_attente_pieces: "badge-info",
  en_reparation: "badge-primary",
  pret_a_vendre: "badge-success",
  en_vente: "badge-accent",
  vendu: "badge-ghost",
  annule: "badge-error",
};
const STATUT_FLIP_LABELS = {
  a_diagnostiquer: "À diagnostiquer",
  en_attente_pieces: "Attente pièces",
  en_reparation: "En réparation",
  pret_a_vendre: "Prêt à vendre",
  en_vente: "En vente",
  vendu: "Vendu",
  annule: "Annulé",
};

// ── Journal state ─────────────────────────────────────────────────────────────
const JOURNAL = { page: 1, total: 0, perPage: 30 };

// ── Chargement principal ──────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const data = await apiFetch("/api/dashboard");
    renderKPIs(data.kpi);
    renderAlertesStock(data.alertes_stock || []);
    renderActivite(data.activite);
  } catch (err) {
    console.error("[dashboard]", err);
  }
  await loadJournal();
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function renderKPIs(kpi) {
  const el = (id) => document.getElementById(id);

  if (el("kpi-ca"))
    el("kpi-ca").textContent = formatEur(kpi.ca_total_mois);

  if (el("kpi-benefice")) {
    el("kpi-benefice").textContent = formatEur(kpi.marge_brute_mois);
    el("kpi-benefice").className =
      `text-2xl font-bold ${kpi.marge_brute_mois >= 0 ? "text-success" : "text-error"}`;
  }

  if (el("kpi-reparations"))
    el("kpi-reparations").textContent = kpi.nb_reparations_en_cours;

  if (el("kpi-stock")) {
    el("kpi-stock").textContent = kpi.nb_alertes_stock;
    el("kpi-stock").className =
      `text-2xl font-bold ${kpi.nb_alertes_stock > 0 ? "text-warning" : "text-success"}`;
  }

  // Bandeaux alertes visuelles
  renderBandeauAlertes(kpi);
}

// ── Bandeau alertes visuelles ─────────────────────────────────────────────────
function renderBandeauAlertes(kpi) {
  const container = document.getElementById("alertes-bandeau");
  if (!container) return;

  const alertes = [];

  if (kpi.nb_ruptures > 0) {
    alertes.push(`
      <div class="alert alert-error shadow-sm py-2">
        <span>🚨 <strong>${kpi.nb_ruptures}</strong>
          article(s) en rupture totale de stock</span>
        <a href="/stock.html" class="btn btn-xs btn-error btn-outline ml-auto">
          Voir
        </a>
      </div>`);
  }

  if (kpi.nb_alertes_stock > kpi.nb_ruptures) {
    const nb = kpi.nb_alertes_stock - kpi.nb_ruptures;
    alertes.push(`
      <div class="alert alert-warning shadow-sm py-2">
        <span>⚠️ <strong>${nb}</strong>
          article(s) sous le seuil minimal</span>
        <a href="/stock.html" class="btn btn-xs btn-warning btn-outline ml-auto">
          Voir
        </a>
      </div>`);
  }

  if (kpi.nb_commandes_retard > 0) {
    alertes.push(`
      <div class="alert alert-info shadow-sm py-2">
        <span>📦 <strong>${kpi.nb_commandes_retard}</strong>
          commande(s) en retard de livraison</span>
        <a href="/stock.html" class="btn btn-xs btn-info btn-outline ml-auto">
          Voir
        </a>
      </div>`);
  }

  container.innerHTML = alertes.join("");
  container.classList.toggle("hidden", alertes.length === 0);
}

// ── Alertes stock détail ──────────────────────────────────────────────────────
function renderAlertesStock(alertes) {
  const el = document.getElementById("alertes-stock-liste");
  if (!el) return;

  if (!alertes.length) {
    el.innerHTML = `
      <p class="text-sm text-success text-center py-3">
        ✅ Tous les stocks sont suffisants
      </p>`;
    return;
  }

  el.innerHTML = alertes
    .map((a) => {
      const rupture = a.quantite === 0;
      return `
        <div class="flex items-center justify-between py-2 px-3
                    rounded-lg ${rupture ? "bg-error/10" : "bg-warning/10"}">
          <div class="min-w-0">
            <div class="font-medium text-sm truncate">
              ${escHtml(a.nom)}
            </div>
            <div class="text-xs text-base-content/50">
              ${escHtml(a.fournisseur_nom || "—")}
            </div>
          </div>
          <div class="ml-2 text-right shrink-0">
            <span class="badge ${rupture ? "badge-error" : "badge-warning"} badge-sm">
              ${rupture ? "Rupture" : `${a.quantite} / ${a.stock_minimal}`}
            </span>
            ${a.commande_en_cours
              ? `<div class="text-xs text-info mt-1">Commandé</div>`
              : ""}
          </div>
        </div>`;
    })
    .join("");
}

// ── Activité récente ──────────────────────────────────────────────────────────
function renderActivite(activite) {
  renderReparations(activite.reparations_en_cours || []);
  renderFlips(activite.flips_en_cours || []);
  renderVentes(activite.dernieres_ventes || []);
}

function renderReparations(items) {
  const el = document.getElementById("activite-reparations");
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `
      <p class="text-sm text-base-content/40 text-center py-3">
        Aucune réparation en cours
      </p>`;
    return;
  }
  el.innerHTML = items
    .map(
      (r) => `
      <a href="/reparations.html"
         class="flex items-center justify-between py-2 px-3
                hover:bg-base-200 rounded-lg transition-colors">
        <div class="min-w-0">
          <div class="font-medium text-sm truncate">
            ${escHtml(r.appareil)}
            ${r.marque
              ? `<span class="text-base-content/50 font-normal">
                   ${escHtml(r.marque)}
                 </span>`
              : ""}
          </div>
          <div class="text-xs text-base-content/50">
            ${escHtml(r.client_nom || "—")}
            · ${formatDate(r.date_reception)}
          </div>
        </div>
        <div class="ml-2 shrink-0">
          ${statutBadge(r.statut, STATUT_REP_MAP, STATUT_REP_LABELS)}
        </div>
      </a>`
    )
    .join("");
}

function renderFlips(items) {
  const el = document.getElementById("activite-flips");
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `
      <p class="text-sm text-base-content/40 text-center py-3">
        Aucun flip en cours
      </p>`;
    return;
  }
  el.innerHTML = items
    .map(
      (f) => `
      <a href="/flips.html"
         class="flex items-center justify-between py-2 px-3
                hover:bg-base-200 rounded-lg transition-colors">
        <div class="min-w-0">
          <div class="font-medium text-sm truncate">
            ${escHtml(f.nom)}
          </div>
          <div class="text-xs text-base-content/50">
            ${escHtml([f.marque, f.modele].filter(Boolean).join(" ") || "—")}
            · ${formatEur(f.prix_achat)}
          </div>
        </div>
        <div class="ml-2 shrink-0">
          ${statutBadge(f.statut, STATUT_FLIP_MAP, STATUT_FLIP_LABELS)}
        </div>
      </a>`
    )
    .join("");
}

function renderVentes(items) {
  const el = document.getElementById("activite-ventes");
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `
      <p class="text-sm text-base-content/40 text-center py-3">
        Aucune vente récente
      </p>`;
    return;
  }
  el.innerHTML = items
    .map(
      (v) => `
      <div class="flex items-center justify-between py-2 px-3
                  hover:bg-base-200 rounded-lg">
        <div class="min-w-0">
          <div class="font-medium text-sm truncate">
            ${escHtml(v.nom)}
          </div>
          <div class="text-xs text-base-content/50">
            ${formatDate(v.date)}
            ${v.plateforme ? `· ${escHtml(v.plateforme)}` : ""}
          </div>
        </div>
        <div class="ml-2 shrink-0 font-mono font-bold text-success text-sm">
          ${formatEur(v.prix_vente)}
        </div>
      </div>`
    )
    .join("");
}

// ── Journal d'activité ────────────────────────────────────────────────────────
async function loadJournal() {
  const tbody = document.getElementById("journal-tbody");
  const paginationEl = document.getElementById("journal-pagination");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="5" class="text-center py-4">
        <span class="loading loading-spinner loading-sm"></span>
      </td>
    </tr>`;

  try {
    const data = await apiFetch(
      `/api/dashboard/journal?page=${JOURNAL.page}&per_page=${JOURNAL.perPage}`
    );
    JOURNAL.total = data.total;

    if (!data.items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-4 text-base-content/40">
            Aucune activité enregistrée
          </td>
        </tr>`;
      return;
    }

    const ACTION_MAP = {
      create:        { label: "Créé",          cls: "badge-success" },
      update:        { label: "Modifié",        cls: "badge-info" },
      delete:        { label: "Supprimé",       cls: "badge-error" },
      integrer_stock:{ label: "Stock intégré",  cls: "badge-accent" },
      add_piece:     { label: "Pièce ajoutée",  cls: "badge-warning" },
      remove_piece:  { label: "Pièce retirée",  cls: "badge-warning" },
      mouvement:     { label: "Mouvement",      cls: "badge-ghost" },
      statut:        { label: "Statut changé",  cls: "badge-primary" },
      archive:       { label: "Archivé",        cls: "badge-ghost" },
      receptionner:  { label: "Réceptionné",    cls: "badge-success" },
      commande:      { label: "Commande",       cls: "badge-info" },
    };

    tbody.innerHTML = data.items
      .map((l) => {
        const action = ACTION_MAP[l.action] ?? {
          label: l.action,
          cls: "badge-ghost",
        };
        return `
          <tr class="hover text-sm">
            <td class="whitespace-nowrap text-base-content/50 text-xs">
              ${formatDate(l.created_at)}
            </td>
            <td>
              <span class="badge badge-xs ${action.cls}">
                ${action.label}
              </span>
            </td>
            <td class="text-base-content/70">
              ${escHtml(l.entite || "—")}
              ${l.entite_id
                ? `<span class="text-base-content/40">#${l.entite_id}</span>`
                : ""}
            </td>
            <td class="text-base-content/60 text-xs max-w-xs truncate">
              ${escHtml(l.details || "—")}
            </td>
            <td class="text-base-content/40 text-xs">
              ${escHtml(l.username || "—")}
            </td>
          </tr>`;
      })
      .join("");

    // Pagination journal
    if (paginationEl) {
      const totalPages = Math.ceil(JOURNAL.total / JOURNAL.perPage);
      paginationEl.innerHTML = `
        <span class="text-xs text-base-content/50">
          ${JOURNAL.total} entrée(s)
        </span>
        <div class="flex gap-2">
          <button class="btn btn-xs btn-ghost"
            ${JOURNAL.page <= 1 ? "disabled" : ""}
            onclick="journalPage(-1)">← Préc.</button>
          <span class="btn btn-xs btn-ghost no-animation">
            ${JOURNAL.page} / ${totalPages || 1}
          </span>
          <button class="btn btn-xs btn-ghost"
            ${JOURNAL.page >= totalPages ? "disabled" : ""}
            onclick="journalPage(1)">Suiv. →</button>
        </div>`;
    }
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-4 text-error text-sm">
          Erreur de chargement
        </td>
      </tr>`;
  }
}

window.journalPage = (delta) => {
  JOURNAL.page = Math.max(1, JOURNAL.page + delta);
  loadJournal();
};

// ── Démarrage ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", loadDashboard);