const { timingSafeEqual } = require('crypto');
const BASIC_AUTH_CHALLENGE = 'Basic realm="Au Murmure des Flots - Admin"';

function secretEquals(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validBasicAuth(header) {
  if (typeof header !== 'string' || !header.startsWith('Basic ') || header.length > 4096) return false;
  const credentials = Buffer.from(header.slice(6), 'base64').toString();
  const separator = credentials.indexOf(':');
  if (separator < 0) return false;
  return secretEquals(credentials.slice(0, separator), process.env.ADMIN_USER)
    && secretEquals(credentials.slice(separator + 1), process.env.ADMIN_PASS);
}

function isOperatorAuthorized(headers = {}) {
  return secretEquals(headers['x-api-key'], process.env.API_KEY)
    || validBasicAuth(headers.authorization);
}

function apiKey(req, res, next) {
  if (isOperatorAuthorized(req.headers)) return next();
  // /admin/ and /api/ are different Basic Auth path scopes in browsers.
  // Challenge the API request so the browser can reuse the admin credentials.
  res.setHeader('WWW-Authenticate', BASIC_AUTH_CHALLENGE);
  res.setHeader('Cache-Control', 'no-store');
  // Missing configuration must never turn protected routes into public routes.
  return res.status(401).json({ success: false, message: 'Authentification requise' });
}

function basicAuth(req, res, next) {
  if (validBasicAuth(req.headers.authorization)) return next();
  res.setHeader('WWW-Authenticate', BASIC_AUTH_CHALLENGE);
  return res.status(401).send('Authentification requise');
}

function socketAuth(socket, next) {
  const headers = socket.handshake.headers || {};
  const key = socket.handshake.auth && socket.handshake.auth.apiKey;
  if (isOperatorAuthorized(headers) || secretEquals(key, process.env.API_KEY)) return next();
  next(new Error('Authentification requise'));
}

module.exports = { apiKey, basicAuth, socketAuth, isOperatorAuthorized };
