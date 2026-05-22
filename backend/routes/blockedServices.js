const express = require('express');
const router = express.Router();
const BlockedService = require('../models/BlockedService');
const { parseDateInput } = require('../services/capacityService');
const { apiKey } = require('../middleware/auth');
const nodemailer = require('nodemailer');

const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 465,
  secure: (parseInt(process.env.EMAIL_PORT) || 465) === 465,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  tls: { rejectUnauthorized: false }
});

async function sendBlockNotification(date, service) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const dateStr = new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const serviceLabel = service === 'midi' ? 'Midi ☀️' : service === 'soir' ? 'Soir 🌙' : 'Toute la journée';
  await emailTransporter.sendMail({
    from: `"Au Murmure des Flots" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: `🔒 Service marqué complet — ${serviceLabel} ${dateStr}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;">
        <h2 style="color:#1c1917;">Service marqué complet</h2>
        <p style="color:#555;font-size:16px;">Le service suivant a été fermé aux réservations en ligne :</p>
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:4px 0;font-size:15px;color:#111;"><strong>Date :</strong> ${dateStr}</p>
          <p style="margin:4px 0;font-size:15px;color:#111;"><strong>Service :</strong> ${serviceLabel}</p>
        </div>
        <p style="color:#555;font-size:14px;">Pour débloquer, utilisez le bouton "🔓 Débloquer" dans l'app ou l'admin web.</p>
      </div>
    `
  });
}

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

    sendBlockNotification(normalizedDate, service).catch(err =>
      console.error('Erreur email blocage:', err.message)
    );

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
