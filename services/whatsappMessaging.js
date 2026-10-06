const sendQueues = new WeakMap();

export function getRandomDelay(min = 3500, max = 7500) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    throw new RangeError('El rango del retraso debe contener enteros válidos.');
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function normalizeWhatsAppJid(phone) {
  if (typeof phone !== 'string') {
    throw new TypeError('El teléfono debe ser una cadena válida.');
  }

  const input = phone.trim().replace(/@s\.whatsapp\.net$/i, '');
  if (!/^\+?[\d\s().-]+$/.test(input)) {
    throw new TypeError('El teléfono debe contener solo dígitos y separadores permitidos.');
  }

  const digits = input.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw new TypeError('El teléfono debe contener entre 8 y 15 dígitos.');
  }

  return `${digits}@s.whatsapp.net`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updatePresence(sock, presence, jid) {
  try {
    await sock.sendPresenceUpdate(presence, jid);
    return true;
  } catch (error) {
    console.warn(`No se pudo actualizar la presencia de WhatsApp a "${presence}" para ${jid}:`, error);
    return false;
  }
}

export async function sendWhatsAppMessage(sock, phone, content) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new TypeError('Se requiere una sesión de WhatsApp válida para enviar el mensaje.');
  }

  const jid = normalizeWhatsAppJid(phone);
  const previousSend = sendQueues.get(sock) ?? Promise.resolve();
  const currentSend = previousSend.catch(() => undefined).then(async () => {
    await wait(getRandomDelay());
    const shouldPausePresence = await updatePresence(sock, 'composing', jid);
    await wait(getRandomDelay(1500, 2500));

    try {
      return await sock.sendMessage(jid, content);
    } finally {
      if (shouldPausePresence) await updatePresence(sock, 'paused', jid);
    }
  });

  sendQueues.set(sock, currentSend);
  try {
    return await currentSend;
  } finally {
    if (sendQueues.get(sock) === currentSend) sendQueues.delete(sock);
  }
}
