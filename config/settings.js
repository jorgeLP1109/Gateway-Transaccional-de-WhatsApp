import { randomBytes } from 'node:crypto';

export const plans = ['basic', 'pro'];
export const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

export function validateSecurityConfiguration() {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 bytes.');
  }
  if (
    !process.env.API_KEY_ENCRYPTION_SECRET ||
    Buffer.byteLength(process.env.API_KEY_ENCRYPTION_SECRET) < 32
  ) {
    throw new Error('API_KEY_ENCRYPTION_SECRET debe tener al menos 32 bytes.');
  }
  if (!process.env.API_KEY && !process.env.API_SECRET_KEY) {
    throw new Error('Configura API_KEY o API_SECRET_KEY para proteger la API administrativa.');
  }
}

export function getPlanPrice(plan) {
  if (!plans.includes(plan)) {
    const error = new Error('plan debe ser basic o pro.');
    error.statusCode = 400;
    throw error;
  }

  const value = Number(process.env[`PLAN_${plan.toUpperCase()}_USD`]);
  if (!Number.isFinite(value) || value <= 0) {
    const error = new Error(`Falta configurar PLAN_${plan.toUpperCase()}_USD.`);
    error.statusCode = 503;
    throw error;
  }

  return Number(value.toFixed(2));
}

export function getSubscriptionDurationDays() {
  const days = Number(process.env.SUBSCRIPTION_DURATION_DAYS || 30);
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new Error('SUBSCRIPTION_DURATION_DAYS debe ser un entero entre 1 y 366.');
  }
  return days;
}

export function getPagoMovilAmount(usdAmount) {
  const rate = Number(process.env.PAYMENT_VES_PER_USD);
  if (!Number.isFinite(rate) || rate <= 0) {
    const error = new Error('Falta configurar PAYMENT_VES_PER_USD.');
    error.statusCode = 503;
    throw error;
  }
  return Number((usdAmount * rate).toFixed(2));
}

export function createClientId() {
  return `wa_${randomBytes(18).toString('hex')}`;
}

export function getPaymentWebhookUrl(method) {
  if (!publicBaseUrl) {
    const error = new Error('Falta configurar PUBLIC_BASE_URL para recibir webhooks.');
    error.statusCode = 503;
    throw error;
  }
  let baseUrl;
  try {
    baseUrl = new URL(publicBaseUrl);
  } catch {
    const error = new Error('PUBLIC_BASE_URL debe ser una URL absoluta válida.');
    error.statusCode = 503;
    throw error;
  }
  if (baseUrl.protocol !== 'https:') {
    const error = new Error('PUBLIC_BASE_URL debe usar HTTPS para los webhooks de pago.');
    error.statusCode = 503;
    throw error;
  }
  return `${publicBaseUrl}/api/v1/payments/webhook/${method}`;
}
