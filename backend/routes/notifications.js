const express = require('express');
const router = express.Router();
const { sendSMS, sendEmail } = require('../services/notificationService');

// Envoyer une notification de test
router.post('/test', async (req, res) => {
  const { type, recipient, message } = req.body;
  
  try {
    if (type === 'sms') {
      await sendSMS(recipient, message);
      res.json({
        success: true,
        message: 'SMS envoyé avec succès'
      });
    } else if (type === 'email') {
      await sendEmail(message, { customerName: 'Test' });
      res.json({
        success: true,
        message: 'Email envoyé avec succès'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Type de notification non valide'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Envoyer un rappel de réservation
router.post('/reminder/:reservationId', async (req, res) => {
  try {
    const Reservation = require('../models/Reservation');
    const reservation = await Reservation.findById(req.params.reservationId);
    
    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }
    
    const date = new Date(reservation.date).toLocaleDateString('fr-FR');
    const message = `Rappel: Votre réservation pour ${reservation.numberOfPeople} personnes le ${date} à ${reservation.time} est confirmée. À bientôt!`;
    
    if (reservation.phoneNumber) {
      await sendSMS(reservation.phoneNumber, message);
    }
    
    res.json({
      success: true,
      message: 'Rappel envoyé'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;