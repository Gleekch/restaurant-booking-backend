const http = require('http');
const express = require('express');
jest.mock('../../services/notificationService', () => ({ verifyEmailConnection: jest.fn() }));
const { verifyEmailConnection } = require('../../services/notificationService');
const router = require('../settings');

describe('deployment readiness routes', () => {
  const original = { ...process.env };
  let server;
  let base;
  beforeAll(async () => {
    const app = express();
    app.use('/api/settings', router);
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/settings`;
  });
  afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
  beforeEach(() => {
    process.env = { ...original, NODE_ENV: 'production', API_KEY: 'test-operator',
      DEPOSIT_ENABLED: 'false', DEPOSIT_ACTIVATION_CONFIRMED: 'false',
      STRIPE_SECRET_KEY: 'sk_test_unit', STRIPE_WEBHOOK_SECRET: 'whsec_unit',
      EMAIL_USER: 'operator@example.test', EMAIL_PASS: 'mock-password' };
    verifyEmailConnection.mockReset();
  });
  afterEach(() => { process.env = original; });
  const read = (path, authenticated = false) => fetch(base + path, {
    headers: authenticated ? { 'X-API-Key': 'test-operator' } : {}
  });
  test('public policy exposes business conditions, never credentials', async () => {
    const response = await read('/deposit-policy');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual(['cancellationHours', 'currency', 'enabled', 'minParty', 'perPersonCents']);
    expect(body.data.enabled).toBe(false);
  });
  test('readiness is authenticated', async () => {
    expect((await read('/production-readiness')).status).toBe(401);
    expect(verifyEmailConnection).not.toHaveBeenCalled();
  });
  test('SMTP verification is explicit and sends no mail', async () => {
    await read('/production-readiness', true);
    expect(verifyEmailConnection).not.toHaveBeenCalled();
    verifyEmailConnection.mockResolvedValue(true);
    const response = await read('/production-readiness?verifySmtp=1', true);
    expect((await response.json()).data.smtp.verified).toBe(true);
    expect(verifyEmailConnection).toHaveBeenCalledTimes(1);
  });
  test('SMTP provider errors never expose their message', async () => {
    verifyEmailConnection.mockRejectedValue(Object.assign(new Error('sensitive provider message'), { code: 'EAUTH' }));
    const response = await read('/production-readiness?verifySmtp=1', true);
    const text = await response.text();
    expect(text).toContain('EAUTH');
    expect(text).not.toContain('sensitive');
    expect(text).not.toContain('mock-password');
  });
  test('invalid activation cannot be announced as free booking', async () => {
    process.env.DEPOSIT_ENABLED = 'true';
    process.env.DEPOSIT_ACTIVATION_CONFIRMED = 'true';
    expect((await read('/deposit-policy')).status).toBe(503);
  });
});
