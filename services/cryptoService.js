import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

function encryptionKey() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('API_KEY_ENCRYPTION_SECRET debe tener al menos 32 bytes.');
  }
  return createHash('sha256').update(secret).digest();
}

export function hashApiKey(apiKey) {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function createApiKey() {
  return `wga_${randomBytes(32).toString('base64url')}`;
}

export function encryptApiKey(apiKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptApiKey(encryptedApiKey) {
  const [ivText, tagText, ciphertextText] = encryptedApiKey.split('.');
  if (!ivText || !tagText || !ciphertextText) {
    throw new Error('El API key cifrado tiene un formato inválido.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
