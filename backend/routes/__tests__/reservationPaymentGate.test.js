jest.mock('../../models/Reservation', () => ({
  find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), findOneAndUpdate: jest.fn()
}));
const Reservation = require('../../models/Reservation');
const router = require('../reservations');
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => jest.clearAllMocks());

test('operator list excludes unpaid online attempts without deleting them', async () => {
  Reservation.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
  await handler('/', 'get')({ query: {} }, response());
  expect(Reservation.find).toHaveBeenCalledWith({ $nor: [
    { status: 'awaiting-payment' },
    { source: { $in: ['website', 'mobile'] }, 'deposit.required': true,
      'deposit.paidAt': null, 'deposit.status': { $in: ['awaiting', 'failed'] } }
  ] });
});

test.each([
  ['awaiting-payment', 'awaiting', 'confirmed'],
  ['awaiting-payment', 'awaiting', 'pending'],
  ['pending', 'awaiting', 'confirmed'],
  ['pending', 'failed', 'confirmed']
])('rejects premature transition %s/%s -> %s', async (status, depositStatus, requestedStatus) => {
  Reservation.findById.mockResolvedValue({ _id: 'test', status, deposit: { required: true, status: depositStatus } });
  const res = response();
  await handler('/:id', 'put')({ params: { id: 'test' }, body: { status: requestedStatus } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('arrhes') }));
  expect(Reservation.findByIdAndUpdate).not.toHaveBeenCalled();
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});

test('confirmation cannot overwrite a concurrent cancellation or refund', async () => {
  Reservation.findById.mockResolvedValue({ _id: 'test', status: 'pending', date: new Date('2026-10-04'),
    time: '12:00', numberOfPeople: 6, deposit: { required: true, status: 'paid' } });
  Reservation.findOneAndUpdate.mockResolvedValue(null);
  const res = response();
  await handler('/:id', 'put')({ params: { id: 'test' }, body: { status: 'confirmed' } }, res);
  expect(Reservation.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'test', status: 'pending', 'deposit.status': { $in: ['paid', 'deducted'] } });
  expect(res.status).toHaveBeenCalledWith(409);
});

test.each(['/:id/deposit/deducted', '/:id/complete', '/:id/no-show'])(
  'outcome %s cannot overwrite a concurrent cancellation', async path => {
    Reservation.findById.mockResolvedValue({ _id: 'test', status: 'confirmed',
      deposit: { required: true, status: 'paid' } });
    Reservation.findOneAndUpdate.mockResolvedValue(null);
    const res = response();
    await handler(path, 'post')({ params: { id: 'test' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(Reservation.findOneAndUpdate.mock.calls[0][0]).toHaveProperty('status');
  }
);

test('manual deposit requests fail before touching a booking when disabled', async () => {
  const previous = process.env.DEPOSIT_ENABLED;
  process.env.DEPOSIT_ENABLED = 'false';
  try {
    const res = response();
    await handler('/:id/deposit/request', 'post')({ params: { id: 'test' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(Reservation.findById).not.toHaveBeenCalled();
    expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined) delete process.env.DEPOSIT_ENABLED;
    else process.env.DEPOSIT_ENABLED = previous;
  }
});
