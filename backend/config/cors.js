const allowedOrigins = Object.freeze([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://www.aumurmuredesflots.com',
  'https://aumurmuredesflots.com',
  'https://resa-aumurmuredesflots.onrender.com',
  'https://restaurant-booking-backend-y3sp.onrender.com'
]);

const corsOptions = {
  origin(origin, callback) {
    // Preserve native/server clients and the existing desktop file origin.
    if (!origin || origin.startsWith('file://') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(Object.assign(new Error('Origine non autorisee.'), {
      code: 'CORS_ORIGIN_DENIED', status: 403
    }));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};

function safeOrigin(origin) {
  if (origin === 'null') return 'null';
  if (typeof origin !== 'string' || origin.length > 512) return '[invalid]';
  try {
    const parsed = new URL(origin);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.origin : '[invalid]';
  } catch (_) { return '[invalid]'; }
}

function corsErrorHandler(error, req, res, next) {
  if (error.code !== 'CORS_ORIGIN_DENIED') return next(error);
  // Log the origin, never credentials, reservation URLs, query tokens or bodies.
  console.warn('[CORS_ORIGIN_DENIED]', JSON.stringify({
    origin: safeOrigin(req.headers.origin), method: req.method
  }));
  res.set('Cache-Control', 'no-store');
  res.status(403).json({ success: false, code: error.code, message: error.message });
}

module.exports = { allowedOrigins, corsOptions, corsErrorHandler };
