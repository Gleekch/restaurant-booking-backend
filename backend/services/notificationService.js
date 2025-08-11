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
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    subject: `Nouvelle réservation - ${reservation.customerName}`,
    text: message,
    html: message.replace(/\n/g, '<br>')
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
    from: process.env.EMAIL_USER,
    to: clientEmail,
    subject: `Confirmation de réservation - ${new Date(reservation.date).toLocaleDateString('fr-FR')}`,
    text: message,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">Confirmation de réservation</h2>
        <p>Bonjour ${reservation.customerName},</p>
        <p>Votre réservation est confirmée :</p>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Date :</strong> ${new Date(reservation.date).toLocaleDateString('fr-FR')}</p>
          <p><strong>Heure :</strong> ${reservation.time}</p>
          <p><strong>Nombre de personnes :</strong> ${reservation.numberOfPeople}</p>
          ${reservation.specialRequests ? `<p><strong>Demandes spéciales :</strong> ${reservation.specialRequests}</p>` : ''}
        </div>
        <p>À bientôt !</p>
        <p><em>L'équipe du restaurant</em></p>
      </div>
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