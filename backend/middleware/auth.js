/**
 * Middleware d'authentification
 * - apiKey : vérifie le header X-API-Key pour les routes sensibles
 * - basicAuth : protection Basic Auth HTTP pour /admin/
 */

// API Key middleware — protège les routes opérateur
// Accepte soit X-API-Key header, soit Basic Auth valide (pour la page admin)
function apiKey(req, res, next) {
  const validKey = process.env.API_KEY;

  if (!validKey) {
    return next(); // dev mode
  }

  // Option 1 : API key header (desktop, scripts)
  const key = req.headers['x-api-key'];
  if (key && key === validKey) {
    return next();
  }

  // Option 2 : Basic Auth valide (page admin dans le navigateur)
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  const authHeader = req.headers.authorization;
  if (user && pass && authHeader && authHeader.startsWith('Basic ')) {
    const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
    const [inputUser, inputPass] = credentials.split(':');
    if (inputUser === user && inputPass === pass) {
      return next();
    }
  }

  return res.status(401).json({ success: false, message: 'Authentification requise' });
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
