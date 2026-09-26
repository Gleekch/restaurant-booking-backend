const express = require('express');
const path = require('path');
const { basicAuth } = require('../middleware/auth');

const router = express.Router();
const directory = path.join(__dirname, '../public/admin');

// Install metadata contains no credentials or customer data. Some mobile
// browsers omit HTTP credentials when fetching the web app manifest/icons.
router.get(['/manifest.json', '/icon-192.png', '/icon-512.png'], (req, res) => {
  res.sendFile(path.join(directory, path.basename(req.path)));
});

router.use(basicAuth);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.send('window.__API_KEY = "";');
});
router.use(express.static(directory, { cacheControl: false }));

module.exports = router;
