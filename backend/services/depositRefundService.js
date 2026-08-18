const Reservation = require('../models/Reservation');
const { refundDeposit } = require('./paymentService');

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

    if (!reservation.deposit || reservation.deposit.status !== 'refund_pending') {
      throw new Error('Aucune arrhe remboursable pour cette reservation');
    }
  }

  const refund = await refundDeposit(reservation);
  const succeeded = refund.status === 'succeeded';
  const updated = await Reservation.findOneAndUpdate(
    { _id: reservationId, 'deposit.status': 'refund_pending' },
    {
      $set: {
        'deposit.stripeRefundId': refund.id,
        'deposit.status': succeeded ? 'refunded' : 'refund_pending',
        'deposit.refundedAt': succeeded ? new Date() : null
      }
    },
    { new: true, runValidators: true }
  );

  if (updated) return refundResult(updated);

  const current = await Reservation.findById(reservationId);
  if (current && current.deposit && current.deposit.status === 'refunded') {
    return refundResult(current, { alreadyRefunded: true });
  }
  throw new Error('Etat du remboursement impossible a confirmer');
}

async function applyRefundEvent(refund) {
  const reservationId = refund.metadata && refund.metadata.reservationId;
  if (!reservationId || !refund.id) return null;

  const succeeded = refund.status === 'succeeded';
  const failed = ['failed', 'canceled'].includes(refund.status);
  const status = succeeded ? 'refunded' : (failed ? 'paid' : 'refund_pending');
  const allowedStatuses = succeeded
    ? ['paid', 'refund_pending', 'refunded']
    : ['paid', 'refund_pending'];

  return Reservation.findOneAndUpdate(
    {
      _id: reservationId,
      'deposit.stripeRefundId': { $in: [null, refund.id] },
      'deposit.status': { $in: allowedStatuses }
    },
    {
      $set: {
        'deposit.stripeRefundId': refund.id,
        'deposit.status': status,
        'deposit.refundedAt': succeeded ? new Date() : null
      }
    },
    { new: true, runValidators: true }
  );
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
      if (result.refunded || result.alreadyRefunded) summary.refunded += 1;
      else summary.pending += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`Reconciliation remboursement ${reservation._id}:`, error.message);
    }
  }

  return summary;
}

function startRefundReconciliationScheduler() {
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
      const summary = await reconcilePendingRefunds();
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
