import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clientId: { type: String, required: true, unique: true },
    plan: { type: String, enum: ['basic', 'pro'], required: true },
    paymentMethod: {
      type: String,
      enum: ['pago_movil', 'facebank', 'binance', 'paypal'],
      required: true,
    },
    status: { type: String, enum: ['pending', 'active', 'expired'], default: 'pending' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

subscriptionSchema.index({ userId: 1, status: 1, expiresAt: 1 });

export default mongoose.models.Subscription ||
  mongoose.model('Subscription', subscriptionSchema);
