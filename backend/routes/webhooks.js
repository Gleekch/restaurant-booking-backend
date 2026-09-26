const express = require('express');

const router = express.Router();
const Reservation = require('../models/Reservation');
const {
  sendEmail,
  formatReservationMessage,
  sendPendingEmailToClient,
  sendDepositExpiredEmailToClient
} = require('../services/notificationService');
const { getStripe, getStripeMode } = require('../services/paymentService');
const { refundReservationSafely, applyRefundEvent } = require('../services/depositRefundService');

function paymentIntentId(session) {
  return typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent && session.payment_intent.id;
}

function getCheckoutIdentity(session) {
  const reservationId = session.metadata && session.metadata.reservationId;
  const checkoutAttempt = Number(session.metadata && session.metadata.checkoutAttempt);
  if (!reservationId || !Number.isInteger(checkoutAttempt) || checkoutAttempt < 1) {
    throw new Error(`Session Checkout ${session.id} sans identite de reservation valide`);
  }
  return { reservationId, checkoutAttempt };
}

function validateCheckoutSession(session, reservation, checkoutAttempt) {
  if (!reservation.deposit || reservation.deposit.checkoutAttempt !== checkoutAttempt) {
    throw new Error(`Session Checkout obsolete pour la reservation ${reservation._id}`);
  }
  if (reservation.deposit.stripeSessionId && reservation.deposit.stripeSessionId !== session.id) {
    throw new Error(`Session Checkout inattendue pour la reservation ${reservation._id}`);
  }
  if (Number(session.amount_total) !== Number(reservation.deposit.amountCents)) {
    throw new Error(`Montant Checkout incorrect pour la reservation ${reservation._id}`);
  }
  if (String(session.currency || '').toLowerCase() !== String(reservation.deposit.currency || '').toLowerCase()) {
    throw new Error(`Devise Checkout incorrecte pour la reservation ${reservation._id}`);
  }
  if (!paymentIntentId(session)) {
    throw new Error(`PaymentIntent absent de la session Checkout ${session.id}`);
  }
}

async function handleCheckoutPaid(session, io) {
  if (session.payment_status !== 'paid') return { awaitingAsyncPayment: true };

  const { reservationId, checkoutAttempt } = getCheckoutIdentity(session);
  const intentId = paymentIntentId(session);
  let reservation;
  let onlineFlow = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await Reservation.findById(reservationId);
    if (!before) throw new Error(`Reservation ${reservationId} introuvable pour le paiement ${session.id}`);
    validateCheckoutSession(session, before, checkoutAttempt);
    const samePayment = before.deposit.stripePaymentIntentId === intentId
      && ['paid', 'refund_pending', 'refund_failed', 'refund_review', 'refunded', 'deducted'].includes(before.deposit.status);
    if (samePayment) {
      if (before.deposit.status === 'refund_pending') {
        const result = await refundReservationSafely(reservationId);
        if (io) io.emit('update-reservation', result.reservation);
        return { duplicate: true, reservation: result.reservation };
      }
      return { duplicate: true, reservation: before };
    }
    const cancelled = before.status === 'cancelled';
    if (before.deposit.status !== 'awaiting' && !(cancelled && before.deposit.status === 'failed')) {
      throw new Error(`Transition de paiement refusee pour la reservation ${reservationId}`);
    }
    onlineFlow = before.status === 'awaiting-payment';
    const setFields = {
      'deposit.status': cancelled ? 'refund_pending' : 'paid',
      'deposit.stripeSessionId': session.id,
      'deposit.stripePaymentIntentId': intentId,
      'deposit.paidAt': new Date()
    };
    if (onlineFlow) setFields.status = 'pending';
    // Record the refund obligation in the SAME write as the late payment.
    // A process crash or webhook replay can then resume it via reconciliation.
    if (cancelled) setFields['deposit.refundRequestedAt'] = new Date();
    reservation = await Reservation.findOneAndUpdate(
      { _id: reservationId, status: before.status,
        'deposit.status': before.deposit.status,
        'deposit.checkoutAttempt': checkoutAttempt,
        $or: [{ 'deposit.stripeSessionId': session.id }, { 'deposit.stripeSessionId': null }] },
      { $set: setFields },
      { new: true, runValidators: true }
    );
    if (reservation) break;
  }
  if (!reservation) throw new Error('Paiement modifie simultanement : rejouer le webhook');

  // Un paiement qui gagne la course avec une annulation est immédiatement
  // remboursé avec la même protection d'idempotence.
  if (reservation.status === 'cancelled') {
    const refundResult = await refundReservationSafely(reservationId);
    if (io) io.emit('update-reservation', refundResult.reservation);
    return { reservation: refundResult.reservation, refundedAfterCancellation: true };
  }

  if (onlineFlow) {
    if (process.env.EMAIL_USER) {
      sendEmail(formatReservationMessage(reservation), reservation).catch(err =>
        console.error('Erreur email restaurant post-paiement:', err.message)
      );
    }
    if (reservation.email) {
      sendPendingEmailToClient(reservation).catch(err =>
        console.error('Erreur email demande client post-paiement:', err.message)
      );
    }
    if (io) {
      io.emit('new-reservation', reservation);
      // Existing desktop clients may already have loaded the awaiting booking.
      // Keep the creation event for unseen bookings and refresh cached ones too.
      io.emit('update-reservation', reservation);
    }
  } else if (io) {
    io.emit('update-reservation', reservation);
  }

  return { reservation };
}

async function handleCheckoutUnavailable(session, io) {
  const { reservationId, checkoutAttempt } = getCheckoutIdentity(session);
  const before = await Reservation.findById(reservationId);
  if (!before) return { missingReservation: true };
  if (!before.deposit || before.deposit.checkoutAttempt !== checkoutAttempt) return { stale: true };
  if (before.deposit.stripeSessionId && before.deposit.stripeSessionId !== session.id) return { stale: true };

  const onlineFlow = before.status === 'awaiting-payment';
  const setFields = { 'deposit.status': 'failed', 'deposit.stripeSessionId': session.id };
  if (onlineFlow) {
    setFields.status = 'cancelled';
    setFields.activeBookingKey = null;
  }

  const reservation = await Reservation.findOneAndUpdate(
    {
      _id: reservationId,
      'deposit.status': 'awaiting',
      'deposit.checkoutAttempt': checkoutAttempt,
      $or: [
        { 'deposit.stripeSessionId': session.id },
        { 'deposit.stripeSessionId': null }
      ]
    },
    { $set: setFields },
    { new: true, runValidators: true }
  );

  if (!reservation) return { duplicate: true };
  if (io) io.emit(onlineFlow ? 'cancel-reservation' : 'update-reservation', reservation);
  if (reservation.email) {
    sendDepositExpiredEmailToClient(reservation).catch(err =>
      console.error('Erreur email expiration paiement:', err.message)
    );
  }
  return { reservation };
}

async function processStripeEvent(event, io) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return handleCheckoutPaid(event.data.object, io);
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      return handleCheckoutUnavailable(event.data.object, io);
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed': {
      const reservation = await applyRefundEvent(event.data.object);
      if (reservation && io) io.emit('update-reservation', reservation);
      return { reservation };
    }
    default:
      return { ignored: true };
  }
}

/**
 * Ce routeur doit être monté avec express.raw avant express.json().
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, webhookSecret);
    const mode = getStripeMode();
    if (!mode || typeof event.livemode !== 'boolean' || event.livemode !== (mode === 'live')) {
      throw new Error('Mode Stripe incompatible avec la configuration du serveur');
    }
  } catch (error) {
    console.error('Signature webhook Stripe invalide:', error.message);
    return res.status(400).send('Webhook Stripe invalide');
  }

  try {
    await processStripeEvent(event, req.app.get('io'));
    return res.json({ received: true });
  } catch (error) {
    console.error(`Erreur traitement webhook Stripe ${event.id}:`, error);
    // Un 5xx demande à Stripe de rejouer l'événement. Les transitions MongoDB
    // et les appels Stripe sont idempotents, ce rejeu est donc sans danger.
    return res.status(500).json({ received: false, retry: true });
  }
});

module.exports = router;
module.exports.processStripeEvent = processStripeEvent;
module.exports.handleCheckoutPaid = handleCheckoutPaid;
module.exports.handleCheckoutUnavailable = handleCheckoutUnavailable;
