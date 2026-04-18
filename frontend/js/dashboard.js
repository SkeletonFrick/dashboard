import { requireAuth } from "./auth.js";
import { apiFetch, formatEur } from "./app.js";

requireAuth();

// Squelette — les appels API réels seront branchés en Phase 3A
async function loadDashboard() {
  // Placeholder : les cartes affichent "—" jusqu'à l'implémentation budget
  console.info("[dashboard] prêt — données chargées en Phase 3A");
}

document.addEventListener("DOMContentLoaded", loadDashboard);