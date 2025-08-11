const express = require('express');
const router = express.Router();
const Reservation = require('../models/Reservation');
const { sendNotifications } = require('../services/notificationService');

// Créer une nouvelle réservation
router.post('/', async (req, res) => {
  try {
    const reservation = new Reservation(req.body);
    await reservation.save();
    
    // Envoyer les notifications
    await sendNotifications(reservation);
    
    // Notifier l'application desktop via WebSocket
    const io = req.app.get('io');
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