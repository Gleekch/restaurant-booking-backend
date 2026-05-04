const express = require('express');

const router = express.Router();
const Reservation = require('../models/Reservation');
const { sendNotifications, sendConfirmationEmailToClient, sendCancellationEmailToClient } = require('../services/notificationService');
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

const ONLINE_BOOKING_LIMIT = parseInt(process.env.ONLINE_BOOKING_LIMIT, 10) || 10;
const ONLINE_CAPACITY_LIMIT = parseInt(process.env.ONLINE_CAPACITY, 10) || 50;
const RESTAURANT_PHONE_DISPLAY = process.env.RESTAURANT_PHONE_DISPLAY || '02 62 26 67 19';
const ONLINE_LIMIT_NOTICE = `Pour garantir un accueil soigné à chaque table et le bien-être de notre équipe, nous limitons les réservations en ligne. Pour toute demande, appelez-nous au ${process.env.RESTAURANT_PHONE_DISPLAY || '02 62 26 67 19'}.`;

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
  const midiLimit = bounds.isMidiExtended ? '14h00' : '13h30';
  const soirLimit = bounds.isSoirWeekend ? '22h00' : '21h30';

  return `Les reservations sont possibles de 12h00 a ${midiLimit} (midi) ou de 18h00 a ${soirLimit} (soir)`;
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
        message: `Ce créneau est complet en ligne pour le service du ${serviceName}. Afin de garantir un accueil soigné à chaque table et le bien-être de notre équipe, nous limitons le nombre de réservations en ligne. Vous pouvez choisir un autre créneau ou nous appeler au ${RESTAURANT_PHONE_DISPLAY} — il reste peut-être de la place !`
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
    const { getEnrichedAvailability, getConfig } = require('../services/slotStrategyService');
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

    const baseSlots = await getAvailableSlots(date, requestedPeople, ONLINE_CAPACITY_LIMIT);

    const hasFullSlots = [...baseSlots.midi, ...baseSlots.soir].some(s => !s.available);
    const notice = hasFullSlots ? ONLINE_LIMIT_NOTICE : null;

    if (!getConfig().recommendationsEnabled) {
      return res.json({
        success: true,
        data: {
          ...baseSlots,
          meta: { recommendationsEnabled: false, notice }
        }
      });
    }

    try {
      const enriched = await getEnrichedAvailability(date, requestedPeople, baseSlots);
      enriched.meta = { ...enriched.meta, notice };
      return res.json({ success: true, data: enriched });
    } catch (enrichError) {
      console.error('slotStrategyService fallback:', enrichError.message);
      return res.json({
        success: true,
        data: {
          ...baseSlots,
          meta: { recommendationsEnabled: false, notice }
        }
      });
    }
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

    if (existing.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Impossible de modifier une reservation terminee'
      });
    }

    // Une réservation annulée ne peut être que réactivée (changement de statut uniquement)
    if (existing.status === 'cancelled') {
      const allowedReactivation = req.body.status === 'pending' || req.body.status === 'confirmed';
      if (!allowedReactivation) {
        return res.status(400).json({
          success: false,
          message: 'Une reservation annulee ne peut etre que reactivee (pending ou confirmed)'
        });
      }
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

    const statusChangedToConfirmed = req.body.status === 'confirmed' && existing.status !== 'confirmed';
    const statusChangedToCancelled = req.body.status === 'cancelled' && existing.status !== 'cancelled';
    const restoredFromCancelled = existing.status === 'cancelled' && (req.body.status === 'pending' || req.body.status === 'confirmed');

    if ((statusChangedToConfirmed || (restoredFromCancelled && req.body.status === 'confirmed')) && reservation.email) {
      sendConfirmationEmailToClient(reservation).catch(err =>
        console.error('Erreur email confirmation client:', err.message)
      );
    }

    if (statusChangedToCancelled && reservation.email) {
      sendCancellationEmailToClient(reservation).catch(err =>
        console.error('Erreur email annulation client:', err.message)
      );
    }

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
    const existing = await Reservation.findById(req.params.id);
    const wasNotCancelled = existing && existing.status !== 'cancelled';

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

    if (wasNotCancelled && reservation.email) {
      sendCancellationEmailToClient(reservation).catch(err =>
        console.error('Erreur email annulation client:', err.message)
      );
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
