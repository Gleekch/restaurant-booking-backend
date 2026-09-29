const express = require('express');
const { rateLimit } = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { configureProxy } = require('../config/proxy');
let server, base, errors;

async function start(render, limiter = true) {
  const app = express(); configureProxy(app, { RENDER: String(render) });
  if (limiter) app.use(rateLimit({ windowMs: 60000, limit: 2 }));
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const request = ip => fetch(base, { headers: { 'X-Forwarded-For': ip } });
beforeEach(() => { errors = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null; }
  errors.mockRestore();
});

test('separate clients behind Render do not consume one shared limiter', async () => {
  await start(true);
  for (let n = 1; n <= 21; n++) {
    const response = await request(`203.0.113.${n}, 104.16.1.1, 10.1.0.2`);
    expect(response.status).toBe(200);
    expect((await response.json()).ip).toBe(`203.0.113.${n}`);
  }
  expect(errors).not.toHaveBeenCalled();
});

test('forged prefixes cannot evade the same client budget', async () => {
  await start(true);
  for (let n = 1; n <= 3; n++) {
    const response = await request(`198.51.100.${n}, 203.0.113.20, 104.16.1.1, 10.1.0.2`);
    expect(response.status).toBe(n === 3 ? 429 : 200);
  }
  expect(errors).not.toHaveBeenCalled();
});

test('forwarded addresses are ignored outside Render', async () => {
  await start(false, false);
  expect((await (await request('203.0.113.1')).json()).ip).toBe('127.0.0.1');
});

test('IPv6 Cloudflare hop is trusted, the public client is not', async () => {
  await start(true);
  expect((await (await request('198.51.100.1, 2001:db8::20, 2606:4700::1')).json()).ip).toBe('2001:db8::20');
  expect(errors).not.toHaveBeenCalled();
});

test('an untrusted public hop cannot forward an arbitrary client IP', async () => {
  await start(true);
  expect((await (await request('198.51.100.8, 203.0.113.50')).json()).ip).toBe('203.0.113.50');
});

test('missing or false Render environment never trusts forwarded headers', () => {
  for (const env of [{}, { RENDER: 'false' }]) {
    const app = express(); configureProxy(app, env);
    expect(app.get('trust proxy')).toBe(false);
  }
});

test('server configures proxy before mounting the reservation limiter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  expect(source).toContain("require('./config/proxy')");
  expect(source.indexOf('configureProxy(app);')).toBeGreaterThan(-1);
  expect(source.indexOf('configureProxy(app);')).toBeLessThan(source.indexOf('const reservationLimiter'));
});
