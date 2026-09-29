// Additive recommendations: base availability remains the safety authority.
const { getOccupancyMap, getServiceBounds, timeToMinutes, getArrivalWindowLoad,
  ARRIVAL_WINDOW_MAX_COVERS, SLOT_MAX_COVERS } = require('./capacityService');
const { getServiceWaves } = require('./serviceWaveService');

const MIDI_DURATION = parseInt(process.env.MIDI_DURATION_MIN, 10) || 90;
const SOIR_DURATION = parseInt(process.env.SOIR_DURATION_MIN, 10) || 120;
const STATUS_LABELS = {
  recommended: 'Recommand\u00e9', available: 'Disponible',
  'last-spots': 'Derni\u00e8res places', full: 'Complet'
};

function getConfig() {
  return { recommendationsEnabled: process.env.SLOT_RECOMMENDATIONS_ENABLED === 'true',
    balancingStrict: process.env.SLOT_BALANCING_STRICT === 'true' };
}

function compareLoad(a, b) {
  return a.arrivalPeak30 - b.arrivalPeak30 || a._waveDensity - b._waveDensity || a._roomPeak - b._roomPeak;
}

function enrichSlots(baseSlots, service, bounds, snapshot, people, capacity) {
  const { occupancy, arrivals, arrivalMinutes } = snapshot;
  const duration = service === 'midi' ? MIDI_DURATION : SOIR_DURATION;
  const waves = getServiceWaves(bounds, service);
  const scored = baseSlots.map(slot => {
    const minute = timeToMinutes(slot.time);
    const wave = waves.find(w => minute >= w.from && minute < w.to);
    const arrivalPeak30 = getArrivalWindowLoad(minute, people, arrivalMinutes).peakCovers;
    let roomPeak = 0;
    for (let m = minute; m < minute + duration; m++) roomPeak = Math.max(roomPeak, (occupancy[m] || 0) + people);
    const waveCovers = wave ? Object.entries(arrivalMinutes)
      .reduce((sum, [m, count]) => sum + (Number(m) >= wave.from && Number(m) < wave.to ? count : 0), 0) : 0;
    // Compare unequal wave lengths by arrival density; never by a fresh quota per wave.
    const waveMinutes = wave ? Math.ceil((wave.to - wave.from) / 15) * 15 : 1;
    const busy = arrivalPeak30 >= ARRIVAL_WINDOW_MAX_COVERS * .8
      || (arrivals[Math.floor(minute / 15) * 15] || 0) + people >= SLOT_MAX_COVERS
      || roomPeak >= capacity * .9;
    return { ...slot, wave: wave?.id || null,
      experience: service === 'midi' ? 'midi' : wave?.kind === 'tapas' ? 'tapas' : 'dinner',
      arrivalPeak30, score: slot.available ? Math.max(0, Math.round(100 * (1 - arrivalPeak30 / ARRIVAL_WINDOW_MAX_COVERS))) : 0,
      _minute: minute, _roomPeak: roomPeak, _waveDensity: waveCovers / waveMinutes, _busy: busy };
  });

  const recommended = new Set();
  for (const experience of ['midi', 'tapas', 'dinner']) {
    const candidates = scored.filter(s => s.experience === experience && s.available && !s._busy)
      .sort((a, b) => compareLoad(a, b) || a._minute - b._minute);
    const seenWaves = new Set();
    for (const slot of candidates) {
      if (compareLoad(slot, candidates[0]) !== 0) break;
      if (!seenWaves.has(slot.wave)) {
        recommended.add(slot.time);
        seenWaves.add(slot.wave);
      }
    }
  }

  return scored.map(slot => {
    const status = !slot.available ? 'full' : slot._busy ? 'last-spots'
      : recommended.has(slot.time) ? 'recommended' : 'available';
    const alternatives = status === 'full' || status === 'last-spots'
      ? scored.filter(other => other.time !== slot.time && other.experience === slot.experience
          && other.available && !other._busy && (!slot.available || other.arrivalPeak30 < slot.arrivalPeak30))
        .sort((a, b) => a.arrivalPeak30 - b.arrivalPeak30
          || Math.abs(a._minute - slot._minute) - Math.abs(b._minute - slot._minute)
          || compareLoad(a, b) || a._minute - b._minute)
        .slice(0, 2).map(s => s.time)
      : [];
    const { _minute, _roomPeak, _waveDensity, _busy, ...publicSlot } = slot;
    return { ...publicSlot, status, label: STATUS_LABELS[status], alternatives };
  });
}

async function getEnrichedAvailability(date, numberOfPeople, baseData) {
  const people = Number(numberOfPeople);
  if (!Number.isSafeInteger(people) || people < 1) throw new Error('Nombre de couverts invalide');
  const snapshot = await getOccupancyMap(date);
  const bounds = getServiceBounds(date);
  return { ...baseData,
    midi: enrichSlots(baseData.midi, 'midi', bounds, snapshot, people, baseData.capacity),
    soir: enrichSlots(baseData.soir, 'soir', bounds, snapshot, people, baseData.capacity),
    meta: getConfig() };
}

module.exports = { getEnrichedAvailability, getConfig };
