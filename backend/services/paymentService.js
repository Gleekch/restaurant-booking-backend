/**
 * Service de paiement des arrhes (acompte) via Stripe Checkout.
 *
 * Flux : pour les groupes >= DEPOSIT_MIN_PARTY, on crée une session
 * Stripe Checkout hébergée. Le client paie sur la page Stripe, puis
 * un webhook confirme la réservation. Aucune donnée carte ne transite
 * par notre serveur.
 */

const Stripe = require('stripe');
const crypto = require('crypto');

// Instance Stripe paresseuse : on ne plante pas au démarrage si la clé
// n'est pas configurée (système d'arrhes désactivé).
let stripeClient = null;
function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY non configurée');
  }
  stripeClient = new Stripe(key, { apiVersion: '2026-06-24.dahlia' });
  return stripeClient;
}

function stableLetterSuffix(value) {
  const bytes = crypto.createHash('sha256').update(String(value)).digest();
  return Array.from(bytes.subarray(0, 8), byte => String.fromCharCode(97 + (byte % 26))).join('');
}

function getDepositConfig() {
  return {
    enabled: String(process.env.DEPOSIT_ENABLED || 'false').toLowerCase() === 'true',
    activationConfirmed: String(process.env.DEPOSIT_ACTIVATION_CONFIRMED || 'false').toLowerCase() === 'true',
    minParty: parseInt(process.env.DEPOSIT_MIN_PARTY, 10) || 6,
    perPersonCents: parseInt(process.env.DEPOSIT_PER_PERSON_CENTS, 10) || 1000,
    currency: (process.env.DEPOSIT_CURRENCY || 'eur').toLowerCase(),
    cancellationHours: parseInt(process.env.DEPOSIT_CANCELLATION_HOURS, 10) || 24,
    // Stripe requires at least 30 minutes at creation; keep a one-minute margin.
    expiryMinutes: Math.min(1440, Math.max(31, parseInt(process.env.CHECKOUT_EXPIRY_MINUTES, 10) || 31)),
    siteUrl: (process.env.PUBLIC_SITE_URL || 'https://www.aumurmuredesflots.com').replace(/\/+$/, '')
  };
}

function isDepositSystemActive() {
  return getPaymentReadiness().active;
}

function getPaymentReadiness() {
  const config = getDepositConfig();
  const mode = getStripeMode();
  const liveRequired = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  const webhookConfigured = /^whsec_\S+$/.test(process.env.STRIPE_WEBHOOK_SECRET || '');
  const issues = [];
  if (!mode) issues.push('STRIPE_KEY_MISSING_OR_INVALID');
  if (liveRequired && mode !== 'live') issues.push('LIVE_KEY_REQUIRED');
  if (!webhookConfigured) issues.push('WEBHOOK_SECRET_MISSING');
  for (const name of ['DEPOSIT_MIN_PARTY', 'DEPOSIT_PER_PERSON_CENTS', 'DEPOSIT_CANCELLATION_HOURS']) {
    const raw = process.env[name];
    if (raw !== undefined && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)) {
      issues.push(`${name}_INVALID`);
    }
  }
  if (config.currency !== 'eur') issues.push('DEPOSIT_CURRENCY_MUST_BE_EUR');
  const readyToActivate = issues.length === 0;
  return {
    enabled: config.enabled, activationConfirmed: config.activationConfirmed,
    mode, liveRequired, webhookConfigured, readyToActivate, issues,
    active: config.enabled && config.activationConfirmed && readyToActivate
  };
}

function getPublicDepositPolicy() {
  const config = getDepositConfig();
  return {
    enabled: isDepositSystemActive(), minParty: config.minParty,
    perPersonCents: config.perPersonCents, currency: config.currency,
    cancellationHours: config.cancellationHours
  };
}

function getStripeMode() {
  const match = /^[sr]k_(test|live)_/.exec(process.env.STRIPE_SECRET_KEY || '');
  return match ? match[1] : null;
}

function isDepositRequired(numberOfPeople) {
  const config = getDepositConfig();
  if (!isDepositSystemActive()) return false;
  return parseInt(numberOfPeople, 10) >= config.minParty;
}

function computeDepositCents(numberOfPeople) {
  const config = getDepositConfig();
  return parseInt(numberOfPeople, 10) * config.perPersonCents;
}

function formatAmount(cents, currency) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: (currency || 'eur').toUpperCase()
  }).format(cents / 100);
}

/**
 * Crée une session Stripe Checkout pour les arrhes d'une réservation.
 * @returns {Promise<{url: string, sessionId: string, expiresAt: Date}>}
 */
function buildCheckoutParameters(reservation) {
  const config = getDepositConfig();

  const amountCents = reservation.deposit.amountCents || computeDepositCents(reservation.numberOfPeople);
  const dateStr = new Date(reservation.date).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  const expiresAt = new Date(reservation.deposit.expiresAt);
  if (!reservation.deposit.expiresAt || !Number.isFinite(expiresAt.getTime())) {
    throw new Error('Expiration de la tentative de paiement non enregistree');
  }
  const checkoutAttempt = Math.max(1, Number(reservation.deposit.checkoutAttempt) || 1);
  const checkoutKey = `deposit-checkout:${reservation._id}:${checkoutAttempt}`;

  return {
    mode: 'payment',
    integration_identifier: `booking_deposit_${stableLetterSuffix(checkoutKey)}`,
    customer_email: reservation.email || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: reservation.deposit.currency || config.currency,
          unit_amount: amountCents,
          product_data: {
            name: 'Arrhes de réservation — Au Murmure des Flots',
            description: `${reservation.numberOfPeople} couverts · ${dateStr} ${reservation.time}. `
              + 'Déduites de votre addition. Remboursables si annulation '
              + `≥ ${config.cancellationHours}h avant.`
          }
        }
      }
    ],
    metadata: {
      reservationId: String(reservation._id),
      numberOfPeople: String(reservation.numberOfPeople),
      checkoutAttempt: String(checkoutAttempt),
      amountCents: String(amountCents),
      currency: reservation.deposit.currency || config.currency
    },
    // expires_at attend un timestamp Unix en secondes
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    success_url: `${config.siteUrl}/?reservation=success#reservation`,
    cancel_url: `${config.siteUrl}/?reservation=cancelled#reservation`
  };
}

async function createCheckoutSession(reservation) {
  if (!isDepositSystemActive()) {
    throw new Error('Les nouvelles demandes d arrhes sont desactivees.');
  }
  const stripe = getStripe();
  const checkoutAttempt = Math.max(1, Number(reservation.deposit.checkoutAttempt) || 1);
  let parameters = reservation.deposit.checkoutParameters;
  if (!parameters) {
    // Persist the whole request before Stripe: retries and configuration changes
    // must never change parameters under the same idempotency key.
    const Reservation = require('../models/Reservation');
    const saved = await Reservation.findOneAndUpdate(
      { _id: reservation._id, 'deposit.checkoutAttempt': checkoutAttempt,
        'deposit.status': 'awaiting', 'deposit.checkoutParameters': null },
      { $set: { 'deposit.checkoutParameters': buildCheckoutParameters(reservation) } },
      { new: true, runValidators: true }
    ) || await Reservation.findById(reservation._id);
    if (!saved || saved.deposit.checkoutAttempt !== checkoutAttempt || !saved.deposit.checkoutParameters) {
      throw new Error('Tentative de paiement modifiee avant creation Checkout');
    }
    parameters = saved.deposit.checkoutParameters;
  }
  const session = await stripe.checkout.sessions.create(parameters, {
    idempotencyKey: `deposit-checkout:${reservation._id}:${checkoutAttempt}`
  });
  const expiresAt = new Date(parameters.expires_at * 1000);

  return { url: session.url, sessionId: session.id, expiresAt };
}

/**
 * Rembourse les arrhes d'une réservation déjà payée.
 * @returns {Promise<object>} l'objet refund Stripe
 */
async function refundDeposit(reservation) {
  const stripe = getStripe();
  const paymentIntentId = reservation.deposit && reservation.deposit.stripePaymentIntentId;
  if (!paymentIntentId) {
    throw new Error('Aucun paiement à rembourser pour cette réservation');
  }
  if (reservation.deposit.stripeRefundId) {
    return retrieveRefund(reservation.deposit.stripeRefundId);
  }
  // Recover a lost response even after Stripe's idempotency retention window.
  // Never start a second financial operation when a refund already exists.
  const existing = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 2 });
  if (existing.has_more || existing.data.length > 1) {
    const error = new Error('Plusieurs remboursements existent : verification manuelle necessaire');
    error.code = 'REFUND_REVIEW';
    throw error;
  }
  if (existing.data.length === 1) return retrieveRefund(existing.data[0].id);
  return stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      metadata: { reservationId: String(reservation._id) }
    },
    { idempotencyKey: `deposit-refund:${reservation._id}:${paymentIntentId}` }
  );
}

async function retrieveRefund(refundId) {
  return getStripe().refunds.retrieve(refundId);
}

async function expireCheckoutSession(reservation) {
  const sessionId = reservation.deposit && reservation.deposit.stripeSessionId;
  if (!sessionId) return null;
  return getStripe().checkout.sessions.expire(sessionId, {}, {
    idempotencyKey: `deposit-checkout-expire:${reservation._id}:${sessionId}`
  });
}

module.exports = {
  getStripe,
  getDepositConfig,
  getPaymentReadiness,
  getPublicDepositPolicy,
  isDepositSystemActive,
  getStripeMode,
  isDepositRequired,
  computeDepositCents,
  formatAmount,
  createCheckoutSession,
  buildCheckoutParameters,
  refundDeposit,
  retrieveRefund,
  expireCheckoutSession
};
