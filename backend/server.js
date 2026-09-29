const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const rateLimit = require('express-rate-limit');
const { apiKey, socketAuth } = require('./middleware/auth');
require('dotenv').config();
const { startReminderScheduler } = require('./services/reminderService');
const { startRefundReconciliationScheduler } = require('./services/depositRefundService');
const Reservation = require('./models/Reservation');
const { isDepositSystemActive } = require('./services/paymentService');
const { configureProxy } = require('./config/proxy');
const { allowedOrigins, corsOptions, corsErrorHandler } = require('./config/cors');

const app = express();
configureProxy(app);
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors(corsOptions));
app.use(corsErrorHandler);

// ─── Webhook Stripe ───
// DOIT être monté AVANT express.json() : la vérification de signature
// Stripe exige le corps brut de la requête (le routeur applique express.raw).
app.use('/api/webhooks', require('./routes/webhooks'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ok' : 'degraded',
    database: databaseReady ? 'connected' : 'unavailable',
    payments: isDepositSystemActive() ? 'enabled' : 'disabled',
    commit: process.env.RENDER_GIT_COMMIT
      ? process.env.RENDER_GIT_COMMIT.slice(0, 7)
      : 'local'
  });
});
io.use(socketAuth);

// Rate limiting — anti-spam sur la création de réservations publiques
const reservationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Trop de requêtes, réessayez dans 15 minutes' }
});

app.use('/admin', require('./routes/admin'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurant_booking', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('Connected to MongoDB');
  await Reservation.createIndexes();
  await require('./models/BookingDay').init();
  console.log('Index anti-doublon Reservation verifies');
  startReminderScheduler(io);
  startRefundReconciliationScheduler(io);
}).catch(err => {
  console.error('Initialisation MongoDB impossible:', err);
  process.exit(1);
});

// ─── Routes publiques ───
// POST /api/reservations (site web) — rate limited, pas d'API key
app.post('/api/reservations', reservationLimiter);
// GET /api/reservations/availability — public (calendrier client)
// Les routes internes (GET list, POST /desktop, PUT, DELETE) sont protégées dans le router
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/floor-plans', require('./routes/floorPlans'));

// Blocages manuels de services (GET public, POST/DELETE protégés dans le router)
app.use('/api/blocked-services', require('./routes/blockedServices'));

// Menu et WhatsApp — publics
app.use('/api/menu', require('./routes/menu'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

// ─── Routes protégées (API key requise) ───
app.use('/api/notifications', apiKey, require('./routes/notifications'));
app.use('/api/voice', apiKey, require('./routes/voice'));

// Settings — routes publiques séparées des routes protégées
const settingsRouter = require('./routes/settings');
app.use('/api/settings', settingsRouter);

// WebSocket
io.on('connection', (socket) => {
  console.log('Desktop app connected');
  socket.on('disconnect', () => {
    console.log('Desktop app disconnected');
  });
});

app.set('io', io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
