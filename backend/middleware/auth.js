/**
 * Middleware d'authentification
 * - apiKey : vérifie le header X-API-Key pour les routes sensibles
 * - basicAuth : protection Basic Auth HTTP pour /admin/
 */

// API Key middleware — protège les routes opérateur (desktop, notifications, settings)
function apiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  const validKey = process.env.API_KEY;

  if (!validKey) {
    // Si API_KEY n'est pas configurée, laisser passer (dev mode)
    return next();
  }

  if (!key || key !== validKey) {
    return res.status(401).json({ success: false, message: 'Clé API invalide ou manquante' });
  }

  next();
}

// Basic Auth middleware — protège la page admin /admin/
function basicAuth(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;

  // Si pas configuré, laisser passer (dev mode)
  if (!user || !pass) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Au Murmure des Flots - Admin"');
    return res.status(401).send('Authentification requise');
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [inputUser, inputPass] = credentials.split(':');

  if (inputUser !== user || inputPass !== pass) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Au Murmure des Flots - Admin"');
    return res.status(401).send('Identifiants incorrects');
  }

  next();
}

module.exports = { apiKey, basicAuth };
