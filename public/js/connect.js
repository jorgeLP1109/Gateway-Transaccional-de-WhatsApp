import { apiRequest, getToken } from './api.js';

const clientId = decodeURIComponent(location.pathname.split('/').pop());
const image = document.querySelector('#qr');
const placeholder = document.querySelector('#qr-placeholder');
const statusText = document.querySelector('#status');
const dashboard = document.querySelector('#dashboard');
let pollTimer;

document.querySelector('#client-id').textContent = `clientId: ${clientId}`;

async function poll() {
  if (!getToken()) {
    placeholder.textContent = 'Inicia sesión para ver el QR.';
    statusText.textContent = 'Esta página requiere una sesión autenticada.';
    document.querySelector('#login-hint').classList.remove('hidden');
    return;
  }

  try {
    const result = await apiRequest(`/instance/qr/${encodeURIComponent(clientId)}`);
    statusText.textContent = result.status === 'qr_pending'
      ? 'Escanea el código en WhatsApp → Dispositivos vinculados.'
      : `Estado: ${result.status}`;
    if (result.qr) {
      image.src = result.qr;
      image.classList.remove('hidden');
      placeholder.classList.add('hidden');
    }
    if (result.status === 'connected') {
      image.classList.add('hidden');
      placeholder.classList.remove('hidden');
      placeholder.textContent = 'WhatsApp quedó conectado correctamente.';
      dashboard.classList.remove('hidden');
      return;
    }
  } catch (error) {
    try {
      const result = await apiRequest(`/instance/status/${encodeURIComponent(clientId)}`);
      statusText.textContent = result.status === 'connected'
        ? 'WhatsApp quedó conectado correctamente.'
        : `Estado: ${result.status}. El código se actualizará automáticamente.`;
      if (result.status === 'connected') {
        image.classList.add('hidden');
        placeholder.classList.remove('hidden');
        placeholder.textContent = 'WhatsApp quedó conectado correctamente.';
        dashboard.classList.remove('hidden');
        return;
      }
    } catch (statusError) {
      statusText.textContent = statusError.message || error.message;
      if (statusError.message.includes('suscripción')) {
        placeholder.textContent = 'No hay una suscripción activa para esta instancia.';
        return;
      }
      if (statusError.message.includes('pertenece')) return;
    }
  }

  pollTimer = setTimeout(() => void poll(), 4000);
}

window.addEventListener('beforeunload', () => clearTimeout(pollTimer));
void poll();
