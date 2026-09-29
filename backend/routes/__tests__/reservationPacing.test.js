jest.mock('../../models/Reservation', () => ({
  find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn()
}));
jest.mock('../../models/BlockedService', () => ({ find: jest.fn() }));
jest.mock('../../services/bookingTransactionService', () => ({ withBookingTransaction: jest.fn() }));
jest.mock('../../services/notificationService', () => ({ sendNotifications: jest.fn() }));

const Reservation = require('../../models/Reservation');
const BlockedService = require('../../models/BlockedService');
const { withBookingTransaction } = require('../../services/bookingTransactionService');
const changes = require('../../services/reservationChangeService');
const router = require('../reservations');
const settings = require('../settings');
const handler = (router, path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = () => ({ customerName: 'TEST', phoneNumber: '0262000000', email: 'fixture@example.invalid',
  date: '2026-09-30', time: '12:15', numberOfPeople: 8 });
const priorEnabled = process.env.DEPOSIT_ENABLED;

beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-09-28T06:00:00Z'));
  process.env.DEPOSIT_ENABLED = 'false';
  // Real capacity service, with only persistence and transactions simulated.
  Reservation.find.mockImplementation(() => Object.assign(Promise.resolve([
    { time: '12:00', numberOfPeople: 12 }, { time: '12:15', numberOfPeople: 1 }
  ]), { session: async () => [{ time: '12:00', numberOfPeople: 12 }, { time: '12:15', numberOfPeople: 1 }] }));
  Reservation.findOne.mockResolvedValue(null);
  BlockedService.find.mockImplementation(() => Object.assign(Promise.resolve([]), { session: async () => [] }));
  withBookingTransaction.mockImplementation(async (_dates, work) => work({ fixture: true }));
});
afterEach(() => {
  jest.useRealTimers();
  if (priorEnabled === undefined) delete process.env.DEPOSIT_ENABLED; else process.env.DEPOSIT_ENABLED = priorEnabled;
});

test.each(['/', '/desktop'])('public and staff creation both enforce rolling pacing: %s', async path => {
  const res = response();
  await handler(router, path, 'post')({ body: body(), get: () => undefined, headers: {} }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('20 couverts sur 30 minutes') }));
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});

test('the legacy availability endpoint returns the same pacing refusal', async () => {
  const res = response();
  await handler(settings, '/availability', 'post')({ body: body() }, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ available: false, message: expect.stringContaining('20 couverts sur 30 minutes') }));
});

test('the new client request and restaurant acceptance cannot bypass rolling pacing', async () => {
  const r = { _id: '000000000000000000000023', ...body(), time: '13:00', numberOfPeople: 6,
    status: 'confirmed', deposit: { required: true, status: 'paid', amountCents: 6000 } };
  const proposal = { date: '2026-09-30', time: '12:15', numberOfPeople: 8 };
  await expect(changes.submit(r, proposal)).rejects.toThrow('20 couverts sur 30 minutes');
  const requestId = '550e8400-e29b-41d4-a716-446655440000';
  r.changeRequests = [{ requestId, status: 'pending', from: changes.schedule(r), proposed: proposal }];
  Reservation.findById.mockResolvedValue(r);
  await expect(changes.decide(r._id, requestId, 'accept')).rejects.toThrow('20 couverts sur 30 minutes');
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  expect(r.deposit.amountCents).toBe(6000);
});

test.each([['/', '21:45'], ['/', '22:00'], ['/desktop', '21:45'], ['/desktop', '22:00']])(
  'new Saturday reservations cannot bypass 21:30 through %s at %s', async (path, time) => {
    const res = response();
    await handler(router, path, 'post')({ body: { ...body(), date: '2026-10-03', time }, get: () => undefined, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('21h30') }));
    expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  }
);

test('staff may still edit contact details on an existing late booking but not move a booking after 21:30', async () => {
  const r = { _id: '000000000000000000000023', ...body(), date: new Date('2026-10-03'), time: '22:00',
    status: 'confirmed', source: 'desktop', deposit: { required: false, status: 'none' } };
  Reservation.findById.mockResolvedValue(r);
  Reservation.findOneAndUpdate.mockResolvedValue({ ...r, phoneNumber: '0262000001' });
  const res = response();
  await handler(router, '/:id', 'put')({ params: { id: r._id }, body: { phoneNumber: '0262000001' }, app: { get: () => ({ emit: jest.fn() }) } }, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  Reservation.findOneAndUpdate.mockClear(); r.time = '21:00';
  const refused = response();
  await handler(router, '/:id', 'put')({ params: { id: r._id }, body: { time: '21:45' } }, refused);
  expect(refused.status).toHaveBeenCalledWith(400);
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});

test.each([['2026-10-04', '19:00'], ['2026-10-05', '12:30'], ['2026-10-06', '12:30']])(
  'closed slots remain blocked before reading capacity: %s %s', async (date, time) => {
    const res = response();
    await handler(router, '/', 'post')({ body: { ...body(), date, time }, get: () => undefined, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('dimanche soir, le lundi et le mardi') }));
    expect(Reservation.find).not.toHaveBeenCalled();
  }
);
