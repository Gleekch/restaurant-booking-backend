const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
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

// Serve static files (admin dashboard)
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurant_booking', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Routes
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/voice', require('./routes/voice'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

// WebSocket pour l'application desktop
io.on('connection', (socket) => {
  console.log('Desktop app connected');
  
  socket.on('disconnect', () => {
    console.log('Desktop app disconnected');
  });
});

// Export io pour utilisation dans les routes
app.set('io', io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});