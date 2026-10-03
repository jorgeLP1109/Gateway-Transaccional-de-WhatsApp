import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'client'], default: 'client', required: true },
    apiKey: { type: String, required: true, select: false },
    apiKeyHash: { type: String, required: true, unique: true, select: false },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', required: true },
    clientId: { type: String, unique: true, sparse: true, default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default mongoose.models.User || mongoose.model('User', userSchema);
