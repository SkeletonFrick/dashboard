// frontend/js/auth.js

const API_BASE = "";

// ── Stockage token ────────────────────────────────────────────────────────────

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

// ── Login / Logout ────────────────────────────────────────────────────────────

async function login(username, password) {
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.detail || "Erreur de connexion" };
    }

    const data = await res.json();
    setToken(data.access_token);
    await fetchCurrentUser();
    window.location.replace("/index.html");
    return { ok: true };
  } catch {
    return { ok: false, error: "Impossible de joindre le serveur" };
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

// ── Utilisateur courant ───────────────────────────────────────────────────────

async function fetchCurrentUser() {
  const token = getToken();
  if (!token) return null;

  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  if (!res || !res.ok) return null;

  const user = await res.json();
  localStorage.setItem("current_user", JSON.stringify(user));
  return user;
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("current_user"));
  } catch {
    return null;
  }
}

// ── Fetch authentifié ─────────────────────────────────────────────────────────

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
    return new Promise(() => {});
  }

  return res;
}

// ── Guard ─────────────────────────────────────────────────────────────────────

function requireAuth() {
  if (!getToken()) {
    window.location.replace("/login.html");
    return false;
  }
  return true;
}

// ── Exports ES module ─────────────────────────────────────────────────────────

export {
  getToken,
  setToken,
  clearToken,
  login,
  logout,
  fetchCurrentUser,
  getCurrentUser,
  authFetch,
  requireAuth,
};