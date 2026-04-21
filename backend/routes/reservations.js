const express = require('express');

const router = express.Router();
const Reservation = require('../models/Reservation');
const { sendNotifications } = require('../services/notificationService');
const {
  checkAvailability,
  CAPACITY,
  getServiceBounds,
  getRestaurantNow,
  isOnlineBookingClosedDate,
  isOnlineBookingClosedTime,
  parseDateInput,
  timeToMinutes
} = require('../services/capacityService');
const { apiKey } = require('../middleware/auth');

const ONLINE_BOOKING_LIMIT = 8;
const ONLINE_CAPACITY_LIMIT = 50;
const RESTAURANT_PHONE_DISPLAY = process.env.RESTAURANT_PHONE_DISPLAY || '02 62 26 67 19';

function getDayRange(date) {
  const { year, month, day } = parseDateInput(date);

  return {
    startDate: new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)),
    endDate: new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0))
  };
}

function getPartySize(numberOfPeople) {
  const parsed = parseInt(numberOfPeople, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Nombre de couverts invalide');
  }

  return parsed;
}

function getServiceName(timeInMinutes) {
  return timeInMinutes < (15 * 60) ? 'midi' : 'soir';
}

function buildServiceHoursMessage(bounds) {
  const midiLimit = bounds.isWeekend ? '13h45' : '13h15';
  const soirLimit = bounds.isWeekend ? '21h30' : '21h00';

  return `Les reservations sont possibles de 12h00 a ${midiLimit} (midi) ou de 18h30 a ${soirLimit} (soir)`;
}

function buildClosedDaysMessage() {
  return 'Les reservations en ligne ne sont pas disponibles le dimanche soir, le lundi et le mardi. Merci de choisir un autre creneau.';
}

function validatePublicReservationPayload(payload) {
  const normalizedDate = typeof payload.date === 'string' ? payload.date : '';
  parseDateInput(normalizedDate);

  const requestedPeople = getPartySize(payload.numberOfPeople);
  const timeInMinutes = timeToMinutes(payload.time);
  const bounds = getServiceBounds(normalizedDate);
  const isMidi = timeInMinutes >= bounds.midiStart && timeInMinutes <= bounds.midiEnd;
  const isSoir = timeInMinutes >= bounds.soirStart && timeInMinutes <= bounds.soirEnd;
  const restaurantNow = getRestaurantNow();

  if (normalizedDate < restaurantNow.date) {
    throw new Error('Cette date est deja passee. Veuillez choisir une date ulterieure.');
  }

  if (isOnlineBookingClosedDate(normalizedDate)) {
    throw new Error(buildClosedDaysMessage());
  }

  if (isOnlineBookingClosedTime(normalizedDate, payload.time)) {
    throw new Error(buildClosedDaysMessage());
  }

  if (requestedPeople > ONLINE_BOOKING_LIMIT) {
    throw new Error(`Pour les groupes de plus de ${ONLINE_BOOKING_LIMIT} personnes, merci d'appeler le restaurant au ${RESTAURANT_PHONE_DISPLAY}.`);
  }

  if (!isMidi && !isSoir) {
    throw new Error(buildServiceHoursMessage(bounds));
  }

  if (normalizedDate === restaurantNow.date) {
    if (isMidi && restaurantNow.minutes > 900) {
      throw new Error('Le service du midi est termine pour aujourd\'hui. Veuillez choisir le service du soir ou un autre jour.');
    }

    if (isSoir && restaurantNow.minutes > 1380) {
      throw new Error('Le service du soir est termine pour aujourd\'hui. Veuillez choisir un autre jour.');
    }

    if (timeInMinutes < restaurantNow.minutes) {
      throw new Error('Cette heure est deja passee. Veuillez choisir un creneau ulterieur.');
    }
  }

  return {
    normalizedDate,
    requestedPeople,
    timeInMinutes,
    isMidi,
    isSoir
  };
}

async function createReservation(req, res) {
  const reservation = new Reservation(req.body);
  await reservation.save();

  try {
    await sendNotifications(reservation);
    console.log('Notifications envoyees avec succes');
  } catch (notificationError) {
    console.error('Erreur envoi notifications:', notificationError);
  }

  const io = req.app.get('io');
  console.log('Emission de new-reservation via Socket.IO pour:', reservation.customerName);
  io.emit('new-reservation', reservation);

  return reservation;
}

router.post('/desktop', apiKey, async (req, res) => {
  try {
    const { date, time, numberOfPeople } = req.body;
    const requestedPeople = getPartySize(numberOfPeople);
    const availability = await checkAvailability(date, time, requestedPeople, CAPACITY);

    if (!availability.available) {
      const serviceName = getServiceName(timeToMinutes(time));
      return res.status(400).json({
        success: false,
        message: `Desole, le service du ${serviceName} est complet a ${availability.peakSlot} (${availability.peakOccupancy}/${availability.capacity} couverts).`
      });
    }

    const reservation = await createReservation(req, res);

    res.status(201).json({
      success: true,
      message: 'Reservation creee avec succes',
      data: reservation
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const { date, time } = req.body;
    const validation = validatePublicReservationPayload(req.body);
    const availability = await checkAvailability(date, time, validation.requestedPeople, ONLINE_CAPACITY_LIMIT);

    if (!availability.available) {
      const serviceName = validation.isMidi ? 'midi' : 'soir';
      return res.status(400).json({
        success: false,
        message: `Desole, les reservations en ligne pour le service du ${serviceName} sont completes a ${availability.peakSlot} (${availability.peakOccupancy}/${availability.capacity} couverts). Vous pouvez essayer de venir directement au restaurant ou choisir un autre creneau.`
      });
    }

    const reservation = await createReservation(req, res);

    res.status(201).json({
      success: true,
      message: 'Reservation creee avec succes',
      data: reservation
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/availability', async (req, res) => {
  try {
    const { date, people } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Parametre date requis'
      });
    }

    const { getAvailableSlots } = require('../services/capacityService');
    const requestedPeople = getPartySize(people || 2);

    if (isOnlineBookingClosedDate(date)) {
      return res.status(400).json({
        success: false,
        message: buildClosedDaysMessage()
      });
    }

    if (requestedPeople > ONLINE_BOOKING_LIMIT) {
      return res.status(400).json({
        success: false,
        message: `Pour les groupes de plus de ${ONLINE_BOOKING_LIMIT} personnes, merci d'appeler le restaurant au ${RESTAURANT_PHONE_DISPLAY}.`
      });
    }

    const slots = await getAvailableSlots(date, requestedPeople, ONLINE_CAPACITY_LIMIT);

    res.json({
      success: true,
      data: slots
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/', apiKey, async (req, res) => {
  try {
    const { date, status } = req.query;
    const query = {};

    if (date) {
      const { startDate, endDate } = getDayRange(date);
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
    res.status(error.message.startsWith('Date invalide') ? 400 : 500).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/:id', apiKey, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation non trouvee'
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

router.put('/:id', apiKey, async (req, res) => {
  try {
    const existing = await Reservation.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Reservation non trouvee'
      });
    }

    if (existing.status === 'cancelled' || existing.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: `Impossible de modifier une reservation ${existing.status === 'cancelled' ? 'annulee' : 'terminee'}`
      });
    }

    const { date, time, numberOfPeople } = req.body;
    const existingDate = existing.date.toISOString().split('T')[0];
    const dateChanged = date && date !== existingDate;
    const timeChanged = time && time !== existing.time;
    const peopleChanged = typeof numberOfPeople !== 'undefined' && getPartySize(numberOfPeople) !== existing.numberOfPeople;

    if (dateChanged || timeChanged || peopleChanged) {
      const checkDate = date || existingDate;
      const checkTime = time || existing.time;
      const checkPeople = typeof numberOfPeople !== 'undefined' ? getPartySize(numberOfPeople) : existing.numberOfPeople;
      const availability = await checkAvailability(checkDate, checkTime, checkPeople, CAPACITY, req.params.id);

      if (!availability.available) {
        return res.status(400).json({
          success: false,
          message: `Creneau complet a ${availability.peakSlot} (${availability.peakOccupancy}/${availability.capacity} couverts)`
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

    res.json({
      success: true,
      message: 'Reservation mise a jour',
      data: reservation
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

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
        message: 'Reservation non trouvee'
      });
    }

    const io = req.app.get('io');
    io.emit('cancel-reservation', reservation);

    res.json({
      success: true,
      message: 'Reservation annulee',
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
