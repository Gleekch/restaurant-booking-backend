const express = require('express');
const rateLimit = require('express-rate-limit');
const { apiKey } = require('../middleware/auth');
const changes = require('../services/reservationChangeService');
const { sendReservationChangeEmail } = require('../services/notificationService');
const router = express.Router();
const readLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });
const writeLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });

function responseError(res, error) {
  if (error.code === 11000) return res.status(409).json({ success: false, message: 'Une reservation existe deja a cette date. Appelez le restaurant.' });
  if ([400, 404, 409].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message });
  res.status(500).json({ success: false, message: 'La modification ne peut pas etre traitee pour le moment. Rechargez la page avant de reessayer.' });
}
function requireEnabled(_req, res, next) {
  if (!changes.enabled()) return res.status(503).json({ success: false, message: 'Les modifications en ligne ne sont pas encore disponibles. Appelez le restaurant.' });
  next();
}
function noStore(_req, res, next) { res.set('Cache-Control', 'private, no-store'); next(); }

router.get('/:id/change-availability', noStore, readLimit, requireEnabled, async (req, res) => {
  try {
    const r = await changes.publicReservation(req.params.id, req.query.token);
    res.json({ success: true, data: await changes.availability(r, req.query.date, req.query.people) });
  } catch (error) { responseError(res, error); }
});

router.post('/:id/change-requests', noStore, writeLimit, requireEnabled, async (req, res) => {
  try {
    const { token, ...proposal } = req.body || {};
    const r = await changes.publicReservation(req.params.id, token);
    const result = await changes.submit(r, proposal);
    if (result.changed) {
      req.app.get('io')?.emit('update-reservation', result.reservation);
      sendReservationChangeEmail(result.reservation, result.change, 'pending').catch(() => console.error('Email demande de modification non envoye'));
    }
    res.json({ success: true, message: 'Demande transmise au restaurant. Votre reservation actuelle reste valable jusqu a son acceptation.',
      data: changes.publicState(result.reservation) });
  } catch (error) { responseError(res, error); }
});

router.post('/:id/change-requests/:requestId/decision', noStore, apiKey, async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).some(key => key !== 'decision')) {
      return res.status(400).json({ success: false, message: 'Decision invalide.' });
    }
    const result = await changes.decide(req.params.id, req.params.requestId, req.body.decision);
    if (result.changed) {
      req.app.get('io')?.emit('update-reservation', result.reservation);
      sendReservationChangeEmail(result.reservation, result.change, result.change.status).catch(() => console.error('Email decision de modification non envoye'));
    }
    res.json({ success: true, message: result.change.status === 'accepted'
      ? 'Modification acceptee. Arrhes deja payees conservees, sans supplement.'
      : 'Demande refusee. La reservation actuelle est conservee.', data: result.reservation });
  } catch (error) { responseError(res, error); }
});

module.exports = router;
