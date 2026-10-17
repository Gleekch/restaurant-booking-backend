jest.mock('../../models/BlockedService', () => {
  const Model = jest.fn(function (fields) { Object.assign(this, fields); this.save = Model.save; });
  Object.assign(Model, { save: jest.fn().mockResolvedValue(), findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]), findOneAndDelete: jest.fn().mockResolvedValue({}) });
  return Model;
});
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({}) }) }));
const express = require('express');
const BlockedService = require('../../models/BlockedService');
const { requireServiceBlockApproval } = require('../../middleware/auth');
let server, base;
const savedEnv = { ...process.env };
beforeAll(async () => {
  process.env.API_KEY = 'fictional-staff-key'; process.env.ADMIN_USER = 'fictional-admin'; process.env.ADMIN_PASS = 'fictional-admin-password';
  delete process.env.SERVICE_BLOCK_PASSWORD;
  const app = express(); app.use(express.json()); app.use('/api/blocked-services', require('../blockedServices'));
  server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  base = 'http://127.0.0.1:' + server.address().port;
});
afterAll(async () => { process.env = savedEnv; await new Promise(resolve => server.close(resolve)); });
beforeEach(() => { jest.clearAllMocks(); process.env.ADMIN_PASS = 'fictional-admin-password'; delete process.env.SERVICE_BLOCK_PASSWORD; });
async function post(body, headers = { 'X-API-Key': 'fictional-staff-key' }) {
  return fetch(base + '/api/blocked-services', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ date: '2026-10-21', service: 'midi', reason: 'Complet', ...body }) });
}
test('ordinary staff key cannot mark a service full without the approval password', async () => {
  expect((await post({})).status).toBe(403); expect(BlockedService.findOne).not.toHaveBeenCalled(); expect(BlockedService.save).not.toHaveBeenCalled();
});
test('cached Basic login does not replace per-action approval', async () => {
  const headers = { Authorization: 'Basic ' + Buffer.from('fictional-admin:fictional-admin-password').toString('base64') };
  expect((await post({}, headers)).status).toBe(403); expect(BlockedService.save).not.toHaveBeenCalled();
});
test.each(['wrong', '', { password: 'fictional-admin-password' }, 'x'.repeat(1025)])('invalid approval is rejected before all model access (%s)', async approvalPassword => {
  expect((await post({ approvalPassword })).status).toBe(403); expect(BlockedService.findOne).not.toHaveBeenCalled(); expect(BlockedService.save).not.toHaveBeenCalled();
});
test('valid per-action approval saves only service fields, not password', async () => {
  const response = await post({ approvalPassword: 'fictional-admin-password' });
  expect(response.status).toBe(201); expect(BlockedService.save).toHaveBeenCalledTimes(1);
  expect(BlockedService.mock.calls[0][0]).not.toHaveProperty('approvalPassword');
  expect(JSON.stringify(await response.json())).not.toContain('fictional-admin-password');
  expect((await post({})).status).toBe(403);
});
test('password alone does not bypass ordinary staff authentication', async () => {
  expect((await post({ approvalPassword: 'fictional-admin-password' }, {})).status).toBe(401); expect(BlockedService.save).not.toHaveBeenCalled();
});
test('separate configured supervisor password supersedes the login password', async () => {
  process.env.SERVICE_BLOCK_PASSWORD = 'fictional-supervisor';
  expect((await post({ approvalPassword: 'fictional-supervisor' })).status).toBe(201);
  expect((await post({ approvalPassword: 'fictional-admin-password' })).status).toBe(403);
});
test('missing server secret fails closed', () => {
  delete process.env.ADMIN_PASS;
  const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() }, next = jest.fn();
  requireServiceBlockApproval({ body: { approvalPassword: 'anything' } }, res, next);
  expect(res.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled();
});
test('approval is removed from request body before business handling', () => {
  const req = { body: { approvalPassword: 'fictional-admin-password', date: '2026-10-21' } }, next = jest.fn();
  requireServiceBlockApproval(req, { setHeader: jest.fn() }, next);
  expect(next).toHaveBeenCalledTimes(1); expect(req.body).not.toHaveProperty('approvalPassword');
});
test('public read access is unchanged and never creates a block', async () => {
  expect((await fetch(base + '/api/blocked-services?date=2026-10-21')).status).toBe(200); expect(BlockedService.save).not.toHaveBeenCalled();
});
test('failed attempts are rate limited without creating blocks', async () => {
  let response;
  for (let i = 0; i < 12; i++) response = await post({ approvalPassword: 'wrong' });
  expect(response.status).toBe(429); expect(BlockedService.save).not.toHaveBeenCalled();
});
