jest.mock('../../models/Reservation', () => ({ findOneAndUpdate: jest.fn() }));
const Reservation = require('../../models/Reservation');
const { deliver } = require('../clientNotificationService');
let booking, send;
const env = { EMAIL_USER: process.env.EMAIL_USER, EMAIL_PASS: process.env.EMAIL_PASS };
beforeEach(() => {
  jest.clearAllMocks(); process.env.EMAIL_USER = 'fixture@example.invalid'; process.env.EMAIL_PASS = 'fixture';
  booking = { _id: 'r1', status: 'confirmed', date: new Date('2026-10-01'), time: '12:30', numberOfPeople: 2, email: 'fixture@example.invalid' };
  send = jest.fn().mockResolvedValue({}); Reservation.findOneAndUpdate.mockResolvedValue(booking);
});
afterAll(() => { for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
test('delivery state is persisted without writing any reservation or payment fields', async () => {
  expect(await deliver(booking, 'confirmed', send)).toEqual({ sent: true });
  expect(booking.clientNotification.state).toBe('sent');
  for (const [, update] of Reservation.findOneAndUpdate.mock.calls) expect(Object.keys(update.$set)).toEqual(['clientNotification']);
});
test('SMTP failure is persisted and remains visible without rolling back the booking', async () => {
  send.mockRejectedValue(new Error('provider secret must not be stored'));
  await expect(deliver(booking, 'confirmed', send)).rejects.toThrow();
  expect(booking.clientNotification).toEqual(expect.objectContaining({ state: 'failed', code: 'EMAIL_SEND_FAILED' }));
  expect(booking.status).toBe('confirmed');
});
test('an outdated or already-sent notification does not send again', async () => {
  Reservation.findOneAndUpdate.mockResolvedValue(null);
  expect(await deliver(booking, 'confirmed', send)).toEqual({ skipped: true }); expect(send).not.toHaveBeenCalled();
});
test('missing SMTP does not appear as a successful delivery', async () => {
  delete process.env.EMAIL_PASS;
  await expect(deliver(booking, 'confirmed', send)).rejects.toThrow('SMTP_NOT_CONFIGURED'); expect(send).not.toHaveBeenCalled();
  expect(booking.clientNotification.state).toBe('failed');
});
test('a booking without email is retained without attempting SMTP', async () => {
  booking.email = ''; expect(await deliver(booking, 'confirmed', send)).toEqual({ skipped: true }); expect(send).not.toHaveBeenCalled();
});
