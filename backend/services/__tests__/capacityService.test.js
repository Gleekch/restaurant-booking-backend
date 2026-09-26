jest.mock('../../models/Reservation', () => ({ find: jest.fn() }));
const Reservation = require('../../models/Reservation');
const { checkAvailability, getAvailableSlots, parseDateInput, CAPACITY } = require('../capacityService');

beforeEach(() => jest.clearAllMocks());
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
