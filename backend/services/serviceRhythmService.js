const BlockedService = require('../models/BlockedService');
const { getServiceWaves } = require('./serviceWaveService');
const { parseDateInput, timeToMinutes, getServiceBounds, getOccupancyMap, getArrivalWindowLoad,
  isOnlineBookingClosedTime, ARRIVAL_WINDOW_MINUTES, ARRIVAL_WINDOW_MAX_COVERS } = require('./capacityService');

const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
function peak(start, end, arrivals) {
  let maximum = 0;
  for (let minute = start; minute < end; minute++) {
    maximum = Math.max(maximum, getArrivalWindowLoad(minute, 0, arrivals).peakCovers);
  }
  return maximum;
}

async function getServiceRhythm(date) {
  parseDateInput(date);
  const bounds = getServiceBounds(date);
  const { arrivalMinutes, reservations } = await getOccupancyMap(date);
  const start = new Date(date + 'T00:00:00.000Z');
  const blocked = await BlockedService.find({ date: { $gte: start, $lt: new Date(start.getTime() + 86400000) } });
  const services = {};
  for (const service of ['midi', 'soir']) {
    const rows = reservations.filter(r => (timeToMinutes(r.time) < 900 ? 'midi' : 'soir') === service);
    const waves = getServiceWaves(bounds, service).map(({ from, to, id, label, kind, endExclusive }) => {
      const bookings = rows.filter(r => timeToMinutes(r.time) >= from && timeToMinutes(r.time) < to);
      return { id, label, kind, start: clock(from), endExclusive: Boolean(endExclusive),
        end: clock(endExclusive ? to : Math.floor((to - 1) / 15) * 15), covers: bookings.reduce((sum, r) => sum + r.numberOfPeople, 0),
        reservations: bookings.length, peak30: peak(from, to, arrivalMinutes) };
    });
    const weeklyClosed = isOnlineBookingClosedTime(date, service === 'midi' ? '12:00' : '19:00');
    const manuallyClosed = blocked.some(b => b.service === 'all' || b.service === service);
    const totalCovers = rows.reduce((sum, r) => sum + r.numberOfPeople, 0);
    services[service] = { waves, totalCovers, closed: weeklyClosed || manuallyClosed,
      closure: weeklyClosed ? 'weekly' : manuallyClosed ? 'manual' : null,
      outsideWaves: totalCovers - waves.reduce((sum, wave) => sum + wave.covers, 0),
      paymentHolds: rows.filter(r => r.status === 'awaiting-payment').reduce((sum, r) => sum + r.numberOfPeople, 0),
      peak30: Math.max(0, ...waves.map(wave => wave.peak30)), provisional: service === 'midi' };
  }
  return { date, updatedAt: new Date().toISOString(), windowMinutes: ARRIVAL_WINDOW_MINUTES,
    limit: ARRIVAL_WINDOW_MAX_COVERS, services };
}

module.exports = { getServiceRhythm };
