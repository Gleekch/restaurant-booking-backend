const Reservation = require('../models/Reservation');
const { refundDeposit, retrieveRefund } = require('./paymentService');

const DEFAULT_RECONCILIATION_INTERVAL_MINUTES = 10;
const DEFAULT_RECONCILIATION_MIN_AGE_MINUTES = 2;
const DEFAULT_RECONCILIATION_BATCH_SIZE = 25;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function refundResult(reservation, overrides = {}) {
  return {
    reservation,
    refunded: reservation.deposit && reservation.deposit.status === 'refunded',
    pending: reservation.deposit && reservation.deposit.status === 'refund_pending',
    needsAttention: Boolean(reservation.deposit && ['refund_failed', 'refund_review'].includes(reservation.deposit.status)),
    alreadyRefunded: false,
    ...overrides
  };
}

/**
 * Rembourse une réservation de manière rejouable.
 *
 * Le passage paid -> refund_pending est atomique. Tous les appels concurrents
 * utilisent ensuite la même clé d'idempotence Stripe, dérivée de la réservation
 * et du PaymentIntent. Une réponse réseau perdue peut donc être rejouée sans
 * créer un second remboursement.
 */
async function refundReservationSafely(reservationId) {
  let reservation = await Reservation.findOneAndUpdate(
    { _id: reservationId, 'deposit.status': 'paid' },
    {
      $set: {
        'deposit.status': 'refund_pending',
        'deposit.refundRequestedAt': new Date()
      }
    },
    { new: true, runValidators: true }
  );

  if (!reservation) {
    reservation = await Reservation.findById(reservationId);
    if (!reservation) throw new Error('Reservation non trouvee');

    if (reservation.deposit && reservation.deposit.status === 'refunded') {
      return refundResult(reservation, { alreadyRefunded: true });
    }

    if (reservation.deposit && ['refund_failed', 'refund_review'].includes(reservation.deposit.status)) {
      return refundResult(reservation);
    }

    if (!reservation.deposit || reservation.deposit.status !== 'refund_pending') {
      throw new Error('Aucune arrhe remboursable pour cette reservation');
    }
  }

  try {
    const refund = await refundDeposit(reservation);
    const updated = await synchronizeRefund(reservationId, refund.id);
    if (!updated) throw new Error('Identite du remboursement impossible a confirmer');
    return refundResult(updated);
  } catch (error) {
    if (error.code !== 'REFUND_REVIEW') throw error;
    const updated = await Reservation.findOneAndUpdate(
      { _id: reservationId, 'deposit.status': 'refund_pending' },
      { $set: { 'deposit.status': 'refund_review', 'deposit.refundFailureReason': error.message },
        $inc: { 'deposit.refundVersion': 1 } },
      { new: true, runValidators: true }
    ) || await Reservation.findById(reservationId);
    return refundResult(updated);
  }
}

function matchesPayment(refund, reservation) {
  const intentId = typeof refund.payment_intent === 'string'
    ? refund.payment_intent : refund.payment_intent && refund.payment_intent.id;
  return Boolean(reservation.deposit && intentId
    && intentId === reservation.deposit.stripePaymentIntentId
    && String(refund.currency || '').toLowerCase() === String(reservation.deposit.currency).toLowerCase()
    && (!refund.metadata || !refund.metadata.reservationId || refund.metadata.reservationId === String(reservation._id)));
}

async function synchronizeRefund(reservationId, refundId) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await Reservation.findById(reservationId);
    if (!before || !before.deposit) return null;
    const deposit = before.deposit;
    if (deposit.stripeRefundId && deposit.stripeRefundId !== refundId) return null;

    // Events may arrive out of order, and idempotent POST responses are cached.
    // Always read Stripe's current state, including bank failures after success.
    const refund = await retrieveRefund(refundId);
    if (refund.id !== refundId || !matchesPayment(refund, before)) return null;
    const fullAmount = Number.isInteger(refund.amount) && refund.amount === deposit.amountCents;
    let status = 'refund_review';
    let reason = null;
    if (['failed', 'canceled'].includes(refund.status)) {
      status = 'refund_failed';
      reason = refund.failure_reason || refund.status;
    } else if (!fullAmount) {
      reason = 'Montant partiel ou incoherent : verification manuelle necessaire';
    } else if (refund.status === 'succeeded') {
      status = 'refunded';
    } else if (refund.status === 'pending') {
      status = 'refund_pending';
    } else {
      reason = 'Action necessaire dans Stripe : ' + refund.status;
    }
    if (deposit.status === 'deducted') {
      status = 'refund_review';
      reason = 'Arrhes deja deduites en caisse : rapprocher le remboursement et le ticket';
    }
    const version = Number(deposit.refundVersion) || 0;
    const updated = await Reservation.findOneAndUpdate(
      { _id: reservationId, 'deposit.status': deposit.status, 'deposit.stripePaymentIntentId': deposit.stripePaymentIntentId,
        'deposit.stripeRefundId': { $in: [null, refundId] },
        'deposit.refundVersion': version === 0 ? { $in: [null, 0] } : version },
      { $set: {
        'deposit.stripeRefundId': refund.id,
        'deposit.status': status,
        'deposit.refundStripeStatus': refund.status,
        'deposit.refundAmountCents': Number.isInteger(refund.amount) ? refund.amount : 0,
        'deposit.refundFailureReason': reason,
        'deposit.refundedAt': status === 'refunded' ? (deposit.refundedAt || new Date()) : null
      }, $inc: { 'deposit.refundVersion': 1 } },
      { new: true, runValidators: true }
    );
    if (updated) return updated;
    // A concurrent update won: re-read BOTH stores, never persist an old result.
  }
  throw new Error('Remboursement modifie simultanement : nouvelle verification necessaire');
}

async function applyRefundEvent(refund) {
  const reservationId = refund.metadata && refund.metadata.reservationId;
  if (!refund.id) return null;
  let reservation;
  if (reservationId) {
    reservation = await Reservation.findById(reservationId);
  } else {
    const intent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
    if (!intent) return null;
    const matches = await Reservation.find({ 'deposit.stripePaymentIntentId': intent }).limit(2);
    if (!matches.length) return null;
    if (matches.length !== 1) throw new Error('Remboursement sans correspondance unique : verification necessaire');
    reservation = matches[0];
  }
  if (!reservation || !matchesPayment(refund, reservation)) return null;
  return synchronizeRefund(reservation._id, refund.id);
}

async function reconcilePendingRefunds(options = {}) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { scanned: 0, refunded: 0, pending: 0, failed: 0, skipped: true };
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const minAgeMinutes = positiveInteger(
    options.minAgeMinutes ?? process.env.REFUND_RECONCILIATION_MIN_AGE_MINUTES,
    DEFAULT_RECONCILIATION_MIN_AGE_MINUTES,
    24 * 60
  );
  const batchSize = positiveInteger(
    options.batchSize ?? process.env.REFUND_RECONCILIATION_BATCH_SIZE,
    DEFAULT_RECONCILIATION_BATCH_SIZE,
    100
  );
  const refundFn = options.refundFn || refundReservationSafely;
  const cutoff = new Date(now.getTime() - minAgeMinutes * 60 * 1000);

  const pendingReservations = await Reservation.find({
    'deposit.status': 'refund_pending',
    'deposit.stripePaymentIntentId': { $type: 'string' },
    $or: [
      { 'deposit.refundRequestedAt': { $lte: cutoff } },
      { 'deposit.refundRequestedAt': null }
    ]
  }, { _id: 1 }).limit(batchSize).lean();

  const summary = {
    scanned: pendingReservations.length,
    refunded: 0,
    pending: 0,
    failed: 0,
    skipped: false
  };

  for (const reservation of pendingReservations) {
    try {
      const result = await refundFn(reservation._id);
      if (options.io && result.reservation) options.io.emit('update-reservation', result.reservation);
      if (result.refunded || result.alreadyRefunded) summary.refunded += 1;
      else if (result.needsAttention) summary.failed += 1;
      else summary.pending += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`Reconciliation remboursement ${reservation._id}:`, error.message);
    }
  }

  return summary;
}

function startRefundReconciliationScheduler(io) {
  const intervalMinutes = positiveInteger(
    process.env.REFUND_RECONCILIATION_INTERVAL_MINUTES,
    DEFAULT_RECONCILIATION_INTERVAL_MINUTES,
    24 * 60
  );
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await reconcilePendingRefunds({ io });
      if (!summary.skipped && (summary.scanned > 0 || summary.failed > 0)) {
        console.log('Reconciliation remboursements:', summary);
      }
    } catch (error) {
      console.error('Erreur reconciliation remboursements:', error.message);
    } finally {
      running = false;
    }
  };

  tick();
  const timer = setInterval(tick, intervalMinutes * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  refundReservationSafely,
  applyRefundEvent,
  reconcilePendingRefunds,
  startRefundReconciliationScheduler
};
