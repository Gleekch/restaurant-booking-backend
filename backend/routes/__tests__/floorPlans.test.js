jest.mock('../../services/floorPlanService', () => ({ context: jest.fn(() => ({})), get: jest.fn(), save: jest.fn() }));
const express = require('express');
const service = require('../../services/floorPlanService');
let server, origin;
const oldKey = process.env.API_KEY;
beforeAll(async () => {
  process.env.API_KEY = 'floor-fixture-only';
  const app = express(); app.use(express.json()); app.use('/api/floor-plans', require('../floorPlans'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); origin = `http://127.0.0.1:${server.address().port}/api/floor-plans`;
});
afterAll(async () => { if (oldKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = oldKey; await new Promise(resolve => server.close(resolve)); });
beforeEach(() => { jest.clearAllMocks(); service.get.mockResolvedValue({ revision: 0 }); service.save.mockResolvedValue({ revision: 1 }); });
test.each(['GET', 'PUT'])('unauthenticated %s is refused', async method => {
  const res = await fetch(origin + '/template', { method }); expect(res.status).toBe(401); expect(service.get).not.toHaveBeenCalled(); expect(service.save).not.toHaveBeenCalled();
});
test('authenticated response is private and never cached', async () => {
  const res = await fetch(origin + '/service?date=2026-09-30&service=midi', { headers: { 'X-API-Key': 'floor-fixture-only' } });
  expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('private, no-store'); expect(service.context).toHaveBeenCalledWith('2026-09-30', 'midi', false);
});
test('conflict is surfaced to the operator', async () => {
  service.save.mockRejectedValueOnce(Object.assign(new Error('Recharger le plan'), { status: 409 }));
  const res = await fetch(origin + '/template', { method: 'PUT', headers: { 'X-API-Key': 'floor-fixture-only', 'Content-Type': 'application/json' }, body: '{}' });
  expect(res.status).toBe(409); expect((await res.json()).message).toBe('Recharger le plan');
});
test('database failure is not a false success and exposes no connection details', async () => {
  service.get.mockRejectedValueOnce(new Error('mongodb://secret-host/password'));
  const res = await fetch(origin + '/template', { headers: { 'X-API-Key': 'floor-fixture-only' } });
  expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain('secret-host');
});
