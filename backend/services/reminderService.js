/**
 * Service de rappels automatiques
 * Envoie un email de rappel 24h avant la réservation
 * Idempotent : utilise reminder24hSentAt pour éviter les doublons
 */

const nodemailer = require('nodemailer');
const Reservation = require('../models/Reservation');
const { formatAmount } = require('./paymentService');
const { reconcileCheckout } = require('./checkoutReconciliationService');
const { getRestaurantNow } = require('./capacityService');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Lien personnel d'annulation en ligne (jeton secret par réservation)
function buildCancelUrl(reservation) {
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://www.aumurmuredesflots.com').replace(/\/+$/, '');
  return `${siteUrl}/annuler?id=${reservation._id}&token=${reservation.cancellationToken}`;
}

const emailPort = parseInt(process.env.EMAIL_PORT) || 465;
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: emailPort,
  secure: emailPort === 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: { rejectUnauthorized: true },
  requireTLS: process.env.NODE_ENV !== 'test',
  disableFileAccess: true,
  disableUrlAccess: true,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
});

async function sendReminderEmail(reservation) {
  if (reservation.status !== 'confirmed') return false;
  if (!reservation.email) return false;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false;

  const dateStr = new Date(reservation.date).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  const mailOptions = {
    from: `"Au Murmure des Flots" <${process.env.EMAIL_USER}>`,
    to: reservation.email,
    subject: `Rappel — Votre réservation demain ${dateStr}`,
    html: `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="margin:0; padding:0; font-family: -apple-system, sans-serif; background:#f4f3ef;">
        <div style="max-width:500px; margin:20px auto; background:white; border-radius:10px; overflow:hidden;">
          <div style="background:#1c1917; padding:24px 30px;">
            <h1 style="color:#e7e5e4; margin:0; font-size:18px; font-weight:600;">Au Murmure des Flots</h1>
          </div>
          <div style="padding:30px;">
            <p style="color:#1c1917; font-size:16px; margin-bottom:20px;">
              Bonjour ${escapeHtml(reservation.customerName)},
            </p>
            <p style="color:#78716c; font-size:15px; line-height:1.6;">
              Nous vous rappelons votre réservation demain :
            </p>
            <div style="background:#fafaf7; border:1px solid #e7e5df; border-radius:8px; padding:20px; margin:20px 0;">
              <p style="margin:0 0 8px; color:#1c1917; font-size:15px;"><strong>${dateStr}</strong></p>
              <p style="margin:0 0 8px; color:#1c1917; font-size:15px;">Heure : <strong>${reservation.time}</strong></p>
              <p style="margin:0 0 8px; color:#1c1917; font-size:15px;">Personnes : <strong>${reservation.numberOfPeople}</strong></p>
              ${reservation.deposit && reservation.deposit.status === 'paid' ? `<p style="margin:0 0 8px; color:#166534; font-size:14px;">Arrhes payées : <strong>${formatAmount(reservation.deposit.amountCents, reservation.deposit.currency)}</strong> (déduites de l'addition)</p>` : ''}
              ${reservation.specialRequests ? `<p style="margin:0; color:#78716c; font-size:14px; font-style:italic;">${escapeHtml(reservation.specialRequests)}</p>` : ''}
            </div>
            <p style="color:#78716c; font-size:14px; line-height:1.6;">
              Si vous souhaitez modifier ou annuler, contactez-nous au
              <a href="tel:${process.env.RESTAURANT_PHONE || '0262266719'}" style="color:#1c1917;">${process.env.RESTAURANT_PHONE || '0262266719'}</a>,
              ou <a href="${buildCancelUrl(reservation)}" style="color:#1c1917;">annulez en ligne</a>.
            </p>
            <p style="color:#78716c; font-size:14px; margin-top:20px;">
              À demain !<br>
              <strong style="color:#1c1917;">L'équipe Au Murmure des Flots</strong>
            </p>
          </div>
          <div style="background:#fafaf7; padding:15px 30px; border-top:1px solid #e7e5df;">
            <p style="margin:0; color:#a8a29e; font-size:12px; text-align:center;">
              44 rue du Général Lambert, 97436 Saint-Leu
            </p>
          </div>
        </div>
      </body></html>
    `
  };

  await emailTransporter.sendMail(mailOptions);
  return true;
}

/**
 * Cherche et envoie les rappels pour les réservations de demain
 * Idempotent : ne renvoie pas si reminder24hSentAt est déjà set
 */
async function processReminders() {
  const tomorrow = new Date(getRestaurantNow().date + 'T00:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const dayAfter = new Date(tomorrow);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

  // Trouver les réservations de demain, confirmées, pas encore rappelées
  const reservations = await Reservation.find({
    date: { $gte: tomorrow, $lt: dayAfter },
    status: 'confirmed',
    reminder24hSentAt: null,
    email: { $exists: true, $ne: '' }
  });

  let sent = 0;
  let errors = 0;

  for (const reservation of reservations) {
    try {
      const fresh = await Reservation.findById(reservation._id);
      if (!fresh || fresh.status !== 'confirmed' || fresh.reminder24hSentAt
        || new Date(fresh.date).getTime() !== new Date(reservation.date).getTime()
        || fresh.time !== reservation.time || fresh.email !== reservation.email) continue;
      const success = await sendReminderEmail(fresh);
      if (success) {
        await Reservation.findOneAndUpdate({ _id: fresh._id, status: 'confirmed', date: fresh.date,
          time: fresh.time, numberOfPeople: fresh.numberOfPeople, reminder24hSentAt: null },
        { $set: { reminder24hSentAt: new Date() } });
        sent++;
        console.log(`Rappel envoyé à ${reservation.email} pour ${reservation.customerName}`);
      }
    } catch (error) {
      errors++;
      console.error(`Erreur rappel pour ${reservation.customerName}:`, error.message);
    }
  }

  console.log(`Rappels: ${sent} envoyés, ${errors} erreurs, ${reservations.length} à traiter`);
  return { sent, errors, total: reservations.length };
}

/**
 * Reconcile expired local holds with Stripe before changing their state.
 * A timeout or an unavailable provider never counts as proof of non-payment.
 * @param {object} io - instance Socket.IO (optionnelle) pour notifier le dashboard
 */
async function sweepExpiredDeposits(io) {
  const now = new Date();
  const candidates = await Reservation.find({
    status: { $in: ['awaiting-payment', 'pending', 'confirmed', 'cancelled'] },
    'deposit.status': 'awaiting',
    'deposit.expiresAt': { $ne: null, $lt: now }
  }).sort({ 'deposit.checkoutCheckedAt': 1 }).limit(100);
  let cancelled = 0;
  let resetDeposits = 0;
  let errors = 0;
  for (const reservation of candidates) {
    try {
      const result = await reconcileCheckout(reservation, io);
      if (result.reservation?.deposit?.status === 'failed') {
        if (result.reservation.status === 'cancelled') cancelled++;
        else resetDeposits++;
      }
    } catch (error) {
      errors++;
      console.error(`Verification paiement expire (${reservation._id}):`, error.message);
    }
  }
  return { cancelled, resetDeposits, errors, scanned: candidates.length };
}

/**
 * Conformité RGPD : anonymise les données personnelles des réservations
 * de plus de RGPD_RETENTION_MONTHS mois (défaut 13). On conserve les données
 * non identifiantes (date, couverts, statut, arrhes) pour les statistiques.
 */
async function anonymizeOldReservations() {
  const retentionMonths = parseInt(process.env.RGPD_RETENTION_MONTHS, 10) || 13;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);

  const old = await Reservation.find({
    date: { $lt: cutoff },
    anonymizedAt: null
  });

  let anonymized = 0;
  for (const reservation of old) {
    try {
      reservation.customerName = 'Client anonymisé';
      reservation.phoneNumber = 'anonymisé';
      reservation.email = undefined;
      reservation.specialRequests = '';
      reservation.notes = '';
      reservation.cancellationToken = null;
      reservation.anonymizedAt = new Date();
      await reservation.save();
      anonymized++;
    } catch (error) {
      console.error(`Erreur anonymisation (${reservation._id}):`, error.message);
    }
  }

  if (anonymized > 0) {
    console.log(`RGPD: ${anonymized} réservation(s) de plus de ${retentionMonths} mois anonymisée(s)`);
  }
  return anonymized;
}

/**
 * Démarre le scheduler de rappels
 * Vérifie toutes les heures s'il y a des rappels à envoyer
 * @param {object} io - instance Socket.IO (optionnelle) pour les annulations d'acomptes expirés
 */
function startReminderScheduler(io) {
  console.log('Scheduler de rappels démarré (vérification toutes les heures)');

  let hourCount = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processReminders().catch(err => console.error('Erreur scheduler rappels:', err.message));
      await sweepExpiredDeposits(io).catch(err => console.error('Erreur balayage acomptes:', err.message));
      // Anonymisation RGPD une fois par jour (au démarrage puis toutes les 24 itérations)
      if (hourCount % 24 === 0) {
        await anonymizeOldReservations().catch(err => console.error('Erreur anonymisation RGPD:', err.message));
      }
      hourCount++;
    } finally { running = false; }
  };

  // Vérifier immédiatement au démarrage
  tick();

  // Puis toutes les heures
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = { processReminders, sweepExpiredDeposits, anonymizeOldReservations, startReminderScheduler };
