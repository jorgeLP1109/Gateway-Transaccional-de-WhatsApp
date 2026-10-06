import { Router } from 'express';
import {
  createSession,
  deleteSession,
  getSession,
  getSessionInfo,
  isValidClientId,
  listSessions,
} from '../sessionManager.js';
import {
  authenticateGatewayRequest,
  hasActiveClientSubscription,
} from '../middleware/auth.js';
import { normalizeWhatsAppJid, sendWhatsAppMessage } from '../services/whatsappMessaging.js';

const router = Router();

function requireClientOwnership(req, res, clientId) {
  if (req.isGatewayAdmin || req.authUser?.role === 'admin') return true;
  if (req.legacyClientId) {
    if (req.legacyClientId === clientId) return true;
    res.status(403).json({ error: 'La API key no autoriza esta instancia.' });
    return false;
  }
  if (req.authUser?.clientId !== clientId) {
    res.status(403).json({ error: 'La instancia no pertenece a esta cuenta.' });
    return false;
  }
  return true;
}

async function requireSubscription(req, res, clientId) {
  if (!req.authUser || req.authUser.role === 'admin') return true;
  const active = await hasActiveClientSubscription(req.authUser._id, clientId);
  if (active) return true;
  res.status(403).json({ error: 'La instancia no tiene una suscripción activa.' });
  return false;
}

router.get('/health', (_req, res) => {
  const sessions = listSessions();
  const connectedCount = sessions.filter((session) => session.status === 'connected').length;
  const connected = connectedCount > 0;
  return res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'unavailable',
    whatsapp: connected ? 'connected' : 'disconnected',
    sessions: { total: sessions.length, connected: connectedCount },
  });
});

router.post('/instance/init', authenticateGatewayRequest, async (req, res) => {
  const clientId = req.body?.clientId || req.authUser?.clientId || req.legacyClientId;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId es obligatorio y debe ser válido.' });
  }
  if (!requireClientOwnership(req, res, clientId)) return;
  if (!(await requireSubscription(req, res, clientId))) return;

  try {
    return res.status(202).json(await createSession(clientId));
  } catch (error) {
    console.error(`[${clientId}] No se pudo inicializar la instancia:`, error);
    return res.status(500).json({ error: 'No se pudo inicializar la sesión de WhatsApp.' });
  }
});

router.get('/instance/qr/:clientId', authenticateGatewayRequest, async (req, res, next) => {
  const { clientId } = req.params;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }
  if (!requireClientOwnership(req, res, clientId)) return;
  if (!(await requireSubscription(req, res, clientId))) return;

  try {
    if (!getSessionInfo(clientId)) await createSession(clientId);
    const session = getSessionInfo(clientId);
    if (session.status !== 'qr_pending' || !session.qrDataUrl) {
      return res.status(409).json({
        error: 'La instancia no está esperando vinculación o el QR aún no está disponible.',
        status: session.status,
      });
    }
    return res.json({ clientId, status: session.status, qr: session.qrDataUrl });
  } catch (error) {
    return next(error);
  }
});

router.get('/instance/status/:clientId', authenticateGatewayRequest, async (req, res) => {
  const { clientId } = req.params;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }
  if (!requireClientOwnership(req, res, clientId)) return;
  if (!(await requireSubscription(req, res, clientId))) return;

  const session = getSessionInfo(clientId);
  if (!session) return res.status(404).json({ error: 'No existe una instancia para este clientId.' });
  return res.json({ clientId, status: session.status });
});

router.post('/sessions/:clientId', authenticateGatewayRequest, async (req, res) => {
  const { clientId } = req.params;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }
  if (!requireClientOwnership(req, res, clientId)) return;
  if (!(await requireSubscription(req, res, clientId))) return;

  try {
    return res.status(202).json(await createSession(clientId));
  } catch (error) {
    console.error(`[${clientId}] No se pudo crear la sesión:`, error);
    return res.status(500).json({ error: 'No se pudo crear la sesión de WhatsApp.' });
  }
});

router.get('/sessions/:clientId', authenticateGatewayRequest, async (req, res) => {
  const { clientId } = req.params;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }
  if (!requireClientOwnership(req, res, clientId)) return;
  if (!(await requireSubscription(req, res, clientId))) return;
  const session = getSessionInfo(clientId);
  if (!session) return res.status(404).json({ error: 'No existe una sesión para este clientId.' });
  return res.json(session);
});

router.delete('/sessions/:clientId', authenticateGatewayRequest, async (req, res) => {
  const { clientId } = req.params;
  if (!isValidClientId(clientId)) {
    return res.status(400).json({ error: 'clientId no es válido.' });
  }
  if (!requireClientOwnership(req, res, clientId)) return;
  if (!(await requireSubscription(req, res, clientId))) return;

  try {
    await deleteSession(clientId);
    return res.status(204).end();
  } catch (error) {
    console.error(`[${clientId}] No se pudo eliminar la sesión:`, error);
    return res.status(500).json({ error: 'No se pudo eliminar la sesión de WhatsApp.' });
  }
});

router.post('/send-message', authenticateGatewayRequest, async (req, res) => {
  const requestedClientId =
    req.get('x-client-id') ||
    req.body?.clientId ||
    req.authUser?.clientId ||
    req.legacyClientId;
  if (!isValidClientId(requestedClientId)) {
    return res.status(400).json({ error: 'Envía un clientId válido para seleccionar la sesión.' });
  }

  if (!req.isGatewayAdmin && req.authUser?.role !== 'admin') {
    if (req.legacyClientId && req.legacyClientId !== requestedClientId) {
      return res.status(403).json({ error: 'La API key no autoriza el envío para este cliente.' });
    }
    if (req.authUser?.clientId !== requestedClientId) {
      return res.status(403).json({ error: 'La instancia no pertenece a esta cuenta.' });
    }
    if (!(await hasActiveClientSubscription(req.authUser._id, requestedClientId))) {
      return res.status(403).json({ error: 'La suscripción no está activa.' });
    }
  }

  const phone = req.body?.phone ?? req.body?.number;
  const { message } = req.body ?? {};
  let jid;
  try {
    jid = normalizeWhatsAppJid(phone);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return res.status(400).json({ error: 'phone/number debe contener entre 8 y 15 dígitos válidos.' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message debe ser un texto no vacío.' });
  }

  const sessionInfo = getSessionInfo(requestedClientId);
  const sock = getSession(requestedClientId);
  if (sessionInfo?.status !== 'connected' || !sock) {
    return res.status(503).json({ error: 'La sesión de WhatsApp del cliente no está conectada.' });
  }

  try {
    const result = await sendWhatsAppMessage(sock, jid, { text: message });
    return res.json({ success: true, to: jid, messageId: result?.key?.id ?? null });
  } catch (error) {
    console.error(`Error al enviar mensaje a ${jid}:`, error);
    return res.status(502).json({ error: 'No se pudo enviar el mensaje a través de WhatsApp.' });
  }
});

export default router;
