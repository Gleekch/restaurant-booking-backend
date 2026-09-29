const crypto = require('crypto');
const Reservation = require('../models/Reservation');
const BlockedService = require('../models/BlockedService');
const { withBookingTransaction } = require('./bookingTransactionService');
const { checkAvailability, getAvailableSlots, getServiceBounds, getRestaurantNow,
  isOnlineBookingClosedDate, isOnlineBookingClosedTime, parseDateInput, timeToMinutes } = require('./capacityService');

const onlineLimit = () => parseInt(process.env.ONLINE_BOOKING_LIMIT, 10) || 10;
const capacity = () => parseInt(process.env.ONLINE_CAPACITY, 10) || 50;
const active = r => ['pending', 'confirmed'].includes(r.status);
const enabled = () => process.env.RESERVATION_CHANGES_ENABLED === 'true';
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const validateDate = date => { try { parseDateInput(date); } catch (error) { fail(error.message); } };
const validateTime = time => { try { return timeToMinutes(time); } catch (error) { fail(error.message); } };
const dateKey = value => new Date(value).toISOString().slice(0, 10);
const schedule = r => ({ date: dateKey(r.date), time: r.time, numberOfPeople: r.numberOfPeople });
const sameSchedule = (a, b) => JSON.stringify(schedule(a)) === JSON.stringify(schedule(b));
const pending = r => (r.changeRequests || []).find(change => change.status === 'pending');

function snapshotFilter(r) {
  return { _id: r._id, status: r.status, date: r.date, time: r.time, numberOfPeople: r.numberOfPeople,
    phoneNumber: r.phoneNumber,
    'deposit.status': r.deposit?.status && r.deposit.status !== 'none' ? r.deposit.status : { $in: [null, 'none'] },
    'deposit.amountCents': r.deposit?.amountCents || { $in: [null, 0] } };
}

function ensureEligible(r) {
  if (!active(r)) fail('Cette reservation ne peut plus etre modifiee en ligne. Appelez le restaurant.');
  if ((r.deposit?.required && r.deposit.status !== 'paid')
    || !['none', 'paid'].includes(r.deposit?.status || 'none')) {
    fail('Le paiement doit etre regle avant une demande de modification. Appelez le restaurant.');
  }
  const now = getRestaurantNow();
  if (dateKey(r.date) < now.date || (dateKey(r.date) === now.date && timeToMinutes(r.time) <= now.minutes)) {
    fail('Le service de cette reservation a deja commence. Appelez le restaurant.');
  }
}

function validateProposal(r, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['date', 'time', 'numberOfPeople'].includes(key))) fail('Modification invalide.');
  validateDate(body.date);
  const people = body.numberOfPeople;
  if (!Number.isSafeInteger(people) || people < 1) fail('Nombre de couverts invalide.');
  if (people > onlineLimit()) fail(`Au-dela de ${onlineLimit()} personnes, appelez le restaurant.`);
  if (people < r.numberOfPeople) fail('Pour reduire le nombre de personnes, appelez le restaurant.');
  const minutes = validateTime(body.time);
  const bounds = getServiceBounds(body.date);
  if (minutes % 15 || !((minutes >= bounds.midiStart && minutes <= bounds.midiEnd)
    || (minutes >= bounds.soirStart && minutes <= bounds.soirEnd))) fail('Choisissez un horaire de service propose.');
  if (isOnlineBookingClosedTime(body.date, body.time)) fail('Le restaurant est ferme le dimanche soir, le lundi et le mardi.');
  const now = getRestaurantNow();
  if (body.date < now.date || (body.date === now.date && minutes <= now.minutes)) fail('Ce creneau est deja passe.');
  return { date: body.date, time: body.time, numberOfPeople: people };
}

async function blockedOn(date, session) {
  const start = new Date(date + 'T00:00:00.000Z');
  const end = new Date(start.getTime() + 86400000);
  const query = BlockedService.find({ date: { $gte: start, $lt: end } });
  return session ? query.session(session) : query;
}

async function ensureAvailable(r, proposal, session) {
  const service = timeToMinutes(proposal.time) < 900 ? 'midi' : 'soir';
  if ((await blockedOn(proposal.date, session)).some(b => b.service === 'all' || b.service === service)) {
    fail('Ce service est ferme aux reservations en ligne.');
  }
  const availability = await checkAvailability(proposal.date, proposal.time, proposal.numberOfPeople, capacity(), r._id, session);
  if (!availability.available) fail(availability.message
    ? `${availability.message} Votre reservation actuelle reste inchangee.`
    : 'Ce creneau est complet. Votre reservation actuelle reste inchangee.', 409);
}

async function publicReservation(id, token) {
  if (!/^[a-f\d]{24}$/i.test(String(id)) || typeof token !== 'string' || !/^[a-f\d]{48}$/i.test(token)) {
    fail('Lien invalide ou reservation introuvable.', 404);
  }
  const r = await Reservation.findById(id);
  const stored = r?.cancellationToken;
  if (!stored || stored.length !== token.length || !crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(token))) {
    fail('Lien invalide ou reservation introuvable.', 404);
  }
  return r;
}

function publicState(r) {
  const last = (r.changeRequests || []).at(-1);
  let eligible = true;
  try { ensureEligible(r); } catch { eligible = false; }
  return { enabled: enabled(), canRequestChange: enabled() && eligible, maxPeople: onlineLimit(), minimumPeople: r.numberOfPeople,
    depositUnchanged: true,
    changeRequest: last ? { requestId: last.requestId,
      status: last.status === 'pending' && !active(r) ? 'void' : last.status,
      from: schedule(last.from), proposed: schedule(last.proposed),
      requestedAt: last.requestedAt, reviewedAt: last.reviewedAt } : null };
}

async function availability(r, date, people) {
  ensureEligible(r); validateDate(date);
  const count = Number(people);
  if (!Number.isSafeInteger(count) || count < r.numberOfPeople || count > onlineLimit()) fail('Nombre de couverts non autorise en ligne. Appelez le restaurant.');
  if (date < getRestaurantNow().date) fail('Cette date est deja passee.');
  if (isOnlineBookingClosedDate(date)) return { midi: [], soir: [], closed: true };
  const slots = await getAvailableSlots(date, count, capacity(), r._id);
  const blocked = await blockedOn(date);
  const now = getRestaurantNow();
  for (const service of ['midi', 'soir']) {
    slots[service] = slots[service].map(slot => ({ ...slot, available: slot.available
      && !isOnlineBookingClosedTime(date, slot.time)
      && !(date === now.date && timeToMinutes(slot.time) <= now.minutes)
      && !blocked.some(b => b.service === 'all' || b.service === service) }));
  }
  return slots;
}

async function submit(r, body) {
  ensureEligible(r);
  const proposed = validateProposal(r, body);
  const previous = pending(r);
  if (previous) {
    if (sameSchedule(previous.proposed, proposed)) return { reservation: r, change: previous, changed: false };
    fail('Une demande attend deja la decision du restaurant. Votre reservation actuelle est conservee.', 409);
  }
  if (sameSchedule(r, proposed)) fail('Aucune modification a demander.');
  await ensureAvailable(r, proposed);
  const change = { requestId: crypto.randomUUID(), status: 'pending', from: schedule(r), proposed, requestedAt: new Date() };
  const updated = await Reservation.findOneAndUpdate({ ...snapshotFilter(r), 'changeRequests.status': { $ne: 'pending' } },
    { $push: { changeRequests: change }, $set: { updatedAt: new Date() } }, { new: true, runValidators: true });
  if (!updated) fail('La reservation a change entre-temps. Rechargez la page.', 409);
  return { reservation: updated, change, changed: true };
}

async function decide(id, requestId, decision) {
  if (!/^[a-f\d]{24}$/i.test(String(id)) || !/^[a-f\d-]{36}$/i.test(String(requestId))
    || !['accept', 'reject'].includes(decision)) fail('Decision invalide.');
  const r = await Reservation.findById(id);
  const change = r?.changeRequests?.find(item => item.requestId === requestId);
  if (!change) fail('Demande introuvable.', 404);
  const state = decision === 'accept' ? 'accepted' : 'rejected';
  if (change.status === state) return { reservation: r, change, changed: false };
  if (change.status !== 'pending') fail('Cette demande a deja ete traitee.', 409);
  const filter = { ...snapshotFilter(r), changeRequests: { $elemMatch: { requestId, status: 'pending' } } };
  const fields = { 'changeRequests.$.status': state, 'changeRequests.$.reviewedAt': new Date(),
    'changeRequests.$.reviewedBy': 'restaurant', updatedAt: new Date() };
  let updated;
  if (decision === 'accept') {
    ensureEligible(r);
    if (!sameSchedule(r, change.from)) fail('La reservation a ete modifiee depuis cette demande. Refusez cette ancienne demande et contactez le client.', 409);
    const proposed = validateProposal(r, schedule(change.proposed));
    updated = await withBookingTransaction([dateKey(r.date), proposed.date], async session => {
      await ensureAvailable(r, proposed, session);
      Object.assign(fields, proposed);
      if (proposed.date !== dateKey(r.date) || proposed.time !== r.time) {
        fields.reminder24hSentAt = null;
      }
      if (['website', 'mobile'].includes(r.source)) {
        fields.activeBookingKey = crypto.createHash('sha256').update(String(r.phoneNumber).replace(/\D/g, '') + ':' + proposed.date).digest('hex');
      }
      const saved = await Reservation.findOneAndUpdate(filter, { $set: fields }, { new: true, runValidators: true, session });
      if (!saved) fail('La reservation a change entre-temps. Rechargez avant de reessayer.', 409);
      return saved;
    });
  } else {
    updated = await Reservation.findOneAndUpdate(filter, { $set: fields }, { new: true, runValidators: true });
    if (!updated) fail('Cette demande a change entre-temps. Rechargez avant de reessayer.', 409);
  }
  // No deposit field is written: adding covers never requests or fabricates extra payment.
  return { reservation: updated, change: { ...(change.toObject ? change.toObject() : change), status: state }, changed: true };
}

module.exports = { publicReservation, publicState, availability, submit, decide,
  validateProposal, ensureEligible, sameSchedule, schedule, enabled };
