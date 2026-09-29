jest.mock('../../models/Reservation', () => ({ find: jest.fn() }));
jest.mock('../../models/BlockedService', () => ({ find: jest.fn() }));
const Reservation = require('../../models/Reservation');
const BlockedService = require('../../models/BlockedService');
const { getServiceRhythm } = require('../serviceRhythmService');
let records;
beforeEach(() => {
  jest.clearAllMocks(); records = [];
  Reservation.find.mockImplementation(async query => records.filter(r => r.status !== query.status.$ne));
  BlockedService.find.mockResolvedValue([]);
});
const booking = (time, numberOfPeople, status = 'confirmed') => ({ time, numberOfPeople, status,
  customerName: 'PRIVATE FIXTURE', email: 'fixture@example.invalid', cancellationToken: 'secret' });

test('three informative lunch waves use the same date bounds as the booking engine', async () => {
  records = ['12:00', '12:30', '12:45', '13:00', '13:15', '13:45'].map(time => booking(time, 2));
  const data = await getServiceRhythm('2026-09-30');
  expect(data.limit).toBe(20);
  expect(data.windowMinutes).toBe(30);
  expect(data.services.midi.provisional).toBe(true);
  expect(data.services.midi.waves.map(w => [w.start, w.end, w.covers])).toEqual([
    ['12:00', '12:30', 4], ['12:45', '13:00', 4], ['13:15', '13:45', 4]
  ]);
  expect(data.services.midi.outsideWaves).toBe(0);
  expect(JSON.stringify(data)).not.toMatch(/PRIVATE|example|secret|customerName|cancellationToken/);
});

test('pressure counts adjacent waves, off-grid bookings and payment holds, never cancellations', async () => {
  records = [booking('12:30', 17), booking('12:45', 17, 'awaiting-payment'), booking('12:39', 1), booking('12:30', 99, 'cancelled')];
  const data = await getServiceRhythm('2026-09-30');
  expect(data.services.midi.totalCovers).toBe(35);
  expect(data.services.midi.peak30).toBe(35);
  expect(data.services.midi.waves[0].peak30).toBe(35);
  expect(data.services.midi.waves[1].peak30).toBe(35);
  expect(data.services.midi.paymentHolds).toBe(17);
});

test.each([['2026-10-04', 'soir'], ['2026-10-05', 'midi'], ['2026-10-06', 'soir']])(
  'weekly closures retain historical wave counts: %s %s', async (date, service) => {
    records = [booking(service === 'midi' ? '12:30' : '19:00', 6)];
    const data = await getServiceRhythm(date);
    expect(data.services[service].closed).toBe(true);
    expect(data.services[service].closure).toBe('weekly');
    expect(data.services[service].totalCovers).toBe(6);
  }
);

test('manual closure is separate from weekly closure and never hides reservations', async () => {
  records = [booking('12:30', 8)]; BlockedService.find.mockResolvedValue([{ service: 'midi' }]);
  const data = await getServiceRhythm('2026-09-30');
  expect(data.services.midi.closure).toBe('manual');
  expect(data.services.midi.waves[0].covers).toBe(8);
  expect(data.services.soir.closed).toBe(false);
});

test('weekend end times are retained and out-of-wave bookings are explicit', async () => {
  records = [booking('11:45', 4), booking('14:00', 6)];
  const data = await getServiceRhythm('2026-10-03');
  expect(data.services.midi.waves.at(-1).end).toBe('14:00');
  expect(data.services.soir.waves.at(-1).end).toBe('21:30');
  expect(data.services.midi.outsideWaves).toBe(4);
});

test.each(['2026-09-30', '2026-10-03'])('tapas then three dinner waves are unambiguous on %s', async date => {
  records = ['18:00', '18:45', '19:00', '19:45', '20:00', '20:45', '21:00', '21:30', '21:45', '22:00'].map(time => booking(time, 2));
  const data = await getServiceRhythm(date);
  expect(data.services.soir.waves.map(w => [w.id, w.start, w.end, w.covers])).toEqual([
    ['soir-tapas', '18:00', '19:00', 4], ['soir-1', '19:00', '19:45', 4],
    ['soir-2', '20:00', '20:45', 4], ['soir-3', '21:00', '21:30', 4]
  ]);
  expect(data.services.soir.waves[0].endExclusive).toBe(true);
  expect(data.services.soir.totalCovers).toBe(20);
  expect(data.services.soir.outsideWaves).toBe(4);
  expect(data.services.soir.provisional).toBe(false);
});

test('evening pressure includes holds and neighboring waves but excludes cancellations', async () => {
  records = [booking('19:45', 12), booking('20:00', 9, 'awaiting-payment'), booking('20:00', 99, 'cancelled')];
  const { services } = await getServiceRhythm('2026-10-03');
  expect(services.soir.paymentHolds).toBe(9);
  expect(services.soir.totalCovers).toBe(21);
  expect(services.soir.waves.find(w => w.id === 'soir-1').peak30).toBe(21);
  expect(services.soir.waves.find(w => w.id === 'soir-2').peak30).toBe(21);
});

test('a database failure is not converted into an empty service', async () => {
  Reservation.find.mockRejectedValue(new Error('offline'));
  await expect(getServiceRhythm('2026-09-30')).rejects.toThrow('offline');
});
