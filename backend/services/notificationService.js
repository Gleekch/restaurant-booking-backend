const nodemailer = require('nodemailer');

// SMS désactivé - Twilio non utilisé
let twilioClient = null;

// Configuration Email
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false // Accepter les certificats auto-signés
  }
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
  
  // Email de confirmation au client
  if (reservation.email) {
    const clientMessage = `Bonjour ${reservation.customerName},\n\nVotre réservation est confirmée :\n${message}\n\nÀ bientôt !\n\nL'équipe du restaurant`;
    emailPromises.push(sendEmailToClient(reservation.email, clientMessage, reservation));
  }
  
  try {
    await Promise.all([...smsPromises, ...emailPromises]);
    console.log('Notifications envoyées avec succès');
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
            <h1 style="color: white; margin: 0; font-size: 28px;">🍽️ Nouvelle Réservation</h1>
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

// Envoyer email au client
async function sendEmailToClient(clientEmail, message, reservation) {
  if (!process.env.EMAIL_USER) {
    console.log('Email non configuré');
    return;
  }
  
  const mailOptions = {
    from: `"Au Murmure des Flots 🌊" <${process.env.EMAIL_USER}>`,
    to: clientEmail,
    subject: `✨ Confirmation de réservation - ${new Date(reservation.date).toLocaleDateString('fr-FR')}`,
    text: message,
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
            <div style="background: white; width: 120px; height: 120px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
              <div style="font-size: 60px;">🌊</div>
            </div>
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300; text-shadow: 2px 2px 4px rgba(0,0,0,0.2);">Au Murmure des Flots</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px; font-style: italic;">Restaurant Gastronomique</p>
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
            <div style="background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); padding: 25px; border-radius: 10px; margin: 30px 0;">
              <h3 style="color: #2c3e50; margin-top: 0; font-size: 18px; border-bottom: 2px solid #667eea; padding-bottom: 10px;">📅 Détails de votre réservation</h3>
              
              <table style="width: 100%; margin-top: 15px;">
                <tr>
                  <td style="padding: 8px 0; color: #666;">
                    <strong>Date :</strong>
                  </td>
                  <td style="padding: 8px 0; color: #2c3e50; text-align: right;">
                    ${new Date(reservation.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">
                    <strong>Heure :</strong>
                  </td>
                  <td style="padding: 8px 0; color: #2c3e50; text-align: right;">
                    ${reservation.time}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">
                    <strong>Nombre de convives :</strong>
                  </td>
                  <td style="padding: 8px 0; color: #2c3e50; text-align: right;">
                    ${reservation.numberOfPeople} ${reservation.numberOfPeople > 1 ? 'personnes' : 'personne'}
                  </td>
                </tr>
                ${reservation.specialRequests ? `
                <tr>
                  <td style="padding: 8px 0; color: #666; vertical-align: top;">
                    <strong>Demandes spéciales :</strong>
                  </td>
                  <td style="padding: 8px 0; color: #2c3e50; text-align: right;">
                    <em>${reservation.specialRequests}</em>
                  </td>
                </tr>
                ` : ''}
              </table>
            </div>
            
            <!-- Message de bienvenue -->
            <div style="background-color: #fef5e7; border-left: 4px solid #f39c12; padding: 15px; margin: 25px 0; border-radius: 5px;">
              <p style="color: #8b6914; margin: 0; font-size: 14px;">
                <strong>💡 Bon à savoir :</strong><br>
                Notre menu est composé de produits frais et locaux, sélectionnés avec soin chaque jour. 
                N'hésitez pas à nous informer de toute allergie ou préférence alimentaire.
              </p>
            </div>
            
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
              © 2024 Au Murmure des Flots - Tous droits réservés
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  };
  
  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`Email de confirmation envoyé à ${clientEmail}`);
  } catch (error) {
    console.error(`Erreur email client:`, error.message);
  }
}

module.exports = {
  sendNotifications,
  sendSMS,
  sendEmail,
  sendEmailToClient
};