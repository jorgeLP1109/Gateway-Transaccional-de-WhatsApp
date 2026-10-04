import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { decryptApiKey, encryptApiKey, hashApiKey } from '../services/cryptoService.js';
import { verifyBinanceWebhook } from '../services/paymentProviders.js';
import { formatMoney } from '../public/js/api.js';

test('API keys encrypt/decrypt and hash consistently', () => {
  process.env.API_KEY_ENCRYPTION_SECRET = 'test-only-encryption-secret-at-least-32-bytes';
  const apiKey = 'wga_test-api-key';
  const encrypted = encryptApiKey(apiKey);

  assert.notEqual(encrypted, apiKey);
  assert.equal(decryptApiKey(encrypted), apiKey);
  assert.equal(hashApiKey(apiKey), hashApiKey(apiKey));
  assert.notEqual(hashApiKey(apiKey), hashApiKey('another-key'));
});

test('money formatting supports fiat currencies and Binance USDT', () => {
  assert.match(formatMoney(12.5, 'USD'), /12,50/);
  assert.match(formatMoney(12.5, 'VES'), /12,50/);
  assert.equal(formatMoney(12.5, 'USDT'), '12,50 USDT');
});

test('Binance webhook requires a current valid RSA signature over the raw body', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const serial = 'test-certificate-serial';
  process.env.BINANCE_PAY_WEBHOOK_CERTIFICATE_SERIAL = serial;
  process.env.BINANCE_PAY_PUBLIC_KEY = publicKey.export({
    type: 'spki',
    format: 'pem',
  });

  const timestamp = String(Date.now());
  const nonce = 'test-nonce';
  const body = Buffer.from('{"bizStatus":"PAY_SUCCESS"}');
  const payload = `${timestamp}\n${nonce}\n${body.toString('utf8')}\n`;
  const signature = sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64');
  const headers = {
    'binancepay-certificate-sn': serial,
    'binancepay-signature': signature,
    'binancepay-timestamp': timestamp,
    'binancepay-nonce': nonce,
  };
  const req = {
    get(name) {
      return headers[name.toLowerCase()];
    },
    rawBody: body,
  };

  assert.equal(verifyBinanceWebhook(req), true);
  req.rawBody = Buffer.from('{"bizStatus":"PAY_FAIL"}');
  assert.equal(verifyBinanceWebhook(req), false);
  req.rawBody = body;
  headers['binancepay-timestamp'] = String(Date.now() - 6 * 60 * 1000);
  assert.equal(verifyBinanceWebhook(req), false);
});
