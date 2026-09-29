jest.mock('../../models/Reservation', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../models/BlockedService', () => ({ find: jest.fn() }));
jest.mock('../bookingTransactionService', () => ({ withBookingTransaction: jest.fn() }));
jest.mock('../capacityService', () => ({ ...jest.requireActual('../capacityService'),
  checkAvailability: jest.fn(), getAvailableSlots: jest.fn(), getRestaurantNow: jest.fn() }));
const Reservation = require('../../models/Reservation');
const BlockedService = require('../../models/BlockedService');
const capacity = require('../capacityService');
const { withBookingTransaction } = require('../bookingTransactionService');
const service = require('../reservationChangeService');
const ReservationModel = jest.requireActual('../../models/Reservation');
const id = '000000000000000000000023';
const token = 'a'.repeat(48);
const requestId = '550e8400-e29b-41d4-a716-446655440000';
let r;
const proposal = () => ({ date: '2026-10-01', time: '19:30', numberOfPeople: 8 });
const change = () => ({ requestId, status: 'pending', from: service.schedule(r), proposed: proposal(), requestedAt: new Date() });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RESERVATION_CHANGES_ENABLED = 'true';
  r = { _id: id, cancellationToken: token, date: new Date('2026-09-30'), time: '12:30', numberOfPeople: 6,
    phoneNumber: '0262000000', status: 'confirmed', source: 'website', deposit: { required: true, status: 'paid', amountCents: 6000 }, changeRequests: [] };
  Reservation.findById.mockResolvedValue(r);
  capacity.getRestaurantNow.mockReturnValue({ date: '2026-09-28', minutes: 700 });
  capacity.checkAvailability.mockResolvedValue({ available: true });
  BlockedService.find.mockImplementation(() => Object.assign(Promise.resolve([]), { session: jest.fn().mockResolvedValue([]) }));
  withBookingTransaction.mockImplementation(async (_dates, work) => work({ fixture: true }));
  Reservation.findOneAndUpdate.mockImplementation(async (_filter, update) => {
    const result = structuredClone(r);
    if (update.$push) result.changeRequests.push(update.$push.changeRequests);
    for (const [key, value] of Object.entries(update.$set || {})) {
      if (key.startsWith('changeRequests.$.')) result.changeRequests[0][key.split('.').at(-1)] = value;
      else result[key] = value;
    }
    return result;
  });
});
afterEach(() => { delete process.env.RESERVATION_CHANGES_ENABLED; });

test('a request preserves the original schedule, confirmation and paid deposit', async () => {
  const result = await service.submit(r, proposal());
  expect(service.schedule(result.reservation)).toEqual(service.schedule(r));
  expect(result.reservation.deposit).toEqual(r.deposit);
  expect(result.reservation.status).toBe('confirmed');
  expect(result.change.proposed.numberOfPeople).toBe(8);
  expect(Reservation.findOneAndUpdate.mock.calls[0][0]['changeRequests.status']).toEqual({ $ne: 'pending' });
  expect(Object.keys(Reservation.findOneAndUpdate.mock.calls[0][1].$set)).toEqual(['updatedAt']);
});

test('acceptance updates schedule atomically, with no extra arrhes and no payment-field write', async () => {
  r.changeRequests.push(change());
  const result = await service.decide(id, requestId, 'accept');
  expect(service.schedule(result.reservation)).toEqual(proposal());
  expect(result.reservation.deposit).toEqual(r.deposit);
  expect(result.reservation.status).toBe(r.status);
  expect(result.reservation.changeRequests[0].status).toBe('accepted');
  expect(result.reservation.cancellationReference).toBeUndefined();
  expect(result.reservation.reminder24hSentAt).toBeNull();
  expect(withBookingTransaction).toHaveBeenCalledWith(['2026-09-30', '2026-10-01'], expect.any(Function));
  expect(capacity.checkAvailability).toHaveBeenCalledWith('2026-10-01', '19:30', 8, 50, id, { fixture: true });
  const [filter, update, options] = Reservation.findOneAndUpdate.mock.calls[0];
  expect(filter.changeRequests.$elemMatch).toEqual({ requestId, status: 'pending' });
  expect(filter['deposit.status']).toBe('paid');
  expect(filter['deposit.amountCents']).toBe(6000);
  expect(Object.keys(update.$set).some(key => key.startsWith('deposit'))).toBe(false);
  expect(options.session).toEqual({ fixture: true });
});

test('rejection preserves the schedule and payment', async () => {
  r.changeRequests.push(change());
  const result = await service.decide(id, requestId, 'reject');
  expect(result.reservation.changeRequests[0].status).toBe('rejected');
  expect(service.schedule(result.reservation)).toEqual(service.schedule(r));
  expect(result.reservation.deposit).toEqual(r.deposit);
  expect(capacity.checkAvailability).not.toHaveBeenCalled();
});

test.each(['2026-10-05', '2026-10-06'])('a closed date %s cannot be requested', async date => {
  await expect(service.submit(r, { ...proposal(), date })).rejects.toThrow('ferme');
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});
test('Sunday evening remains closed; Sunday lunch remains valid', async () => {
  await expect(service.submit(r, { ...proposal(), date: '2026-10-04' })).rejects.toThrow('ferme');
  expect(service.validateProposal(r, { ...proposal(), date: '2026-10-04', time: '12:30' }).time).toBe('12:30');
});
test.each([
  { numberOfPeople: 11 }, { numberOfPeople: 5 }, { numberOfPeople: 8.5 },
  { numberOfPeople: true }, { numberOfPeople: '8' }, { numberOfPeople: [8] },
  { time: '19:17' }, { time: '03:00' }, { date: '2026-09-27' }, { date: '2026-02-30' },
  { deposit: { amountCents: 0 } }, { status: 'confirmed' }
])('invalid or protected changes are rejected: %j', async fields => {
  await expect(service.submit(r, { ...proposal(), ...fields })).rejects.toThrow();
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});
test.each(['cancelled', 'completed', 'no-show', 'awaiting-payment'])('status %s cannot request a change', async status => {
  r.status = status;
  await expect(service.submit(r, proposal())).rejects.toThrow();
});
test.each(['awaiting', 'refund_pending', 'refunded', 'refund_failed', 'deducted'])('payment status %s cannot request a change', async status => {
  r.deposit.status = status;
  await expect(service.submit(r, proposal())).rejects.toThrow();
});
test('a started service cannot be modified publicly', async () => {
  capacity.getRestaurantNow.mockReturnValue({ date: '2026-09-30', minutes: 750 });
  await expect(service.submit(r, proposal())).rejects.toThrow('commence');
});
test('manual service blocking is enforced at approval', async () => {
  r.changeRequests.push(change());
  BlockedService.find.mockReturnValue({ session: jest.fn().mockResolvedValue([{ service: 'soir' }]) });
  await expect(service.decide(id, requestId, 'accept')).rejects.toThrow('service est ferme');
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});
test('capacity is rechecked at approval; full destination leaves old booking untouched', async () => {
  r.changeRequests.push(change());
  capacity.checkAvailability.mockResolvedValue({ available: false });
  await expect(service.decide(id, requestId, 'accept')).rejects.toMatchObject({ status: 409 });
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});
test('stale or concurrent approvals do not overwrite a newer reservation', async () => {
  r.changeRequests.push(change());
  r.time = '13:00';
  await expect(service.decide(id, requestId, 'accept')).rejects.toMatchObject({ status: 409 });
  r.time = '12:30';
  Reservation.findOneAndUpdate.mockResolvedValue(null);
  await expect(service.decide(id, requestId, 'accept')).rejects.toMatchObject({ status: 409 });
});
test('retrying the same request or decision is idempotent', async () => {
  r.changeRequests.push(change());
  expect((await service.submit(r, proposal())).changed).toBe(false);
  await expect(service.submit(r, { ...proposal(), time: '20:00' })).rejects.toMatchObject({ status: 409 });
  r.changeRequests[0].status = 'accepted';
  expect((await service.decide(id, requestId, 'accept')).changed).toBe(false);
  await expect(service.decide(id, requestId, 'reject')).rejects.toMatchObject({ status: 409 });
  expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});
test('wrong and malformed bearer tokens cannot expose a reservation', async () => {
  await expect(service.publicReservation(id, 'b'.repeat(48))).rejects.toMatchObject({ status: 404 });
  await expect(service.publicReservation(id, {})).rejects.toMatchObject({ status: 404 });
  await expect(service.publicReservation('wrong', token)).rejects.toMatchObject({ status: 404 });
  expect(await service.publicReservation(id, token)).toBe(r);
});
test('public responses omit secrets, money mutation fields and staff audit identity', () => {
  r.changeRequests.push({ ...change(), reviewedBy: 'secret-staff' });
  const json = JSON.stringify(service.publicState(r));
  expect(json).not.toMatch(/cancellationToken|stripe|reviewedBy|secret-staff|phoneNumber/);
  delete process.env.RESERVATION_CHANGES_ENABLED;
  expect(service.publicState(r).canRequestChange).toBe(false);
});
test('availability excludes the original reservation and blocks closed days without database reads', async () => {
  expect(await service.availability(r, '2026-10-05', 8)).toEqual({ midi: [], soir: [], closed: true });
  expect(capacity.getAvailableSlots).not.toHaveBeenCalled();
  capacity.getAvailableSlots.mockResolvedValue({ midi: [{ time: '12:30', available: true }], soir: [] });
  await service.availability(r, '2026-09-30', 8);
  expect(capacity.getAvailableSlots).toHaveBeenCalledWith('2026-09-30', 8, 50, id);
});
test('additive request history validates without changing existing reservation fields', async () => {
  const model = new ReservationModel({ ...r, customerName: 'TEST', changeRequests: [change()] });
  await expect(model.validate()).resolves.toBeUndefined();
  expect(model.deposit.amountCents).toBe(6000);
  expect(model.changeRequests[0].proposed.numberOfPeople).toBe(8);
});
