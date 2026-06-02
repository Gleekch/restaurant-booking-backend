const nodemailer = require('nodemailer');

// SMS désactivé - Twilio non utilisé
let twilioClient = null;

const { formatAmount } = require('./paymentService');

// Renvoie true si la réservation comporte des arrhes payées
function hasPaidDeposit(reservation) {
  return reservation.deposit && reservation.deposit.status === 'paid';
}

// Lien personnel d'annulation en ligne (jeton secret par réservation)
function buildCancelUrl(reservation) {
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://www.aumurmuredesflots.com').replace(/\/+$/, '');
  return `${siteUrl}/annuler?id=${reservation._id}&token=${reservation.cancellationToken}`;
}

// Bloc HTML « arrhes payées » (vide si pas d'arrhes)
function depositBlockHtml(reservation) {
  if (!hasPaidDeposit(reservation)) return '';
  const cancellationHours = parseInt(process.env.DEPOSIT_CANCELLATION_HOURS, 10) || 24;
  return `
            <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 18px; margin: 25px 0; border-radius: 5px;">
              <p style="color: #2e7d32; margin: 0 0 6px 0; font-size: 15px;"><strong>✓ Arrhes reçues : ${formatAmount(reservation.deposit.amountCents, reservation.deposit.currency)}</strong></p>
              <p style="color: #555; margin: 0; font-size: 13px; line-height: 1.5;">Ce montant sera <strong>déduit de votre addition</strong>. Il vous est intégralement remboursé en cas d'annulation au moins ${cancellationHours}h avant votre venue.</p>
            </div>`;
}

// Bloc HTML « Annuler ma réservation »
function cancelBlockHtml(reservation) {
  return `
            <div style="text-align: center; margin: 25px 0; padding: 18px; background-color: #fafaf7; border: 1px solid #e7e5df; border-radius: 8px;">
              <p style="color: #666; font-size: 13px; margin: 0 0 12px 0;">Un imprévu ? Vous pouvez annuler votre réservation en ligne.</p>
              <a href="${buildCancelUrl(reservation)}" style="display: inline-block; background-color: #78716c; color: white; padding: 10px 22px; text-decoration: none; border-radius: 6px; font-size: 13px;">Annuler ma réservation</a>
            </div>`;
}

// Configuration Email
const emailPort = parseInt(process.env.EMAIL_PORT) || 465;
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: emailPort,
  secure: emailPort === 465, // true pour port 465, false pour 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
});

// Fonction pour envoyer les notifications
async function sendNotifications(reservation) {
  const message = formatReservationMessage(reservation);
  
  // Envoyer SMS au chef et au manager (notifications internes uniquement)
  const phoneNumbers = [
    process.env.CHEF_PHONE,
    process.env.MANAGER_PHONE
  ].filter(Boolean); // Filtrer les numéros vides
  
  const smsPromises = phoneNumbers.map(number => 
    sendSMS(number, message)
  );
  
  // Envoyer email au restaurant ET au client
  const emailPromises = [];
  
  // Email au restaurant
  if (process.env.EMAIL_USER) {
    emailPromises.push(sendEmail(message, reservation));
  }
  
  // Email d'accusé de réception au client (en attente de confirmation)
  if (reservation.email) {
    emailPromises.push(sendPendingEmailToClient(reservation));
  }
  
  try {
    const results = await Promise.allSettled([...smsPromises, ...emailPromises]);
    
    // Logger les résultats détaillés
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Notification ${index} échouée:`, result.reason);
      } else {
        console.log(`Notification ${index} envoyée avec succès`);
      }
    });
    
    console.log('Traitement des notifications terminé');
  } catch (error) {
    console.error('Erreur lors de l\'envoi des notifications:', error);
  }
}

// Formater le message de réservation
function formatReservationMessage(reservation) {
  const date = new Date(reservation.date).toLocaleDateString('fr-FR');
  return `Nouvelle réservation:
Nom: ${reservation.customerName}
Tel: ${reservation.phoneNumber}
Personnes: ${reservation.numberOfPeople}
Date: ${date}
Heure: ${reservation.time}
${reservation.specialRequests ? `Notes: ${reservation.specialRequests}` : ''}`;
}

// Envoyer SMS - Désactivé
async function sendSMS(phoneNumber, message) {
  // SMS désactivé - pas de service SMS configuré
  return;
}

// Envoyer Email
async function sendEmail(message, reservation) {
  if (!process.env.EMAIL_USER) {
    console.log('Email non configuré');
    return;
  }
  
  const mailOptions = {
    from: `"Système Réservations 📋" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: `🔔 Nouvelle réservation - ${reservation.customerName} (${reservation.numberOfPeople} pers.)`,
    text: message,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #ff6b6b 0%, #feca57 100%); padding: 30px; text-align: center;">
            <img src="https://raw.githubusercontent.com/Gleekch/restaurant-booking-backend/main/assets/logo.png" alt="Au Murmure des Flots" style="width: 80px; height: 80px; border-radius: 50%; background: white; padding: 8px; margin: 0 auto 15px; display: block; box-shadow: 0 3px 10px rgba(0,0,0,0.2);">
            <h1 style="color: white; margin: 0; font-size: 28px;">Nouvelle Réservation</h1>
          </div>
          
          <!-- Contenu -->
          <div style="padding: 30px;">
            <!-- Info client -->
            <div style="background-color: #e8f5e9; border-left: 5px solid #4caf50; padding: 20px; margin-bottom: 25px; border-radius: 5px;">
              <h2 style="color: #2e7d32; margin-top: 0; font-size: 20px;">👤 Informations Client</h2>
              <p style="margin: 8px 0;"><strong>Nom :</strong> ${reservation.customerName}</p>
              <p style="margin: 8px 0;"><strong>Téléphone :</strong> <a href="tel:${reservation.phoneNumber}" style="color: #1976d2; text-decoration: none;">${reservation.phoneNumber}</a></p>
              ${reservation.email ? `<p style="margin: 8px 0;"><strong>Email :</strong> <a href="mailto:${reservation.email}" style="color: #1976d2; text-decoration: none;">${reservation.email}</a></p>` : ''}
            </div>
            
            <!-- Détails réservation -->
            <div style="background-color: #fff3e0; border-left: 5px solid #ff9800; padding: 20px; margin-bottom: 25px; border-radius: 5px;">
              <h2 style="color: #e65100; margin-top: 0; font-size: 20px;">📅 Détails de la Réservation</h2>
              <table style="width: 100%;">
                <tr>
                  <td style="padding: 8px 0;"><strong>Date :</strong></td>
                  <td style="text-align: right; font-size: 18px; color: #e65100;">
                    ${new Date(reservation.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Heure :</strong></td>
                  <td style="text-align: right; font-size: 18px; color: #e65100;">
                    ${reservation.time}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Nombre :</strong></td>
                  <td style="text-align: right; font-size: 18px; color: #e65100;">
                    ${reservation.numberOfPeople} ${reservation.numberOfPeople > 1 ? 'personnes' : 'personne'}
                  </td>
                </tr>
                ${hasPaidDeposit(reservation) ? `
                <tr>
                  <td style="padding: 8px 0;"><strong>Arrhes :</strong></td>
                  <td style="text-align: right; font-size: 18px; color: #2e7d32;">
                    ${formatAmount(reservation.deposit.amountCents, reservation.deposit.currency)} payées ✓
                  </td>
                </tr>
                ` : ''}
              </table>
            </div>
            
            <!-- Demandes spéciales -->
            ${reservation.specialRequests ? `
            <div style="background-color: #fce4ec; border-left: 5px solid #e91e63; padding: 20px; margin-bottom: 25px; border-radius: 5px;">
              <h2 style="color: #880e4f; margin-top: 0; font-size: 20px;">💬 Demandes Spéciales</h2>
              <p style="margin: 0; font-style: italic; color: #424242;">
                "${reservation.specialRequests}"
              </p>
            </div>
            ` : ''}
            
            <!-- Actions rapides -->
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px dashed #e0e0e0;">
              <a href="tel:${reservation.phoneNumber}" style="display: inline-block; background-color: #4caf50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin: 0 10px; font-weight: bold;">
                📞 Appeler le client
              </a>
              ${reservation.email ? `
              <a href="mailto:${reservation.email}" style="display: inline-block; background-color: #2196f3; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin: 0 10px; font-weight: bold;">
                ✉️ Envoyer un email
              </a>
              ` : ''}
            </div>
            
            <!-- Statut -->
            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #9e9e9e; font-size: 12px;">
                Réservation reçue le ${new Date().toLocaleString('fr-FR')} via ${reservation.source}
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  };
  
  try {
    await emailTransporter.sendMail(mailOptions);
    console.log('Email envoyé');
  } catch (error) {
    console.error('Erreur email:', error.message);
  }
}

// Email accusé de réception — en attente de confirmation du personnel
async function sendPendingEmailToClient(reservation) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !reservation.email) return;

  const dateStr = new Date(reservation.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const mailOptions = {
    from: `"Au Murmure des Flots 🌊" <${process.env.EMAIL_USER}>`,
    to: reservation.email,
    subject: `Demande de réservation reçue — ${new Date(reservation.date).toLocaleDateString('fr-FR')}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin: 0; padding: 0; font-family: 'Georgia', serif; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
            <img src="https://raw.githubusercontent.com/Gleekch/restaurant-booking-backend/main/assets/logo.png" alt="Au Murmure des Flots" style="width: 120px; height: 120px; border-radius: 50%; background: white; padding: 10px; margin: 0 auto 20px; display: block;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300;">Au Murmure des Flots</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px; font-style: italic;">Restaurant Bistronomique</p>
          </div>
          <div style="padding: 40px 30px;">
            <h2 style="color: #2c3e50; font-size: 24px; margin-bottom: 10px; font-weight: 300;">Demande de réservation reçue</h2>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Cher(e) ${reservation.customerName},</p>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              Nous avons bien reçu votre demande de réservation. Notre équipe va la vérifier et vous enverra une confirmation par email dans les meilleurs délais.
            </p>
            <div style="background-color: #ffffff; border: 2px solid #667eea; border-radius: 10px; padding: 20px; margin: 30px 0;">
              <p style="margin: 0 0 14px 0; font-size: 15px; font-weight: bold; color: #333333; border-bottom: 1px solid #eeeeee; padding-bottom: 10px;">📅 Votre demande</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Date :</strong> ${dateStr}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Heure :</strong> ${reservation.time}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Couverts :</strong> ${reservation.numberOfPeople} ${reservation.numberOfPeople > 1 ? 'personnes' : 'personne'}</p>
              ${reservation.specialRequests ? `<p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Notes :</strong> ${reservation.specialRequests}</p>` : ''}
            </div>
            <div style="background-color: #fef5e7; border-left: 4px solid #f39c12; padding: 15px; margin: 25px 0; border-radius: 5px;">
              <p style="color: #8b6914; margin: 0; font-size: 14px;">
                <strong>⏳ En attente de confirmation</strong><br>
                Vous recevrez un second email dès que notre équipe aura validé votre réservation. En cas de besoin, n'hésitez pas à nous appeler au 02 62 26 67 19.
              </p>
            </div>
            ${depositBlockHtml(reservation)}
            ${cancelBlockHtml(reservation)}
            <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid #e0e0e0;">
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📞 02 62 26 67 19</p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📧 aumurmuredesflots@gmail.com</p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📍 44 rue du Général Lambert, 97436 Saint-Leu</p>
            </div>
          </div>
          <div style="background-color: #2c3e50; padding: 30px; text-align: center;">
            <p style="color: #ecf0f1; margin: 0 0 10px 0; font-size: 16px; font-style: italic;">"Où chaque repas devient un voyage culinaire"</p>
            <p style="color: #7f8c8d; margin: 20px 0 0 0; font-size: 12px;">© 2025 Au Murmure des Flots - Tous droits réservés</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email accusé de réception envoyé à ${reservation.email}`);
  } catch (error) {
    console.error(`❌ Erreur email accusé de réception:`, error.message);
    throw error;
  }
}

// Email de confirmation — envoyé quand le personnel valide la réservation
async function sendConfirmationEmailToClient(reservation) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !reservation.email) return;
  const clientEmail = reservation.email;
  console.log(`Tentative d'envoi d'email de confirmation au client: ${clientEmail}`);

  const mailOptions = {
    from: `"Au Murmure des Flots 🌊" <${process.env.EMAIL_USER}>`,
    to: clientEmail,
    subject: `✨ Réservation confirmée — ${new Date(reservation.date).toLocaleDateString('fr-FR')}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Georgia', serif; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          
          <!-- Header avec logo -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
            <img src="https://raw.githubusercontent.com/Gleekch/restaurant-booking-backend/main/assets/logo.png" alt="Au Murmure des Flots" style="width: 120px; height: 120px; border-radius: 50%; background: white; padding: 10px; margin: 0 auto 20px; display: block; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300; text-shadow: 2px 2px 4px rgba(0,0,0,0.2);">Au Murmure des Flots</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px; font-style: italic;">Restaurant Bistronomique</p>
          </div>
          
          <!-- Contenu -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #2c3e50; font-size: 24px; margin-bottom: 10px; font-weight: 300;">Confirmation de réservation</h2>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              Cher(e) ${reservation.customerName},
            </p>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              C'est avec grand plaisir que nous confirmons votre réservation. Notre équipe a hâte de vous accueillir pour une expérience gastronomique inoubliable.
            </p>
            
            <!-- Détails de la réservation -->
            <div style="background-color: #ffffff; border: 2px solid #667eea; border-radius: 10px; padding: 20px; margin: 30px 0;">
              <p style="margin: 0 0 14px 0; font-size: 15px; font-weight: bold; color: #333333; border-bottom: 1px solid #eeeeee; padding-bottom: 10px;">📅 Détails de votre réservation</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Date :</strong> ${new Date(reservation.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Heure :</strong> ${reservation.time}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Couverts :</strong> ${reservation.numberOfPeople} ${reservation.numberOfPeople > 1 ? 'personnes' : 'personne'}</p>
              ${reservation.specialRequests ? `<p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Notes :</strong> ${reservation.specialRequests}</p>` : ''}
            </div>
            
            <!-- Message de bienvenue -->
            <div style="background-color: #fef5e7; border-left: 4px solid #f39c12; padding: 15px; margin: 25px 0; border-radius: 5px;">
              <p style="color: #8b6914; margin: 0; font-size: 14px;">
                <strong>💡 Bon à savoir :</strong><br>
                Notre menu est composé de produits frais et locaux, sélectionnés avec soin chaque jour. 
                N'hésitez pas à nous informer de toute allergie ou préférence alimentaire.
              </p>
            </div>
            
            ${depositBlockHtml(reservation)}
            ${cancelBlockHtml(reservation)}

            <!-- Contact -->
            <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid #e0e0e0;">
              <p style="color: #666; font-size: 14px; margin: 5px 0;">
                📞 Téléphone : 02 62 26 67 19
              </p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">
                📧 Email : aumurmuredesflots@gmail.com
              </p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">
                📍 Adresse : 44 rue du Général Lambert, 97436 Saint-Leu
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #2c3e50; padding: 30px; text-align: center;">
            <p style="color: #ecf0f1; margin: 0 0 10px 0; font-size: 16px; font-style: italic;">
              "Où chaque repas devient un voyage culinaire"
            </p>
            <div style="margin-top: 20px;">
              <a href="https://resa-aumurmuredesflots.onrender.com" style="color: #3498db; text-decoration: none; font-size: 14px;">Nouvelle réservation</a>
              <span style="color: #7f8c8d; margin: 0 10px;">|</span>
              <a href="tel:0262266719" style="color: #3498db; text-decoration: none; font-size: 14px;">Nous appeler</a>
            </div>
            <p style="color: #7f8c8d; margin: 20px 0 0 0; font-size: 12px;">
              © 2025 Au Murmure des Flots - Tous droits réservés
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  };
  
  try {
    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email de confirmation envoyé à ${clientEmail}`);
    console.log(`Message ID: ${info.messageId}`);
    console.log(`Response: ${info.response}`);
  } catch (error) {
    console.error(`❌ Erreur email client pour ${clientEmail}:`, error.message);
    console.error('Détails de l\'erreur:', error);
    throw error; // Propager l'erreur pour qu'elle soit visible dans les logs
  }
}

// Email d'annulation — envoyé quand le personnel annule la réservation
async function sendCancellationEmailToClient(reservation) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !reservation.email) return;

  const dateStr = new Date(reservation.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const phoneDisplay = process.env.RESTAURANT_PHONE_DISPLAY || '02 62 26 67 19';

  const mailOptions = {
    from: `"Au Murmure des Flots 🌊" <${process.env.EMAIL_USER}>`,
    to: reservation.email,
    subject: `Annulation de votre réservation — ${new Date(reservation.date).toLocaleDateString('fr-FR')}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin: 0; padding: 0; font-family: 'Georgia', serif; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
            <img src="https://raw.githubusercontent.com/Gleekch/restaurant-booking-backend/main/assets/logo.png" alt="Au Murmure des Flots" style="width: 120px; height: 120px; border-radius: 50%; background: white; padding: 10px; margin: 0 auto 20px; display: block;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300;">Au Murmure des Flots</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px; font-style: italic;">Restaurant Bistronomique</p>
          </div>
          <div style="padding: 40px 30px;">
            <h2 style="color: #2c3e50; font-size: 24px; margin-bottom: 10px; font-weight: 300;">Annulation de réservation</h2>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Cher(e) ${reservation.customerName},</p>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              Nous vous informons que votre réservation a été annulée. Nous sommes désolés pour la gêne occasionnée.
            </p>
            <div style="background-color: #ffffff; border: 2px solid #667eea; border-radius: 10px; padding: 20px; margin: 30px 0;">
              <p style="margin: 0 0 14px 0; font-size: 15px; font-weight: bold; color: #333333; border-bottom: 1px solid #eeeeee; padding-bottom: 10px;">📅 Réservation annulée</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Date :</strong> ${dateStr}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Heure :</strong> ${reservation.time}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Couverts :</strong> ${reservation.numberOfPeople} ${reservation.numberOfPeople > 1 ? 'personnes' : 'personne'}</p>
            </div>
            <div style="background-color: #fef5e7; border-left: 4px solid #f39c12; padding: 15px; margin: 25px 0; border-radius: 5px;">
              <p style="color: #8b6914; margin: 0; font-size: 14px;">
                <strong>💬 Vous souhaitez réserver à une autre date ?</strong><br>
                N'hésitez pas à nous appeler au ${phoneDisplay} ou à effectuer une nouvelle réservation sur notre site.
              </p>
            </div>
            <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid #e0e0e0;">
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📞 ${phoneDisplay}</p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📧 aumurmuredesflots@gmail.com</p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📍 44 rue du Général Lambert, 97436 Saint-Leu</p>
            </div>
          </div>
          <div style="background-color: #2c3e50; padding: 30px; text-align: center;">
            <p style="color: #ecf0f1; margin: 0 0 10px 0; font-size: 16px; font-style: italic;">"Où chaque repas devient un voyage culinaire"</p>
            <p style="color: #7f8c8d; margin: 20px 0 0 0; font-size: 12px;">© 2025 Au Murmure des Flots - Tous droits réservés</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email d'annulation envoyé à ${reservation.email}`);
  } catch (error) {
    console.error(`❌ Erreur email annulation:`, error.message);
    throw error;
  }
}

// Email envoyé quand le paiement des arrhes expire sans avoir été finalisé
async function sendDepositExpiredEmailToClient(reservation) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !reservation.email) return;

  const dateStr = new Date(reservation.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const phoneDisplay = process.env.RESTAURANT_PHONE_DISPLAY || '02 62 26 67 19';
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://www.aumurmuredesflots.com').replace(/\/+$/, '');

  const mailOptions = {
    from: `"Au Murmure des Flots 🌊" <${process.env.EMAIL_USER}>`,
    to: reservation.email,
    subject: `Réservation non confirmée — paiement non finalisé`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin: 0; padding: 0; font-family: 'Georgia', serif; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
            <img src="https://raw.githubusercontent.com/Gleekch/restaurant-booking-backend/main/assets/logo.png" alt="Au Murmure des Flots" style="width: 120px; height: 120px; border-radius: 50%; background: white; padding: 10px; margin: 0 auto 20px; display: block;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300;">Au Murmure des Flots</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px; font-style: italic;">Restaurant Bistronomique</p>
          </div>
          <div style="padding: 40px 30px;">
            <h2 style="color: #2c3e50; font-size: 24px; margin-bottom: 10px; font-weight: 300;">Réservation non confirmée</h2>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Cher(e) ${reservation.customerName},</p>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              Votre demande de réservation pour <strong>${dateStr} à ${reservation.time}</strong> (${reservation.numberOfPeople} ${reservation.numberOfPeople > 1 ? 'personnes' : 'personne'}) n'a pas pu être confirmée car le paiement des arrhes n'a pas été finalisé dans le délai imparti.
            </p>
            <div style="background-color: #fef5e7; border-left: 4px solid #f39c12; padding: 15px; margin: 25px 0; border-radius: 5px;">
              <p style="color: #8b6914; margin: 0; font-size: 14px;">
                <strong>Vous souhaitez tout de même réserver ?</strong><br>
                Effectuez une nouvelle réservation sur notre site ou appelez-nous directement au ${phoneDisplay}.
              </p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${siteUrl}/#reservation" style="display: inline-block; background-color: #667eea; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-size: 14px;">Réserver à nouveau</a>
            </div>
            <div style="text-align: center; padding-top: 30px; border-top: 1px solid #e0e0e0;">
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📞 ${phoneDisplay}</p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📧 aumurmuredesflots@gmail.com</p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📍 44 rue du Général Lambert, 97436 Saint-Leu</p>
            </div>
          </div>
          <div style="background-color: #2c3e50; padding: 30px; text-align: center;">
            <p style="color: #ecf0f1; margin: 0 0 10px 0; font-size: 16px; font-style: italic;">"Où chaque repas devient un voyage culinaire"</p>
            <p style="color: #7f8c8d; margin: 20px 0 0 0; font-size: 12px;">© 2025 Au Murmure des Flots - Tous droits réservés</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email expiration arrhes envoyé à ${reservation.email}`);
  } catch (error) {
    console.error('❌ Erreur email expiration arrhes:', error.message);
  }
}

// Email envoyé par le staff pour demander les arrhes à un client (groupes téléphone/desktop)
async function sendDepositRequestEmailToClient(reservation, checkoutUrl) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !reservation.email) return;

  const dateStr = new Date(reservation.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const phoneDisplay = process.env.RESTAURANT_PHONE_DISPLAY || '02 62 26 67 19';
  const expiryMinutes = parseInt(process.env.CHECKOUT_EXPIRY_MINUTES, 10) || 30;
  const cancellationHours = parseInt(process.env.DEPOSIT_CANCELLATION_HOURS, 10) || 24;
  const amountEuros = reservation.deposit && reservation.deposit.amountCents
    ? (reservation.deposit.amountCents / 100).toFixed(2).replace('.', ',')
    : '?';

  const mailOptions = {
    from: `"Au Murmure des Flots 🌊" <${process.env.EMAIL_USER}>`,
    to: reservation.email,
    subject: `Arrhes à régler — réservation du ${new Date(reservation.date).toLocaleDateString('fr-FR')}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin: 0; padding: 0; font-family: 'Georgia', serif; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
            <img src="https://raw.githubusercontent.com/Gleekch/restaurant-booking-backend/main/assets/logo.png" alt="Au Murmure des Flots" style="width: 120px; height: 120px; border-radius: 50%; background: white; padding: 10px; margin: 0 auto 20px; display: block;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300;">Au Murmure des Flots</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px; font-style: italic;">Restaurant Bistronomique</p>
          </div>
          <div style="padding: 40px 30px;">
            <h2 style="color: #2c3e50; font-size: 24px; margin-bottom: 10px; font-weight: 300;">Arrhes à régler</h2>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Cher(e) ${reservation.customerName},</p>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              Pour confirmer votre réservation, nous vous demandons de régler les arrhes en ligne en cliquant sur le bouton ci-dessous.
            </p>
            <div style="background-color: #ffffff; border: 2px solid #667eea; border-radius: 10px; padding: 20px; margin: 30px 0;">
              <p style="margin: 0 0 14px 0; font-size: 15px; font-weight: bold; color: #333333; border-bottom: 1px solid #eeeeee; padding-bottom: 10px;">📅 Votre réservation</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Date :</strong> ${dateStr}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Heure :</strong> ${reservation.time}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #111111;"><strong>Couverts :</strong> ${reservation.numberOfPeople} ${reservation.numberOfPeople > 1 ? 'personnes' : 'personne'}</p>
              <p style="margin: 8px 0; font-size: 15px; color: #166534;"><strong>Arrhes :</strong> ${amountEuros} €</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${checkoutUrl}" style="display: inline-block; background-color: #4caf50; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">💳 Payer mes arrhes</a>
            </div>
            <div style="background-color: #fef5e7; border-left: 4px solid #f39c12; padding: 15px; margin: 25px 0; border-radius: 5px;">
              <p style="color: #8b6914; margin: 0; font-size: 13px; line-height: 1.5;">
                <strong>⏰ Lien valable ${expiryMinutes} minutes.</strong><br>
                Ce montant sera déduit de votre addition. Il vous est intégralement remboursé en cas d'annulation au moins ${cancellationHours}h avant votre venue.
              </p>
            </div>
            <div style="text-align: center; padding-top: 30px; border-top: 1px solid #e0e0e0;">
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📞 ${phoneDisplay}</p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📧 aumurmuredesflots@gmail.com</p>
              <p style="color: #666; font-size: 14px; margin: 5px 0;">📍 44 rue du Général Lambert, 97436 Saint-Leu</p>
            </div>
          </div>
          <div style="background-color: #2c3e50; padding: 30px; text-align: center;">
            <p style="color: #ecf0f1; margin: 0 0 10px 0; font-size: 16px; font-style: italic;">"Où chaque repas devient un voyage culinaire"</p>
            <p style="color: #7f8c8d; margin: 20px 0 0 0; font-size: 12px;">© 2025 Au Murmure des Flots - Tous droits réservés</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email demande arrhes envoyé à ${reservation.email}`);
  } catch (error) {
    console.error('❌ Erreur email demande arrhes:', error.message);
    throw error;
  }
}

module.exports = {
  sendNotifications,
  sendSMS,
  sendEmail,
  formatReservationMessage,
  sendConfirmationEmailToClient,
  sendCancellationEmailToClient,
  sendDepositExpiredEmailToClient,
  sendDepositRequestEmailToClient
};