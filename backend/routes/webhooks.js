const express = require('express');

const router = express.Router();
const Reservation = require('../models/Reservation');
const {
  sendEmail,
  formatReservationMessage,
  sendConfirmationEmailToClient,
  sendDepositExpiredEmailToClient
} = require('../services/notificationService');
const { getStripe } = require('../services/paymentService');

/**
 * Webhook Stripe.
 *
 * IMPORTANT : ce routeur DOIT être monté avec express.raw AVANT le
 * express.json() global de server.js, car la vérification de signature
 * exige le corps brut de la requête.
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    console.error('Signature webhook Stripe invalide:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  const io = req.app.get('io');

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const reservationId = session.metadata && session.metadata.reservationId;
      const reservation = reservationId ? await Reservation.findById(reservationId) : null;

      if (reservation && reservation.status === 'awaiting-payment') {
        // Flux normal : réservation en ligne → paiement confirme la résa
        reservation.deposit.status = 'paid';
        reservation.deposit.stripePaymentIntentId = session.payment_intent || null;
        reservation.deposit.paidAt = new Date();
        reservation.status = 'confirmed';
        await reservation.save();

        if (process.env.EMAIL_USER) {
          sendEmail(formatReservationMessage(reservation), reservation).catch(err =>
            console.error('Erreur email restaurant post-paiement:', err.message)
          );
        }
        if (reservation.email) {
          sendConfirmationEmailToClient(reservation).catch(err =>
            console.error('Erreur email confirmation client post-paiement:', err.message)
          );
        }

        if (io) io.emit('new-reservation', reservation);
        console.log(`Arrhes payees, reservation confirmee pour ${reservation.customerName} (${reservation._id})`);

      } else if (reservation && reservation.deposit && reservation.deposit.status === 'awaiting') {
        // Flux admin "Demander les arrhes" : la résa existe déjà (pending/confirmed)
        // On enregistre le paiement sans changer le statut de la réservation
        reservation.deposit.status = 'paid';
        reservation.deposit.stripePaymentIntentId = session.payment_intent || null;
        reservation.deposit.paidAt = new Date();
        await reservation.save();

        if (process.env.EMAIL_USER) {
          sendEmail(formatReservationMessage(reservation), reservation).catch(err =>
            console.error('Erreur email restaurant arrhes admin:', err.message)
          );
        }

        if (io) io.emit('update-reservation', reservation);
        console.log(`Arrhes admin payees pour ${reservation.customerName} (${reservation._id})`);
      }
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const reservationId = session.metadata && session.metadata.reservationId;
      const reservation = reservationId ? await Reservation.findById(reservationId) : null;

      if (reservation && reservation.status === 'awaiting-payment') {
        // Flux normal : réservation non confirmée → annulation
        reservation.status = 'cancelled';
        reservation.deposit.status = 'failed';
        await reservation.save();
        if (io) io.emit('cancel-reservation', reservation);
        if (reservation.email) {
          sendDepositExpiredEmailToClient(reservation).catch(err =>
            console.error('Erreur email expiration paiement:', err.message)
          );
        }
        console.log(`Session expiree, reservation annulee (${reservation._id})`);

      } else if (reservation && reservation.deposit && reservation.deposit.status === 'awaiting') {
        // Flux admin : le lien a expiré mais la résa reste active → on remet juste le dépôt à 'failed'
        reservation.deposit.status = 'failed';
        await reservation.save();
        if (io) io.emit('update-reservation', reservation);
        if (reservation.email) {
          sendDepositExpiredEmailToClient(reservation).catch(err =>
            console.error('Erreur email expiration lien admin:', err.message)
          );
        }
        console.log(`Lien arrhes admin expire, reservation conservee (${reservation._id})`);
      }
    }
  } catch (error) {
    console.error('Erreur traitement webhook Stripe:', error);
    // On renvoie tout de même 200 pour éviter que Stripe ne réessaie en boucle
    // sur une erreur applicative non récupérable.
  }

  res.json({ received: true });
});

module.exports = router;
