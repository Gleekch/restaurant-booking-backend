/**
 * Couche de scoring et de recommandation de créneaux.
 *
 * Observe et classe les créneaux existants sans bloquer aucune réservation.
 * SLOT_RECOMMENDATIONS_ENABLED=false → les appelants retombent sur la logique legacy.
 */

const {
  getOccupancyMap,
  getServiceBounds,
  timeToMinutes,
  SLOT_MAX_COVERS
} = require('./capacityService');

const MIDI_DURATION = parseInt(process.env.MIDI_DURATION_MIN, 10) || 90;
const SOIR_DURATION = parseInt(process.env.SOIR_DURATION_MIN, 10) || 120;

// Heure cible préférée par service pour départager les ex-aequo de score
const MIDI_PREFERRED_MIN = 12 * 60 + 15; // 12:15
const SOIR_PREFERRED_MIN = 19 * 60 + 30; // 19:30

function getConfig() {
  return {
    recommendationsEnabled: process.env.SLOT_RECOMMENDATIONS_ENABLED === 'true',
    balancingStrict: process.env.SLOT_BALANCING_STRICT === 'true'
  };
}

function getWave(timeMin, bounds) {
  if (timeMin >= bounds.midiStart && timeMin <= bounds.midiEnd) {
    return timeMin < bounds.midiWaveCutoff ? 'midi-1' : 'midi-2';
  }
  if (timeMin >= bounds.soirStart && timeMin <= bounds.soirEnd) {
    return timeMin < bounds.soirWaveCutoff ? 'soir-1' : 'soir-2';
  }
  return null;
}

function computePeakLoad(startMin, duration, occupancy, requestedPeople) {
  let peak = 0;
  for (let slot = startMin; slot < startMin + duration; slot += 15) {
    const load = (occupancy[slot] || 0) + requestedPeople;
    if (load > peak) peak = load;
  }
  return peak;
}

function computeScore(peakLoad, capacity) {
  return Math.max(0, Math.round(100 * (1 - peakLoad / capacity)));
}

const STATUS_LABELS = {
  recommended: 'Recommandé',
  available: 'Disponible',
  'last-spots': 'Dernières places',
  full: 'Complet'
};

// Fenêtre dorée soir : 19h00–20h30 — aucune pénalité dans cette plage
const SOIR_WINDOW_START = 19 * 60;       // 19:00 = 1140
const SOIR_WINDOW_END   = 20 * 60 + 30; // 20:30 = 1230
const DISTANCE_PENALTY  = 6;            // points par tranche de 15 min hors fenêtre

function getDistanceFromWindow(timeMin, windowStart, windowEnd) {
  if (timeMin >= windowStart && timeMin <= windowEnd) return 0;
  if (timeMin < windowStart) return (windowStart - timeMin) / 15;
  return (timeMin - windowEnd) / 15;
}

function pickRecommendedIndex(slots, service) {
  let best = -1;

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s.available) continue;

    if (best === -1) { best = i; continue; }

    const b = slots[best];

    let sAdj, bAdj;
    if (service === 'soir') {
      sAdj = s.score - getDistanceFromWindow(s._timeMin, SOIR_WINDOW_START, SOIR_WINDOW_END) * DISTANCE_PENALTY;
      bAdj = b.score - getDistanceFromWindow(b._timeMin, SOIR_WINDOW_START, SOIR_WINDOW_END) * DISTANCE_PENALTY;
    } else {
      // Midi : préférence centrée sur 12h15
      sAdj = s.score - (Math.abs(s._timeMin - MIDI_PREFERRED_MIN) / 15) * DISTANCE_PENALTY;
      bAdj = b.score - (Math.abs(b._timeMin - MIDI_PREFERRED_MIN) / 15) * DISTANCE_PENALTY;
    }

    if (sAdj > bAdj) { best = i; }
  }

  return best;
}

function enrichSlots(baseSlots, service, bounds, occupancy, arrivals, requestedPeople, capacity) {
  const duration = service === 'midi' ? MIDI_DURATION : SOIR_DURATION;

  // First pass: compute scores
  const scored = baseSlots.map(slot => {
    const timeMin = timeToMinutes(slot.time);
    const peakLoad = computePeakLoad(timeMin, duration, occupancy, requestedPeople);
    const score = computeScore(peakLoad, capacity);
    const wave = getWave(timeMin, bounds);
    const slotArrivals = (arrivals[timeMin] || 0) + requestedPeople;
    return { ...slot, wave, score, _timeMin: timeMin, _peakLoad: peakLoad, _slotArrivals: slotArrivals };
  });

  const recommendedIdx = pickRecommendedIndex(scored, service);

  // Second pass: assign status
  const withStatus = scored.map((slot, idx) => {
    let status;
    if (!slot.available) {
      status = 'full';
    } else if (idx === recommendedIdx) {
      status = 'recommended';
    } else if (slot._slotArrivals >= SLOT_MAX_COVERS) {
      status = 'last-spots';
    } else {
      status = 'available';
    }
    return { ...slot, status, label: STATUS_LABELS[status] };
  });

  // Third pass: compute alternatives for crowded/full slots
  const goodSlots = withStatus.filter(s => s.available && s.status !== 'last-spots');

  return withStatus.map(slot => {
    const needsAlts = slot.status === 'last-spots' || slot.status === 'full';
    const alternatives = needsAlts
      ? goodSlots
          .filter(s => s.time !== slot.time)
          .sort((a, b) => Math.abs(a._timeMin - slot._timeMin) - Math.abs(b._timeMin - slot._timeMin))
          .slice(0, 2)
          .map(s => s.time)
      : [];

    const { _timeMin, _peakLoad, _slotArrivals, ...rest } = slot;
    return { ...rest, alternatives };
  });
}

/**
 * Enrichit les créneaux de baseData avec wave, score, status, label, alternatives.
 * baseData doit être le résultat de capacityService.getAvailableSlots().
 * En cas d'erreur interne, rejette la promesse — l'appelant doit gérer le fallback.
 */
async function getEnrichedAvailability(date, numberOfPeople, baseData) {
  const { occupancy, arrivals } = await getOccupancyMap(date);
  const bounds = getServiceBounds(date);
  const capacity = baseData.capacity;

  const enrichedMidi = enrichSlots(baseData.midi, 'midi', bounds, occupancy, arrivals, numberOfPeople, capacity);
  const enrichedSoir = enrichSlots(baseData.soir, 'soir', bounds, occupancy, arrivals, numberOfPeople, capacity);

  return {
    midi: enrichedMidi,
    soir: enrichedSoir,
    capacity,
    isWeekend: baseData.isWeekend,
    meta: getConfig()
  };
}

module.exports = { getEnrichedAvailability, getConfig };
