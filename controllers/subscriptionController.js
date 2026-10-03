import Subscription from '../models/Subscription.js';

export async function getMySubscription(req, res, next) {
  try {
    const subscription = await Subscription.findOne({ userId: req.authUser._id })
      .sort({ updatedAt: -1 });
    if (!subscription) return res.json({ subscription: null });

    const expired = subscription.expiresAt <= new Date();
    return res.json({
      subscription: {
        id: subscription.id,
        clientId: subscription.clientId,
        plan: subscription.plan,
        paymentMethod: subscription.paymentMethod,
        status: expired && subscription.status === 'active' ? 'expired' : subscription.status,
        expiresAt: subscription.expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}
