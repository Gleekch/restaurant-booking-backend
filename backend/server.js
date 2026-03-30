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
const io = socketIo(server, {
  cors: {
    origin: "*", // Accepter toutes les origines pour l'application desktop
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    // Autoriser les requêtes sans origine (Electron, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5173',
      'http://localhost:5174',
      'https://your-dinner-spot.onrender.com',
      'https://resa-aumurmuredesflots.onrender.com',
      'https://restaurant-booking-backend-y3sp.onrender.com'
    ];
    
    // Autoriser aussi les requêtes depuis file:// (Electron)
    if (origin.startsWith('file://') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Pour l'instant, autoriser toutes les origines
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting — anti-spam sur la création de réservations publiques
const reservationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 réservations par IP par fenêtre
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

// Routes publiques (avec rate limiting)
app.post('/api/reservations', reservationLimiter);
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

// Routes protégées (API key requise)
app.use('/api/notifications', apiKey, require('./routes/notifications'));
app.use('/api/voice', apiKey, require('./routes/voice'));
app.use('/api/settings', apiKey, require('./routes/settings'));

// WebSocket pour l'application desktop
io.on('connection', (socket) => {
  console.log('Desktop app connected');
  
  socket.on('disconnect', () => {
    console.log('Desktop app disconnected');
  });
});

// Export io pour utilisation dans les routes
app.set('io', io);

// Démarrer le scheduler de rappels après connexion MongoDB
const { startReminderScheduler } = require('./services/reminderService');

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startReminderScheduler();
});