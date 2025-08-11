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
    
    // Déterminer le service et vérifier les horaires limites
    const [hours, minutes] = time.split(':').map(Number);
    const timeInMinutes = hours * 60 + minutes;
    
    // Vérifier si c'est le week-end (samedi = 6, dimanche = 0)
    const reservationDate = new Date(date);
    const dayOfWeek = reservationDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Vérifier si c'est aujourd'hui et si le service est déjà passé
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    reservationDate.setHours(0, 0, 0, 0);
    
    if (reservationDate.getTime() === today.getTime()) {
      // C'est aujourd'hui, vérifier l'heure actuelle
      const currentHour = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTimeInMinutes = currentHour * 60 + currentMinutes;
      
      // Si on est après 15h, le service du midi est terminé
      if (timeInMinutes < 900 && currentTimeInMinutes > 900) { // 900 = 15h00
        return res.status(400).json({
          success: false,
          message: 'Le service du midi est terminé pour aujourd\'hui. Veuillez choisir le service du soir ou un autre jour.'
        });
      }
      
      // Si on est après 23h, le service du soir est terminé
      if (timeInMinutes >= 1110 && currentTimeInMinutes > 1380) { // 1380 = 23h00
        return res.status(400).json({
          success: false,
          message: 'Le service du soir est terminé pour aujourd\'hui. Veuillez choisir un autre jour.'
        });
      }
      
      // Empêcher de réserver pour une heure déjà passée
      if (timeInMinutes < currentTimeInMinutes) {
        return res.status(400).json({
          success: false,
          message: 'Cette heure est déjà passée. Veuillez choisir un créneau ultérieur.'
        });
      }
    }
    
    // Horaires avec 30 min supplémentaires le week-end
    // Midi: 12h00 à 13h15 (13h45 le week-end)
    const midiMaxTime = isWeekend ? 825 : 795; // 13h45 = 825 min, 13h15 = 795 min
    const isMidi = timeInMinutes >= 720 && timeInMinutes <= midiMaxTime;
    
    // Soir: 18h30 à 21h00 (21h30 le week-end)
    const soirMaxTime = isWeekend ? 1290 : 1260; // 21h30 = 1290 min, 21h00 = 1260 min
    const isSoir = timeInMinutes >= 1110 && timeInMinutes <= soirMaxTime;
    
    if (!isMidi && !isSoir) {
      const midiLimit = isWeekend ? '13h45' : '13h15';
      const soirLimit = isWeekend ? '21h30' : '21h00';
      return res.status(400).json({
        success: false,
        message: `Les réservations sont possibles de 12h00 à ${midiLimit} (midi) ou de 18h30 à ${soirLimit} (soir)`
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
        message: `Désolé, les réservations en ligne pour le service du ${serviceName} sont complètes (${totalCouverts}/50 réservations). Vous pouvez essayer de venir directement au restaurant ou choisir un autre créneau.`
      });
    }
    
    const reservation = new Reservation(req.body);
    await reservation.save();
    
    // Envoyer les notifications email/SMS d'abord (important pour le client)
    try {
      await sendNotifications(reservation);
      console.log('Notifications envoyées avec succès');
    } catch (err) {
      console.error('Erreur envoi notifications:', err);
      // L'erreur n'empêche pas la réservation d'être créée
    }
    
    // Notifier l'application desktop via WebSocket après
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