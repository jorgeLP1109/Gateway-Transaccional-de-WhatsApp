import {
  API_KEY_KEY,
  apiRequest,
  formatMoney,
  getStoredUser,
  getToken,
  logoutToLogin,
  setNotice,
} from './api.js';

const pageNotice = document.querySelector('#page-notice');
const qrImage = document.querySelector('#instance-qr');
const qrPlaceholder = document.querySelector('#qr-placeholder');
const qrStatus = document.querySelector('#qr-status');
const keyInput = document.querySelector('#api-key');
let refreshTimer;
let currentClientId;
let currentStatus;

function showInstanceStatus(status) {
  currentStatus = status;
  const connected = status === 'connected';
  document.querySelector('#instance-state').textContent = connected
    ? 'WhatsApp conectado'
    : status === 'qr_pending' ? 'Esperando escaneo del QR' : 'Conectando…';
  document.querySelector('#instance-state').className = `mt-1 text-xl font-semibold ${connected ? 'text-mint' : 'text-white'}`;
  qrStatus.textContent = connected
    ? 'La instancia está conectada y lista para enviar mensajes.'
    : status === 'qr_pending' ? 'Escanea este código QR con WhatsApp.' : 'Inicializando tu sesión…';
  if (!connected) return;
  qrImage.classList.add('hidden');
  qrPlaceholder.classList.remove('hidden');
  qrPlaceholder.textContent = 'Conexión activa. Ya puedes enviar mensajes desde la API.';
  document.querySelector('#connect-link').classList.add('hidden');
}

async function refreshInstance() {
  if (!currentClientId) return;
  try {
    const result = await apiRequest(`/instance/qr/${encodeURIComponent(currentClientId)}`);
    showInstanceStatus(result.status);
    if (result.qr) {
      qrImage.src = result.qr;
      qrImage.classList.remove('hidden');
      qrPlaceholder.classList.add('hidden');
      const link = document.querySelector('#connect-link');
      link.href = `/connect/${encodeURIComponent(currentClientId)}`;
      link.classList.remove('hidden');
      qrStatus.textContent = 'Escanea este código en WhatsApp → Dispositivos vinculados.';
    }
  } catch (error) {
    try {
      const status = await apiRequest(`/instance/status/${encodeURIComponent(currentClientId)}`);
      showInstanceStatus(status.status);
    } catch (statusError) {
      if (statusError.message.includes('suscripción')) {
        setNotice(pageNotice, statusError.message, 'error');
      } else {
        qrStatus.textContent = error.message;
      }
    }
  }

  if (document.visibilityState !== 'hidden') {
    refreshTimer = setTimeout(
      () => void refreshInstance(),
      currentStatus === 'connected' ? 15_000 : 4_000,
    );
  }
}

function renderPayments(payments) {
  const body = document.querySelector('#payment-history');
  body.replaceChildren();
  if (!payments?.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'py-4 text-slate-500';
    cell.textContent = 'Todavía no tienes pagos registrados.';
    row.append(cell);
    body.append(row);
    return;
  }

  for (const payment of payments) {
    const row = document.createElement('tr');
    row.className = 'text-sm';
    const date = new Date(payment.createdAt);
    const values = [
      payment.reference,
      payment.method.replaceAll('_', ' '),
      formatMoney(payment.amount, payment.currency),
      payment.status === 'approved' ? 'Aprobado' : payment.status === 'rejected' ? 'Rechazado' : 'Pendiente',
      Number.isNaN(date.valueOf()) ? '—' : date.toLocaleDateString(),
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.className = `py-3 ${index === 0 ? 'font-mono text-xs' : ''}`;
      cell.textContent = value;
      if (index === 3) {
        cell.className += payment.status === 'approved'
          ? ' text-mint'
          : payment.status === 'rejected' ? ' text-rose-200' : ' text-amber-200';
      }
      row.append(cell);
    });
    body.append(row);
  }
}

async function loadDashboard() {
  if (!getToken()) {
    location.href = `/login.html?next=${encodeURIComponent('/dashboard.html')}`;
    return;
  }

  const cachedUser = getStoredUser();
  if (cachedUser?.name) {
    document.querySelector('#user-name').textContent = cachedUser.name;
    document.querySelector('#welcome').textContent = `Hola, ${cachedUser.name}. Administra tu conexión de WhatsApp.`;
  }

  try {
    const { user } = await apiRequest('/auth/me');
    if (user.role === 'admin') {
      location.href = '/admin.html';
      return;
    }
    document.querySelector('#user-name').textContent = user.name;
    document.querySelector('#welcome').textContent = `Hola, ${user.name}. Administra tu conexión de WhatsApp.`;

    const [subscriptionResult, historyResult] = await Promise.all([
      apiRequest('/payments/subscription'),
      apiRequest('/payments/history'),
    ]);
    const subscription = subscriptionResult.subscription;
    const badge = document.querySelector('#plan-badge');
    if (subscription && subscription.status === 'active') {
      badge.textContent = `${subscription.plan.toUpperCase()} · hasta ${new Date(subscription.expiresAt).toLocaleDateString()}`;
      currentClientId = subscription.clientId;
      document.querySelector('#client-id').textContent = `clientId: ${subscription.clientId}`;
      await refreshInstance();
    } else {
      badge.textContent = subscription?.status === 'expired' ? 'Suscripción vencida' : 'Sin suscripción activa';
      document.querySelector('#instance-state').textContent = 'Activa un plan para conectar WhatsApp';
      document.querySelector('#qr-status').textContent = 'Elige un plan para obtener acceso a tu instancia.';
      document.querySelector('#qr-placeholder').textContent = 'Tu código QR estará disponible cuando la suscripción quede activa.';
    }
    renderPayments(historyResult.payments);
  } catch (error) {
    setNotice(pageNotice, error.message, 'error');
  }
}

const existingApiKey = localStorage.getItem(API_KEY_KEY);
if (existingApiKey) keyInput.value = existingApiKey;

document.querySelector('#toggle-api-key').addEventListener('click', (event) => {
  const show = keyInput.type === 'password';
  keyInput.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
});

document.querySelector('#copy-api-key').addEventListener('click', async () => {
  if (!keyInput.value) {
    setNotice(pageNotice, 'Primero genera tu API key.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(keyInput.value);
    setNotice(pageNotice, 'API key copiada al portapapeles.', 'success');
  } catch {
    keyInput.type = 'text';
    keyInput.select();
    setNotice(pageNotice, 'Selecciona y copia la clave manualmente.', 'info');
  }
});

document.querySelector('#rotate-api-key').addEventListener('click', async (event) => {
  if (!confirm('La clave actual dejará de funcionar inmediatamente. ¿Quieres continuar?')) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await apiRequest('/auth/api-key/rotate', { method: 'POST', body: {} });
    localStorage.setItem(API_KEY_KEY, result.apiKey);
    keyInput.value = result.apiKey;
    keyInput.type = 'text';
    setNotice(pageNotice, 'Nueva API key generada. Cópiala ahora y guárdala de forma segura.', 'success');
  } catch (error) {
    setNotice(pageNotice, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#refresh-qr').addEventListener('click', () => {
  clearTimeout(refreshTimer);
  void refreshInstance();
});

document.querySelector('#send-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#send-button');
  button.disabled = true;
  setNotice(document.querySelector('#send-notice'), '');
  try {
    const result = await apiRequest('/send-message', {
      method: 'POST',
      body: {
        number: document.querySelector('#number').value.trim(),
        message: document.querySelector('#message').value.trim(),
      },
    });
    setNotice(document.querySelector('#send-notice'), `Mensaje enviado · ${result.messageId || result.to}`, 'success');
  } catch (error) {
    setNotice(document.querySelector('#send-notice'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#logout').addEventListener('click', logoutToLogin);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentClientId) {
    clearTimeout(refreshTimer);
    void refreshInstance();
  }
});
window.addEventListener('beforeunload', () => clearTimeout(refreshTimer));

await loadDashboard();
