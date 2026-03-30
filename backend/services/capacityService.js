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
 */
async function getOccupancyMap(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const reservations = await Reservation.find({
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $ne: 'cancelled' }
  });

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
 * @returns {{ available: boolean, peakOccupancy: number, peakSlot: string, capacity: number }}
 */
async function checkAvailability(date, time, numberOfPeople, limit) {
  const effectiveLimit = Math.min(limit, CAPACITY);
  const { occupancy } = await getOccupancyMap(date);

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
 * Retourne les créneaux disponibles pour une date et un nombre de personnes.
 * Utile pour le calendrier de disponibilité côté client.
 */
async function getAvailableSlots(date, numberOfPeople, limit) {
  const effectiveLimit = Math.min(limit || CAPACITY, CAPACITY);
  const { occupancy } = await getOccupancyMap(date);

  // Créneaux midi : 12:00 - 13:15 (toutes les 15min)
  const midiSlots = [];
  for (let m = 720; m <= 795; m += 15) {
    const duration = MIDI_DURATION;
    let canFit = true;
    for (let slot = m; slot < m + duration; slot += 15) {
      if ((occupancy[slot] || 0) + numberOfPeople > effectiveLimit) {
        canFit = false;
        break;
      }
    }
    const h = String(Math.floor(m / 60)).padStart(2, '0');
    const min = String(m % 60).padStart(2, '0');
    midiSlots.push({ time: `${h}:${min}`, available: canFit });
  }

  // Créneaux soir : 18:30 - 21:00 (toutes les 15min)
  const soirSlots = [];
  for (let m = 1110; m <= 1260; m += 15) {
    const duration = SOIR_DURATION;
    let canFit = true;
    for (let slot = m; slot < m + duration; slot += 15) {
      if ((occupancy[slot] || 0) + numberOfPeople > effectiveLimit) {
        canFit = false;
        break;
      }
    }
    const h = String(Math.floor(m / 60)).padStart(2, '0');
    const min = String(m % 60).padStart(2, '0');
    soirSlots.push({ time: `${h}:${min}`, available: canFit });
  }

  return { midi: midiSlots, soir: soirSlots, capacity: effectiveLimit };
}

module.exports = { checkAvailability, getAvailableSlots, getOccupancyMap, CAPACITY };
