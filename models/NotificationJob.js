import mongoose from 'mongoose';

const notificationJobSchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentLog',
      required: true,
      unique: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'sending', 'sent', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    sentAt: Date,
    lastError: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

export default mongoose.models.NotificationJob ||
  mongoose.model('NotificationJob', notificationJobSchema);
