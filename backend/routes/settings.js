const express = require('express');
const router = express.Router();

// Read-only compatibility view: operational configuration has one source of truth.
const { getServiceBounds, CAPACITY } = require('../services/capacityService');
const minutesToTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const hours = Object.fromEntries(days.map((name, index) => {
  const date = '2026-10-' + String(4 + index).padStart(2, '0');
  const bounds = getServiceBounds(date);
  const closed = index === 1 || index === 2;
  return [name, { closed,
    lunch: closed ? null : minutesToTime(bounds.midiStart) + '-' + minutesToTime(bounds.midiEnd),
    dinner: closed || index === 0 ? null : minutesToTime(bounds.soirStart) + '-' + minutesToTime(bounds.soirEnd)
  }];
}));
const settings = {
  restaurant: { name: 'Au Murmure des Flots', address: '44 rue du General Lambert, 97436 Saint-Leu',
    phone: process.env.RESTAURANT_PHONE || '0262266719' },
  hours,
  capacity: { totalSeats: CAPACITY, onlineSeats: Number(process.env.ONLINE_CAPACITY) || 50,
    maxGroupSize: Number(process.env.ONLINE_BOOKING_LIMIT) || 10, arrivalsPer30Minutes: 20 },
  bookingRules: { cancellationHours: Number(process.env.DEPOSIT_CANCELLATION_HOURS) || 24, timeSlotDuration: 15 },
  readOnly: true
};

// Obtenir les paramètres
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: settings
  });
});

// Obtenir les horaires
router.get('/hours', (req, res) => {
  res.json({
    success: true,
    data: settings.hours
  });
});

// Obtenir les horaires d'un jour spécifique
router.get('/hours/:day', (req, res) => {
  const day = req.params.day.toLowerCase();
  if (settings.hours[day]) {
    res.json({
      success: true,
      data: settings.hours[day]
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'Jour non valide'
    });
  }
});

// Vérifier la disponibilité
// Disponibilité — délègue à capacityService (mêmes règles que POST /api/reservations)
// DEPRECATED : utiliser GET /api/reservations/availability à la place
router.post('/availability', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { date, time, numberOfPeople } = req.body;
    require('../services/capacityService').timeToMinutes(time);
    const data = await require('../services/availabilityService').getPublicAvailability(date, numberOfPeople ?? 2);
    const slot = [...data.midi, ...data.soir].find(entry => entry.time === time);
    res.json({ success: true, available: Boolean(slot?.available),
      message: slot?.available ? 'Creneau disponible' : 'Creneau indisponible. Merci de choisir un autre horaire.',
      ...(slot || {}), data });
  } catch (error) {
    res.status(400).json({ success: false, available: false, message: error.message });
  }
});

// Mettre à jour les paramètres (protégé par API key)
const { apiKey } = require('../middleware/auth');
const { getPaymentReadiness, getPublicDepositPolicy } = require('../services/paymentService');
const networkSalt = require('crypto').randomBytes(32);

router.get('/network-readiness', apiKey, (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, data: {
    render: process.env.RENDER === 'true',
    clientDiffersFromPeer: req.ip !== req.socket.remoteAddress,
    forwardedHops: req.ips.length,
    clientFingerprint: require('crypto').createHmac('sha256', networkSalt).update(req.ip || '').digest('hex').slice(0, 24)
  } });
});

router.get('/service-rhythm', apiKey, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    require('../services/capacityService').parseDateInput(req.query.date);
  } catch {
    return res.status(400).json({ success: false, message: 'Date invalide.' });
  }
  try {
    const data = await require('../services/serviceRhythmService').getServiceRhythm(req.query.date);
    res.json({ success: true, data });
  } catch {
    res.status(503).json({ success: false, message: 'Charge des vagues indisponible. Reessayez avant de vous y fier.' });
  }
});

router.get('/deposit-policy', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const readiness = getPaymentReadiness();
  if (readiness.enabled && readiness.activationConfirmed && !readiness.readyToActivate) {
    return res.status(503).json({ success: false, message: 'Paiement temporairement indisponible' });
  }
  res.json({ success: true, data: getPublicDepositPolicy() });
});

router.get('/production-readiness', apiKey, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const payment = getPaymentReadiness();
  let smtp = { configured: Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS), verified: false };
  if (req.query.verifySmtp === '1') {
    try {
      if (!smtp.configured) throw Object.assign(new Error('SMTP not configured'), { code: 'NOT_CONFIGURED' });
      await require('../services/notificationService').verifyEmailConnection();
      smtp.verified = true;
    } catch (error) {
      // Never return provider messages, credentials or email addresses.
      smtp.code = ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'NOT_CONFIGURED'].includes(error.code)
        ? error.code : 'SMTP_CHECK_FAILED';
    }
  }
  res.json({ success: true, data: { payment, policy: getPublicDepositPolicy(), smtp } });
});

router.put('/', apiKey, (_req, res) => {
  res.status(409).json({ success: false,
    message: 'Configuration en lecture seule. Aucune modification en memoire ne sera appliquee. Utilisez les reglages du serveur et les fermetures de service.' });
});

module.exports = router;
