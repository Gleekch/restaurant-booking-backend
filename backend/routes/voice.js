const express = require('express');
const router = express.Router();

// Service vocal désactivé - Twilio non configuré
router.post('/incoming', async (req, res) => {
  res.status(503).json({ 
    error: 'Service vocal temporairement indisponible',
    message: 'Le service de réservation vocale n\'est pas configuré'
  });
});

router.post('/handle-selection', async (req, res) => {
  res.status(503).json({ 
    error: 'Service vocal temporairement indisponible',
    message: 'Le service de réservation vocale n\'est pas configuré'
  });
});

router.post('/process-reservation', async (req, res) => {
  res.status(503).json({ 
    error: 'Service vocal temporairement indisponible',
    message: 'Le service de réservation vocale n\'est pas configuré'
  });
});

router.post('/confirm-people', async (req, res) => {
  res.status(503).json({ 
    error: 'Service vocal temporairement indisponible',
    message: 'Le service de réservation vocale n\'est pas configuré'
  });
});

router.post('/transcription-callback', async (req, res) => {
  res.status(503).json({ 
    error: 'Service vocal temporairement indisponible',
    message: 'Le service de réservation vocale n\'est pas configuré'
  });
});

module.exports = router;