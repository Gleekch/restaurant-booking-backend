const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const rateLimit = require('express-rate-limit');
const { apiKey, basicAuth } = require('./middleware/auth');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS — whitelist stricte
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://www.aumurmuredesflots.com',
  'https://aumurmuredesflots.com',
  'https://resa-aumurmuredesflots.onrender.com',
  'https://restaurant-booking-backend-y3sp.onrender.com'
];

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors({
  origin: function(origin, callback) {
    // Autoriser les requêtes sans origine (Electron, curl, Postman)
    if (!origin) return callback(null, true);
    if (origin.startsWith('file://') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS non autorisé'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting — anti-spam sur la création de réservations publiques
const reservationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Trop de requêtes, réessayez dans 15 minutes' }
});

// Protection admin avec Basic Auth
app.use('/admin', basicAuth, express.static(path.join(__dirname, 'public', 'admin')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurant_booking', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// ─── Routes publiques ───
// POST /api/reservations (site web) — rate limited, pas d'API key
app.post('/api/reservations', reservationLimiter);
// GET /api/reservations/availability — public (calendrier client)
// Les routes internes (GET list, POST /desktop, PUT, DELETE) sont protégées dans le router
app.use('/api/reservations', require('./routes/reservations'));

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

// Scheduler de rappels
const { startReminderScheduler } = require('./services/reminderService');

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startReminderScheduler();
});
