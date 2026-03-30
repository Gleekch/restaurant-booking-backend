/**
 * Service de capacité par créneaux
 *
 * Calcule la disponibilité réelle en tenant compte de la durée des repas.
 * Une réservation à 19h00 avec une durée de 2h occupe des places jusqu'à 21h00.
 * À chaque créneau de 15min, on compte les personnes encore assises.
 *
 * Config (via .env ou défauts) :
 *   RESTAURANT_CAPACITY = 70
 *   MIDI_DURATION_MIN = 90    (1h30)
 *   SOIR_DURATION_MIN = 120   (2h)
 */

const Reservation = require('../models/Reservation');

const CAPACITY = parseInt(process.env.RESTAURANT_CAPACITY) || 70;
const MIDI_DURATION = parseInt(process.env.MIDI_DURATION_MIN) || 90;
const SOIR_DURATION = parseInt(process.env.SOIR_DURATION_MIN) || 120;

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function isMidiTime(minutes) {
  return minutes < 15 * 60; // avant 15h
}

function getMealDuration(timeMinutes) {
  return isMidiTime(timeMinutes) ? MIDI_DURATION : SOIR_DURATION;
}

/**
 * Pour une date donnée, retourne le nombre de couverts occupés à chaque créneau de 15min
 * en tenant compte de la durée des repas.
 * @param {string} date
 * @param {string} [excludeId] - ID de réservation à exclure du calcul (pour PUT)
 */
async function getOccupancyMap(date, excludeId) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const query = {
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $ne: 'cancelled' }
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const reservations = await Reservation.find(query);

  // Map de créneau (en minutes depuis minuit) -> nombre de couverts occupés
  const occupancy = {};

  for (const r of reservations) {
    const startMin = timeToMinutes(r.time);
    const duration = getMealDuration(startMin);
    const endMin = startMin + duration;

    // Pour chaque créneau de 15min pendant le repas, ajouter les couverts
    for (let slot = startMin; slot < endMin; slot += 15) {
      occupancy[slot] = (occupancy[slot] || 0) + r.numberOfPeople;
    }
  }

  return { occupancy, reservations };
}

/**
 * Vérifie si une nouvelle réservation peut être acceptée.
 * Regarde chaque créneau de 15min pendant la durée du repas.
 * Si un seul créneau dépasse la capacité, on refuse.
 *
 * @param {string} date - Date ISO
 * @param {string} time - Heure HH:MM
 * @param {number} numberOfPeople - Nombre de couverts
 * @param {number} limit - Capacité max (50 web, 70 desktop)
 * @param {string} [excludeId] - ID de réservation à exclure (pour revalidation PUT)
 * @returns {{ available: boolean, peakOccupancy: number, peakSlot: string, capacity: number }}
 */
async function checkAvailability(date, time, numberOfPeople, limit, excludeId) {
  const effectiveLimit = Math.min(limit, CAPACITY);
  const { occupancy } = await getOccupancyMap(date, excludeId);

  const startMin = timeToMinutes(time);
  const duration = getMealDuration(startMin);
  const endMin = startMin + duration;

  let peakOccupancy = 0;
  let peakSlot = startMin;

  for (let slot = startMin; slot < endMin; slot += 15) {
    const current = (occupancy[slot] || 0) + numberOfPeople;
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

/**
 * Retourne les bornes horaires selon le jour (semaine vs weekend).
 */
function getServiceBounds(date) {
  const d = new Date(date);
  const day = d.getDay();
  const isWeekend = day === 0 || day === 6;
  return {
    isWeekend,
    midiStart: 720,             // 12:00
    midiEnd: isWeekend ? 825 : 795,  // 13:45 weekend, 13:15 semaine
    soirStart: 1110,            // 18:30
    soirEnd: isWeekend ? 1290 : 1260  // 21:30 weekend, 21:00 semaine
  };
}

/**
 * Retourne les créneaux disponibles pour une date et un nombre de personnes.
 * Tient compte des horaires weekend et des heures déjà passées.
 */
async function getAvailableSlots(date, numberOfPeople, limit) {
  const effectiveLimit = Math.min(limit || CAPACITY, CAPACITY);
  const { occupancy } = await getOccupancyMap(date);
  const bounds = getServiceBounds(date);

  // Déterminer l'heure courante si c'est aujourd'hui
  const now = new Date();
  const requestDate = new Date(date);
  requestDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = requestDate.getTime() === today.getTime();
  const currentMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : 0;

  function formatTime(m) {
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function checkSlot(startMin, duration) {
    // Créneau déjà passé
    if (isToday && startMin < currentMinutes) return false;
    for (let slot = startMin; slot < startMin + duration; slot += 15) {
      if ((occupancy[slot] || 0) + numberOfPeople > effectiveLimit) return false;
    }
    return true;
  }

  const midiSlots = [];
  for (let m = bounds.midiStart; m <= bounds.midiEnd; m += 15) {
    midiSlots.push({ time: formatTime(m), available: checkSlot(m, MIDI_DURATION) });
  }

  const soirSlots = [];
  for (let m = bounds.soirStart; m <= bounds.soirEnd; m += 15) {
    soirSlots.push({ time: formatTime(m), available: checkSlot(m, SOIR_DURATION) });
  }

  return { midi: midiSlots, soir: soirSlots, capacity: effectiveLimit, isWeekend: bounds.isWeekend };
}

module.exports = { checkAvailability, getAvailableSlots, getOccupancyMap, getServiceBounds, CAPACITY };
