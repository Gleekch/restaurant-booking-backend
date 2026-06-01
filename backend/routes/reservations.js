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
const {
  isDepositRequired,
  computeDepositCents,
  getDepositConfig,
  createCheckoutSession,
  refundDeposit
} = require('../services/paymentService');

const RESTAURANT_TIME_ZONE = process.env.RESTAURANT_TIME_ZONE || 'Indian/Reunion';

// Décalage du fuseau du restaurant par rapport à UTC (minutes, à l'est).
function getTimezoneOffsetMinutes(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Instant UTC (ms) du début de la réservation (date = minuit UTC du jour + heure locale).
function getReservationStartUtcMs(reservation) {
  const dateMidnightUtc = new Date(reservation.date).getTime();
  const [hours, minutes] = String(reservation.time).split(':').map(Number);
  const localMinutes = (hours * 60) + minutes;
  const offset = getTimezoneOffsetMinutes(RESTAURANT_TIME_ZONE, new Date(reservation.date));
  return dateMidnightUtc + ((localMinutes - offset) * 60000);
}

function hoursUntilReservation(reservation) {
  return (getReservationStartUtcMs(reservation) - Date.now()) / (60 * 60 * 1000);
}

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

  if (!payload.email || typeof payload.email !== 'string' || !payload.email.includes('@')) {
    throw new Error('Une adresse email valide est requise pour réserver en ligne.');
  }

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

async function createReservation(req, res, options = {}) {
  const { notify = true } = options;
  const reservation = new Reservation(req.body);
  await reservation.save();

  if (notify) {
    try {
      await sendNotifications(reservation);
      console.log('Notifications envoyees avec succes');
    } catch (notificationError) {
      console.error('Erreur envoi notifications:', notificationError);
    }

    const io = req.app.get('io');
    console.log('Emission de new-reservation via Socket.IO pour:', reservation.customerName);
    io.emit('new-reservation', reservation);
  }

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
    // Sécurité : ces champs ne doivent jamais venir du client (anti-spoofing
    // d'un statut « payé » ou d'arrhes pour contourner le paiement).
    delete req.body.status;
    delete req.body.deposit;
    req.body.source = 'website';

    const { date, time } = req.body;
    const validation = validatePublicReservationPayload(req.body);

    // Vérifier si le service est bloqué manuellement
    const BlockedServiceModel = require('../models/BlockedService');
    const { year: by, month: bm, day: bd } = parseDateInput(validation.normalizedDate);
    const bStart = new Date(Date.UTC(by, bm - 1, bd, 0, 0, 0, 0));
    const bEnd   = new Date(Date.UTC(by, bm - 1, bd, 23, 59, 59, 999));
    const blockedEntries = await BlockedServiceModel.find({ date: { $gte: bStart, $lte: bEnd } });
    const blockedSvcs = blockedEntries.map(b => b.service);
    const requestedService = validation.isMidi ? 'midi' : 'soir';
    if (blockedSvcs.includes('all') || blockedSvcs.includes(requestedService)) {
      return res.status(400).json({
        success: false,
        message: `Le service du ${requestedService} est complet pour cette date. Pour toute demande, appelez-nous au ${RESTAURANT_PHONE_DISPLAY}.`
      });
    }

    // Vérification doublon : même téléphone + même date + statut actif
    const { startDate, endDate } = getDayRange(validation.normalizedDate);
    const existingBooking = await Reservation.findOne({
      phoneNumber: req.body.phoneNumber,
      date: { $gte: startDate, $lt: endDate },
      status: { $nin: ['cancelled', 'awaiting-payment'] }
    });

    if (existingBooking) {
      return res.status(400).json({
        success: false,
        message: `Votre réservation du ${new Date(existingBooking.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${existingBooking.time} a déjà été prise en compte. Vous recevrez une confirmation par email. Pour toute modification, appelez-nous au ${RESTAURANT_PHONE_DISPLAY}.`
      });
    }

    const availability = await checkAvailability(date, time, validation.requestedPeople, ONLINE_CAPACITY_LIMIT);

    if (!availability.available) {
      const serviceName = validation.isMidi ? 'midi' : 'soir';
      return res.status(400).json({
        success: false,
        message: `Ce créneau est complet en ligne pour le service du ${serviceName}. Afin de garantir un accueil soigné à chaque table et le bien-être de notre équipe, nous limitons le nombre de réservations en ligne. Vous pouvez choisir un autre créneau ou nous appeler au ${RESTAURANT_PHONE_DISPLAY} — il reste peut-être de la place !`
      });
    }

    // Groupes >= seuil : arrhes obligatoires avant de retenir la réservation.
    if (isDepositRequired(validation.requestedPeople)) {
      const config = getDepositConfig();
      const amountCents = computeDepositCents(validation.requestedPeople);
      const expiresAt = new Date(Date.now() + config.expiryMinutes * 60 * 1000);

      // Création en attente de paiement : occupe déjà la place (status != cancelled).
      req.body.status = 'awaiting-payment';
      req.body.deposit = {
        required: true,
        amountCents,
        perPersonCents: config.perPersonCents,
        currency: config.currency,
        status: 'awaiting',
        expiresAt
      };

      const reservation = await createReservation(req, res, { notify: false });

      try {
        const session = await createCheckoutSession(reservation);
        reservation.deposit.stripeSessionId = session.sessionId;
        reservation.deposit.expiresAt = session.expiresAt;
        await reservation.save();

        return res.status(201).json({
          success: true,
          requiresPayment: true,
          checkoutUrl: session.url,
          message: 'Acompte requis pour confirmer la reservation',
          data: reservation
        });
      } catch (paymentError) {
        console.error('Erreur creation session de paiement:', paymentError);
        reservation.status = 'cancelled';
        reservation.deposit.status = 'failed';
        await reservation.save();
        return res.status(502).json({
          success: false,
          message: 'Le service de paiement est momentanement indisponible. Merci de reessayer ou d\'appeler le restaurant.'
        });
      }
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

    // Vérifier les blocages manuels
    const BlockedService = require('../models/BlockedService');
    const { year, month, day } = parseDateInput(date);
    const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const dayEnd   = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    const blocked = await BlockedService.find({ date: { $gte: dayStart, $lte: dayEnd } });
    const blockedServices = blocked.map(b => b.service);

    const baseSlots = await getAvailableSlots(date, requestedPeople, ONLINE_CAPACITY_LIMIT);

    // Marquer les créneaux bloqués comme indisponibles
    if (blockedServices.includes('all') || blockedServices.includes('midi')) {
      baseSlots.midi = baseSlots.midi.map(s => ({ ...s, available: false }));
    }
    if (blockedServices.includes('all') || blockedServices.includes('soir')) {
      baseSlots.soir = baseSlots.soir.map(s => ({ ...s, available: false }));
    }

    const hasFullSlots = [...baseSlots.midi, ...baseSlots.soir].some(s => !s.available);
    const notice = hasFullSlots ? ONLINE_LIMIT_NOTICE : null;
    const meta = { recommendationsEnabled: false, notice, blockedServices };

    if (!getConfig().recommendationsEnabled) {
      return res.json({ success: true, data: { ...baseSlots, meta } });
    }

    try {
      const enriched = await getEnrichedAvailability(date, requestedPeople, baseSlots);
      enriched.meta = { ...enriched.meta, notice, blockedServices };
      return res.json({ success: true, data: enriched });
    } catch (enrichError) {
      console.error('slotStrategyService fallback:', enrichError.message);
      return res.json({ success: true, data: { ...baseSlots, meta } });
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

// Logique d'annulation partagée (admin + client) : rembourse les arrhes si
// l'annulation a lieu suffisamment en avance, puis passe la résa en 'cancelled'.
// Renvoie { refundMessage, refunded }.
async function cancelReservationCore(reservation) {
  let refundMessage = '';
  let refunded = false;

  if (reservation.deposit && reservation.deposit.status === 'paid') {
    const config = getDepositConfig();
    if (hoursUntilReservation(reservation) >= config.cancellationHours) {
      try {
        await refundDeposit(reservation);
        reservation.deposit.status = 'refunded';
        reservation.deposit.refundedAt = new Date();
        refundMessage = ' Arrhes remboursees.';
        refunded = true;
      } catch (refundError) {
        console.error('Erreur remboursement arrhes:', refundError);
        refundMessage = ' (echec du remboursement automatique, a traiter manuellement)';
      }
    } else {
      refundMessage = ' Arrhes conservees (annulation tardive).';
    }
  }

  reservation.status = 'cancelled';
  await reservation.save();
  return { refundMessage, refunded };
}

router.delete('/:id', apiKey, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation non trouvee'
      });
    }

    const wasNotCancelled = reservation.status !== 'cancelled';
    const { refundMessage } = await cancelReservationCore(reservation);

    if (wasNotCancelled && reservation.email) {
      sendCancellationEmailToClient(reservation).catch(err =>
        console.error('Erreur email annulation client:', err.message)
      );
    }

    const io = req.app.get('io');
    io.emit('cancel-reservation', reservation);

    res.json({
      success: true,
      message: `Reservation annulee.${refundMessage}`,
      data: reservation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Résumé public d'une réservation (page d'annulation client), protégé par le jeton.
router.get('/:id/public', async (req, res) => {
  try {
    const { token } = req.query;
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation || !token || token !== reservation.cancellationToken) {
      return res.status(404).json({ success: false, message: 'Reservation introuvable ou lien invalide' });
    }

    const config = getDepositConfig();
    res.json({
      success: true,
      data: {
        customerName: reservation.customerName,
        date: reservation.date,
        time: reservation.time,
        numberOfPeople: reservation.numberOfPeople,
        status: reservation.status,
        deposit: {
          required: reservation.deposit.required,
          amountCents: reservation.deposit.amountCents,
          currency: reservation.deposit.currency,
          status: reservation.deposit.status
        },
        cancellationHours: config.cancellationHours,
        refundableNow: reservation.deposit.status === 'paid'
          && hoursUntilReservation(reservation) >= config.cancellationHours
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Annulation par le client via son jeton secret (pas d'API key).
router.post('/:id/cancel', async (req, res) => {
  try {
    const token = req.body && req.body.token;
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation || !token || token !== reservation.cancellationToken) {
      return res.status(404).json({ success: false, message: 'Reservation introuvable ou lien invalide' });
    }

    if (reservation.status === 'cancelled') {
      return res.json({ success: true, alreadyCancelled: true, message: 'Cette reservation est deja annulee.' });
    }

    if (reservation.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Cette reservation ne peut plus etre annulee.' });
    }

    const { refundMessage, refunded } = await cancelReservationCore(reservation);

    if (reservation.email) {
      sendCancellationEmailToClient(reservation).catch(err =>
        console.error('Erreur email annulation client:', err.message)
      );
    }

    const io = req.app.get('io');
    io.emit('cancel-reservation', reservation);

    res.json({
      success: true,
      refunded,
      message: `Votre reservation a bien ete annulee.${refundMessage}`
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Remboursement manuel des arrhes (override staff)
router.post('/:id/deposit/refund', apiKey, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation non trouvee' });
    }

    if (!reservation.deposit || reservation.deposit.status !== 'paid') {
      return res.status(400).json({ success: false, message: 'Aucune arrhe remboursable pour cette reservation' });
    }

    await refundDeposit(reservation);
    reservation.deposit.status = 'refunded';
    reservation.deposit.refundedAt = new Date();
    await reservation.save();

    const io = req.app.get('io');
    io.emit('update-reservation', reservation);

    res.json({ success: true, message: 'Arrhes remboursees', data: reservation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Marque les arrhes comme deduites de l'addition (comptabilite, aucun mouvement d'argent)
router.post('/:id/deposit/deducted', apiKey, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation non trouvee' });
    }

    if (!reservation.deposit || reservation.deposit.status !== 'paid') {
      return res.status(400).json({ success: false, message: 'Les arrhes doivent etre payees pour etre deduites' });
    }

    reservation.deposit.status = 'deducted';
    reservation.deposit.deductedAt = new Date();
    await reservation.save();

    const io = req.app.get('io');
    io.emit('update-reservation', reservation);

    res.json({ success: true, message: 'Arrhes marquees comme deduites de l\'addition', data: reservation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});


module.exports = router;
