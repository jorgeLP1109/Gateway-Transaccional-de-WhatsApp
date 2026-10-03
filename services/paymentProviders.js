import {
  createSign,
  createVerify,
  randomBytes,
} from 'node:crypto';
import { getPaymentWebhookUrl } from '../config/settings.js';

const requestTimeoutMs = 15_000;

async function readJsonResponse(response, providerName) {
  const body = await response.text();
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`${providerName} devolvió una respuesta JSON inválida.`);
  }
  if (!response.ok) {
    throw new Error(
      `${providerName} respondió HTTP ${response.status}: ${
        parsed.message || parsed.error_description || parsed.error || 'Error del proveedor'
      }`,
    );
  }
  return parsed;
}

function paypalBaseUrl() {
  return (process.env.PAYPAL_API_BASE || 'https://api-m.paypal.com').replace(/\/+$/, '');
}

async function paypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const data = await readJsonResponse(response, 'PayPal OAuth');
  if (!data.access_token) throw new Error('PayPal no devolvió un access token.');
  return data.access_token;
}

export async function createPaypalPayOrder(payment) {
  const accessToken = await paypalAccessToken();
  const body = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: String(payment._id),
      custom_id: String(payment._id),
      invoice_id: payment.reference,
      amount: {
        currency_code: payment.currency,
        value: payment.amount.toFixed(2),
      },
      description: `Suscripción ${payment.plan}`,
    }],
  };

  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'paypal-request-id': payment.reference,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  return readJsonResponse(response, 'PayPal');
}

export async function capturePaypalOrder(orderId) {
  const accessToken = await paypalAccessToken();
  const response = await fetch(
    `${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'paypal-request-id': `capture-${orderId}`,
      },
      body: '{}',
      signal: AbortSignal.timeout(requestTimeoutMs),
    },
  );
  return readJsonResponse(response, 'PayPal');
}

function binancePrivateKey() {
  const key = process.env.BINANCE_PAY_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!key) throw new Error('Falta configurar BINANCE_PAY_PRIVATE_KEY.');
  return key;
}

function binanceSerial() {
  const serial = process.env.BINANCE_PAY_CERTIFICATE_SERIAL;
  if (!serial) throw new Error('Falta configurar BINANCE_PAY_CERTIFICATE_SERIAL.');
  return serial;
}

function binanceSignature(timestamp, nonce, body) {
  const payload = `${timestamp}\n${nonce}\n${body}\n`;
  const signer = createSign('RSA-SHA256');
  signer.update(payload);
  signer.end();
  return signer.sign(binancePrivateKey(), 'base64');
}

export async function createBinancePayOrder(payment) {
  const apiKey = process.env.BINANCE_PAY_API_KEY;
  if (!apiKey) throw new Error('Falta configurar BINANCE_PAY_API_KEY.');

  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString('hex');
  const body = JSON.stringify({
    env: { terminalType: 'WEB' },
    merchantTradeNo: payment.reference,
    orderAmount: payment.amount.toFixed(2),
    currency: payment.currency,
    goods: {
      goodsType: '02',
      goodsCategory: 'Z000',
      referenceGoodsId: payment.plan,
      goodsName: `Suscripción ${payment.plan}`,
    },
    webhookUrl: getPaymentWebhookUrl('binance'),
  });

  const response = await fetch(
    `${(process.env.BINANCE_PAY_API_BASE || 'https://bpay.binanceapi.com').replace(/\/+$/, '')}/binancepay/openapi/v3/order`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'binancepay-timestamp': timestamp,
        'binancepay-nonce': nonce,
        'binancepay-certificate-sn': binanceSerial(),
        'binancepay-signature': binanceSignature(timestamp, nonce, body),
        'binancepay-api-key': apiKey,
      },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs),
    },
  );
  const data = await readJsonResponse(response, 'Binance Pay');
  if (data.status !== 'SUCCESS' || !data.data?.prepayId) {
    throw new Error(`Binance Pay no creó la orden: ${data.errorMessage || data.status || 'respuesta incompleta'}`);
  }
  return data.data;
}

export function verifyBinanceWebhook(req) {
  const serial = req.get('binancepay-certificate-sn');
  const signature = req.get('binancepay-signature');
  const timestamp = req.get('binancepay-timestamp');
  const nonce = req.get('binancepay-nonce');
  const publicKey = process.env.BINANCE_PAY_PUBLIC_KEY?.replace(/\\n/g, '\n');
  const webhookSerial = process.env.BINANCE_PAY_WEBHOOK_CERTIFICATE_SERIAL;

  if (
    !publicKey ||
    !serial ||
    !signature ||
    !timestamp ||
    !nonce ||
    !webhookSerial ||
    serial !== webhookSerial ||
    !req.rawBody ||
    !Number.isFinite(Number(timestamp)) ||
    Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000
  ) {
    return false;
  }

  const payload = `${timestamp}\n${nonce}\n${req.rawBody.toString('utf8')}\n`;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(payload);
  verifier.end();
  try {
    return verifier.verify(publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

export async function verifyPaypalWebhook(req) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error('Falta configurar PAYPAL_WEBHOOK_ID.');

  const accessToken = await paypalAccessToken();
  const response = await fetch(
    `${paypalBaseUrl()}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: req.get('paypal-auth-algo'),
        cert_url: req.get('paypal-cert-url'),
        transmission_id: req.get('paypal-transmission-id'),
        transmission_sig: req.get('paypal-transmission-sig'),
        transmission_time: req.get('paypal-transmission-time'),
        webhook_id: webhookId,
        webhook_event: req.body,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    },
  );
  const data = await readJsonResponse(response, 'PayPal webhook verification');
  return data.verification_status === 'SUCCESS';
}
