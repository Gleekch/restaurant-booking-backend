jest.mock('../../models/Reservation', () => ({ find: jest.fn() }));
const Reservation = require('../../models/Reservation');
const { checkAvailability, getAvailableSlots, parseDateInput, getServiceBounds, CAPACITY } = require('../capacityService');

beforeEach(() => {
  jest.clearAllMocks();
  // Keep the service fixtures in the future regardless of the test execution date.
  jest.useFakeTimers().setSystemTime(new Date('2026-09-29T00:00:00Z'));
});
afterEach(() => jest.useRealTimers());
test('off-grid staff bookings occupy real time, not a different grid', async () => {
  Reservation.find.mockResolvedValue([{ time: '19:05', numberOfPeople: CAPACITY }]);
  expect((await checkAvailability('2026-10-07', '19:00', 1, CAPACITY)).available).toBe(false);
  expect((await checkAvailability('2026-10-07', '21:05', 1, CAPACITY)).available).toBe(true);
  expect((await getAvailableSlots('2026-10-07', 2, CAPACITY)).soir.find(s => s.time === '19:00').available).toBe(false);
});
test('off-grid requests cannot bypass occupancy or arrival limits', async () => {
  Reservation.find.mockResolvedValue([{ time: '19:00', numberOfPeople: CAPACITY }]);
  expect((await checkAvailability('2026-10-07', '19:05', 2, CAPACITY)).available).toBe(false);
  Reservation.find.mockResolvedValue([{ time: '19:05', numberOfPeople: 17 }]);
  expect((await checkAvailability('2026-10-07', '19:00', 2, 50)).available).toBe(false);
});
test.each(['2026-02-30', '2026-13-01', '2026-00-01'])('rejects impossible date %s', value => {
  expect(() => parseDateInput(value)).toThrow('Date invalide');
});
test.each([1.5, '2people', -1, 0])('rejects invalid party size %s', async value => {
  await expect(checkAvailability('2026-10-07', '19:00', value)).rejects.toThrow();
});

test.each([50, CAPACITY])('30-minute ceiling also applies to capacity limit %s', async limit => {
  Reservation.find.mockResolvedValue([{ time: '12:00', numberOfPeople: 12 }, { time: '12:15', numberOfPeople: 1 }]);
  const result = await checkAvailability('2026-09-30', '12:15', 8, limit);
  expect(result).toEqual(expect.objectContaining({ available: false, reason: 'arrival-window-full', peakOccupancy: 21, capacity: 20 }));
});

test.each(['12:01', '12:15', '12:29'])('counts nearby arrivals on both sides of %s', async time => {
  Reservation.find.mockResolvedValue([{ time: '12:00', numberOfPeople: 6 }, { time: '12:29', numberOfPeople: 8 }]);
  expect((await checkAvailability('2026-09-30', time, 7, CAPACITY)).available).toBe(false);
});

test('exactly 30 minutes apart are separate half-open windows', async () => {
  Reservation.find.mockResolvedValue([{ time: '12:00', numberOfPeople: 20 }]);
  expect((await checkAvailability('2026-09-30', '12:29', 1, CAPACITY)).available).toBe(false);
  expect((await checkAvailability('2026-09-30', '12:30', 20, CAPACITY)).available).toBe(true);
});

test('allows exactly 20, rejects 21 and a single party over the pacing ceiling', async () => {
  Reservation.find.mockResolvedValue([{ time: '19:05', numberOfPeople: 12 }]);
  expect((await checkAvailability('2026-09-30', '19:30', 8, CAPACITY)).available).toBe(true);
  expect((await checkAvailability('2026-09-30', '19:30', 9, CAPACITY)).available).toBe(false);
  Reservation.find.mockResolvedValue([]);
  expect((await checkAvailability('2026-09-30', '19:00', 21, CAPACITY)).available).toBe(false);
});

test('online slots and saving accept exactly 20 arrivals but refuse 21 across adjacent slots', async () => {
  Reservation.find.mockResolvedValue([{ time: '12:00', numberOfPeople: 12 }]);
  for (const [people, available] of [[8, true], [9, false]]) {
    expect((await getAvailableSlots('2026-09-30', people, 50)).midi.find(s => s.time === '12:15').available).toBe(available);
    expect((await checkAvailability('2026-09-30', '12:15', people, 50)).available).toBe(available);
  }
});

test('availability and save agree on 30-minute pressure and exclude the edited booking', async () => {
  const id = '000000000000000000000023';
  const records = [{ time: '12:00', numberOfPeople: 17 }, { time: '12:15', numberOfPeople: 9 }];
  Reservation.find.mockResolvedValue(records);
  expect((await getAvailableSlots('2026-09-30', 8, 50, id)).midi.find(s => s.time === '12:15').available).toBe(false);
  expect(Reservation.find).toHaveBeenCalledWith(expect.objectContaining({ _id: { $ne: id } }));
  expect((await checkAvailability('2026-09-30', '12:15', 8, 50, id)).available).toBe(false);
});

test('Wednesday and Thursday include 13:45; weekend lunch and Sunday evening closure stay intact', async () => {
  Reservation.find.mockResolvedValue([]);
  for (const date of ['2026-09-30', '2026-10-01']) {
    expect(getServiceBounds(date).midiEnd).toBe(825);
    expect((await getAvailableSlots(date, 2, 50)).midi.at(-1)).toEqual({ time: '13:45', available: true });
  }
  expect(getServiceBounds('2026-10-02').midiEnd).toBe(840);
  expect(getServiceBounds('2026-10-03').soirEnd).toBe(1290);
  expect((await getAvailableSlots('2026-10-04', 2, 50)).soir).toEqual([]);
});

test.each(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])('last arrival is 21:30, including Saturday: %s', async date => {
  Reservation.find.mockResolvedValue([]);
  expect((await getAvailableSlots(date, 2, 50)).soir.at(-1)).toEqual({ time: '21:30', available: true });
  expect((await checkAvailability(date, '21:30', 2, CAPACITY)).available).toBe(true);
  for (const time of ['21:31', '21:45', '22:00']) {
    expect(await checkAvailability(date, time, 2, CAPACITY)).toEqual(expect.objectContaining({ available: false, reason: 'after-last-arrival' }));
  }
});

test.each([['18:45', '19:00'], ['19:45', '20:00'], ['20:45', '21:00']])(
  'the 20-cover ceiling never resets between evening periods: %s / %s', async (first, next) => {
    Reservation.find.mockResolvedValue([{ time: first, numberOfPeople: 12 }]);
    expect((await checkAvailability('2026-10-03', next, 8, CAPACITY)).available).toBe(true);
    expect((await checkAvailability('2026-10-03', next, 9, CAPACITY)).reason).toBe('arrival-window-full');
  }
);
