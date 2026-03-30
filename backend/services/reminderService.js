/**
 * Service de rappels automatiques
 * Envoie un email de rappel 24h avant la réservation
 * Idempotent : utilise reminder24hSentAt pour éviter les doublons
 */

const nodemailer = require('nodemailer');
const Reservation = require('../models/Reservation');

const emailPort = parseInt(process.env.EMAIL_PORT) || 465;
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: emailPort,
  secure: emailPort === 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
});

async function sendReminderEmail(reservation) {
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
              Bonjour ${reservation.customerName},
            </p>
            <p style="color:#78716c; font-size:15px; line-height:1.6;">
              Nous vous rappelons votre réservation demain :
            </p>
            <div style="background:#fafaf7; border:1px solid #e7e5df; border-radius:8px; padding:20px; margin:20px 0;">
              <p style="margin:0 0 8px; color:#1c1917; font-size:15px;"><strong>${dateStr}</strong></p>
              <p style="margin:0 0 8px; color:#1c1917; font-size:15px;">Heure : <strong>${reservation.time}</strong></p>
              <p style="margin:0 0 8px; color:#1c1917; font-size:15px;">Personnes : <strong>${reservation.numberOfPeople}</strong></p>
              ${reservation.specialRequests ? `<p style="margin:0; color:#78716c; font-size:14px; font-style:italic;">${reservation.specialRequests}</p>` : ''}
            </div>
            <p style="color:#78716c; font-size:14px; line-height:1.6;">
              Si vous souhaitez modifier ou annuler, contactez-nous au
              <a href="tel:${process.env.RESTAURANT_PHONE || '0262266719'}" style="color:#1c1917;">${process.env.RESTAURANT_PHONE || '0262266719'}</a>.
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
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  // Trouver les réservations de demain, confirmées, pas encore rappelées
  const reservations = await Reservation.find({
    date: { $gte: tomorrow, $lt: dayAfter },
    status: { $in: ['confirmed', 'pending'] },
    reminder24hSentAt: null,
    email: { $exists: true, $ne: '' }
  });

  let sent = 0;
  let errors = 0;

  for (const reservation of reservations) {
    try {
      const success = await sendReminderEmail(reservation);
      if (success) {
        reservation.reminder24hSentAt = new Date();
        await reservation.save();
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
 * Démarre le scheduler de rappels
 * Vérifie toutes les heures s'il y a des rappels à envoyer
 */
function startReminderScheduler() {
  console.log('Scheduler de rappels démarré (vérification toutes les heures)');

  // Vérifier immédiatement au démarrage
  processReminders().catch(err => console.error('Erreur scheduler rappels:', err.message));

  // Puis toutes les heures
  setInterval(() => {
    processReminders().catch(err => console.error('Erreur scheduler rappels:', err.message));
  }, 60 * 60 * 1000); // 1 heure
}

module.exports = { processReminders, startReminderScheduler };
