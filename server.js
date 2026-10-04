import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from './config/database.js';
import { plans, validateSecurityConfiguration } from './config/settings.js';
import { bootstrapAdmin } from './controllers/authController.js';
import authRoutes from './routes/authRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import { startNotificationWorker, stopNotificationWorker } from './services/notificationWorker.js';
import { isValidClientId, listSessions, stopSessions } from './sessionManager.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({
  limit: '1mb',
  verify(req, _res, buffer) {
    req.rawBody = Buffer.from(buffer);
  },
}));
app.use(express.static(path.join(currentDirectory, 'public')));

app.get('/health', (_req, res) => {
  const sessions = listSessions();
  const connectedCount = sessions.filter((session) => session.status === 'connected').length;
  const connected = connectedCount > 0;
  return res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'unavailable',
    service: 'wa-gateway',
    whatsapp: connected ? 'connected' : 'disconnected',
    sessions: { total: sessions.length, connected: connectedCount },
  });
});

app.get('/connect/:clientId', (req, res) => {
  if (!isValidClientId(req.params.clientId)) {
    return res.status(400).send('clientId inválido.');
  }
  return res.sendFile(path.join(currentDirectory, 'public', 'connect.html'));
});

app.get('/api/v1/plans', (_req, res) => {
  const result = Object.fromEntries(
    plans.map((plan) => {
      const priceUsd = Number(process.env[`PLAN_${plan.toUpperCase()}_USD`]);
      return [
        plan,
        {
          name: plan === 'basic' ? 'Básico' : 'Pro',
          priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
          durationDays: Number(process.env.SUBSCRIPTION_DURATION_DAYS || 30),
        },
      ];
    }),
  );
  return res.json({ plans: result });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1', whatsappRoutes);

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'El cuerpo de la solicitud debe ser JSON válido.' });
  }
  console.error('Error no controlado en la solicitud:', error);
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  return res.status(statusCode).json({
    error: statusCode === 500 ? 'Error interno del servidor.' : error.message,
  });
});

let httpServer;

async function start() {
  validateSecurityConfiguration();
  await connectDatabase();
  await bootstrapAdmin();
  startNotificationWorker();

  httpServer = app.listen(port, () => {
    console.log(`WA Gateway SaaS escuchando en el puerto ${port}.`);
  });
  httpServer.on('error', (error) => {
    console.error('No se pudo iniciar el servidor HTTP:', error);
    process.exitCode = 1;
  });
}

async function shutdown(signal) {
  console.log(`Recibida señal ${signal}; cerrando el servicio.`);
  stopNotificationWorker();
  await stopSessions();
  if (httpServer) {
    await new Promise((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
  const mongoose = await import('mongoose');
  await mongoose.default.disconnect();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').catch((error) => {
    console.error('Error durante el cierre:', error);
    process.exitCode = 1;
  });
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').catch((error) => {
    console.error('Error durante el cierre:', error);
    process.exitCode = 1;
  });
});

await start().catch((error) => {
  console.error('No se pudo iniciar WA Gateway SaaS:', error);
  process.exitCode = 1;
});
