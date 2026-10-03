import { Router } from 'express';
import {
  capturePaypalPayment,
  createBinanceOrder,
  createPaypalOrder,
  facebankInfo,
  getMyPaymentHistory,
  listPendingPayments,
  pagoMovilInfo,
  paymentWebhook,
  reportFacebank,
  reportPagoMovil,
  retryNotification,
  reviewManualPayment,
} from '../controllers/paymentController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { getMySubscription } from '../controllers/subscriptionController.js';

const router = Router();

router.post('/webhook/:method', paymentWebhook);
router.use(requireAuth);
router.get('/history', getMyPaymentHistory);
router.get('/subscription', getMySubscription);
router.get('/pago-movil/info', pagoMovilInfo);
router.post('/pago-movil/report', reportPagoMovil);
router.get('/facebank/info', facebankInfo);
router.post('/facebank/report', reportFacebank);
router.post('/binance/create-order', createBinanceOrder);
router.post('/paypal/create-order', createPaypalOrder);
router.post('/paypal/capture-order', capturePaypalPayment);
router.get('/admin/pending', requireAdmin, listPendingPayments);
router.post('/admin/:paymentId/review', requireAdmin, reviewManualPayment);
router.post('/admin/notifications/:notificationId/retry', requireAdmin, retryNotification);

export default router;
