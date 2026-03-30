const express = require('express');
const router = express.Router();

// Configuration du restaurant (pourrait être dans MongoDB)
let settings = {
  restaurant: {
    name: 'Le Bistrot Moderne',
    address: '123 Rue de la République, 75001 Paris',
    phone: '+33 1 23 45 67 89',
    email: 'contact@bistrotmoderne.fr'
  },
  hours: {
    monday: { lunch: null, dinner: null, closed: true },
    tuesday: { lunch: '12:00-14:30', dinner: '19:00-22:30', closed: false },
    wednesday: { lunch: '12:00-14:30', dinner: '19:00-22:30', closed: false },
    thursday: { lunch: '12:00-14:30', dinner: '19:00-22:30', closed: false },
    friday: { lunch: '12:00-14:30', dinner: '19:00-23:00', closed: false },
    saturday: { lunch: '12:00-14:30', dinner: '19:00-23:00', closed: false },
    sunday: { lunch: '12:00-15:00', dinner: null, closed: false }
  },
  capacity: {
    totalTables: 20,
    totalSeats: 80,
    maxGroupSize: 12
  },
  bookingRules: {
    advanceBookingDays: 30,
    minAdvanceHours: 2,
    cancellationHours: 24,
    timeSlotDuration: 15
  }
};

// Obtenir les paramètres
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: settings
  });
});

// Obtenir les horaires
router.get('/hours', (req, res) => {
  res.json({
    success: true,
    data: settings.hours
  });
});

// Obtenir les horaires d'un jour spécifique
router.get('/hours/:day', (req, res) => {
  const day = req.params.day.toLowerCase();
  if (settings.hours[day]) {
    res.json({
      success: true,
      data: settings.hours[day]
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'Jour non valide'
    });
  }
});

// Vérifier la disponibilité
// Disponibilité — redirige vers le vrai endpoint dans /api/reservations/availability
// Conservé pour compatibilité, mais l'endpoint canonique est GET /api/reservations/availability
router.post('/availability', async (req, res) => {
  const { date, time, numberOfPeople } = req.body;
  if (!date || !time) {
    return res.json({ success: false, available: false, message: 'Date et heure requises' });
  }
  const { checkAvailability } = require('../services/capacityService');
  try {
    const result = await checkAvailability(date, time, numberOfPeople || 2, 50);
    res.json({
      success: true,
      available: result.available,
      message: result.available ? 'Créneau disponible' : `Créneau complet à ${result.peakSlot} (${result.peakOccupancy}/${result.capacity} couverts)`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Mettre à jour les paramètres (protégé par API key)
const { apiKey } = require('../middleware/auth');
router.put('/', apiKey, (req, res) => {
  settings = { ...settings, ...req.body };
  res.json({
    success: true,
    message: 'Paramètres mis à jour',
    data: settings
  });
});

module.exports = router;