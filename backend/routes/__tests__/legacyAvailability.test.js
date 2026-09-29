jest.mock('../../models/Reservation', () => ({ find: jest.fn() }));
jest.mock('../../models/BlockedService', () => ({ find: jest.fn() }));
const Reservation = require('../../models/Reservation');
const BlockedService = require('../../models/BlockedService');
const { getPublicAvailability } = require('../../services/availabilityService');
const settings = require('../settings');
const handler = (path, method = 'get') => settings.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() });
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-09-30T08:07:00Z'));
  Reservation.find.mockResolvedValue([]); BlockedService.find.mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());
test('12:00 is not offered at 12:07 Reunion, but 12:15 stays available', async () => {
  const slots = await getPublicAvailability('2026-09-30', 2);
  expect(slots.midi.find(s => s.time === '12:00').available).toBe(false);
  expect(slots.midi.find(s => s.time === '12:15').available).toBe(true);
});
test.each([
  { date: '2026-09-30', time: '12:00', numberOfPeople: 2 },
  { date: '2026-09-30', time: '12:17', numberOfPeople: 2 },
  { date: '2026-09-30', time: '12:30', numberOfPeople: 11 },
  { date: '2026-09-29', time: '12:30', numberOfPeople: 2 },
  { date: '2026-10-04', time: '19:00', numberOfPeople: 2 },
  { date: '2026-10-05', time: '12:30', numberOfPeople: 2 },
  { date: '2026-10-06', time: '12:30', numberOfPeople: 2 }
])('legacy endpoint never offers invalid slot %j', async body => {
  const res = response(); await handler('/availability','post')({ body }, res);
  expect(res.json.mock.calls[0][0].available).toBe(false);
});
test('manual closures apply equally to the legacy endpoint', async () => {
  BlockedService.find.mockResolvedValue([{ service: 'soir' }]);
  const res = response(); await handler('/availability','post')({ body: { date: '2026-09-30', time: '19:00', numberOfPeople: 2 } }, res);
  expect(res.json.mock.calls[0][0].available).toBe(false);
});
test('settings exposes actual restaurant hours and does not pretend to save volatile settings', async () => {
  const res = response(); handler('/')({}, res);
  const settings = res.json.mock.calls[0][0].data;
  expect(settings.restaurant.name).toBe('Au Murmure des Flots');
  expect(settings.hours.monday.closed).toBe(true); expect(settings.hours.sunday.dinner).toBeNull();
  expect(settings.hours.saturday.dinner).toBe('18:00-21:30');
  const update = response(); handler('/','put')({ body: { hours: {} } }, update);
  expect(update.status).toHaveBeenCalledWith(409);
});
