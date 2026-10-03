import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { createApiKey, encryptApiKey, hashApiKey } from './cryptoService.js';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 bytes.');
  }
  return secret;
}

export async function createUserCredentials({ name, email, password, phone, role = 'client' }) {
  const apiKey = createApiKey();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password: passwordHash,
    role,
    apiKey: encryptApiKey(apiKey),
    apiKeyHash: hashApiKey(apiKey),
    phone,
  });

  return { user, apiKey };
}

export function createAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h', issuer: 'wa-gateway' },
  );
}

export async function authenticatePassword(email, password) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password))) {
    return null;
  }
  return user;
}

export async function authenticateApiKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey) return null;
  return User.findOne({
    apiKeyHash: hashApiKey(apiKey),
    status: 'active',
  }).select('+apiKeyHash');
}

export function verifyAccessToken(token) {
  return jwt.verify(token, jwtSecret(), { issuer: 'wa-gateway' });
}
