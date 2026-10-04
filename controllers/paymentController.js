import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import mongoose from 'mongoose';
import {
  getPagoMovilAmount,
  getPlanPrice,
} from '../config/settings.js';
import NotificationJob from '../models/NotificationJob.js';
import PaymentLog from '../models/PaymentLog.js';
import {
  capturePaypalOrder,
  createBinancePayOrder,
  createPaypalPayOrder,
  verifyBinanceWebhook,
  verifyPaypalWebhook,
} from '../services/paymentProviders.js';
import { approvePayment } from '../services/subscriptionService.js';

function providerError(res, error) {
  console.error('Error de proveedor de pagos:', error);
  return res.status(error.statusCode || 502).json({
    error: error.statusCode ? error.message : 'No se pudo completar la operación con el proveedor.',
  });
}

function isValidReference(reference) {
  return typeof reference === 'string' && /^[a-zA-Z0-9._/-]{3,160}$/.test(reference.trim());
}

function validProofUrl(proofUrl) {
  if (proofUrl === undefined || proofUrl === '') return true;
  if (typeof proofUrl !== 'string' || proofUrl.length > 2048) return false;
  try {
    const url = new URL(proofUrl);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

async function makeQrDataUrl(payload) {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
}

export async function pagoMovilInfo(req, res, next) {
  try {
    const { plan } = req.query;
    const usdAmount = getPlanPrice(plan);
    const amount = getPagoMovilAmount(usdAmount);
    const bankInfo = {
      bank: process.env.PAGO_MOVIL_BANK || '',
      bankCode: process.env.PAGO_MOVIL_BANK_CODE || '',
      phone: process.env.PAGO_MOVIL_PHONE || '',
      nationalId: process.env.PAGO_MOVIL_ID || '',
      accountHolder: process.env.PAGO_MOVIL_HOLDER || '',
      amount,
      currency: 'VES',
      plan,
    };
    if (Object.values(bankInfo).some((value) => value === '')) {
      return res.status(503).json({ error: 'Los datos de Pago Móvil no están configurados.' });
    }

    const payload = process.env.PAGO_MOVIL_QR_PAYLOAD ||
      JSON.stringify({ type: 'pago_movil', ...bankInfo });
    const qr = await makeQrDataUrl(payload);
    return res.json({
      ...bankInfo,
      qr,
      qrPayloadFormat: process.env.PAGO_MOVIL_QR_PAYLOAD
        ? 'configured'
        : 'gateway-json-not-a-bank-standard',
      instructions: 'Realiza el pago y registra la referencia en /pago-movil/report.',
    });
  } catch (error) {
    return next(error);
  }
}

export async function reportPagoMovil(req, res, next) {
  return createManualPayment(req, res, next, 'pago_movil');
}

export async function facebankInfo(_req, res) {
  const info = {
    routingNumber: process.env.FACEBANK_ROUTING_NUMBER || '',
    accountNumber: process.env.FACEBANK_ACCOUNT_NUMBER || '',
    accountHolder: process.env.FACEBANK_ACCOUNT_HOLDER || '',
    pipolPayEmail: process.env.PIPOL_PAY_EMAIL || '',
    instructions:
      process.env.FACEBANK_PAYMENT_INSTRUCTIONS ||
      'Usa transferencia ACH o Pipol Pay e incluye la referencia al reportar el pago.',
    currency: 'USD',
  };
  if (!info.routingNumber || !info.accountNumber || !info.pipolPayEmail || !info.accountHolder) {
    return res.status(503).json({ error: 'Los datos de Facebank/Pipol Pay no están configurados.' });
  }
  return res.json(info);
}

export async function reportFacebank(req, res, next) {
  return createManualPayment(req, res, next, 'facebank');
}

async function createManualPayment(req, res, next, method) {
  const { plan, reference, proofUrl } = req.body ?? {};
  if (!isValidReference(reference) || !validProofUrl(proofUrl)) {
    return res.status(400).json({
      error: 'reference válida y proofUrl HTTP(S) opcional son obligatorios.',
    });
  }

  try {
    const usdAmount = getPlanPrice(plan);
    const amount = method === 'pago_movil' ? getPagoMovilAmount(usdAmount) : usdAmount;
    const payment = await PaymentLog.create({
      userId: req.authUser._id,
      reference: reference.trim(),
      amount,
      currency: method === 'pago_movil' ? 'VES' : 'USD',
      method,
      proofUrl,
      plan,
    });
    return res.status(201).json({
      paymentId: payment.id,
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'La referencia de pago ya fue registrada.' });
    }
    if (error.statusCode) return providerError(res, error);
    return next(error);
  }
}

export async function createBinanceOrder(req, res, next) {
  try {
    const amount = getPlanPrice(req.body?.plan);
    const payment = await PaymentLog.create({
      userId: req.authUser._id,
      reference: `BN-${randomUUID()}`,
      amount,
      currency: 'USDT',
      method: 'binance',
      plan: req.body.plan,
    });

    try {
      const order = await createBinancePayOrder(payment);
      payment.providerOrderId = order.prepayId;
      payment.metadata = { checkoutUrl: order.checkoutUrl || null };
      await payment.save();
      return res.status(201).json({
        paymentId: payment.id,
        reference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        orderId: order.prepayId,
        checkoutUrl: order.checkoutUrl || null,
        qrCode: order.qrcodeLink || null,
        deeplink: order.deeplink || null,
      });
    } catch (error) {
      await PaymentLog.deleteOne({ _id: payment._id, status: 'pending' });
      throw error;
    }
  } catch (error) {
    return providerError(res, error);
  }
}

export async function createPaypalOrder(req, res, next) {
  try {
    const amount = getPlanPrice(req.body?.plan);
    const payment = await PaymentLog.create({
      userId: req.authUser._id,
      reference: `PP-${randomUUID()}`,
      amount,
      currency: 'USD',
      method: 'paypal',
      plan: req.body.plan,
    });

    try {
      const order = await createPaypalPayOrder(payment);
      payment.providerOrderId = order.id;
      await payment.save();
      return res.status(201).json({
        paymentId: payment.id,
        reference: payment.reference,
        orderId: order.id,
        status: order.status,
        links: order.links,
      });
    } catch (error) {
      await PaymentLog.deleteOne({ _id: payment._id, status: 'pending' });
      throw error;
    }
  } catch (error) {
    return providerError(res, error);
  }
}

function paypalCaptureDetails(order) {
  const capture = order.purchase_units?.[0]?.payments?.captures?.find(
    (item) => item.status === 'COMPLETED',
  );
  return capture?.amount;
}

function amountsMatch(actual, expected, currency) {
  return actual?.currency_code === currency &&
    Number(actual.value).toFixed(2) === Number(expected).toFixed(2);
}

export async function capturePaypalPayment(req, res, next) {
  const { orderId } = req.body ?? {};
  if (typeof orderId !== 'string' || orderId.length > 128) {
    return res.status(400).json({ error: 'orderId es obligatorio.' });
  }

  try {
    const payment = await PaymentLog.findOne({
      userId: req.authUser._id,
      method: 'paypal',
      providerOrderId: orderId,
    });
    if (!payment) return res.status(404).json({ error: 'No se encontró la orden PayPal.' });
    if (payment.status === 'approved') {
      return res.json({ success: true, status: payment.status });
    }

    const order = await capturePaypalOrder(orderId);
    const capturedAmount = paypalCaptureDetails(order);
    if (
      order.status !== 'COMPLETED' ||
      !amountsMatch(capturedAmount, payment.amount, payment.currency)
    ) {
      return res.status(409).json({ error: 'PayPal no confirmó un pago completo por el importe esperado.' });
    }

    await approvePayment(payment._id);
    return res.json({ success: true, status: 'approved' });
  } catch (error) {
    return providerError(res, error);
  }
}

export async function paymentWebhook(req, res, next) {
  const { method } = req.params;

  try {
    if (method === 'binance') {
      if (!verifyBinanceWebhook(req)) {
        return res.status(401).json({ error: 'Firma de Binance Pay inválida.' });
      }
      const data = req.body?.data;
      if (data?.bizStatus !== 'PAY_SUCCESS') return res.status(200).json({ received: true });

      const payment = await PaymentLog.findOne({
        method: 'binance',
        reference: data.merchantTradeNo,
      });
      if (!payment) return res.status(404).json({ error: 'Orden Binance desconocida.' });
      if (
        !amountsMatch(
          { value: data.orderAmount, currency_code: data.currency },
          payment.amount,
          payment.currency,
        )
      ) {
        return res.status(409).json({ error: 'El importe del webhook no coincide con la orden.' });
      }

      await approvePayment(payment._id);
      return res.json({ received: true });
    }

    if (method === 'paypal') {
      if (!(await verifyPaypalWebhook(req))) {
        return res.status(401).json({ error: 'Firma de PayPal inválida.' });
      }
      if (req.body?.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
        return res.status(200).json({ received: true });
      }

      const resource = req.body.resource || {};
      const relatedOrderId = resource.supplementary_data?.related_ids?.order_id;
      const criteria = [];
      if (relatedOrderId) criteria.push({ providerOrderId: relatedOrderId });
      if (resource.invoice_id) criteria.push({ reference: resource.invoice_id });
      if (mongoose.isValidObjectId(resource.custom_id)) {
        criteria.push({ _id: resource.custom_id });
      }
      if (!criteria.length) return res.status(400).json({ error: 'Webhook PayPal sin referencia de orden.' });
      const payment = await PaymentLog.findOne({ method: 'paypal', $or: criteria });
      if (!payment) return res.status(404).json({ error: 'Orden PayPal desconocida.' });
      if (!amountsMatch(resource.amount, payment.amount, payment.currency)) {
        return res.status(409).json({ error: 'El importe del webhook no coincide con la orden.' });
      }

      await approvePayment(payment._id);
      return res.json({ received: true });
    }

    return res.status(404).json({ error: 'Método de webhook no admitido.' });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    return next(error);
  }
}

export async function getMyPaymentHistory(req, res, next) {
  try {
    const payments = await PaymentLog.find({ userId: req.authUser._id })
      .select('reference amount currency method status plan createdAt updatedAt')
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json({ payments });
  } catch (error) {
    return next(error);
  }
}

export async function listPendingPayments(_req, res, next) {
  try {
    const payments = await PaymentLog.find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate('userId', 'name email phone');
    return res.json({ payments });
  } catch (error) {
    return next(error);
  }
}

export async function reviewManualPayment(req, res, next) {
  const { action } = req.body ?? {};
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action debe ser approve o reject.' });
  }

  try {
    const payment = await PaymentLog.findOne({
      _id: req.params.paymentId,
      method: { $in: ['pago_movil', 'facebank'] },
    });
    if (!payment) return res.status(404).json({ error: 'No se encontró el pago manual.' });
    if (payment.status !== 'pending') {
      return res.status(409).json({ error: 'El pago ya fue procesado.' });
    }

    if (action === 'approve') {
      await approvePayment(payment._id);
      return res.json({ success: true, status: 'approved' });
    }

    const rejected = await PaymentLog.findOneAndUpdate(
      { _id: payment._id, status: 'pending' },
      { $set: { status: 'rejected' } },
      { returnDocument: 'after' },
    );
    if (!rejected) return res.status(409).json({ error: 'El pago ya fue procesado.' });
    await NotificationJob.deleteOne({ paymentId: payment._id });
    return res.json({ success: true, status: 'rejected' });
  } catch (error) {
    if (error instanceof mongoose.Error.CastError) {
      return res.status(400).json({ error: 'paymentId inválido.' });
    }
    return next(error);
  }
}

export async function retryNotification(req, res, next) {
  try {
    const job = await NotificationJob.findByIdAndUpdate(
      { _id: req.params.notificationId, status: 'failed' },
      {
        $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null },
      },
      { returnDocument: 'after' },
    );
    if (!job) {
      return res.status(404).json({ error: 'No se encontró una notificación fallida para reintentar.' });
    }
    return res.json({ success: true, notificationId: job.id, status: job.status });
  } catch (error) {
    if (error instanceof mongoose.Error.CastError) {
      return res.status(400).json({ error: 'notificationId inválido.' });
    }
    return next(error);
  }
}
