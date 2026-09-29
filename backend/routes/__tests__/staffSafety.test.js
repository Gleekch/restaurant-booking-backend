jest.mock('../../models/Reservation', () => {
  const Model = jest.fn(function (body) { Object.assign(this, body, { _id: '000000000000000000000001' }); this.save = Model.save; });
  Object.assign(Model, { save: jest.fn(), find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn() });
  return Model;
});
jest.mock('../../services/bookingTransactionService', () => ({ withBookingTransaction: jest.fn() }));
jest.mock('../../services/notificationService', () => ({ sendNotifications: jest.fn().mockResolvedValue(),
  sendConfirmationEmailToClient: jest.fn().mockResolvedValue(), sendPendingEmailToClient: jest.fn().mockResolvedValue() }));
const Reservation = require('../../models/Reservation');
const { withBookingTransaction } = require('../../services/bookingTransactionService');
const notices = require('../../services/notificationService');
const router = require('../reservations');
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = () => ({ customerName: 'FIXTURE', phoneNumber: '0262000000', email: 'fixture@example.invalid',
  date: '2026-09-30', time: '12:30', numberOfPeople: 2, status: 'confirmed', source: 'desktop' });
const query = value => Object.assign(Promise.resolve(value), { session: () => Promise.resolve(value) });
const io = { emit: jest.fn() };
let records;
beforeEach(() => {
  jest.clearAllMocks(); records = [];
  Reservation.find.mockImplementation(() => query([]));
  Reservation.findOne.mockImplementation(filter => query(records.find(r => filter.bookingRequestKey
    ? r.bookingRequestKey === filter.bookingRequestKey : r.bookingRequestFingerprint === filter.bookingRequestFingerprint)));
  Reservation.save.mockImplementation(async function () { records.push(this); });
  let tail = Promise.resolve();
  withBookingTransaction.mockImplementation((_dates, work) => { const result = tail.then(() => work({ fixture: true })); tail = result.catch(() => {}); return result; });
});
async function create(key, data = body()) {
  const res = response(); await handler('/desktop', 'post')({ body: data, get: () => key, app: { get: () => io } }, res); return res;
}
test.each(['retry-key', undefined])('concurrent staff retries only create and notify once (%s)', async key => {
  const responses = await Promise.all([create(key), create(key)]);
  expect(records).toHaveLength(1); expect(notices.sendNotifications).toHaveBeenCalledTimes(1);
  expect(responses[1].json).toHaveBeenCalledWith(expect.objectContaining({ success: true, duplicate: true }));
});
test('different keys permit two intentional identical bookings', async () => {
  await create('one'); await create('two'); expect(records).toHaveLength(2);
});
test('reusing a key with different covers does not change the first booking', async () => {
  await create('one'); const result = await create('one', { ...body(), numberOfPeople: 3 });
  expect(result.status).toHaveBeenCalledWith(400); expect(records).toHaveLength(1); expect(records[0].numberOfPeople).toBe(2);
});
test.each([['2026-10-04','19:00'], ['2026-10-05','12:30'], ['2026-10-06','12:30'], ['2026-09-30','11:45']])(
  'staff create and reschedule refuse closure %s %s without writing', async (date, time) => {
    expect((await create('closed', { ...body(), date, time })).status).toHaveBeenCalledWith(400);
    Reservation.findById.mockResolvedValue({ ...body(), _id: '000000000000000000000001', date: new Date('2026-09-30'), deposit: { status: 'none' } });
    const res = response(); await handler('/:id','put')({ params: { id: '000000000000000000000001' }, body: { date, time } }, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(Reservation.save).not.toHaveBeenCalled(); expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  });
test('existing closed-date contact details can still be corrected', async () => {
  const existing = { ...body(), _id: '000000000000000000000001', date: new Date('2026-10-05'), deposit: { status: 'none' } };
  Reservation.findById.mockResolvedValue(existing); Reservation.findOneAndUpdate.mockResolvedValue({ ...existing, phoneNumber: '0262000001' });
  const res = response(); await handler('/:id','put')({ params: { id: existing._id }, body: { phoneNumber: '0262000001' }, app: { get: () => io } }, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true })); expect(notices.sendConfirmationEmailToClient).not.toHaveBeenCalled();
});
test.each(['pending', 'confirmed'])('rescheduling a %s booking sends the matching email', async status => {
  const existing = { ...body(), status, _id: '000000000000000000000001', date: new Date('2026-09-30'), deposit: { status: 'none' } };
  Reservation.findById.mockResolvedValue(existing); Reservation.findOneAndUpdate.mockResolvedValue({ ...existing, time: '13:00' });
  const res = response(); await handler('/:id','put')({ params: { id: existing._id }, body: { time: '13:00' }, app: { get: () => io } }, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  expect(status === 'confirmed' ? notices.sendConfirmationEmailToClient : notices.sendPendingEmailToClient).toHaveBeenCalledWith(expect.objectContaining({ time: '13:00', status }));
});
