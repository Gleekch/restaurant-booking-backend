const Reservation = require('../models/Reservation');
const { getStripe, getStripeMode, expireCheckoutSession } = require('./paymentService');

async function reconcileCheckout(reservation, io) {
  const deposit = reservation.deposit;
  if (deposit?.status !== 'awaiting' || !deposit.expiresAt
    || new Date(deposit.expiresAt).getTime() >= Date.now()) return { skipped: true };
  const filter = { _id: reservation._id, status: reservation.status,
    'deposit.status': 'awaiting', 'deposit.checkoutAttempt': deposit.checkoutAttempt,
    'deposit.stripeSessionId': deposit.stripeSessionId || null };
  const claimed = await Reservation.findOneAndUpdate(filter,
    { $set: { 'deposit.checkoutCheckedAt': new Date() } }, { new: true });
  if (!claimed) return { stale: true };
  try {
    if (!deposit.stripeSessionId) throw new Error('Session de paiement a verifier');
    const read = () => getStripe().checkout.sessions.retrieve(deposit.stripeSessionId);
    const validate = session => {
      if (session.id !== deposit.stripeSessionId || session.metadata?.reservationId !== String(reservation._id)
        || Number(session.metadata?.checkoutAttempt) !== deposit.checkoutAttempt
        || session.amount_total !== deposit.amountCents || session.currency !== deposit.currency
        || !getStripeMode() || session.livemode !== (getStripeMode() === 'live')) {
        throw new Error('Identite du paiement incompatible');
      }
    };
    let session = await read();
    validate(session);
    if (session.status === 'open' && session.payment_status !== 'paid') {
      // Stripe arbitrates the race. A failed expiry is not proof of failed payment.
      try { await expireCheckoutSession(reservation); } catch { /* Retrieve authoritative state. */ }
      session = await read();
      validate(session);
    }
    const handlers = require('../routes/webhooks');
    if (session.payment_status === 'paid') return handlers.handleCheckoutPaid(session, io);
    if (session.status === 'expired') return handlers.handleCheckoutUnavailable(session, io);
    const updated = await Reservation.findOneAndUpdate(filter, { $set: {
      'deposit.checkoutReviewReason': 'Paiement ou lien encore actif chez Stripe : verification necessaire'
    } }, { new: true });
    if (updated && io) io.emit('update-reservation', updated);
    return { awaiting: true };
  } catch (error) {
    const updated = await Reservation.findOneAndUpdate(filter, { $set: {
      'deposit.checkoutReviewReason': 'Verification Stripe indisponible : ne pas recreer un paiement'
    } }, { new: true });
    if (updated && io) io.emit('update-reservation', updated);
    throw error;
  }
}
module.exports = { reconcileCheckout };
