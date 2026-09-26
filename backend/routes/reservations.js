const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const router = express.Router();

const cancelLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Trop de requetes, reessayez dans une heure' }
});
const Reservation = require('../models/Reservation');
const { reservationInput } = require('../services/reservationInputService');
const { withBookingTransaction } = require('../services/bookingTransactionService');
const { sendNotifications, sendConfirmationEmailToClient, sendCancellationEmailToClient, sendDepositRequestEmailToClient } = require('../services/notificationService');
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
  isDepositSystemActive,
  getPaymentReadiness,
  computeDepositCents,
  getDepositConfig,
  createCheckoutSession,
  expireCheckoutSession
} = require('../services/paymentService');
const { refundReservationSafely } = require('../services/depositRefundService');
const { toPublicReservationData } = require('../services/publicReservationService');

const RESTAURANT_TIME_ZONE = process.env.RESTAURANT_TIME_ZONE || 'Indian/Reunion';

function getBookingRequestKey(req) {
  const key = String(req.get('Idempotency-Key') || '').trim();
  if (!key) return null;
  if (key.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error('Cle de soumission invalide');
  }
  return key;
}

function bookingFingerprint(body) {
  const stablePayload = {
    customerName: String(body.customerName || '').trim(),
    phoneNumber: String(body.phoneNumber || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    numberOfPeople: Number(body.numberOfPeople),
    date: String(body.date || ''),
    time: String(body.time || ''),
    specialRequests: String(body.specialRequests || '').trim()
  };
  return crypto.createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex');
}

function activeBookingKey(phoneNumber, normalizedDate) {
  const normalizedPhone = String(phoneNumber || '').replace(/\D/g, '');
  return crypto.createHash('sha256').update(`${normalizedPhone}:${normalizedDate}`).digest('hex');
}

function sendExistingPublicReservation(res, reservation) {
  if (reservation.status === 'awaiting-payment' && reservation.deposit && reservation.deposit.status === 'awaiting') {
    if (!reservation.deposit.stripeCheckoutUrl) {
      return res.status(409).json({
        success: false,
        retryable: true,
        message: 'La page de paiement est en cours de creation. Merci de reessayer dans quelques secondes.'
      });
    }
    return res.status(200).json({
      success: true,
      duplicate: true,
      requiresPayment: true,
      checkoutUrl: reservation.deposit.stripeCheckoutUrl,
      message: 'Paiement deja initialise pour cette reservation',
      data: toPublicReservationData(reservation)
    });
  }

  return res.status(200).json({
    success: true,
    duplicate: true,
    message: 'Cette reservation a deja ete prise en compte',
    data: toPublicReservationData(reservation)
  });
}

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
  const parsed = Number(numberOfPeople);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Nombre de couverts invalide');
  }

  return parsed;
}

function depositStateFilter(reservation) {
  const status = reservation.deposit?.status || 'none';
  return status === 'none' ? { $in: [null, 'none'] } : status;
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
  if (timeInMinutes % 15 !== 0) throw new Error('Merci de choisir un creneau propose (toutes les 15 minutes).');
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
  const { notify = true, limit = CAPACITY } = options;
  const reservation = await withBookingTransaction([req.body.date], async session => {
    const availability = await checkAvailability(req.body.date, req.body.time, req.body.numberOfPeople, limit, null, session);
    if (!availability.available) throw new Error('Ce creneau vient de se remplir. Merci de choisir un autre horaire.');
    const created = new Reservation(req.body);
    await created.save({ session });
    return created;
  });

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
    req.body = reservationInput(req.body, true);
    req.body.source = req.body.source || 'desktop';
    if (req.body.status === 'cancelled') throw new Error('Une nouvelle reservation doit etre active.');
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
    req.body = reservationInput(req.body);
    // Sécurité : ces champs ne doivent jamais venir du client (anti-spoofing
    // d'un statut « payé » ou d'arrhes pour contourner le paiement).
    delete req.body.status;
    delete req.body.deposit;
    delete req.body.bookingRequestKey;
    delete req.body.bookingRequestFingerprint;
    delete req.body.activeBookingKey;
    req.body.source = 'website';

    const { date, time } = req.body;
    const validation = validatePublicReservationPayload(req.body);
    const paymentReadiness = getPaymentReadiness();
    if (paymentReadiness.enabled && paymentReadiness.activationConfirmed
      && !paymentReadiness.readyToActivate && validation.requestedPeople >= getDepositConfig().minParty) {
      return res.status(503).json({ success: false, message: 'Le paiement des arrhes est temporairement indisponible. Merci d appeler le restaurant.' });
    }
    const bookingRequestKey = getBookingRequestKey(req);
    const requestFingerprint = bookingFingerprint(req.body);
    req.body.activeBookingKey = activeBookingKey(req.body.phoneNumber, validation.normalizedDate);

    if (bookingRequestKey) {
      const replay = await Reservation.findOne({ bookingRequestKey });
      if (replay) {
        if (replay.bookingRequestFingerprint !== requestFingerprint) {
          return res.status(409).json({ success: false, message: 'Cette cle de soumission a deja ete utilisee avec une autre reservation' });
        }
        return sendExistingPublicReservation(res, replay);
      }
      req.body.bookingRequestKey = bookingRequestKey;
      req.body.bookingRequestFingerprint = requestFingerprint;
    }

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
      status: { $ne: 'cancelled' }
    });

    if (existingBooking) {
      if (existingBooking.bookingRequestFingerprint === requestFingerprint) {
        return sendExistingPublicReservation(res, existingBooking);
      }
      return res.status(409).json({
        success: false,
        message: 'Une reservation existe deja pour ce numero a cette date. Pour la modifier, contactez le restaurant.'
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
        checkoutAttempt: 1,
        expiresAt
      };

      const reservation = await createReservation(req, res, { notify: false, limit: ONLINE_CAPACITY_LIMIT });

      try {
        const session = await createCheckoutSession(reservation);
        const storedReservation = await Reservation.findOneAndUpdate(
          {
            _id: reservation._id,
            status: 'awaiting-payment',
            'deposit.status': 'awaiting',
            'deposit.checkoutAttempt': 1
          },
          {
            $set: {
              'deposit.stripeSessionId': session.sessionId,
              'deposit.stripeCheckoutUrl': session.url,
              'deposit.expiresAt': session.expiresAt
            }
          },
          { new: true, runValidators: true }
        );
        if (!storedReservation) throw new Error('Reservation modifiee pendant la creation du paiement');

        return res.status(201).json({
          success: true,
          requiresPayment: true,
          checkoutUrl: session.url,
          message: 'Acompte requis pour confirmer la reservation',
          data: toPublicReservationData(storedReservation)
        });
      } catch (paymentError) {
        console.error('Erreur creation session de paiement:', paymentError);
        await Reservation.findOneAndUpdate(
          {
            _id: reservation._id,
            status: 'awaiting-payment',
            'deposit.status': 'awaiting',
            'deposit.checkoutAttempt': 1
          },
          { $set: { status: 'cancelled', activeBookingKey: null, 'deposit.status': 'failed' } },
          { runValidators: true }
        );
        return res.status(502).json({
          success: false,
          message: 'Le service de paiement est momentanement indisponible. Merci de reessayer ou d\'appeler le restaurant.'
        });
      }
    }

    const reservation = await createReservation(req, res, { limit: ONLINE_CAPACITY_LIMIT });

    res.status(201).json({
      success: true,
      message: 'Reservation creee avec succes',
      data: toPublicReservationData(reservation)
    });
  } catch (error) {
    if (error && error.code === 11000 && req.body.bookingRequestKey) {
      const replay = await Reservation.findOne({
        $or: [
          { bookingRequestKey: req.body.bookingRequestKey },
          { activeBookingKey: req.body.activeBookingKey }
        ]
      });
      if (replay && replay.bookingRequestFingerprint === req.body.bookingRequestFingerprint) {
        return sendExistingPublicReservation(res, replay);
      }
      if (replay) {
        return res.status(409).json({
          success: false,
          message: 'Une reservation existe deja pour ce numero a cette date. Pour la modifier, contactez le restaurant.'
        });
      }
    }
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
    // Unpaid online attempts stay stored for capacity and webhook handling,
    // but are not restaurant requests until payment has been received.
    const query = { $nor: [
      { status: 'awaiting-payment' },
      { source: { $in: ['website', 'mobile'] }, 'deposit.required': true,
        'deposit.paidAt': null, 'deposit.status': { $in: ['awaiting', 'failed'] } }
    ] };

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
    req.body = reservationInput(req.body, true);
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

    // Toutes les annulations, y compris celles des interfaces admin/desktop,
    // passent par le même flux atomique de remboursement.
    if (req.body.status === 'cancelled') {
      const result = await cancelReservationCore(existing._id);
      if (result.changed && result.reservation.email) {
        sendCancellationEmailToClient(result.reservation).catch(err =>
          console.error('Erreur email annulation client:', err.message)
        );
      }

      const io = req.app.get('io');
      io.emit('cancel-reservation', result.reservation);
      return res.json({
        success: true,
        alreadyCancelled: !result.changed,
        refunded: result.refunded,
        message: `Reservation annulee.${result.refundMessage}`,
        data: result.reservation
      });
    }

    if ((existing.status === 'awaiting-payment' && req.body.status && req.body.status !== 'awaiting-payment')
      || (req.body.status === 'confirmed' && existing.deposit && existing.deposit.required
        && !['paid', 'deducted'].includes(existing.deposit.status))) {
      return res.status(400).json({
        success: false,
        message: 'Les arrhes doivent etre payees avant la confirmation par le restaurant.'
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
    const phoneChanged = typeof req.body.phoneNumber === 'string' && req.body.phoneNumber !== existing.phoneNumber;
    const reactivating = existing.status === 'cancelled';
    if (reactivating && existing.deposit && existing.deposit.required
      && !['paid', 'deducted'].includes(existing.deposit.status)) {
      throw new Error('Les arrhes de cette reservation doivent etre verifiees avant sa reactivation.');
    }
    if ((dateChanged || timeChanged || peopleChanged) && existing.deposit && existing.deposit.status === 'awaiting') {
      throw new Error('Annulez le lien de paiement en cours avant de modifier la date, l heure ou les couverts.');
    }
    const checkDate = date || existingDate;
    const checkTime = time || existing.time;
    const checkPeople = typeof numberOfPeople !== 'undefined' ? getPartySize(numberOfPeople) : existing.numberOfPeople;
    const updateFilter = { _id: req.params.id, status: existing.status };
    if (req.body.status === 'confirmed' && existing.deposit && existing.deposit.required) {
      updateFilter['deposit.status'] = { $in: ['paid', 'deducted'] };
    }
    const fields = { ...req.body, updatedAt: new Date() };
    const affectsCapacity = dateChanged || timeChanged || peopleChanged || phoneChanged || reactivating;
    let reservation;
    if (affectsCapacity) {
      reservation = await withBookingTransaction([existingDate, checkDate], async session => {
        const availability = await checkAvailability(checkDate, checkTime, checkPeople, CAPACITY, req.params.id, session);
        if (!availability.available) throw new Error('Creneau complet : la modification depasserait la capacite.');
        // Reject a stale edit even if a competing edit kept the same status.
        const filter = { ...updateFilter, date: existing.date, time: existing.time,
          numberOfPeople: existing.numberOfPeople, 'deposit.status': depositStateFilter(existing) };
        if (['website', 'mobile'].includes(existing.source)) {
          fields.activeBookingKey = activeBookingKey(fields.phoneNumber || existing.phoneNumber, checkDate);
        }
        return Reservation.findOneAndUpdate(filter, { $set: fields }, { new: true, runValidators: true, session });
      });
    } else {
      reservation = await Reservation.findOneAndUpdate(updateFilter, { $set: fields }, { new: true, runValidators: true });
    }
    if (!reservation) {
      return res.status(409).json({
        success: false,
        message: 'La reservation a change entre-temps. Rechargez avant de la modifier.'
      });
    }

    const statusChangedToConfirmed = req.body.status === 'confirmed' && existing.status !== 'confirmed';
    const restoredFromCancelled = existing.status === 'cancelled' && (req.body.status === 'pending' || req.body.status === 'confirmed');

    if ((statusChangedToConfirmed || (restoredFromCancelled && req.body.status === 'confirmed')) && reservation.email) {
      sendConfirmationEmailToClient(reservation).catch(err =>
        console.error('Erreur email confirmation client:', err.message)
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
async function cancelReservationCore(reservationId) {
  let refundMessage = '';
  let refunded = false;
  let reservation;
  let changed = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await Reservation.findById(reservationId);
    if (!before) throw new Error('Reservation non trouvee');
    if (before.status === 'completed') throw new Error('Cette reservation ne peut plus etre annulee');
    if (before.status === 'cancelled') { reservation = before; break; }
    const depositStatus = before.deposit && before.deposit.status || 'none';
    const fields = { status: 'cancelled', activeBookingKey: null };
    if (depositStatus === 'paid' && hoursUntilReservation(before) >= getDepositConfig().cancellationHours) {
      fields['deposit.status'] = 'refund_pending';
      fields['deposit.refundRequestedAt'] = new Date();
    }
    reservation = await Reservation.findOneAndUpdate(
      { _id: reservationId, status: before.status,
        'deposit.status': depositStatus === 'none' ? { $in: [null, 'none'] } : depositStatus },
      { $set: fields },
      { new: true, runValidators: true }
    );
    if (reservation) { changed = true; break; }
  }
  if (!reservation) throw new Error('Reservation modifiee simultanement : merci de reessayer');

  if (reservation.deposit && reservation.deposit.status === 'awaiting') {
    try {
      await expireCheckoutSession(reservation);
      reservation = await Reservation.findOneAndUpdate(
        {
          _id: reservationId,
          'deposit.status': 'awaiting',
          'deposit.checkoutAttempt': reservation.deposit.checkoutAttempt
        },
        { $set: { 'deposit.status': 'failed' } },
        { new: true, runValidators: true }
      ) || reservation;
    } catch (expireError) {
      // Si le paiement vient juste d'être confirmé, le webhook le constatera
      // et le remboursera automatiquement puisque la réservation est annulée.
      console.error('Impossible d\'expirer la session Stripe:', expireError.message);
    }
  }

  if (reservation.deposit && ['paid', 'refund_pending'].includes(reservation.deposit.status)) {
    const config = getDepositConfig();
    if (reservation.deposit.status === 'refund_pending' || hoursUntilReservation(reservation) >= config.cancellationHours) {
      try {
        const refundResult = await refundReservationSafely(reservationId);
        reservation = refundResult.reservation;
        refunded = refundResult.refunded;
        refundMessage = refunded
          ? ' Arrhes remboursees.'
          : refundResult.needsAttention
            ? ' Le remboursement necessite une verification par le restaurant.'
            : ' Remboursement des arrhes en cours de traitement.';
      } catch (refundError) {
        console.error('Erreur remboursement arrhes:', refundError);
        reservation = await Reservation.findById(reservationId);
        refundMessage = ' Remboursement des arrhes en cours de verification; ne pas le relancer manuellement dans Stripe.';
      }
    } else {
      refundMessage = ' Arrhes conservees (annulation tardive).';
    }
  }

  if (reservation.deposit && ['refund_failed', 'refund_review'].includes(reservation.deposit.status)) {
    refundMessage = ' Le remboursement necessite une verification par le restaurant.';
  }
  return { refundMessage, refunded, changed, reservation };
}

router.delete('/:id', apiKey, async (req, res) => {
  try {
    const result = await cancelReservationCore(req.params.id);
    const { reservation, refundMessage } = result;

    if (result.changed && reservation.email) {
      sendCancellationEmailToClient(reservation).catch(err =>
        console.error('Erreur email annulation client:', err.message)
      );
    }

    const io = req.app.get('io');
    io.emit('cancel-reservation', reservation);

    res.json({
      success: true,
      alreadyCancelled: !result.changed,
      refunded: result.refunded,
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
router.get('/:id/public', cancelLimiter, async (req, res) => {
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
router.post('/:id/cancel', cancelLimiter, async (req, res) => {
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

    const result = await cancelReservationCore(reservation._id);
    const { refundMessage, refunded } = result;

    if (result.changed && result.reservation.email) {
      sendCancellationEmailToClient(result.reservation).catch(err =>
        console.error('Erreur email annulation client:', err.message)
      );
    }

    const io = req.app.get('io');
    io.emit('cancel-reservation', result.reservation);

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
    const result = await refundReservationSafely(req.params.id);
    const reservation = result.reservation;

    const io = req.app.get('io');
    io.emit('update-reservation', reservation);

    res.status(result.needsAttention ? 409 : 200).json({
      success: !result.needsAttention,
      needsAttention: result.needsAttention,
      alreadyRefunded: result.alreadyRefunded,
      pending: result.pending,
      message: result.needsAttention ? 'Remboursement a verifier dans Stripe : aucune nouvelle tentative automatique'
        : result.refunded ? 'Arrhes remboursees' : 'Remboursement en cours de traitement',
      data: reservation
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Envoie un lien de paiement des arrhes au client (pour les groupes pris par téléphone/desktop)
router.post('/:id/deposit/request', apiKey, async (req, res) => {
  let claimedReservation = null;
  try {
    if (!isDepositSystemActive()) {
      return res.status(503).json({ success: false, message: 'Les nouvelles demandes d arrhes sont desactivees.' });
    }
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation non trouvee' });
    }

    if (!['pending', 'confirmed'].includes(reservation.status)) {
      return res.status(400).json({ success: false, message: 'Impossible de demander des arrhes pour une reservation annulee ou terminee' });
    }

    if (reservation.deposit && !['none', 'failed'].includes(reservation.deposit.status)) {
      const message = reservation.deposit.status === 'awaiting'
        ? 'Un lien de paiement est deja actif pour cette reservation'
        : 'Les arrhes ont deja ete payees ou sont en cours de remboursement';
      return res.status(409).json({ success: false, message });
    }

    if (!reservation.email) {
      return res.status(400).json({ success: false, message: 'Aucune adresse email pour cette reservation — envoyez le lien manuellement' });
    }

    const config = getDepositConfig();
    const amountCents = computeDepositCents(reservation.numberOfPeople);
    const expiresAt = new Date(Date.now() + config.expiryMinutes * 60 * 1000);

    claimedReservation = await Reservation.findOneAndUpdate(
      {
        _id: reservation._id,
        status: { $in: ['pending', 'confirmed'] },
        $or: [
          { 'deposit.status': { $in: ['none', 'failed'] } },
          { 'deposit.status': { $exists: false } }
        ]
      },
      {
        $set: {
          'deposit.required': true,
          'deposit.amountCents': amountCents,
          'deposit.perPersonCents': config.perPersonCents,
          'deposit.currency': config.currency,
          'deposit.status': 'awaiting',
          'deposit.stripeSessionId': null,
          'deposit.stripeCheckoutUrl': null,
          'deposit.checkoutParameters': null,
          'deposit.expiresAt': expiresAt
        },
        $inc: { 'deposit.checkoutAttempt': 1 }
      },
      { new: true, runValidators: true }
    );
    if (!claimedReservation) {
      return res.status(409).json({ success: false, message: 'Une demande de paiement est deja en cours' });
    }

    const session = await createCheckoutSession(claimedReservation);
    const storedReservation = await Reservation.findOneAndUpdate(
      {
        _id: claimedReservation._id,
        'deposit.status': 'awaiting',
        'deposit.checkoutAttempt': claimedReservation.deposit.checkoutAttempt,
        'deposit.stripeSessionId': null
      },
      {
        $set: {
          'deposit.stripeSessionId': session.sessionId,
          'deposit.stripeCheckoutUrl': session.url,
          'deposit.expiresAt': session.expiresAt
        }
      },
      { new: true, runValidators: true }
    );
    if (!storedReservation) throw new Error('Demande de paiement modifiee pendant la creation Checkout');

    await sendDepositRequestEmailToClient(storedReservation, session.url);

    const io = req.app.get('io');
    io.emit('update-reservation', storedReservation);

    res.json({ success: true, message: 'Lien de paiement envoye au client', data: storedReservation });
  } catch (error) {
    if (claimedReservation) {
      await Reservation.findOneAndUpdate(
        {
          _id: claimedReservation._id,
          'deposit.status': 'awaiting',
          'deposit.checkoutAttempt': claimedReservation.deposit.checkoutAttempt,
          'deposit.stripeSessionId': null
        },
        { $set: { 'deposit.status': 'failed' } },
        { runValidators: true }
      ).catch(updateError => console.error('Erreur rollback demande arrhes:', updateError.message));
    }
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

    const updated = await Reservation.findOneAndUpdate(
      { _id: reservation._id, status: { $in: ['pending', 'confirmed', 'completed'] }, 'deposit.status': 'paid' },
      { $set: { 'deposit.status': 'deducted', 'deposit.deductedAt': new Date() } },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(409).json({ success: false, message: 'Reservation ou paiement modifie entre-temps.' });

    const io = req.app.get('io');
    io.emit('update-reservation', updated);

    res.json({ success: true, message: 'Arrhes marquees comme deduites de l\'addition', data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Marque le client comme arrivé (résa terminée) : les arrhes payées sont déduites de l'addition
router.post('/:id/complete', apiKey, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation non trouvee' });
    }

    if (!['pending', 'confirmed'].includes(reservation.status)) {
      return res.status(400).json({ success: false, message: 'Seule une reservation active peut etre marquee comme terminee' });
    }

    if (reservation.deposit?.required && !['paid', 'deducted'].includes(reservation.deposit.status)) {
      return res.status(400).json({ success: false, message: 'Les arrhes doivent etre payees avant de terminer la reservation.' });
    }
    const fields = { status: 'completed' };
    if (reservation.deposit && reservation.deposit.status === 'paid') {
      fields['deposit.status'] = 'deducted';
      fields['deposit.deductedAt'] = new Date();
    }
    const updated = await Reservation.findOneAndUpdate(
      { _id: reservation._id, status: reservation.status,
        'deposit.status': depositStateFilter(reservation) },
      { $set: fields }, { new: true, runValidators: true }
    );
    if (!updated) return res.status(409).json({ success: false, message: 'Reservation ou paiement modifie entre-temps.' });

    const io = req.app.get('io');
    io.emit('update-reservation', updated);

    res.json({ success: true, message: 'Client marque comme arrive', data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Marque la réservation comme no-show : les arrhes payées restent acquises au restaurant
router.post('/:id/no-show', apiKey, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id);

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation non trouvee' });
    }

    if (!['pending', 'confirmed'].includes(reservation.status)) {
      return res.status(400).json({ success: false, message: 'Seule une reservation active peut etre marquee en no-show' });
    }

    const updated = await Reservation.findOneAndUpdate(
      { _id: reservation._id, status: reservation.status },
      { $set: { status: 'no-show' } }, { new: true, runValidators: true }
    );
    if (!updated) return res.status(409).json({ success: false, message: 'Reservation modifiee entre-temps.' });

    const io = req.app.get('io');
    io.emit('update-reservation', updated);

    const kept = updated.deposit && updated.deposit.status === 'paid';
    res.json({
      success: true,
      message: `Reservation marquee en no-show.${kept ? ' Arrhes conservees.' : ''}`,
      data: updated
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});


module.exports = router;
