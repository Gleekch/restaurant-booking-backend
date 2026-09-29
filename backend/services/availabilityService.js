const capacity = require('./capacityService');
const strategy = require('./slotStrategyService');
const BlockedService = require('../models/BlockedService');

async function getPublicAvailability(date, people = 2) {
  const { year, month, day } = capacity.parseDateInput(date);
  const size = Number(people);
  const limit = Number(process.env.ONLINE_BOOKING_LIMIT) || 10;
  const phone = process.env.RESTAURANT_PHONE_DISPLAY || '02 62 26 67 19';
  if (!Number.isInteger(size) || size < 1) throw new Error('Nombre de couverts invalide');
  if (size > limit) throw new Error(`Pour les groupes de plus de ${limit} personnes, merci d'appeler le restaurant au ${phone}.`);
  if (capacity.isOnlineBookingClosedDate(date)) {
    throw new Error('Restaurant ferme le dimanche soir, le lundi et le mardi. Merci de choisir un autre creneau.');
  }
  if (date < capacity.getRestaurantNow().date) throw new Error('Cette date est deja passee.');
  const blocked = await BlockedService.find({ date: {
    $gte: new Date(Date.UTC(year, month - 1, day)),
    $lt: new Date(Date.UTC(year, month - 1, day + 1))
  } });
  const blockedServices = blocked.map(entry => entry.service);
  const base = await capacity.getAvailableSlots(date, size, Number(process.env.ONLINE_CAPACITY) || 50);
  for (const service of ['midi', 'soir']) {
    if (blockedServices.includes('all') || blockedServices.includes(service)) {
      base[service] = base[service].map(slot => ({ ...slot, available: false }));
    }
  }
  const notice = [...base.midi, ...base.soir].some(slot => !slot.available)
    ? `Pour toute demande concernant un creneau indisponible, appelez-nous au ${phone}.` : null;
  const meta = { recommendationsEnabled: false, notice, blockedServices };
  if (strategy.getConfig().recommendationsEnabled) {
    try {
      const enriched = await strategy.getEnrichedAvailability(date, size, base);
      return { ...enriched, meta: { ...enriched.meta, notice, blockedServices } };
    } catch (error) {
      console.error('slotStrategyService fallback:', error.message);
    }
  }
  return { ...base, meta };
}

module.exports = { getPublicAvailability };
