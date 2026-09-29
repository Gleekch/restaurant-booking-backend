jest.mock('../../models/Reservation', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../services/bookingTransactionService', () => ({ withBookingTransaction: jest.fn() }));
jest.mock('../../services/capacityService', () => ({
  ...jest.requireActual('../../services/capacityService'), checkAvailability: jest.fn()
}));
jest.mock('../../services/notificationService', () => ({
  sendNotifications: jest.fn(), sendConfirmationEmailToClient: jest.fn(),
  sendCancellationEmailToClient: jest.fn(), sendDepositRequestEmailToClient: jest.fn()
}));

const Reservation = require('../../models/Reservation');
const { withBookingTransaction } = require('../../services/bookingTransactionService');
const { checkAvailability, CAPACITY } = require('../../services/capacityService');
const notifications = require('../../services/notificationService');
const router = require('../reservations');
const edit = router.stack.find(layer => layer.route?.path === '/:id' && layer.route.methods.put).route.stack.at(-1).handle;
const id = '000000000000000000000021';
const session = { fixture: true };
let existing, io;
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const request = body => ({ params: { id }, body, app: { get: () => io } });

beforeEach(() => {
  jest.clearAllMocks();
  existing = { _id: id, date: new Date('2026-09-30T00:00:00Z'), time: '12:30',
    numberOfPeople: 4, status: 'confirmed', source: 'website', phoneNumber: '0262000000',
    deposit: { required: true, status: 'paid', amountCents: 4000 } };
  io = { emit: jest.fn() };
  Reservation.findById.mockResolvedValue(existing);
  Reservation.findOneAndUpdate.mockImplementation(async (_filter, update) => ({ ...existing, ...update.$set }));
  withBookingTransaction.mockImplementation(async (_dates, work) => work(session));
  checkAvailability.mockResolvedValue({ available: true });
});

test('staff can move date/time and add covers with capacity checked excluding the original booking', async () => {
  const res = response();
  const body = { date: '2026-10-01', time: '19:30', numberOfPeople: 8 };
  await edit(request(body), res);
  expect(withBookingTransaction).toHaveBeenCalledWith(['2026-09-30', '2026-10-01'], expect.any(Function));
  expect(checkAvailability).toHaveBeenCalledWith('2026-10-01', '19:30', 8, CAPACITY, id, session);
  const [filter, update, options] = Reservation.findOneAndUpdate.mock.calls[0];
  expect(filter).toEqual(expect.objectContaining({ _id: id, status: 'confirmed', date: existing.date,
    time: '12:30', numberOfPeople: 4, 'deposit.status': 'paid' }));
  expect(update.$set).toEqual(expect.objectContaining(body));
  expect(update.$set.activeBookingKey).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(update.$set).some(key => key === 'deposit' || key.startsWith('deposit.'))).toBe(false);
  expect(options).toEqual({ new: true, runValidators: true, session });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true,
    data: expect.objectContaining({ ...body, deposit: existing.deposit, status: 'confirmed' }) }));
  expect(io.emit).toHaveBeenCalledWith('update-reservation', expect.objectContaining(body));
  expect(notifications.sendConfirmationEmailToClient).not.toHaveBeenCalled();
});

test('a full destination does not save the move or remove the original booking', async () => {
  checkAvailability.mockResolvedValue({ available: false });
  const res = response();
  await edit(request({ date: '2026-10-01', numberOfPeople: 8 }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  expect(io.emit).not.toHaveBeenCalled();
});

test('an outstanding checkout prevents a date or covers change', async () => {
  existing.deposit.status = 'awaiting';
  const res = response();
  await edit(request({ numberOfPeople: 8 }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('paiement en cours') }));
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});

test('a concurrent booking edit returns a conflict without emitting a success', async () => {
  Reservation.findOneAndUpdate.mockResolvedValue(null);
  const res = response();
  await edit(request({ time: '19:30' }), res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(io.emit).not.toHaveBeenCalled();
});

test.each([{ phoneNumber: '0262000011' }, { numberOfPeople: 3 }])(
  'existing overloaded bookings still allow non-worsening staff changes: %j', async body => {
    checkAvailability.mockResolvedValue({ available: false, message: 'Trop d arrivees rapprochees' });
    const res = response();
    await edit(request(body), res);
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(Reservation.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: existing.phoneNumber }),
      expect.anything(), expect.objectContaining({ session }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  }
);

test('pacing failure explains the arrival ceiling without saving or changing the paid amount', async () => {
  checkAvailability.mockResolvedValue({ available: false, message: 'Maximum 20 couverts sur 30 minutes.' });
  const res = response();
  await edit(request({ numberOfPeople: 8 }), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Maximum 20 couverts sur 30 minutes.' }));
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  expect(existing.deposit.amountCents).toBe(4000);
});

test.each([{ numberOfPeople: 0 }, { numberOfPeople: 2.5 }, { deposit: { amountCents: 8000 } }])(
  'invalid covers or forged payment fields cannot be saved: %j', async body => {
    const res = response();
    await edit(request(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  }
);
