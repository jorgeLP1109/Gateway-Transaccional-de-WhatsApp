import { getSession, getSessionInfo, createSession, isValidClientId } from '../sessionManager.js';
import NotificationJob from '../models/NotificationJob.js';
import PaymentLog from '../models/PaymentLog.js';
import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import { decryptApiKey } from './cryptoService.js';

const maxAttempts = 10;
const pollDelayMs = 5_000;
const staleLeaseMs = 2 * 60_000;
let timer;
let stopped = false;
let lastExpirySweepAt = 0;

function nextDelay(attempts) {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60_000);
}

async function sendWelcome(job) {
  const senderClientId = process.env.SYSTEM_WHATSAPP_CLIENT_ID;
  if (!isValidClientId(senderClientId)) {
    throw new Error('SYSTEM_WHATSAPP_CLIENT_ID no está configurado con un clientId válido.');
  }

  const [user, payment] = await Promise.all([
    User.findById(job.userId).select('+apiKey'),
    PaymentLog.findById(job.paymentId),
  ]);
  if (!user || !payment || !user.clientId || user.status !== 'active') {
    throw new Error('No se encontró una cuenta activa, su suscripción o su clientId.');
  }

  if (!getSessionInfo(senderClientId)) {
    await createSession(senderClientId);
  }
  const sender = getSession(senderClientId);
  if (getSessionInfo(senderClientId)?.status !== 'connected' || !sender) {
    throw new Error('La sesión SYSTEM_WHATSAPP_CLIENT_ID no está conectada.');
  }

  const recipient = user.phone.replace(/\D/g, '');
  const apiKey = decryptApiKey(user.apiKey);
  const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const connectUrl = baseUrl
    ? `${baseUrl}/connect/${encodeURIComponent(user.clientId)}`
    : 'la ruta /connect/{clientId} de tu gateway';
  const message = [
    `¡Pago confirmado! Tu suscripción ${payment.plan} ya está activa.`,
    `clientId: ${user.clientId}`,
    `API Key: ${apiKey}`,
    `Escanea el QR de tu instancia en: ${connectUrl}`,
    'Guarda tu API Key en un lugar seguro y no la compartas.',
  ].join('\n');

  await sender.sendMessage(`${recipient}@s.whatsapp.net`, { text: message });
}

async function processOneJob() {
  const now = new Date();
  const job = await NotificationJob.findOneAndUpdate(
    {
      attempts: { $lt: maxAttempts },
      $or: [
        { status: 'pending', nextAttemptAt: { $lte: now } },
        { status: 'sending', updatedAt: { $lte: new Date(now.getTime() - staleLeaseMs) } },
      ],
    },
    {
      $set: { status: 'sending' },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { nextAttemptAt: 1 } },
  );

  if (!job) {
    await NotificationJob.updateMany(
      { status: { $in: ['pending', 'sending'] }, attempts: { $gte: maxAttempts } },
      { $set: { status: 'failed' } },
    );
    return;
  }

  try {
    await sendWelcome(job);
    job.status = 'sent';
    job.sentAt = new Date();
    job.lastError = undefined;
    await job.save();
    console.log(`Notificación de bienvenida enviada para pago ${job.paymentId}.`);
  } catch (error) {
    const exhausted = job.attempts >= maxAttempts;
    job.status = exhausted ? 'failed' : 'pending';
    job.nextAttemptAt = new Date(Date.now() + nextDelay(job.attempts));
    job.lastError = String(error.message || error).slice(0, 500);
    await job.save();
    console.error(
      `No se pudo enviar la bienvenida para pago ${job.paymentId} (intento ${job.attempts}/${maxAttempts}):`,
      error,
    );
  }
}

async function tick() {
  if (stopped) return;
  try {
    if (Date.now() - lastExpirySweepAt >= 15 * 60_000) {
      const result = await Subscription.updateMany(
        { status: 'active', expiresAt: { $lte: new Date() } },
        { $set: { status: 'expired' } },
      );
      lastExpirySweepAt = Date.now();
      if (result.modifiedCount) {
        console.log(`Suscripciones expiradas: ${result.modifiedCount}.`);
      }
    }
    await processOneJob();
  } catch (error) {
    console.error('Error procesando la cola de notificaciones:', error);
  } finally {
    if (!stopped) {
      timer = setTimeout(tick, pollDelayMs);
      timer.unref?.();
    }
  }
}

export function startNotificationWorker() {
  stopped = false;
  void tick();
}

export function stopNotificationWorker() {
  stopped = true;
  clearTimeout(timer);
}
