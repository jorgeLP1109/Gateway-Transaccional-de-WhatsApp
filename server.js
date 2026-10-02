import { timingSafeEqual } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import {
  createSession,
  deleteSession,
  getSession,
  getSessionInfo,
  isValidClientId,
  listSessions,
} from './sessionManager.js';

dotenv.config();

if (!process.env.API_SECRET_KEY) {
  console.error('Error: API_SECRET_KEY no está configurada. Revisa el archivo .env.');
  process.exit(1);
}

function loadClientApiKeys(value) {
  if (!value) return new Map();

  let entries;
  try {
    entries = Object.entries(JSON.parse(value));
  } catch {
    throw new Error('CLIENT_API_KEYS debe ser un objeto JSON válido.');
  }

  const keys = new Map();
  const configuredKeys = new Set();
  for (const [clientId, apiKey] of entries) {
    if (!isValidClientId(clientId) || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('CLIENT_API_KEYS debe asociar cada clientId válido con una API key no vacía.');
    }
    if (configuredKeys.has(apiKey)) {
      throw new Error('Cada cliente debe tener una API key única en CLIENT_API_KEYS.');
    }

    configuredKeys.add(apiKey);
    keys.set(clientId, apiKey);
  }

  return keys;
}

const clientApiKeys = loadClientApiKeys(process.env.CLIENT_API_KEYS);
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

function apiKeysMatch(providedKey, expectedKey) {
  const providedKeyBuffer = Buffer.from(providedKey);
  const expectedKeyBuffer = Buffer.from(expectedKey);
  return (
    providedKeyBuffer.length === expectedKeyBuffer.length &&
    timingSafeEqual(providedKeyBuffer, expectedKeyBuffer)
  );
}

function authenticateApiKey(req, res, next) {
  const providedKey = req.get('x-api-key');

  if (!providedKey) {
    return res.status(401).json({ error: 'Falta la cabecera x-api-key.' });
  }

  if (!apiKeysMatch(providedKey, process.env.API_SECRET_KEY)) {
    return res.status(401).json({ error: 'La API key no es válida.' });
  }

  next();
}

function authenticateSendMessage(req, res, next) {
  const providedKey = req.get('x-api-key');
  if (!providedKey) {
    return res.status(401).json({ error: 'Envía una API key válida en x-api-key.' });
  }

  const requestedClientId = req.get('x-client-id') || req.body?.clientId;
  const isAdminKey = apiKeysMatch(providedKey, process.env.API_SECRET_KEY);
  const clientIdFromKey = [...clientApiKeys.entries()]
    .find(([, apiKey]) => apiKeysMatch(providedKey, apiKey))?.[0];

  if (!isAdminKey && (!clientIdFromKey || (requestedClientId && requestedClientId !== clientIdFromKey))) {
    return res.status(401).json({ error: 'La API key no autoriza el envío para este cliente.' });
  }

  const clientId = requestedClientId || clientIdFromKey;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'Envía un x-client-id válido para seleccionar la sesión.' });
  }

  req.clientId = clientId;
  next();
}

app.get('/health', (_req, res) => {
  const sessions = listSessions();
  const connectedCount = sessions.filter((session) => session.status === 'connected').length;
  const connected = connectedCount > 0;

  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'unavailable',
    whatsapp: connected ? 'connected' : 'disconnected',
    sessions: {
      total: sessions.length,
      connected: connectedCount,
    },
  });
});

app.post('/api/v1/instance/init', authenticateApiKey, async (req, res) => {
  const { clientId } = req.body ?? {};
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId es obligatorio y debe ser válido.' });
  }

  try {
    const session = await createSession(clientId);
    return res.status(202).json(session);
  } catch (error) {
    console.error(`[${clientId}] No se pudo inicializar la instancia:`, error);
    return res.status(500).json({ error: 'No se pudo inicializar la sesión de WhatsApp.' });
  }
});

app.get('/api/v1/instance/qr/:clientId', authenticateApiKey, (req, res) => {
  const { clientId } = req.params;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }

  const session = getSessionInfo(clientId);
  if (!session) {
    return res.status(404).json({ error: 'No existe una instancia para este clientId.' });
  }

  if (session.status !== 'qr_pending' || !session.qrDataUrl) {
    return res.status(409).json({
      error: 'La instancia no está esperando vinculación o el QR ya no está activo.',
      status: session.status,
    });
  }

  return res.status(200).json({
    clientId,
    format: 'data-url',
    qr: session.qrDataUrl,
  });
});

app.get('/api/v1/instance/status/:clientId', authenticateApiKey, (req, res) => {
  const { clientId } = req.params;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }

  const session = getSessionInfo(clientId);
  if (!session) {
    return res.status(404).json({ error: 'No existe una instancia para este clientId.' });
  }

  return res.status(200).json({
    clientId,
    status: session.status,
  });
});

app.post('/api/v1/sessions/:clientId', authenticateApiKey, async (req, res) => {
  const { clientId } = req.params;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }

  try {
    const session = await createSession(clientId);
    return res.status(202).json(session);
  } catch (error) {
    console.error(`[${clientId}] No se pudo crear la sesión:`, error);
    return res.status(500).json({ error: 'No se pudo crear la sesión de WhatsApp.' });
  }
});

app.get('/api/v1/sessions/:clientId', authenticateApiKey, (req, res) => {
  const session = getSessionInfo(req.params.clientId);
  if (!session) {
    return res.status(404).json({ error: 'No existe una sesión para este clientId.' });
  }

  return res.status(200).json(session);
});

app.delete('/api/v1/sessions/:clientId', authenticateApiKey, async (req, res) => {
  if (!isValidClientId(req.params.clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }

  try {
    await deleteSession(req.params.clientId);
    return res.status(204).end();
  } catch (error) {
    console.error(`[${req.params.clientId}] No se pudo eliminar la sesión:`, error);
    return res.status(500).json({ error: 'No se pudo eliminar la sesión de WhatsApp.' });
  }
});

app.post('/api/v1/send-message', authenticateSendMessage, async (req, res) => {
  const { phone, message } = req.body ?? {};
  const { clientId } = req;

  if (typeof phone !== 'string' || !/^\+?[\d\s().-]+$/.test(phone)) {
    return res.status(400).json({ error: 'phone debe ser un número telefónico válido.' });
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return res.status(400).json({ error: 'phone debe contener entre 8 y 15 dígitos.' });
  }

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message debe ser un texto no vacío.' });
  }

  const sessionInfo = getSessionInfo(clientId);
  const sock = getSession(clientId);
  if (sessionInfo?.status !== 'connected' || !sock) {
    return res.status(503).json({ error: 'La sesión de WhatsApp del cliente no está conectada.' });
  }

  const jid = `${digits}@s.whatsapp.net`;

  try {
    await sock.sendMessage(jid, { text: message });
    console.log(`Mensaje enviado a ${jid}.`);
    return res.status(200).json({ success: true, to: jid });
  } catch (error) {
    console.error(`Error al enviar mensaje a ${jid}:`, error);
    return res.status(502).json({ error: 'No se pudo enviar el mensaje a través de WhatsApp.' });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'El cuerpo de la solicitud debe ser JSON válido.' });
  }

  console.error('Error no controlado en la solicitud:', error);
  return res.status(500).json({ error: 'Error interno del servidor.' });
});

const server = app.listen(port, () => {
  console.log(`API Gateway escuchando en el puerto ${port}.`);
});

server.on('error', (error) => {
  console.error('No se pudo iniciar el servidor HTTP:', error);
  process.exitCode = 1;
});
