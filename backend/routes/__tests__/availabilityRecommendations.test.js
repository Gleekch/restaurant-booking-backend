jest.mock('../../models/Reservation', () => ({ find: jest.fn() }));
jest.mock('../../models/BlockedService', () => ({ find: jest.fn() }));
const Reservation = require('../../models/Reservation');
const BlockedService = require('../../models/BlockedService');
const strategy = require('../../services/slotStrategyService');
const router = require('../reservations');
const handler = router.stack.find(layer => layer.route?.path === '/availability').route.stack.at(-1).handle;
const saved = process.env.SLOT_RECOMMENDATIONS_ENABLED;
beforeEach(() => {
  Reservation.find.mockResolvedValue([{ time: '12:00', numberOfPeople: 19 }]);
  BlockedService.find.mockResolvedValue([]);
  process.env.SLOT_RECOMMENDATIONS_ENABLED = 'true';
});
afterEach(() => {
  jest.restoreAllMocks();
  if (saved === undefined) delete process.env.SLOT_RECOMMENDATIONS_ENABLED;
  else process.env.SLOT_RECOMMENDATIONS_ENABLED = saved;
});
async function request(date = '2026-10-07') {
  const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ query: { date, people: '2' } }, res);
  return { ...res, body: res.json.mock.calls[0][0] };
}
test.each([false, true])('real unavailable flags survive with recommendations enabled=%s', async enabled => {
  process.env.SLOT_RECOMMENDATIONS_ENABLED = String(enabled);
  const res = await request();
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.body.data.midi.find(s => s.time === '12:15').available).toBe(false);
  expect(res.body.data.meta.recommendationsEnabled).toBe(enabled);
});
test('scoring outage falls back only to real capacity, never fabricated slots', async () => {
  jest.spyOn(strategy, 'getEnrichedAvailability').mockRejectedValue(new Error('fixture'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const { body } = await request();
  expect(body.success).toBe(true);
  expect(body.data.meta.recommendationsEnabled).toBe(false);
  expect(body.data.midi.find(s => s.time === '12:15').available).toBe(false);
});
test('manual closure remains authoritative with recommendations', async () => {
  BlockedService.find.mockResolvedValue([{ service: 'soir' }]);
  const { body } = await request();
  expect(body.data.soir.every(s => !s.available && s.status === 'full')).toBe(true);
});
test.each(['2026-10-05', '2026-10-06'])('weekly closed date is not opened by recommendations: %s', async date => {
  const res = await request(date);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.body.success).toBe(false);
});
test('Sunday keeps only lunch and Saturday stops at 21:30', async () => {
  expect((await request('2026-10-04')).body.data.soir).toEqual([]);
  expect((await request('2026-10-03')).body.data.soir.at(-1).time).toBe('21:30');
});
