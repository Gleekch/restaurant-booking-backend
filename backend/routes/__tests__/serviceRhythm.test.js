jest.mock('../../services/serviceRhythmService', () => ({ getServiceRhythm: jest.fn() }));
const express = require('express');
const { getServiceRhythm } = require('../../services/serviceRhythmService');
const router = require('../settings');
let server, origin;
const saved = { user: process.env.ADMIN_USER, pass: process.env.ADMIN_PASS };
beforeAll(async () => {
  process.env.ADMIN_USER = 'fixture'; process.env.ADMIN_PASS = 'fixture-only';
  const app = express(); app.use('/api/settings', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
});
afterAll(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  for (const [key, value] of [['ADMIN_USER', saved.user], ['ADMIN_PASS', saved.pass]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
beforeEach(() => { jest.clearAllMocks(); getServiceRhythm.mockResolvedValue({ date: '2026-09-30', services: {} }); });
const get = (date, auth = true) => fetch(origin + '/api/settings/service-rhythm?date=' + date, { headers: auth
  ? { Authorization: 'Basic ' + Buffer.from('fixture:fixture-only').toString('base64') } : {} });

test('unauthorized users cannot read the staff load', async () => {
  expect((await get('2026-09-30', false)).status).toBe(401);
  expect(getServiceRhythm).not.toHaveBeenCalled();
});
test('valid operator sees no-cache snapshot for the requested date', async () => {
  const response = await get('2026-09-30');
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await response.json()).data.date).toBe('2026-09-30');
});
test('invalid date fails before querying the database', async () => {
  expect((await get('2026-02-30')).status).toBe(400); expect(getServiceRhythm).not.toHaveBeenCalled();
});
test('outage is explicit and never returns fake zero load or internal details', async () => {
  getServiceRhythm.mockRejectedValueOnce(new Error('private database details'));
  const response = await get('2026-09-30'); expect(response.status).toBe(503);
  const data = await response.json(); expect(data.success).toBe(false);
  expect(data.data).toBeUndefined(); expect(data.message).not.toContain('private database');
});
