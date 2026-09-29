jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) })) }));
jest.mock('../clientNotificationService', () => ({ deliver: jest.fn(async (_r, _kind, send) => send()) }));
const nodemailer = require('nodemailer');
const { deliver } = require('../clientNotificationService');
const { sendNotifications } = require('../notificationService');
const send = nodemailer.createTransport.mock.results[0].value.sendMail;
const env = { EMAIL_USER: process.env.EMAIL_USER, EMAIL_PASS: process.env.EMAIL_PASS };
beforeEach(() => {
  jest.clearAllMocks(); process.env.EMAIL_USER = 'staff@example.invalid'; process.env.EMAIL_PASS = 'fixture';
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
test.each(['pending', 'confirmed'])('new %s booking uses the matching tracked client email', async status => {
  const booking = { _id: 'r1', customerName: 'FIXTURE', email: 'client@example.invalid', date: new Date('2026-10-01'), time: '12:30', numberOfPeople: 2, status };
  await sendNotifications(booking);
  expect(deliver).toHaveBeenCalledWith(booking, status, expect.any(Function), undefined);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: booking.email }));
});
