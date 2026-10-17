jest.mock('../../models/Reservation', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../services/notificationService', () => ({ sendCancellationEmailToClient: jest.fn().mockResolvedValue() }));
const Reservation = require('../../models/Reservation');
const notifications = require('../../services/notificationService');
const router = require('../reservations');
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const id = '333333333333333333333333', token = 'fictional-cancel-token';
let record, io;
beforeEach(() => {
  jest.clearAllMocks(); io = { emit: jest.fn() };
  record = { _id: id, customerName: 'TEST - FICTIF', status: 'confirmed', cancellationToken: token,
    date: new Date('2026-10-18'), time: '12:30', deposit: { status: 'none' } };
  Reservation.findById.mockImplementation(async () => ({ ...record }));
  Reservation.findOneAndUpdate.mockImplementation(async (_filter, update) => { Object.assign(record, update.$set); return { ...record }; });
});
async function cancel(path = '/:id/cancel', method = 'post', body = { token }) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler(path, method)({ params: { id }, body, app: { get: () => io } }, res); return res;
}
test('validated client cancellation records a durable event atomically with status', async () => {
  const res = await cancel(); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  expect(Reservation.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ status: 'cancelled', cancellationInitiator: 'client', cancelledAt: expect.any(Date) });
  expect(io.emit).toHaveBeenCalledWith('cancel-reservation', expect.objectContaining({ cancellationInitiator: 'client', cancelledAt: expect.any(Date) }));
  expect(notifications.sendCancellationEmailToClient).not.toHaveBeenCalled();
});
test('repeated client request keeps the original event timestamp and writes nothing', async () => {
  await cancel(); const at = record.cancelledAt; jest.clearAllMocks();
  await cancel(); expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled(); expect(io.emit).not.toHaveBeenCalled(); expect(record.cancelledAt).toBe(at);
});
test('invalid public token does not write metadata or emit an event', async () => {
  const res = await cancel('/:id/cancel', 'post', { token: 'wrong' }); expect(res.status).toHaveBeenCalledWith(404);
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled(); expect(io.emit).not.toHaveBeenCalled();
});
test('staff cancellation cannot impersonate a client using an input field', async () => {
  await cancel('/:id', 'delete', { cancellationInitiator: 'client' });
  expect(record.cancellationInitiator).toBe('restaurant');
});
test('failed atomic cancellation does not produce an alert or change metadata', async () => {
  Reservation.findOneAndUpdate.mockResolvedValue(null);
  const res = await cancel(); expect(res.status).toHaveBeenCalledWith(400);
  expect(io.emit).not.toHaveBeenCalled(); expect(record.cancelledAt).toBeUndefined();
});
