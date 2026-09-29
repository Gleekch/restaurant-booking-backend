jest.mock('../../services/reservationChangeService', () => ({
  enabled: jest.fn(), publicReservation: jest.fn(), publicState: jest.fn(), availability: jest.fn(), submit: jest.fn(), decide: jest.fn()
}));
jest.mock('../../services/notificationService', () => ({ sendReservationChangeEmail: jest.fn().mockResolvedValue(true) }));
const express = require('express');
const changes = require('../../services/reservationChangeService');
const { sendReservationChangeEmail } = require('../../services/notificationService');
const router = require('../reservationChanges');
let server, base, emit;
const booking = { _id: '000000000000000000000023', status: 'confirmed' };
const change = { requestId: '550e8400-e29b-41d4-a716-446655440000', status: 'accepted' };
const previous = { user: process.env.ADMIN_USER, pass: process.env.ADMIN_PASS };
beforeAll(async () => {
  process.env.ADMIN_USER = 'fixture'; process.env.ADMIN_PASS = 'fixture-only';
  const app = express(); app.use(express.json()); emit = jest.fn(); app.set('io', { emit });
  app.use('/api/reservations', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + server.address().port + '/api/reservations/' + booking._id;
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const [key, value] of [['ADMIN_USER', previous.user], ['ADMIN_PASS', previous.pass]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
beforeEach(() => {
  jest.clearAllMocks(); changes.enabled.mockReturnValue(true);
  changes.publicReservation.mockResolvedValue(booking);
  changes.publicState.mockReturnValue({ canRequestChange: true });
  changes.submit.mockResolvedValue({ reservation: booking, change, changed: true });
  changes.decide.mockResolvedValue({ reservation: booking, change, changed: true });
  changes.availability.mockResolvedValue({ midi: [], soir: [] });
});
const post = (path, data, authorized = false) => fetch(base + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Basic ' + Buffer.from('fixture:fixture-only').toString('base64') } : {}) },
  body: JSON.stringify(data) });

test('customer bearer link never authorizes staff acceptance', async () => {
  const response = await post('/change-requests/' + change.requestId + '/decision', { decision: 'accept', token: 'anything' });
  expect(response.status).toBe(401);
  expect(changes.decide).not.toHaveBeenCalled();
});
test('disabled rollout rejects a public request before loading a reservation', async () => {
  changes.enabled.mockReturnValue(false);
  const response = await post('/change-requests', { token: 'fixture' });
  expect(response.status).toBe(503);
  expect(changes.publicReservation).not.toHaveBeenCalled();
});
test('submission authenticates the personal link and returns no staff data', async () => {
  const proposal = { date: '2026-10-01', time: '19:30', numberOfPeople: 8 };
  const response = await post('/change-requests', { token: 'fixture', ...proposal });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(changes.publicReservation).toHaveBeenCalledWith(booking._id, 'fixture');
  expect(changes.submit).toHaveBeenCalledWith(booking, proposal);
  expect(emit).toHaveBeenCalledWith('update-reservation', booking);
  expect(sendReservationChangeEmail).toHaveBeenCalledWith(booking, change, 'pending');
  expect((await response.json()).data).toEqual({ canRequestChange: true });
});
test('availability checks the personal link before reading slots', async () => {
  const response = await fetch(base + '/change-availability?token=fixture&date=2026-10-01&people=8');
  expect(response.status).toBe(200);
  expect(changes.publicReservation).toHaveBeenCalledWith(booking._id, 'fixture');
  expect(changes.availability).toHaveBeenCalledWith(booking, '2026-10-01', '8');
});
test('authenticated staff can decide; a replay never sends a second email', async () => {
  const path = '/change-requests/' + change.requestId + '/decision';
  expect((await post(path, { decision: 'accept' }, true)).status).toBe(200);
  changes.decide.mockResolvedValue({ reservation: booking, change, changed: false });
  expect((await post(path, { decision: 'accept' }, true)).status).toBe(200);
  expect(sendReservationChangeEmail).toHaveBeenCalledTimes(1);
});
test('staff cannot inject payment or status fields through the decision endpoint', async () => {
  const response = await post('/change-requests/' + change.requestId + '/decision', { decision: 'accept', deposit: { amountCents: 0 } }, true);
  expect(response.status).toBe(400);
  expect(changes.decide).not.toHaveBeenCalled();
});
test('a duplicate active booking conflict is explicit and emits no success', async () => {
  changes.decide.mockRejectedValueOnce(Object.assign(new Error('index details'), { code: 11000 }));
  const response = await post('/change-requests/' + change.requestId + '/decision', { decision: 'accept' }, true);
  expect(response.status).toBe(409);
  expect(JSON.stringify(await response.json())).not.toContain('index details');
  expect(emit).not.toHaveBeenCalled();
});

test('unexpected database errors never expose internal details to the public', async () => {
  changes.submit.mockRejectedValueOnce(new Error('private database details'));
  const response = await post('/change-requests', { token: 'fixture' });
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('private database details');
  expect(emit).not.toHaveBeenCalled();
});
