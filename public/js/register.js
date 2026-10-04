import { apiRequest, saveSession, setNotice } from './api.js';

const form = document.querySelector('#register-form');
const notice = document.querySelector('#form-notice');
const button = document.querySelector('#submit-button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  button.disabled = true;
  button.textContent = 'Creando cuenta…';
  setNotice(notice, '');

  try {
    const result = await apiRequest('/auth/register', {
      method: 'POST',
      body: Object.fromEntries(new FormData(form)),
      auth: false,
    });
    saveSession(result);
    location.href = `/checkout.html?plan=${encodeURIComponent(
      new URLSearchParams(location.search).get('plan') === 'pro' ? 'pro' : 'basic',
    )}`;
  } catch (error) {
    setNotice(notice, error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Crear cuenta y continuar →';
  }
});
