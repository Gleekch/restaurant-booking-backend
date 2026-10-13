jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) })) }));
jest.mock('../clientNotificationService', () => ({ deliver: jest.fn(async (_r, _kind, send) => send()) }));
const nodemailer = require('nodemailer');
const { sendConfirmationEmailToClient } = require('../notificationService');
const { deliver } = require('../clientNotificationService');
const send = nodemailer.createTransport.mock.results[0].value.sendMail;
const originalEnv = { ...process.env };
const booking = { _id: 'fixture', email: 'client@example.invalid', customerName: '<script>TEST</script>', date: '2026-10-14', time: '19:30', numberOfPeople: 2, status: 'confirmed', cancellationToken: 'test-only', specialRequests: '<img src=x onerror=alert(1)>' };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EMAIL_USER = 'staff@example.invalid'; process.env.EMAIL_PASS = 'fixture';
  process.env.PUBLIC_SITE_URL = 'https://restaurant.example.invalid';
  process.env.RESERVATION_CHANGES_ENABLED = 'false';
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = originalEnv; });
test('confirmation uses the real logo palette, accessible layout and unchanged dispatch', async () => {
  await sendConfirmationEmailToClient(booking);
  const mail = send.mock.calls[0][0];
  expect(deliver).toHaveBeenCalledWith(booking, 'confirmed', expect.any(Function), undefined);
  expect(mail.to).toBe(booking.email);
  for (const color of ['#27777e', '#b79a6c', '#114a55']) expect(mail.html).toContain(color);
  expect(mail.html).not.toContain('#764ba2');
  expect(mail.html).toContain('role="presentation"');
  expect(mail.html).toContain('assets/logo.png');
  expect(mail.html).toContain('19:30');
  expect(mail.html).toContain('&lt;script&gt;TEST&lt;/script&gt;');
  expect(mail.html).not.toContain('<img src=x');
  expect(mail.html).toContain('https://restaurant.example.invalid/annuler?id=fixture&token=test-only');
  expect(mail.html).not.toContain('Arrhes reçues');
});
test.each(['pending', 'refunded', 'failed'])('does not invent paid arrhes for deposit %s', async status => {
  await sendConfirmationEmailToClient({ ...booking, deposit: { status, amountCents: 2000, currency: 'eur' } });
  expect(send.mock.calls[0][0].html).not.toContain('Arrhes reçues');
});
test('keeps paid amount and refund deadline when arrhes are actually paid', async () => {
  process.env.DEPOSIT_CANCELLATION_HOURS = '24';
  await sendConfirmationEmailToClient({ ...booking, deposit: { status: 'paid', amountCents: 2000, currency: 'eur' } });
  expect(send.mock.calls[0][0].html).toContain('Arrhes reçues');
  expect(send.mock.calls[0][0].html).toContain('24h');
  expect(send.mock.calls[0][0].html).toContain('déduit de votre addition');
});
test('management label still follows the existing feature flag', async () => {
  process.env.RESERVATION_CHANGES_ENABLED = 'true';
  await sendConfirmationEmailToClient(booking);
  expect(send.mock.calls[0][0].html).toContain('Gérer ma réservation');
});
