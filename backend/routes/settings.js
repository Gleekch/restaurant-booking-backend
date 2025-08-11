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
router.post('/availability', async (req, res) => {
  const { date, time, numberOfPeople } = req.body;
  
  // Logique simplifiée de vérification de disponibilité
  // Dans un cas réel, on vérifierait les réservations existantes
  
  const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dayHours = settings.hours[dayOfWeek];
  
  if (dayHours.closed) {
    return res.json({
      success: false,
      available: false,
      message: 'Le restaurant est fermé ce jour-là'
    });
  }
  
  // Vérifier si l'heure est dans les créneaux d'ouverture
  const requestedTime = parseInt(time.replace(':', ''));
  let isInOpenHours = false;
  
  if (dayHours.lunch) {
    const [lunchStart, lunchEnd] = dayHours.lunch.split('-').map(t => parseInt(t.replace(':', '')));
    if (requestedTime >= lunchStart && requestedTime <= lunchEnd) {
      isInOpenHours = true;
    }
  }
  
  if (dayHours.dinner) {
    const [dinnerStart, dinnerEnd] = dayHours.dinner.split('-').map(t => parseInt(t.replace(':', '')));
    if (requestedTime >= dinnerStart && requestedTime <= dinnerEnd) {
      isInOpenHours = true;
    }
  }
  
  if (!isInOpenHours) {
    return res.json({
      success: false,
      available: false,
      message: 'Le restaurant est fermé à cette heure'
    });
  }
  
  if (numberOfPeople > settings.capacity.maxGroupSize) {
    return res.json({
      success: false,
      available: false,
      message: `Nous ne pouvons accueillir que ${settings.capacity.maxGroupSize} personnes maximum par réservation`
    });
  }
  
  // Ici, on devrait vérifier les réservations existantes
  // Pour l'instant, on retourne toujours disponible
  
  res.json({
    success: true,
    available: true,
    message: 'Créneau disponible'
  });
});

// Mettre à jour les paramètres (protégé par authentification dans un cas réel)
router.put('/', (req, res) => {
  settings = { ...settings, ...req.body };
  res.json({
    success: true,
    message: 'Paramètres mis à jour',
    data: settings
  });
});

module.exports = router;