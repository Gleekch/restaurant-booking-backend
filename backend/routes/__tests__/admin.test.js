const express = require('express');
const adminRouter = require('../admin');
const { apiKey } = require('../../middleware/auth');

test('install metadata is public but admin page, configuration and reservations remain private', async () => {
  const initialEnv = { ...process.env };
  process.env.ADMIN_USER = 'unit-admin';
  process.env.ADMIN_PASS = 'unit-only';
  process.env.API_KEY = 'unit-only-do-not-disclose';
  const app = express();
  app.use('/admin', adminRouter);
  app.get('/api/reservations', apiKey, (_req, res) => res.json({ success: true, data: [] }));
  const server = await new Promise(resolve => {
    const owned = app.listen(0, '127.0.0.1', () => resolve(owned));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const url of ['/admin/', '/admin/config.js', '/admin/app.js', '/api/reservations']) {
      const response = await fetch(origin + url);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Basic realm="Au Murmure des Flots - Admin"');
      await response.arrayBuffer();
    }
    for (const url of ['/admin/manifest.json', '/admin/icon-192.png', '/admin/icon-512.png']) {
      const response = await fetch(origin + url);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const headers = { Authorization: 'Basic ' + Buffer.from('unit-admin:unit-only').toString('base64') };
    const config = await fetch(origin + '/admin/config.js', { headers });
    expect(config.status).toBe(200);
    expect(config.headers.get('cache-control')).toContain('no-store');
    expect(await config.text()).toBe('window.__API_KEY = "";');
    const reservations = await fetch(origin + '/api/reservations', { headers });
    expect(reservations.status).toBe(200);
    expect((await reservations.json()).success).toBe(true);
  } finally {
    process.env = initialEnv;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
