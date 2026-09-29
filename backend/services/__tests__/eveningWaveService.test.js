jest.mock('../../models/Reservation', () => ({ find: jest.fn() }));
const Reservation = require('../../models/Reservation');
const { getAvailableSlots } = require('../capacityService');
const { getEnrichedAvailability } = require('../slotStrategyService');

test('public recommendations use the same evening groups and never resurrect crowded slots', async () => {
  Reservation.find.mockResolvedValue([{ time: '19:45', numberOfPeople: 12 }]);
  const base = await getAvailableSlots('2026-10-03', 9, 50);
  const data = await getEnrichedAvailability('2026-10-03', 9, base);
  const expected = { '18:00': 'soir-tapas', '18:45': 'soir-tapas', '19:00': 'soir-1',
    '19:45': 'soir-1', '20:00': 'soir-2', '20:45': 'soir-2', '21:00': 'soir-3', '21:30': 'soir-3' };
  for (const [time, wave] of Object.entries(expected)) expect(data.soir.find(s => s.time === time).wave).toBe(wave);
  expect(data.soir.find(s => s.time === '20:00')).toEqual(expect.objectContaining({ available: false, status: 'full' }));
  expect(data.soir.at(-1).time).toBe('21:30');
  expect(data.soir.filter(s => s.time > '21:30')).toEqual([]);
});
