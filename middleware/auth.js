import { timingSafeEqual } from 'node:crypto';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { authenticateApiKey, verifyAccessToken } from '../services/authService.js';

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAdminApiKey(value) {
  const expected = process.env.API_KEY || process.env.API_SECRET_KEY;
  return Boolean(expected && safeEqual(value, expected));
}

export function loadLegacyClientApiKeys() {
  const value = process.env.CLIENT_API_KEYS;
  if (!value) return new Map();

  let entries;
  try {
    entries = Object.entries(JSON.parse(value));
  } catch {
    throw new Error('CLIENT_API_KEYS debe ser un objeto JSON válido.');
  }

  const keys = new Map();
  const uniqueKeys = new Set();
  for (const [clientId, apiKey] of entries) {
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(clientId) ||
      typeof apiKey !== 'string' ||
      !apiKey.trim() ||
      uniqueKeys.has(apiKey)
    ) {
      throw new Error('CLIENT_API_KEYS contiene una asociación inválida o duplicada.');
    }
    uniqueKeys.add(apiKey);
    keys.set(clientId, apiKey);
  }
  return keys;
}

export const legacyClientApiKeys = loadLegacyClientApiKeys();

export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Se requiere un token Bearer válido.' });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'La cuenta no está activa.' });
    }
    req.authUser = user;
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'El token es inválido o expiró.' });
    }
    return next(error);
  }
}

export function requireAdmin(req, res, next) {
  if (req.authUser?.role !== 'admin') {
    return res.status(403).json({ error: 'Se requiere el rol admin.' });
  }
  return next();
}

export async function authenticateGatewayRequest(req, res, next) {
  const suppliedKey = req.get('x-api-key');
  const [scheme, bearerToken] = (req.get('authorization') || '').split(' ');

  try {
    if (scheme === 'Bearer' && bearerToken) {
      try {
        const payload = verifyAccessToken(bearerToken);
        const user = await User.findById(payload.sub);
        if (!user || user.status !== 'active') {
          return res.status(401).json({ error: 'La cuenta no está activa.' });
        }
        req.authUser = user;
        return next();
      } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'El token es inválido o expiró.' });
        }
        throw error;
      }
    }

    if (isAdminApiKey(suppliedKey)) {
      req.isGatewayAdmin = true;
      return next();
    }

    const legacyClientId = [...legacyClientApiKeys.entries()]
      .find(([, key]) => safeEqual(suppliedKey, key))?.[0];
    if (legacyClientId) {
      req.legacyClientId = legacyClientId;
      return next();
    }

    const user = await authenticateApiKey(suppliedKey);
    if (user) {
      req.authUser = user;
      return next();
    }

    return res.status(401).json({ error: 'API key inválida o ausente.' });
  } catch (error) {
    return next(error);
  }
}

export async function hasActiveClientSubscription(userId, clientId) {
  return Subscription.exists({
    userId,
    clientId,
    status: 'active',
    expiresAt: { $gt: new Date() },
  });
}
