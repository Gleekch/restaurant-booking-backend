jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) })) }));
const nodemailer = require('nodemailer');
const { sendReservationChangeEmail } = require('../notificationService');
const send = nodemailer.createTransport.mock.results[0].value.sendMail;
const previous = { EMAIL_USER: process.env.EMAIL_USER, EMAIL_PASS: process.env.EMAIL_PASS };
const r = { _id: '000000000000000000000023', customerName: 'CLIENT TEST', email: 'customer@example.invalid',
  date: '2026-10-01', time: '19:30', numberOfPeople: 8, status: 'pending', cancellationToken: 'a'.repeat(48) };
const change = { from: { date: '2026-09-30', time: '12:30', numberOfPeople: 6 }, proposed: r };
beforeEach(() => { send.mockClear(); process.env.EMAIL_USER = 'staff@example.invalid'; process.env.EMAIL_PASS = 'fixture'; });
afterAll(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
test('request email tells both parties old reservation remains valid', async () => {
  await sendReservationChangeEmail(r, change, 'pending');
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.map(([mail]) => mail.to).sort()).toEqual(['customer@example.invalid', 'staff@example.invalid']);
  expect(send.mock.calls[0][0].text).toContain('reste valable');
});
test('accepted change does not falsely confirm a pending booking or demand extra deposit', async () => {
  await sendReservationChangeEmail(r, change, 'accepted');
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].text).toContain('en attente de confirmation');
  expect(send.mock.calls[0][0].text).toContain('Aucun supplement');
  expect(send.mock.calls[0][0].text).not.toContain('stripe.com');
});
