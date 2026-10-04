import { apiRequest, formatMoney } from './api.js';

document.querySelectorAll('[data-current-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

try {
  const { plans } = await apiRequest('/plans', { auth: false });
  for (const plan of ['basic', 'pro']) {
    const element = document.querySelector(`[data-plan-price="${plan}"]`);
    const price = plans?.[plan]?.priceUsd;
    if (element && Number.isFinite(price)) {
      element.textContent = formatMoney(price);
    }
  }
} catch {
  const note = document.querySelector('#pricing-note');
  if (note) note.textContent = 'Precios sujetos a la configuración de tu región y plan.';
}
