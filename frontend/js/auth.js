/**
 * auth.js — Gestion JWT côté client
 * Utilisé par toutes les pages et login.html
 */

const API_BASE = "";
let authError = null;

// ── Stockage token ──────────────────────────────────────────────

function getToken() {
  return localStorage.getItem("token");
}

function setToken(token) {
  localStorage.setItem("token", token);
}

function clearToken() {
  localStorage.removeItem("token");
  localStorage.removeItem("current_user");
}

// ── Login / Logout ──────────────────────────────────────────────

async function login(username, password) {
  authError = null;
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      authError = data.detail || "Erreur de connexion";
      return false;
    }

    const data = await res.json();
    setToken(data.access_token);

    // Récupérer les infos utilisateur
    await fetchCurrentUser();

    window.location.replace("/index.html");
    return true;
  } catch {
    authError = "Impossible de joindre le serveur";
    return false;
  }
}

async function logout() {
  const token = getToken();
  if (token) {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  clearToken();
  window.location.replace("/login.html");
}

// ── Utilisateur courant ─────────────────────────────────────────

async function fetchCurrentUser() {
  const res = await authFetch("/api/auth/me");
  if (res.ok) {
    const user = await res.json();
    localStorage.setItem("current_user", JSON.stringify(user));
    return user;
  }
  return null;
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("current_user"));
  } catch {
    return null;
  }
}

// ── Fetch authentifié ───────────────────────────────────────────

async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.replace("/login.html");
    // Retourner une Response jamais résolue pour stopper l'exécution
    return new Promise(() => {});
  }

  return res;
}

// ── Guard — à appeler en tête de chaque page protégée ──────────

function requireAuth() {
  if (!getToken()) {
    window.location.replace("/login.html");
    return false;
  }
  return true;
}