jest.mock('../../models/Reservation', () => ({ findById: jest.fn() }));
const Reservation = require('../../models/Reservation');
const router = require('../reservations');
const read = router.stack.find(layer => layer.route?.path === '/:id/public').route.stack.at(-1).handle;
const token = 'a'.repeat(48);
beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-09-30T07:00:00Z')); });
afterEach(() => jest.useRealTimers());

// Owner decision: the accepted date/time sets a new refund deadline, not the old schedule.
test.each([
  ['2026-10-02', '12:00', true, '2026-10-01T08:00:00.000Z'],
  ['2026-09-30', '12:00', false, '2026-09-29T08:00:00.000Z'],
  ['2026-10-01', '12:00', true, '2026-09-30T08:00:00.000Z']
])('public refund eligibility follows accepted schedule %s %s', async (date, time, refundable, deadline) => {
  Reservation.findById.mockResolvedValue({ date: new Date(date), time, numberOfPeople: 8,
    status: 'confirmed', cancellationToken: token, deposit: { required: true, status: 'paid', amountCents: 6000, currency: 'eur' },
    cancellationReference: { date: new Date('2026-09-30'), time: '12:00', numberOfPeople: 6 },
    changeRequests: [{ requestId: 'fixture', status: 'pending', from: { date, time, numberOfPeople: 8 },
      proposed: { date: '2026-10-10', time: '19:00', numberOfPeople: 8 } }] });
  const res = { status: jest.fn().mockReturnThis(), set: jest.fn(), json: jest.fn() };
  await read({ params: { id: '000000000000000000000023' }, query: { token } }, res);
  const result = res.json.mock.calls[0][0];
  expect(result.success).toBe(true);
  expect(result.data.refundableNow).toBe(refundable);
  expect(result.data.deposit.amountCents).toBe(6000);
  expect(result.data.refundDeadline).toBe(deadline);
});
