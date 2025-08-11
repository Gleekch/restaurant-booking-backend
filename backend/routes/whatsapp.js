const express = require('express');
const router = express.Router();

// Générer un lien WhatsApp pour une réservation
router.post('/generate-link', (req, res) => {
  const { reservation } = req.body;
  
  // Formater le message pour WhatsApp
  const message = `🍽️ NOUVELLE RÉSERVATION
  
Nom: ${reservation.customerName}
Tél: ${reservation.phoneNumber}
Personnes: ${reservation.numberOfPeople}
Date: ${new Date(reservation.date).toLocaleDateString('fr-FR')}
Heure: ${reservation.time}
${reservation.specialRequests ? `Notes: ${reservation.specialRequests}` : ''}

Répondre pour confirmer ✅`;

  // Encoder le message pour l'URL
  const encodedMessage = encodeURIComponent(message);
  const whatsappNumber = process.env.WHATSAPP_NUMBER || '262692504049';
  
  // Générer le lien WhatsApp
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodedMessage}`;
  
  res.json({
    success: true,
    whatsappUrl,
    message: 'Lien WhatsApp généré'
  });
});

// Générer un QR code pour WhatsApp
router.get('/qr-code', (req, res) => {
  const whatsappNumber = process.env.WHATSAPP_NUMBER || '262692504049';
  const welcomeMessage = encodeURIComponent('Bonjour, je souhaite faire une réservation');
  
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${welcomeMessage}`;
  
  // URL pour générer un QR code via API
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(whatsappUrl)}`;
  
  res.json({
    success: true,
    whatsappUrl,
    qrCodeUrl,
    whatsappNumber
  });
});

module.exports = router;