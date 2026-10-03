import User from '../models/User.js';
import {
  authenticatePassword,
  createAccessToken,
  createUserCredentials,
} from '../services/authService.js';
import { createApiKey, encryptApiKey, hashApiKey } from '../services/cryptoService.js';

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    status: user.status,
    clientId: user.clientId || null,
    createdAt: user.createdAt,
  };
}

function validPhone(phone) {
  return typeof phone === 'string' && /^\+?[\d\s().-]{8,24}$/.test(phone) &&
    phone.replace(/\D/g, '').length >= 8 &&
    phone.replace(/\D/g, '').length <= 15;
}

export async function register(req, res, next) {
  const { name, email, password, phone } = req.body ?? {};
  if (
    typeof name !== 'string' ||
    name.trim().length < 2 ||
    name.trim().length > 120 ||
    typeof email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 128 ||
    !validPhone(phone)
  ) {
    return res.status(400).json({
      error: 'name, email, password (mínimo 12 caracteres) y phone válido son obligatorios.',
    });
  }

  try {
    const { user, apiKey } = await createUserCredentials({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      phone: phone.trim(),
    });
    return res.status(201).json({
      user: publicUser(user),
      token: createAccessToken(user),
      apiKey,
      warning: 'Guarda el API key: solo se muestra en esta respuesta.',
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    }
    return next(error);
  }
}

export async function login(req, res, next) {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email y password son obligatorios.' });
  }

  try {
    const user = await authenticatePassword(email.trim(), password);
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas.' });
    return res.json({ user: publicUser(user), token: createAccessToken(user) });
  } catch (error) {
    return next(error);
  }
}

export function getCurrentUser(req, res) {
  return res.json({ user: publicUser(req.authUser) });
}

export async function rotateApiKey(req, res, next) {
  try {
    const apiKey = createApiKey();
    req.authUser.apiKey = encryptApiKey(apiKey);
    req.authUser.apiKeyHash = hashApiKey(apiKey);
    await req.authUser.save();
    return res.json({
      apiKey,
      warning: 'Guarda el API key: solo se muestra en esta respuesta.',
    });
  } catch (error) {
    return next(error);
  }
}

export async function bootstrapAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL && !ADMIN_PASSWORD) return;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !process.env.ADMIN_PHONE || ADMIN_PASSWORD.length < 12) {
    throw new Error('Configura ADMIN_EMAIL, ADMIN_PHONE y ADMIN_PASSWORD de al menos 12 caracteres, o elimina las variables de administrador.');
  }

  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'admin') {
      throw new Error('ADMIN_EMAIL ya pertenece a una cuenta que no es admin.');
    }
    return;
  }

  await createUserCredentials({
    name: ADMIN_NAME?.trim() || 'Administrador',
    email,
    password: ADMIN_PASSWORD,
    phone: process.env.ADMIN_PHONE,
    role: 'admin',
  });
  console.log(`Cuenta administrativa inicial creada para ${email}.`);
}
