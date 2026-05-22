const express = require('express');
const router = express.Router();
const BlockedService = require('../models/BlockedService');
const { parseDateInput } = require('../services/capacityService');
const { apiKey } = require('../middleware/auth');

// Lister les blocages (public — consulté par /availability)
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    const query = {};
    if (date) {
      const { year, month, day } = parseDateInput(date);
      const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      const end   = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
      query.date = { $gte: start, $lte: end };
    }
    const blocked = await BlockedService.find(query);
    res.json({ success: true, data: blocked });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Bloquer un service (staff uniquement)
router.post('/', apiKey, async (req, res) => {
  try {
    const { date, service, reason } = req.body;
    const { year, month, day } = parseDateInput(date);
    const normalizedDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));

    const existing = await BlockedService.findOne({
      date: { $gte: new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)),
               $lte: new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)) },
      service
    });

    if (existing) {
      return res.status(409).json({ success: false, message: 'Ce service est déjà bloqué pour cette date.' });
    }

    const blocked = new BlockedService({ date: normalizedDate, service, reason: reason || '' });
    await blocked.save();
    res.status(201).json({ success: true, data: blocked });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Débloquer un service (staff uniquement)
router.delete('/', apiKey, async (req, res) => {
  try {
    const { date, service } = req.body;
    const { year, month, day } = parseDateInput(date);
    const result = await BlockedService.findOneAndDelete({
      date: { $gte: new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)),
               $lte: new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)) },
      service
    });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Aucun blocage trouvé.' });
    }
    res.json({ success: true, message: 'Service débloqué.' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
