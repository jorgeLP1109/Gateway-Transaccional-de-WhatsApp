import mongoose from 'mongoose';

const paymentLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reference: { type: String, required: true, unique: true, trim: true, maxlength: 160 },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, required: true, uppercase: true, maxlength: 8 },
    method: {
      type: String,
      enum: ['pago_movil', 'facebank', 'binance', 'paypal'],
      required: true,
      index: true,
    },
    proofUrl: { type: String, trim: true, maxlength: 2048 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    plan: { type: String, enum: ['basic', 'pro'], required: true },
    clientId: { type: String, trim: true },
    providerOrderId: { type: String, sparse: true, unique: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);

paymentLogSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.PaymentLog ||
  mongoose.model('PaymentLog', paymentLogSchema);
