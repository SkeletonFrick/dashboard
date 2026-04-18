import { apiFetch, formatEur } from "./app.js";

export async function loadBudget() {
  document.getElementById("budget-loader").classList.remove("hidden");
  document.getElementById("budget-content").classList.add("hidden");

  // Label mois courant
  const now = new Date();
  document.getElementById("mois-label").textContent = now.toLocaleDateString(
    "fr-FR",
    { month: "long", year: "numeric" }
  );

  try {
    const data = await apiFetch("/api/budget");
    renderBudget(data);
    document.getElementById("budget-content").classList.remove("hidden");
  } catch (e) {
    console.error(e);
  } finally {
    document.getElementById("budget-loader").classList.add("hidden");
  }
}

function renderBudget(d) {
  // KPIs
  document.getElementById("kpi-ca-ventes").textContent = formatEur(
    d.ca_mois
  );
  document.getElementById("kpi-ca-rep").textContent = formatEur(
    d.ca_reparations_mois
  );
  document.getElementById("kpi-nb-rep").textContent =
    `${d.nb_reparations_mois} livrée(s)`;
  document.getElementById("kpi-ca-total").textContent = formatEur(
    d.ca_total_mois
  );

  const margeEl = document.getElementById("kpi-marge");
  margeEl.textContent = formatEur(d.marge_brute_mois);
  margeEl.className =
    "stat-value text-xl " +
    (d.marge_brute_mois >= 0 ? "text-success" : "text-error");

  // Objectif
  const pct = Math.min(d.avancement_pct, 100);
  document.getElementById("objectif-label").textContent =
    `${formatEur(d.ca_total_mois)} / ${formatEur(d.objectif_mensuel)}`;
  const prog = document.getElementById("objectif-progress");
  prog.value = pct;
  prog.className =
    "progress w-full " + (pct >= 100 ? "progress-success" : "progress-info");
  document.getElementById("objectif-pct").textContent =
    `${d.avancement_pct} %`;

  // Répartition
  const r = d.repartition;
  const pctFmt = (v) => `${Math.round(v * 100)} %`;

  document.getElementById("rp-urssaf-pct").textContent = pctFmt(r.urssaf_pct);
  document.getElementById("rp-urssaf-bar").value = r.urssaf_pct * 100;
  document.getElementById("rp-urssaf-montant").textContent = formatEur(
    r.montant_urssaf
  );

  document.getElementById("rp-reinvest-pct").textContent = pctFmt(
    r.reinvest_pct
  );
  document.getElementById("rp-reinvest-bar").value = r.reinvest_pct * 100;
  document.getElementById("rp-reinvest-montant").textContent = formatEur(
    r.montant_reinvest
  );

  document.getElementById("rp-perso-pct").textContent = pctFmt(r.perso_pct);
  document.getElementById("rp-perso-bar").value = r.perso_pct * 100;
  document.getElementById("rp-perso-montant").textContent = formatEur(
    r.montant_perso
  );

  // Charges fixes
  const tbody = document.getElementById("charges-tbody");
  const perioMap = {
    mensuelle: "/ mois",
    trimestrielle: "/ trim.",
    semestrielle: "/ sem.",
    annuelle: "/ an",
  };
  if (d.charges_fixes.liste.length === 0) {
    tbody.innerHTML =
      `<tr><td colspan="3" class="text-center text-base-content/40">` +
      `Aucune charge fixe — à configurer dans Paramètres</td></tr>`;
  } else {
    tbody.innerHTML = d.charges_fixes.liste
      .map(
        (c) => `<tr>
        <td>${escHtml(c.nom)}</td>
        <td class="text-base-content/60 text-xs">
          ${perioMap[c.periodicite] || c.periodicite}
        </td>
        <td class="text-right font-mono">${formatEur(c.montant)}</td>
      </tr>`
      )
      .join("");
  }
  document.getElementById("charges-total").textContent = formatEur(
    d.charges_fixes.total_mensuel
  );

  // Net après charges
  const netEl = document.getElementById("net-apres-charges");
  netEl.textContent = formatEur(d.net_apres_charges);
  netEl.className =
    "text-4xl font-bold font-mono " +
    (d.net_apres_charges >= 0 ? "text-success" : "text-error");

  // Déclaration AE
  document.getElementById("ae-ca").textContent = formatEur(d.ca_declarable);
  document.getElementById("ae-cotisations").textContent = formatEur(
    d.repartition.montant_urssaf
  );
  document.getElementById("ae-taux").textContent =
    `${Math.round(d.repartition.urssaf_pct * 100)} %`;

  // Historique 12 mois (mini bar chart)
  renderHistorique(d.historique_12m);
}

function renderHistorique(historique) {
  const barsEl = document.getElementById("historique-bars");
  const labelsEl = document.getElementById("historique-labels");

  if (!historique.length) {
    barsEl.innerHTML =
      `<span class="text-base-content/40 text-sm m-auto">` +
      `Pas encore de données</span>`;
    labelsEl.innerHTML = "";
    return;
  }

  const max = Math.max(...historique.map((h) => h.ca), 1);
  const moisCourant = new Date().toISOString().slice(0, 7);

  barsEl.innerHTML = historique
    .map((h) => {
      const heightPct = Math.round((h.ca / max) * 100);
      const isCurrent = h.mois === moisCourant;
      return `<div
        class="flex-1 flex flex-col justify-end"
        title="${h.mois} : ${formatEur(h.ca)}"
      >
        <div
          class="rounded-t ${isCurrent ? "bg-primary" : "bg-base-300"}
                 transition-all min-h-[2px]"
          style="height: ${heightPct}%"
        ></div>
      </div>`;
    })
    .join("");

  labelsEl.innerHTML = historique
    .map((h) => {
      const label = h.mois.slice(5); // MM
      const isCurrent = h.mois === moisCourant;
      return `<div
        class="flex-1 text-center truncate
               ${isCurrent ? "text-primary font-bold" : ""}"
      >${label}</div>`;
    })
    .join("");
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}