jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) })) }));
jest.mock('../../models/Reservation', () => ({ find: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../checkoutReconciliationService', () => ({ reconcileCheckout: jest.fn() }));
const nodemailer = require('nodemailer');
const Reservation = require('../../models/Reservation');
const { processReminders, sweepExpiredDeposits } = require('../reminderService');
const { reconcileCheckout } = require('../checkoutReconciliationService');
const send = nodemailer.createTransport.mock.results[0].value.sendMail;
let booking;
const beforeEnv = { EMAIL_USER: process.env.EMAIL_USER, EMAIL_PASS: process.env.EMAIL_PASS };
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-09-29T22:00:00Z'));
  process.env.EMAIL_USER = 'fixture@example.invalid'; process.env.EMAIL_PASS = 'fixture';
  booking = { _id: 'r1', status: 'confirmed', customerName: '<script>fixture</script>', email: 'fixture@example.invalid',
    date: new Date('2026-10-01'), time: '12:30', numberOfPeople: 2 };
  Reservation.find.mockResolvedValue([booking]); Reservation.findById.mockImplementation(async () => booking);
  jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
afterAll(() => { for (const [key, value] of Object.entries(beforeEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
test('only confirmed bookings tomorrow in Reunion get reminders; no stale save', async () => {
  expect((await processReminders()).sent).toBe(1);
  expect(Reservation.find).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', date: { $gte: new Date('2026-10-01'), $lt: new Date('2026-10-02') } }));
  expect(send.mock.calls[0][0].html).toContain('&lt;script&gt;');
  expect(Reservation.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', time: '12:30', reminder24hSentAt: null }), expect.anything());
});
test.each(['pending', 'cancelled'])('%s bookings never receive confirmation-like reminders', async status => {
  booking.status = status; await processReminders(); expect(send).not.toHaveBeenCalled();
});
test('a move after the scan prevents the obsolete reminder', async () => {
  Reservation.findById.mockResolvedValue({ ...booking, time: '13:00' });
  await processReminders(); expect(send).not.toHaveBeenCalled();
});
test('bounded expiry sweep delegates every transition to Stripe reconciliation', async () => {
  const limit = jest.fn().mockResolvedValue([booking]); const sort = jest.fn().mockReturnValue({ limit });
  Reservation.find.mockReturnValue({ sort }); reconcileCheckout.mockRejectedValueOnce(new Error('offline'));
  expect(await sweepExpiredDeposits()).toEqual({ cancelled: 0, resetDeposits: 0, errors: 1, scanned: 1 });
  expect(limit).toHaveBeenCalledWith(100); expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
});
