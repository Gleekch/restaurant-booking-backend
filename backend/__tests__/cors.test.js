const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { allowedOrigins, corsOptions, corsErrorHandler } = require('../config/cors');
let server, base, reached, warnings;

beforeEach(async () => {
  reached = 0;
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const app = express();
  app.use(cors(corsOptions)); app.use(corsErrorHandler);
  app.get('/error', (_req, _res, next) => next(new Error('Unrelated error')));
  app.all('/fixture', (_req, res) => { reached++; res.json({ success: true }); });
  app.use((_error, _req, res, _next) => res.status(503).json({ success: false }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  warnings.mockRestore();
});

test.each(allowedOrigins)('existing origin remains authorized: %s', async origin => {
  const response = await fetch(base + '/fixture', { headers: { Origin: origin } });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  expect(warnings).not.toHaveBeenCalled();
});

test.each([undefined, 'file://'])('native and legacy desktop origin remains compatible: %s', async origin => {
  const response = await fetch(base + '/fixture', { headers: origin ? { Origin: origin } : {} });
  expect(response.status).toBe(200);
  expect(warnings).not.toHaveBeenCalled();
});

test('booking preflight permits existing content-type and idempotency headers', async () => {
  const origin = 'https://www.aumurmuredesflots.com';
  const response = await fetch(base + '/fixture', { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,idempotency-key'
  } });
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(response.headers.get('access-control-allow-headers')).toBe('content-type,idempotency-key');
  expect(reached).toBe(0);
});

test.each(['https://untrusted.invalid', 'https://www.aumurmuredesflots.com.evil.invalid', 'null', 'https://untrusted.lovable.app'])('unknown origin stays blocked with 403, not an internal failure: %s', async origin => {
  const response = await fetch(base + '/fixture', { method: 'POST', headers: { Origin: origin } });
  expect(response.status).toBe(403);
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ success: false, code: 'CORS_ORIGIN_DENIED', message: 'Origine non autorisee.' });
  expect(reached).toBe(0);
  expect(warnings).toHaveBeenCalledWith('[CORS_ORIGIN_DENIED]', JSON.stringify({ origin, method: 'POST' }));
});

test('denied preflight never reaches the business route', async () => {
  const response = await fetch(base + '/fixture', { method: 'OPTIONS', headers: {
    Origin: 'https://untrusted.invalid', 'Access-Control-Request-Method': 'POST'
  } });
  expect(response.status).toBe(403); expect(reached).toBe(0);
});

test('CORS diagnostics contain no credentials, private paths, query tokens or body', async () => {
  const response = await fetch(base + '/fixture?token=PRIVATE_QUERY', { method: 'POST',
    headers: { Origin: 'https://user:PRIVATE_PASSWORD@untrusted.invalid/private/path?token=PRIVATE_ORIGIN', Authorization: 'Bearer PRIVATE_AUTH' },
    body: 'PRIVATE_BODY'
  });
  expect(response.status).toBe(403);
  expect(warnings).toHaveBeenCalledWith('[CORS_ORIGIN_DENIED]', JSON.stringify({ origin: 'https://untrusted.invalid', method: 'POST' }));
  expect(JSON.stringify(warnings.mock.calls)).not.toMatch(/PRIVATE|private\/path/);
});

test.each(['not a URL', 'x'.repeat(513)])('malformed origins are bounded in diagnostics', async origin => {
  const response = await fetch(base + '/fixture', { headers: { Origin: origin } });
  expect(response.status).toBe(403);
  expect(warnings).toHaveBeenCalledWith('[CORS_ORIGIN_DENIED]', JSON.stringify({ origin: '[invalid]', method: 'GET' }));
});

test('unrelated errors are not hidden as CORS failures', async () => {
  expect((await fetch(base + '/error')).status).toBe(503);
  expect(warnings).not.toHaveBeenCalled();
});

test('server installs CORS diagnostics before business routes, preserving the raw webhook order', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  expect(source).toContain("require('./config/cors')");
  expect(source.indexOf('app.use(corsErrorHandler);')).toBeGreaterThan(source.indexOf('app.use(cors(corsOptions));'));
  expect(source.indexOf('app.use(corsErrorHandler);')).toBeLessThan(source.indexOf("app.use('/api/webhooks'"));
  expect(source.indexOf("app.use('/api/webhooks'")).toBeLessThan(source.indexOf('app.use(express.json())'));
});
