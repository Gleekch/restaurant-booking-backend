const express = require('express');
const router = express.Router();
const Reservation = require('../models/Reservation');
const { sendNotifications } = require('../services/notificationService');
const { checkAvailability, CAPACITY } = require('../services/capacityService');
const { apiKey } = require('../middleware/auth');

// Créer une réservation depuis l'application desktop (protégé par API key)
router.post('/desktop', apiKey, async (req, res) => {
  try {
    const { date, time, numberOfPeople } = req.body;

    // Vérifier la capacité par créneau (desktop = capacité totale restaurant)
    const availability = await checkAvailability(date, time, numberOfPeople, CAPACITY);
    if (!availability.available) {
      const hour = parseInt(time.split(':')[0]);
      const serviceName = hour < 15 ? 'midi' : 'soir';
      return res.status(400).json({
        success: false,
        message: `Désolé, le service du ${serviceName} est complet à ${availability.peakSlot} (${availability.peakOccupancy}/${availability.capacity} couverts).`
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

// Créer une nouvelle réservation (depuis le site web - limite 50 couverts)
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
    
    // Vérifier la capacité par créneau (web = limite 50 pour garder de la marge)
    const WEB_LIMIT = 50;
    const availability = await checkAvailability(date, time, numberOfPeople, WEB_LIMIT);
    if (!availability.available) {
      const serviceName = isMidi ? 'midi' : 'soir';
      return res.status(400).json({
        success: false,
        message: `Désolé, les réservations en ligne pour le service du ${serviceName} sont complètes à ${availability.peakSlot} (${availability.peakOccupancy}/${availability.capacity} couverts). Vous pouvez essayer de venir directement au restaurant ou choisir un autre créneau.`
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

// Vérifier la disponibilité par créneau pour une date
router.get('/availability', async (req, res) => {
  try {
    const { date, people } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, message: 'Paramètre date requis' });
    }
    const { getAvailableSlots } = require('../services/capacityService');
    const numberOfPeople = parseInt(people) || 2;
    const slots = await getAvailableSlots(date, numberOfPeople, 50);
    res.json({ success: true, data: slots });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Obtenir toutes les réservations (protégé)
router.get('/', apiKey, async (req, res) => {
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
router.get('/:id', apiKey, async (req, res) => {
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
router.put('/:id', apiKey, async (req, res) => {
  try {
    const existing = await Reservation.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Réservation non trouvée' });
    }

    // Empêcher la modification d'une réservation annulée ou terminée
    if (existing.status === 'cancelled' || existing.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: `Impossible de modifier une réservation ${existing.status === 'cancelled' ? 'annulée' : 'terminée'}`
      });
    }

    const { date, time, numberOfPeople } = req.body;
    const dateChanged = date && date !== existing.date.toISOString().split('T')[0];
    const timeChanged = time && time !== existing.time;
    const peopleChanged = numberOfPeople && numberOfPeople !== existing.numberOfPeople;

    // Revalider la capacité si date, heure ou nombre de personnes changent
    if (dateChanged || timeChanged || peopleChanged) {
      const checkDate = date || existing.date.toISOString().split('T')[0];
      const checkTime = time || existing.time;
      const checkPeople = numberOfPeople || existing.numberOfPeople;

      // Exclure la réservation courante du calcul de capacité
      const availability = await checkAvailability(checkDate, checkTime, checkPeople, CAPACITY, req.params.id);

      if (!availability.available) {
        return res.status(400).json({
          success: false,
          message: `Créneau complet à ${availability.peakSlot} (${availability.peakOccupancy}/${availability.capacity} couverts)`
        });
      }
    }

    const reservation = await Reservation.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    const io = req.app.get('io');
    io.emit('update-reservation', reservation);

    res.json({ success: true, message: 'Réservation mise à jour', data: reservation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Annuler une réservation
router.delete('/:id', apiKey, async (req, res) => {
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