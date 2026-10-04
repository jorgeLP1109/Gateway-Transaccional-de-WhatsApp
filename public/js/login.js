import { apiRequest, saveSession, setNotice } from './api.js';

const form = document.querySelector('#login-form');
const notice = document.querySelector('#form-notice');
const button = document.querySelector('#submit-button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = 'Validando…';
  setNotice(notice, '');

  try {
    const payload = Object.fromEntries(new FormData(form));
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: payload,
      auth: false,
    });
    saveSession(result);
    const next = new URLSearchParams(location.search).get('next');
    location.href = next?.startsWith('/') && !next.startsWith('//')
      ? next
      : result.user?.role === 'admin' ? '/admin.html' : '/dashboard.html';
  } catch (error) {
    setNotice(notice, error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar a mi cuenta →';
  }
});
