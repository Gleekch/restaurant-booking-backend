/**
 * Service de paiement des arrhes (acompte) via Stripe Checkout.
 *
 * Flux : pour les groupes >= DEPOSIT_MIN_PARTY, on crée une session
 * Stripe Checkout hébergée. Le client paie sur la page Stripe, puis
 * un webhook confirme la réservation. Aucune donnée carte ne transite
 * par notre serveur.
 */

const Stripe = require('stripe');

// Instance Stripe paresseuse : on ne plante pas au démarrage si la clé
// n'est pas configurée (système d'arrhes désactivé).
let stripeClient = null;
function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY non configurée');
  }
  stripeClient = new Stripe(key);
  return stripeClient;
}

function getDepositConfig() {
  return {
    enabled: String(process.env.DEPOSIT_ENABLED || 'false').toLowerCase() === 'true',
    minParty: parseInt(process.env.DEPOSIT_MIN_PARTY, 10) || 6,
    perPersonCents: parseInt(process.env.DEPOSIT_PER_PERSON_CENTS, 10) || 1000,
    currency: (process.env.DEPOSIT_CURRENCY || 'eur').toLowerCase(),
    cancellationHours: parseInt(process.env.DEPOSIT_CANCELLATION_HOURS, 10) || 24,
    expiryMinutes: Math.max(30, parseInt(process.env.CHECKOUT_EXPIRY_MINUTES, 10) || 30),
    siteUrl: (process.env.PUBLIC_SITE_URL || 'https://www.aumurmuredesflots.com').replace(/\/+$/, '')
  };
}

function isDepositRequired(numberOfPeople) {
  const config = getDepositConfig();
  if (!config.enabled) return false;
  if (!process.env.STRIPE_SECRET_KEY) return false;
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
async function createCheckoutSession(reservation) {
  const config = getDepositConfig();
  const stripe = getStripe();

  const amountCents = reservation.deposit.amountCents || computeDepositCents(reservation.numberOfPeople);
  const dateStr = new Date(reservation.date).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  const expiresAt = new Date(Date.now() + config.expiryMinutes * 60 * 1000);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: reservation.email || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: config.currency,
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
      numberOfPeople: String(reservation.numberOfPeople)
    },
    // expires_at attend un timestamp Unix en secondes
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    success_url: `${config.siteUrl}/?reservation=success#reservation`,
    cancel_url: `${config.siteUrl}/?reservation=cancelled#reservation`
  });

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
  return stripe.refunds.create({ payment_intent: paymentIntentId });
}

module.exports = {
  getStripe,
  getDepositConfig,
  isDepositRequired,
  computeDepositCents,
  formatAmount,
  createCheckoutSession,
  refundDeposit
};
