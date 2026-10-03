import mongoose from 'mongoose';
import { createClientId, getSubscriptionDurationDays } from '../config/settings.js';
import NotificationJob from '../models/NotificationJob.js';
import PaymentLog from '../models/PaymentLog.js';
import Subscription from '../models/Subscription.js';
import User from '../models/User.js';

export async function approvePayment(paymentId) {
  const mongoSession = await mongoose.startSession();
  let approvedPayment;

  try {
    await mongoSession.withTransaction(async () => {
      const payment = await PaymentLog.findById(paymentId).session(mongoSession);
      if (!payment) {
        const error = new Error('No se encontró el pago.');
        error.statusCode = 404;
        throw error;
      }

      if (payment.status === 'approved') {
        approvedPayment = payment;
        return;
      }
      if (payment.status !== 'pending') {
        const error = new Error('El pago no está pendiente de aprobación.');
        error.statusCode = 409;
        throw error;
      }

      const user = await User.findById(payment.userId).session(mongoSession);
      if (!user || user.status !== 'active') {
        const error = new Error('La cuenta asociada al pago no está activa.');
        error.statusCode = 409;
        throw error;
      }

      const clientId = user.clientId || createClientId();
      const currentSubscription = await Subscription.findOne({
        userId: user._id,
        clientId,
      }).session(mongoSession);
      const now = new Date();
      const existingExpiry =
        currentSubscription?.status === 'active' &&
        currentSubscription.expiresAt > now
          ? currentSubscription.expiresAt
          : now;
      const expiresAt = new Date(
        existingExpiry.getTime() + getSubscriptionDurationDays() * 24 * 60 * 60 * 1000,
      );

      user.clientId = clientId;
      await user.save({ session: mongoSession });

      await Subscription.findOneAndUpdate(
        { userId: user._id, clientId },
        {
          $set: {
            plan: payment.plan,
            paymentMethod: payment.method,
            status: 'active',
            expiresAt,
          },
          $setOnInsert: { userId: user._id, clientId },
        },
        { upsert: true, new: true, runValidators: true, session: mongoSession },
      );

      payment.clientId = clientId;
      payment.status = 'approved';
      await payment.save({ session: mongoSession });

      await NotificationJob.updateOne(
        { paymentId: payment._id },
        {
          $setOnInsert: {
            paymentId: payment._id,
            userId: user._id,
            status: 'pending',
            nextAttemptAt: now,
          },
        },
        { upsert: true, session: mongoSession },
      );
      approvedPayment = payment;
    });
  } finally {
    await mongoSession.endSession();
  }

  return approvedPayment;
}
