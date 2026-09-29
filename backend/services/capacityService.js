/**
 * Service de capacite par creneaux.
 *
 * Calcule la disponibilite reelle en tenant compte de la duree des repas.
 * Une reservation a 19h00 avec une duree de 2h occupe des places jusqu'a 21h00.
 * A chaque creneau de 15 min, on compte les personnes encore assises.
 */

const Reservation = require('../models/Reservation');

const RESTAURANT_TIME_ZONE = process.env.RESTAURANT_TIME_ZONE || 'Indian/Reunion';
const CAPACITY = parseInt(process.env.RESTAURANT_CAPACITY, 10) || 70;
const MIDI_DURATION = parseInt(process.env.MIDI_DURATION_MIN, 10) || 90;
const SOIR_DURATION = parseInt(process.env.SOIR_DURATION_MIN, 10) || 120;
const SLOT_MAX_COVERS = parseInt(process.env.SLOT_MAX_COVERS, 10) || 15;
const SLOT_TOLERANCE = parseInt(process.env.SLOT_TOLERANCE, 10) || 2;
const SLOT_HARD_LIMIT = SLOT_MAX_COVERS + SLOT_TOLERANCE;
const ARRIVAL_WINDOW_MINUTES = 30;
const ARRIVAL_WINDOW_MAX_COVERS = 20;

function parseDateInput(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Date invalide. Format attendu : YYYY-MM-DD');
  }

  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('Date invalide. Jour inexistant.');
  }
  return { year, month, day };
}

function buildUtcDate(date, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const { year, month, day } = parseDateInput(date);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
}

function formatRestaurantDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: RESTAURANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const values = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return values;
}

function getRestaurantNow() {
  const parts = formatRestaurantDateParts();
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (parseInt(parts.hour, 10) * 60) + parseInt(parts.minute, 10)
  };
}

function getRestaurantDay(date) {
  return buildUtcDate(date).getUTCDay();
}

function isOnlineBookingClosedDate(date) {
  const day = getRestaurantDay(date);
  return day === 1 || day === 2;
}

function isOnlineBookingClosedTime(date, timeStr) {
  const day = getRestaurantDay(date);

  if (day === 1 || day === 2) {
    return true;
  }

  if (day === 0) {
    return timeToMinutes(timeStr) >= (15 * 60);
  }

  return false;
}

function timeToMinutes(timeStr) {
  if (typeof timeStr !== 'string' || !/^\d{2}:\d{2}$/.test(timeStr)) {
    throw new Error('Heure invalide. Format attendu : HH:MM');
  }

  const [hours, minutes] = timeStr.split(':').map(Number);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error('Heure invalide. Format attendu : HH:MM');
  }

  return (hours * 60) + minutes;
}

function isMidiTime(minutes) {
  return minutes < (15 * 60);
}

function getMealDuration(timeMinutes) {
  return isMidiTime(timeMinutes) ? MIDI_DURATION : SOIR_DURATION;
}

async function getOccupancyMap(date, excludeId, session) {
  const startOfDay = buildUtcDate(date, 0, 0, 0, 0);
  const endOfDay = buildUtcDate(date, 23, 59, 59, 999);

  const query = {
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $ne: 'cancelled' }
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const request = Reservation.find(query);
  const reservations = await (session ? request.session(session) : request);
  const occupancy = {};
  const arrivals = {};
  const arrivalMinutes = {};

  for (const reservation of reservations) {
    const startMin = timeToMinutes(reservation.time);
    const duration = getMealDuration(startMin);
    const endMin = startMin + duration;

    arrivalMinutes[startMin] = (arrivalMinutes[startMin] || 0) + reservation.numberOfPeople;
    const arrivalSlot = Math.floor(startMin / 15) * 15;
    arrivals[arrivalSlot] = (arrivals[arrivalSlot] || 0) + reservation.numberOfPeople;

    for (let slot = startMin; slot < endMin; slot += 1) {
      occupancy[slot] = (occupancy[slot] || 0) + reservation.numberOfPeople;
    }
  }

  return { occupancy, arrivals, arrivalMinutes, reservations };
}

// Check every half-open window containing the new arrival, including off-grid
// phone bookings and arrivals after the requested time (not just the past 30 min).
function getArrivalWindowLoad(startMin, requestedPeople, arrivalMinutes) {
  let peakCovers = requestedPeople;
  let peakStart = startMin;
  for (let start = startMin - ARRIVAL_WINDOW_MINUTES + 1; start <= startMin; start++) {
    let covers = requestedPeople;
    for (let minute = start; minute < start + ARRIVAL_WINDOW_MINUTES; minute++) {
      covers += arrivalMinutes[minute] || 0;
    }
    if (covers > peakCovers) { peakCovers = covers; peakStart = start; }
  }
  return { peakCovers, peakStart };
}

async function checkAvailability(date, time, numberOfPeople, limit, excludeId, session) {
  const requestedPeople = Number(numberOfPeople);

  if (!Number.isInteger(requestedPeople) || requestedPeople <= 0) {
    throw new Error('Nombre de couverts invalide');
  }

  const effectiveLimit = Math.min(limit || CAPACITY, CAPACITY);
  const startMin = timeToMinutes(time);
  const bounds = getServiceBounds(date);
  if (isOnlineBookingClosedTime(date, time)) {
    return { available: false, reason: 'closed',
      message: 'Restaurant ferme le dimanche soir, le lundi et le mardi. Choisissez un autre creneau.' };
  }
  if (startMin > getServiceBounds(date).soirEnd) {
    return { available: false, reason: 'after-last-arrival',
      message: 'Derniere arrivee a 21h30 pour tous les services du soir, samedi compris.' };
  }
  if (!((startMin >= bounds.midiStart && startMin <= bounds.midiEnd)
    || (startMin >= bounds.soirStart && startMin <= bounds.soirEnd))) {
    return { available: false, reason: 'outside-service', message: 'Cet horaire est en dehors des services du restaurant.' };
  }
  const { occupancy, arrivals, arrivalMinutes } = await getOccupancyMap(date, excludeId, session);

  const arrivalLoad = getArrivalWindowLoad(startMin, requestedPeople, arrivalMinutes);
  if (arrivalLoad.peakCovers > ARRIVAL_WINDOW_MAX_COVERS) {
    return { available: false, reason: 'arrival-window-full',
      message: `Trop d arrivees rapprochees : maximum ${ARRIVAL_WINDOW_MAX_COVERS} couverts sur ${ARRIVAL_WINDOW_MINUTES} minutes. Choisissez un autre horaire.`,
      peakOccupancy: arrivalLoad.peakCovers, capacity: ARRIVAL_WINDOW_MAX_COVERS,
      arrivalWindowMinutes: ARRIVAL_WINDOW_MINUTES };
  }

  // Vérification 1 : limite d'arrivées par créneau — uniquement pour les réservations en ligne
  if (effectiveLimit < CAPACITY) {
    const slotArrivals = (arrivals[Math.floor(startMin / 15) * 15] || 0) + requestedPeople;
    if (slotArrivals > SLOT_HARD_LIMIT) {
      const h = String(Math.floor(startMin / 60)).padStart(2, '0');
      const m = String(startMin % 60).padStart(2, '0');
      return {
        available: false,
        peakOccupancy: slotArrivals,
        peakSlot: `${h}:${m}`,
        capacity: SLOT_HARD_LIMIT
      };
    }
  }

  // Vérification 2 : capacité salle globale sur la durée du repas
  const duration = getMealDuration(startMin);
  const endMin = startMin + duration;
  let peakOccupancy = 0;
  let peakSlot = startMin;

  for (let slot = startMin; slot < endMin; slot += 1) {
    const current = (occupancy[slot] || 0) + requestedPeople;
    if (current > peakOccupancy) {
      peakOccupancy = current;
      peakSlot = slot;
    }
  }

  const peakHour = String(Math.floor(peakSlot / 60)).padStart(2, '0');
  const peakMinute = String(peakSlot % 60).padStart(2, '0');

  return {
    available: peakOccupancy <= effectiveLimit,
    peakOccupancy,
    peakSlot: `${peakHour}:${peakMinute}`,
    capacity: effectiveLimit
  };
}

function getServiceBounds(date) {
  const day = getRestaurantDay(date);
  const isWeekend = day === 0 || day === 6;
  const isMidiExtended = day === 5 || day === 6 || day === 0; // ven, sam, dim
  const isSoirWeekend = day === 6; // sam uniquement (dim = pas de soir)

  return {
    isWeekend,
    isMidiExtended,
    isSoirWeekend,
    midiStart: 720,                              // 12:00
    midiEnd: isMidiExtended ? 840 : 825,         // 14:00 ou 13:45
    soirStart: 1080,                             // 18:00
    soirEnd: 1290,                             // 21:30, samedi compris
    midiWaveCutoff: isMidiExtended ? 780 : 765,  // 13:00 ou 12:45
    soirWaveCutoff: isSoirWeekend ? 1200 : 1185  // 20:00 ou 19:45
  };
}

async function getAvailableSlots(date, numberOfPeople, limit, excludeId) {
  const requestedPeople = parseInt(numberOfPeople, 10) || 2;
  const effectiveLimit = Math.min(limit || CAPACITY, CAPACITY);
  const { occupancy, arrivals, arrivalMinutes } = await getOccupancyMap(date, excludeId);
  const bounds = getServiceBounds(date);
  const restaurantNow = getRestaurantNow();
  const isToday = date === restaurantNow.date;
  const currentMinutes = isToday ? restaurantNow.minutes : 0;

  function formatTime(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function checkSlot(startMin, duration) {
    if (date < restaurantNow.date || isOnlineBookingClosedTime(date, formatTime(startMin))
      || (isToday && startMin < currentMinutes)) {
      return false;
    }

    if ((arrivals[startMin] || 0) + requestedPeople > SLOT_HARD_LIMIT) {
      return false;
    }

    if (getArrivalWindowLoad(startMin, requestedPeople, arrivalMinutes).peakCovers > ARRIVAL_WINDOW_MAX_COVERS) {
      return false;
    }

    for (let slot = startMin; slot < startMin + duration; slot += 1) {
      if ((occupancy[slot] || 0) + requestedPeople > effectiveLimit) {
        return false;
      }
    }

    return true;
  }

  const midiSlots = [];
  for (let slot = bounds.midiStart; slot <= bounds.midiEnd; slot += 15) {
    midiSlots.push({
      time: formatTime(slot),
      available: checkSlot(slot, MIDI_DURATION)
    });
  }

  const soirSlots = [];
  if (getRestaurantDay(date) !== 0) {
    for (let slot = bounds.soirStart; slot <= bounds.soirEnd; slot += 15) {
      soirSlots.push({
        time: formatTime(slot),
        available: checkSlot(slot, SOIR_DURATION)
      });
    }
  }

  return {
    midi: midiSlots,
    soir: soirSlots,
    capacity: effectiveLimit,
    isWeekend: bounds.isWeekend
  };
}

module.exports = {
  checkAvailability,
  getAvailableSlots,
  getOccupancyMap,
  getServiceBounds,
  isOnlineBookingClosedDate,
  isOnlineBookingClosedTime,
  parseDateInput,
  timeToMinutes,
  getRestaurantNow,
  CAPACITY,
  SLOT_MAX_COVERS,
  SLOT_HARD_LIMIT,
  ARRIVAL_WINDOW_MINUTES,
  ARRIVAL_WINDOW_MAX_COVERS,
  getArrivalWindowLoad
};
