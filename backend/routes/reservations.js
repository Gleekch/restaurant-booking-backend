const express = require('express');
const router = express.Router();
const Reservation = require('../models/Reservation');
const { sendNotifications } = require('../services/notificationService');

// Créer une nouvelle réservation
router.post('/', async (req, res) => {
  try {
    // Vérifier la limite de 50 couverts par service
    const { date, time, numberOfPeople } = req.body;
    const hour = parseInt(time.split(':')[0]);
    
    // Déterminer le service
    const isMidi = hour >= 12 && hour < 15;
    const isSoir = hour >= 18 && hour < 23;
    
    if (!isMidi && !isSoir) {
      return res.status(400).json({
        success: false,
        message: 'Les réservations sont uniquement possibles entre 12h-15h (midi) ou 18h-23h (soir)'
      });
    }
    
    // Récupérer toutes les réservations du jour et du service
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    const existingReservations = await Reservation.find({
      date: { $gte: startDate, $lte: endDate },
      status: { $ne: 'cancelled' } // Ne pas compter les réservations annulées
    });
    
    // Calculer les couverts par service
    const serviceReservations = existingReservations.filter(r => {
      const resHour = parseInt(r.time.split(':')[0]);
      if (isMidi) {
        return resHour >= 12 && resHour < 15;
      } else {
        return resHour >= 18 && resHour < 23;
      }
    });
    
    const totalCouverts = serviceReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const serviceName = isMidi ? 'midi' : 'soir';
    
    if (totalCouverts + numberOfPeople > 50) {
      return res.status(400).json({
        success: false,
        message: `Désolé, le service du ${serviceName} est complet (${totalCouverts}/50 couverts déjà réservés). Veuillez choisir un autre créneau.`
      });
    }
    
    const reservation = new Reservation(req.body);
    await reservation.save();
    
    // Envoyer les notifications
    await sendNotifications(reservation);
    
    // Notifier l'application desktop via WebSocket
    const io = req.app.get('io');
    console.log('Émission de new-reservation via Socket.IO pour:', reservation.customerName);
    io.emit('new-reservation', reservation);
    
    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès',
      data: reservation
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Obtenir toutes les réservations
router.get('/', async (req, res) => {
  try {
    const { date, status } = req.query;
    let query = {};
    
    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      query.date = { $gte: startDate, $lt: endDate };
    }
    
    if (status) {
      query.status = status;
    }
    
    const reservations = await Reservation.find(query).sort({ date: 1, time: 1 });
    res.json({
      success: true,
      data: reservations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Obtenir une réservation par ID
router.get('/:id', async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }
    res.json({
      success: true,
      data: reservation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Mettre à jour une réservation
router.put('/:id', async (req, res) => {
  try {
    const reservation = await Reservation.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }
    
    // Notifier l'application desktop
    const io = req.app.get('io');
    io.emit('update-reservation', reservation);
    
    res.json({
      success: true,
      message: 'Réservation mise à jour',
      data: reservation
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Annuler une réservation
router.delete('/:id', async (req, res) => {
  try {
    const reservation = await Reservation.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    );
    
    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }
    
    // Notifier l'application desktop
    const io = req.app.get('io');
    io.emit('cancel-reservation', reservation);
    
    res.json({
      success: true,
      message: 'Réservation annulée',
      data: reservation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;