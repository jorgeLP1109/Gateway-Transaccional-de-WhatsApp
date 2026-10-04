export const API_BASE = '/api/v1';
export const TOKEN_KEY = 'waGatewayToken';
export const API_KEY_KEY = 'waGatewayApiKey';
export const USER_KEY = 'waGatewayUser';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveSession({ token, apiKey, user }) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (apiKey) localStorage.setItem(API_KEY_KEY, apiKey);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(API_KEY_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export async function apiRequest(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  if (auth) {
    const token = getToken();
    if (token) requestHeaders.set('authorization', `Bearer ${token}`);
    const apiKey = localStorage.getItem(API_KEY_KEY);
    if (apiKey) requestHeaders.set('x-api-key', apiKey);
  }

  let response;
  try {
    response = await fetch(path.startsWith('http') ? path : `${API_BASE}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Comprueba tu conexión.');
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    if (response.status === 401 && auth) clearSession();
    throw new Error(data.error || `La solicitud falló (HTTP ${response.status}).`);
  }
  return data;
}

export function setNotice(element, message, kind = 'info') {
  if (!element) return;
  element.textContent = message;
  element.className = `mt-4 rounded-xl border px-4 py-3 text-sm ${
    kind === 'error'
      ? 'border-rose-400/20 bg-rose-400/10 text-rose-200'
      : kind === 'success'
        ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200'
        : 'border-sky-300/20 bg-sky-300/10 text-sky-100'
  }`;
  element.hidden = !message;
}

export function formatMoney(value, currency = 'USD') {
  if (currency === 'USDT') {
    return `${new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} USDT`;
  }

  return new Intl.NumberFormat('es', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function getPlanFromLocation() {
  const plan = new URLSearchParams(location.search).get('plan');
  return plan === 'pro' ? 'pro' : 'basic';
}

export function logoutToLogin() {
  clearSession();
  location.href = '/login.html';
}
