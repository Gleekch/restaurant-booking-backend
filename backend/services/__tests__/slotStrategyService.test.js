jest.mock('../../models/Reservation', () => ({ find: jest.fn() }));
jest.mock('../../models/BlockedService', () => ({ find: jest.fn() }));
const Reservation = require('../../models/Reservation');
const BlockedService = require('../../models/BlockedService');
const { getAvailableSlots } = require('../capacityService');
const { getEnrichedAvailability } = require('../slotStrategyService');
const { getServiceRhythm } = require('../serviceRhythmService');
let records;
beforeEach(() => {
  records = [];
  Reservation.find.mockImplementation(async () => records.filter(r => r.status !== 'cancelled'));
  BlockedService.find.mockResolvedValue([]);
});
const booking = (time, numberOfPeople, status = 'confirmed') => ({ time, numberOfPeople, status });
const load = async (people = 2, date = '2026-10-07') =>
  getEnrichedAvailability(date, people, await getAvailableSlots(date, people, 50));

test('does not recommend the noon rush when a calmer arrival is available', async () => {
  records = [booking('12:00', 10)];
  const { midi } = await load(10);
  expect(midi.find(s => s.time === '12:15')).toMatchObject({ available: true, arrivalPeak30: 20, status: 'last-spots' });
  const recommendations = midi.filter(s => s.status === 'recommended');
  expect(recommendations.length).toBeGreaterThan(0);
  expect(recommendations.every(s => s.arrivalPeak30 === 10)).toBe(true);
  expect(midi.find(s => s.time === '12:15').alternatives).toEqual(['12:30', '12:45']);
});

test('empty services offer an explicit choice across waves, not a fixed noon/early dinner bias', async () => {
  const data = await load();
  expect(data.midi.filter(s => s.status === 'recommended').map(s => s.wave)).toEqual(['midi-1', 'midi-2', 'midi-3']);
  expect(data.soir.filter(s => s.status === 'recommended').map(s => s.wave)).toEqual(['soir-tapas', 'soir-1', 'soir-2', 'soir-3']);
});

test('alternatives never cross between tapas and dinner, including in either direction', async () => {
  records = [booking('19:00', 16)];
  const { soir } = await load(4);
  const dinner = soir.find(s => s.time === '19:00');
  expect(dinner.alternatives).toEqual(['19:30', '19:45']);
  const tapas = soir.find(s => s.time === '18:45');
  expect(tapas.status).toBe('last-spots');
  expect(tapas.alternatives.length).toBeGreaterThan(0);
  expect(tapas.alternatives.every(time => time < '19:00')).toBe(true);
});

test('near-full services need no recommended badge, and closed slots stay closed', async () => {
  records = [booking('19:00', 14)];
  const base = await getAvailableSlots('2026-10-07', 2, 50);
  // Only this busy arrival period remains open in this service.
  base.soir.forEach(s => { if (!['19:00', '19:15'].includes(s.time)) s.available = false; });
  const { soir } = await getEnrichedAvailability('2026-10-07', 2, base);
  const dinner = soir.filter(s => s.experience === 'dinner');
  expect(dinner.some(s => s.available)).toBe(true);
  expect(dinner.some(s => s.status === 'recommended')).toBe(false);
  expect(dinner.filter(s => s.available).every(s => s.status === 'last-spots')).toBe(true);
});

test.each(['2026-10-07', '2026-10-09', '2026-10-10'])('public and staff use identical three-wave lunch boundaries: %s', async date => {
  const publicData = await load(2, date);
  const staff = await getServiceRhythm(date);
  for (const service of ['midi', 'soir']) for (const slot of publicData[service]) {
    const wave = staff.services[service].waves.find(w => slot.time >= w.start && (w.endExclusive ? slot.time < w.end : slot.time <= w.end));
    expect(slot.wave).toBe(wave.id);
  }
});

test('off-grid arrivals and payment holds affect pressure, cancelled reservations do not', async () => {
  records = [booking('19:39', 12, 'awaiting-payment'), booking('19:45', 99, 'cancelled')];
  const { soir } = await load(6);
  expect(soir.find(s => s.time === '20:00')).toMatchObject({ available: true, arrivalPeak30: 18, status: 'last-spots' });
  expect(soir.find(s => s.time === '20:15').arrivalPeak30).toBe(6);
});

test('manual closure and base capacity refusals cannot be resurrected by scoring', async () => {
  const base = await getAvailableSlots('2026-10-07', 2, 50);
  base.midi.forEach(s => { s.available = false; });
  base.soir[0].available = false;
  const data = await getEnrichedAvailability('2026-10-07', 2, base);
  expect(data.midi.every(s => !s.available && s.status === 'full')).toBe(true);
  expect(data.soir[0]).toMatchObject({ available: false, status: 'full' });
  expect(data.soir.every(s => s.alternatives.every(time => data.soir.some(a => a.time === time && a.available && a.experience === s.experience)))).toBe(true);
});

test('reading recommendations does not mutate the base slots or reservations', async () => {
  records = [booking('12:00', 10)];
  const base = await getAvailableSlots('2026-10-07', 2, 50);
  const before = JSON.stringify({ base, records });
  await getEnrichedAvailability('2026-10-07', 2, base);
  expect(JSON.stringify({ base, records })).toBe(before);
});
