const crypto = require('crypto');
const FloorPlan = require('../models/FloorPlan');
const Reservation = require('../models/Reservation');
const tableCatalog = require('../config/tableCatalog.json');
const { parseDateInput, timeToMinutes, isOnlineBookingClosedTime } = require('./capacityService');

const emptyLayout = () => ({ zones: [{ id: 'terrace', name: 'Terrasse' }, { id: 'inside', name: 'Salle interieure' }], tables: [] });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const cleanString = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : fail('Libelle invalide.');
const numeric = (value, min, max) => Number.isFinite(value) && value >= min && value <= max ? value : fail('Dimension ou position de table invalide.');

function validateLayout(input) {
  if (!input || !Array.isArray(input.zones) || input.zones.length !== 2 || !Array.isArray(input.tables) || input.tables.length > 80) fail('Plan invalide (80 tables maximum).');
  const zoneIds = new Set();
  const zones = input.zones.map(zone => {
    if (!zone || !['terrace', 'inside'].includes(zone.id) || zoneIds.has(zone.id)) fail('Conserver une terrasse et une salle interieure.');
    zoneIds.add(zone.id); return { id: zone.id, name: cleanString(zone.name, 40) };
  });
  const ids = new Set(), labels = new Set();
  const tables = input.tables.map(table => {
    if (!table || !/^[a-zA-Z0-9_-]{1,64}$/.test(table.id) || ids.has(table.id)) fail('Identifiant de table invalide ou duplique.');
    ids.add(table.id);
    const name = cleanString(table.name, 24);
    if (labels.has(name.toLowerCase())) fail('Chaque table doit avoir un nom distinct.');
    labels.add(name.toLowerCase());
    if (!zoneIds.has(table.zone) || !['round', 'rectangle'].includes(table.shape)) fail('Zone ou forme invalide.');
    if (!Number.isInteger(table.seats) || table.seats < 1 || table.seats > 20) fail('Indiquez de 1 a 20 places par table.');
    const width = numeric(table.width, 70, 260), height = numeric(table.height, 60, 200);
    const x = numeric(table.x, 0, 1000 - width), y = numeric(table.y, 0, 650 - height);
    return { id: table.id, name, zone: table.zone, shape: table.shape, seats: table.seats, x, y, width, height };
  });
  return { zones, tables };
}

function context(date, service, template = false) {
  if (template) return { key: 'template', template: true };
  let parsed;
  try { parsed = parseDateInput(date); } catch (_) { fail('Date invalide.'); }
  const { year, month, day } = parsed;
  if (!['midi', 'soir'].includes(service)) fail('Service invalide.');
  return { key: `${date}:${service}`, date, service,
    start: new Date(Date.UTC(year, month - 1, day)), end: new Date(Date.UTC(year, month - 1, day + 1)) };
}
const fingerprint = booking => crypto.createHash('sha256').update(JSON.stringify([
  String(booking._id), new Date(booking.date).toISOString().slice(0, 10), booking.time, booking.numberOfPeople
])).digest('hex');
async function bookingsFor(ctx) {
  if (ctx.template) return [];
  const all = await Reservation.find({ date: { $gte: ctx.start, $lt: ctx.end }, status: { $nin: ['awaiting-payment', 'cancelled'] } })
    .select('_id customerName date time numberOfPeople status table deposit.required deposit.status deposit.paidAt').lean();
  return all.filter(r => (timeToMinutes(r.time) < 900 ? 'midi' : 'soir') === ctx.service
    && !(r.deposit?.required && !r.deposit.paidAt && ['awaiting', 'failed'].includes(r.deposit.status)));
}
function decorate(doc, ctx, bookings, inherited = false) {
  const assignments = (doc.assignments || []).map(assignment => {
    const booking = bookings.find(r => String(r._id) === assignment.reservationId);
    const review = !booking || assignment.fingerprint !== fingerprint(booking);
    return { ...assignment, review };
  });
  return { key: ctx.key, revision: doc.revision || 0, inherited, layout: doc.layout, assignments, tableCatalog,
    updatedAt: doc.updatedAt || null,
    closed: !ctx.template && isOnlineBookingClosedTime(ctx.date, ctx.service === 'midi' ? '12:00' : '19:00'),
    bookings: bookings.map(r => ({ id: String(r._id), name: r.customerName, time: r.time, people: r.numberOfPeople, status: r.status, legacyTable: r.table || null, fingerprint: fingerprint(r) })) };
}
async function get(ctx) {
  const existing = await FloorPlan.findById(ctx.key).lean();
  const base = existing || (!ctx.template && await FloorPlan.findById('template').lean());
  const doc = existing || { layout: base?.layout || emptyLayout(), assignments: [], revision: 0 };
  return decorate(doc, ctx, await bookingsFor(ctx), !existing && !ctx.template);
}
async function save(ctx, payload) {
  if (!payload || !Number.isInteger(payload.revision) || payload.revision < 0) fail('Version du plan requise.');
  const layout = validateLayout(payload.layout);
  if (!Array.isArray(payload.assignments) || payload.assignments.length > 200) fail('Affectations invalides.');
  if (ctx.template && payload.assignments.length) fail('Le plan type ne contient pas de reservations.');
  const bookings = await bookingsFor(ctx), usedTables = new Set(), usedBookings = new Set();
  const assignments = payload.assignments.map(a => {
    if (!a || !Array.isArray(a.tableIds) || !a.tableIds.length || a.tableIds.length > 20 || usedBookings.has(a.reservationId)) fail('Affectation invalide ou dupliquee.');
    const booking = bookings.find(r => String(r._id) === a.reservationId);
    if (!booking) fail('Une reservation a ete annulee ou deplacee. Retirez son placement puis rechargez le service.', 409);
    if (a.fingerprint !== fingerprint(booking)) fail('Une reservation a change. Rechargez et verifiez son placement.', 409);
    usedBookings.add(a.reservationId);
    let seats = 0;
    const zones = new Set();
    for (const id of a.tableIds) {
      const table = layout.tables.find(t => t.id === id);
      if (!table || usedTables.has(id)) fail('Une table est absente ou attribuee deux fois.');
      usedTables.add(id); seats += table.seats; zones.add(table.zone);
    }
    if (zones.size !== 1) fail('Un groupe de tables doit rester dans la meme zone.');
    if (seats < booking.numberOfPeople) fail(`Places insuffisantes pour cette reservation (${booking.numberOfPeople} couverts).`);
    return { reservationId: a.reservationId, tableIds: [...a.tableIds], fingerprint: fingerprint(booking) };
  });
  const fields = { layout, assignments, updatedAt: new Date(), revision: payload.revision + 1 };
  let saved;
  if (payload.revision === 0) {
    try { saved = await FloorPlan.create({ _id: ctx.key, ...fields }); }
    catch (error) { if (error.code === 11000) fail('Ce plan a ete modifie sur un autre poste. Rechargez avant de reessayer.', 409); throw error; }
  } else {
    saved = await FloorPlan.findOneAndUpdate({ _id: ctx.key, revision: payload.revision }, { $set: fields }, { new: true, runValidators: true });
    if (!saved) fail('Ce plan a ete modifie sur un autre poste. Rechargez avant de reessayer.', 409);
  }
  return decorate(saved, ctx, bookings);
}
module.exports = { get, save, context, validateLayout, emptyLayout, fingerprint };
