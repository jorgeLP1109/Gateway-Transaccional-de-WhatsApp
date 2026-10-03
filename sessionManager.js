import { chmod, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

const sessions = new Map();
const sessionsDirectory = resolve(process.cwd(), 'sessions');
const reconnectDelayMs = 3000;
const clientIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;

let baileysVersionPromise;

function assertClientId(clientId) {
  if (typeof clientId !== 'string' || !clientIdPattern.test(clientId)) {
    throw new TypeError('clientId debe tener entre 1 y 64 caracteres alfanuméricos, guion o guion bajo.');
  }
}

async function getBaileysVersion() {
  baileysVersionPromise ??= fetchLatestBaileysVersion();

  try {
    return await baileysVersionPromise;
  } catch (error) {
    baileysVersionPromise = undefined;
    throw error;
  }
}

function scheduleReconnect(clientId, session, delayMs = reconnectDelayMs) {
  if (sessions.get(clientId) !== session || session.reconnectTimer) return;

  console.log(`[${clientId}] Reintentando conexión de WhatsApp en ${delayMs / 1000} segundos...`);
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = undefined;
    session.startPromise = connectSession(clientId, session);
  }, delayMs);
}

async function connectSession(clientId, session) {
  if (sessions.get(clientId) !== session) return;

  session.status = 'connecting';

  try {
    const { version } = await getBaileysVersion();
    console.log(`[${clientId}] Versión de Baileys detectada: ${version.join('.')}`);

    const authDirectory = resolve(sessionsDirectory, clientId);
    await mkdir(authDirectory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      await chmod(authDirectory, 0o700);
    }
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
    if (sessions.get(clientId) !== session) return;

    const socket = makeWASocket({
      auth: state,
      version,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      defaultQueryTimeoutMs: 0,
    });
    if (sessions.get(clientId) !== session) {
      await socket.end(new Error('Session was stopped during startup'));
      return;
    }
    session.socket = socket;

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (sessions.get(clientId) !== session || session.socket !== socket) return;

      if (qr) {
        const qrGeneration = ++session.qrGeneration;
        console.log(`[${clientId}] Se generó un QR para vincular la sesión.`);
        void QRCode.toDataURL(qr)
          .then((qrDataUrl) => {
            if (
              sessions.get(clientId) === session &&
              session.socket === socket &&
              session.qrGeneration === qrGeneration &&
              session.status !== 'connected'
            ) {
              session.qrDataUrl = qrDataUrl;
              session.status = 'qr_pending';
            }
          })
          .catch((error) => {
            console.error(`[${clientId}] No se pudo convertir el QR a DataURL:`, error);
          });
      }

      if (connection === 'open') {
        session.status = 'connected';
        session.qrDataUrl = null;
        console.log(`[${clientId}] Conexión con WhatsApp establecida.`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const wasLoggedOut = statusCode === DisconnectReason.loggedOut;

        session.socket = undefined;
        session.qrDataUrl = null;
        session.status = wasLoggedOut ? 'logged_out' : 'disconnected';
        console.error(
          `[${clientId}] Conexión con WhatsApp cerrada${statusCode ? ` (código ${statusCode})` : ''}.`,
          lastDisconnect?.error ?? '',
        );

        if (wasLoggedOut) {
          console.error(`[${clientId}] La sesión cerró sesión. Elimina las credenciales y vuelve a crearla.`);
        } else {
          scheduleReconnect(clientId, session, statusCode === 515 ? 0 : reconnectDelayMs);
        }
      }
    });
  } catch (error) {
    if (sessions.get(clientId) !== session) return;

    session.socket = undefined;
    session.status = 'disconnected';
    console.error(`[${clientId}] No se pudo iniciar la conexión con WhatsApp:`, error);
    scheduleReconnect(clientId, session);
  }
}

export function isValidClientId(clientId) {
  return typeof clientId === 'string' && clientIdPattern.test(clientId);
}

export async function createSession(clientId) {
  assertClientId(clientId);

  const existingSession = sessions.get(clientId);
  if (existingSession) {
    return getSessionInfo(clientId);
  }

  const session = {
    socket: undefined,
    status: 'connecting',
    qrDataUrl: null,
    qrGeneration: 0,
    reconnectTimer: undefined,
    startPromise: undefined,
  };
  sessions.set(clientId, session);
  session.startPromise = connectSession(clientId, session);
  await session.startPromise;

  return getSessionInfo(clientId);
}

export function getSession(clientId) {
  return isValidClientId(clientId) ? sessions.get(clientId)?.socket : undefined;
}

export function getSessionInfo(clientId) {
  if (!isValidClientId(clientId)) return undefined;

  const session = sessions.get(clientId);
  if (!session) return undefined;

  return {
    clientId,
    status: session.status,
    qrDataUrl: session.qrDataUrl,
  };
}

export function listSessions() {
  return [...sessions.keys()].map((clientId) => getSessionInfo(clientId));
}

export async function deleteSession(clientId) {
  assertClientId(clientId);

  const session = sessions.get(clientId);
  if (session) {
    sessions.delete(clientId);
    clearTimeout(session.reconnectTimer);

    await session.startPromise;
    try {
      await session.socket?.logout('Client unlinked');
    } catch (error) {
      console.error(`[${clientId}] Error al cerrar la sesión de WhatsApp:`, error);
    }
  }

  await rm(resolve(sessionsDirectory, clientId), { recursive: true, force: true });
  console.log(`[${clientId}] Sesión y credenciales eliminadas.`);
}

export async function stopSessions() {
  const activeSessions = [...sessions.values()];
  sessions.clear();

  await Promise.all(
    activeSessions.map(async (session) => {
      clearTimeout(session.reconnectTimer);
      try {
        await session.socket?.end(new Error('Gateway shutting down'));
      } catch (error) {
        console.error('Error cerrando una sesión de WhatsApp:', error);
      }
    }),
  );
}