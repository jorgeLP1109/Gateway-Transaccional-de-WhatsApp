import mongoose from 'mongoose';

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI es obligatorio para iniciar el servicio SaaS.');
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
  });

  console.log('Conexión con MongoDB establecida.');
}
