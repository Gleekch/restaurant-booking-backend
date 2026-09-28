const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BACKEND_URL = 'https://restaurant-booking-backend-y3sp.onrender.com';

function validateBackendUrl(value = DEFAULT_BACKEND_URL) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !(url.origin === DEFAULT_BACKEND_URL || (loopback && ['http:', 'https:'].includes(url.protocol)))) {
    throw new Error('Adresse du serveur non autorisee');
  }
  return url.origin;
}

function createConnectionStore({ directory, safeStorage, env = {}, request = fetch }) {
  const backendUrl = validateBackendUrl(env.BACKEND_URL || DEFAULT_BACKEND_URL);
  const file = path.join(directory, 'operator-connection.json');
  // Environment API keys are only used by isolated loopback test fixtures.
  const fixtureKey = backendUrl !== DEFAULT_BACKEND_URL ? env.API_KEY : null;
  let credentials = fixtureKey ? { type: 'api-key', value: fixtureKey } : null;
  let storageWarning = null;
  let rejected = false;
  let busy = false;
  let revision = 0;

  function snapshot() {
    return { backendUrl, hasCredentials: Boolean(credentials),
      hasApiKey: credentials?.type === 'api-key', requiresSetup: !credentials || rejected,
      storageWarning };
  }

  async function encryptionAvailable() {
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
    return safeStorage.isAsyncEncryptionAvailable();
  }

  async function persist(next, stillCurrent = () => true) {
    if (!await encryptionAvailable()) throw new Error('Chiffrement Windows indisponible');
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ backendUrl, credentials: next }));
    if (!stillCurrent()) return false;
    fs.mkdirSync(directory, { recursive: true });
    const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }),
        { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return true;
  }

  async function initialize() {
    if (fixtureKey || !fs.existsSync(file)) return snapshot();
    try {
      if (!await encryptionAvailable()) throw new Error('Encryption unavailable');
      if (fs.statSync(file).size > 32768) throw new Error('Invalid configuration');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.version !== 1 || typeof saved.encrypted !== 'string') throw new Error('Invalid configuration');
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(saved.encrypted, 'base64'));
      const stored = JSON.parse(decrypted.result);
      if (stored.backendUrl !== backendUrl || stored.credentials?.type !== 'basic'
        || !/^Basic [A-Za-z0-9+/]+=*$/.test(stored.credentials.value || '')) throw new Error('Invalid configuration');
      credentials = stored.credentials;
      if (decrypted.shouldReEncrypt) await persist(credentials);
    } catch {
      credentials = null;
      storageWarning = 'Connexion enregistree illisible sur ce poste. Saisissez vos identifiants.';
    }
    return snapshot();
  }

  function headers() {
    if (!credentials || rejected) return {};
    return credentials.type === 'basic' ? { Authorization: credentials.value }
      : { 'X-API-Key': credentials.value };
  }

  async function signIn(input) {
    if (busy) return { success: false, message: 'Une connexion est deja en cours.' };
    const { username, password } = input || {};
    if (typeof username !== 'string' || !username.trim() || username.length > 128 || /[:\r\n]/.test(username)
      || typeof password !== 'string' || !password || password.length > 1024) {
      return { success: false, message: 'Saisissez votre nom d utilisateur et votre mot de passe.' };
    }
    busy = true;
    const attemptRevision = revision;
    const next = { type: 'basic', value: 'Basic ' + Buffer.from(username.trim() + ':' + password).toString('base64') };
    try {
      if (!await encryptionAvailable()) return { success: false,
        message: 'Le stockage chiffre Windows est indisponible. Aucun identifiant ne sera enregistre en clair.' };
      let response;
      try {
        response = await request(backendUrl + '/api/settings/production-readiness', {
          method: 'GET', headers: { Authorization: next.value }, redirect: 'error',
          signal: AbortSignal.timeout(15000)
        });
      } catch {
        return { success: false, message: 'Serveur inaccessible. Verifiez Internet puis reessayez.' };
      }
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: 'Identifiants incorrects. Utilisez ceux de l acces tablette.' };
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true || !body.data) {
        return { success: false, message: 'Le serveur ne permet pas de valider cette connexion.' };
      }
      if (attemptRevision !== revision) return { success: false, message: 'Connexion annulee.' };
      // Encrypt first, then atomically replace the previous connection.
      // A failed login or disk write must never destroy a working configuration.
      if (!await persist(next, () => attemptRevision === revision)) return { success: false, message: 'Connexion annulee.' };
      credentials = next;
      rejected = false;
      storageWarning = null;
      return { success: true };
    } catch {
      return { success: false, message: 'Impossible d enregistrer la connexion chiffree sur ce poste.' };
    } finally { busy = false; }
  }

  function forget() {
    revision++;
    if (fs.existsSync(file)) fs.unlinkSync(file);
    credentials = null;
    rejected = false;
    storageWarning = null;
  }

  return { initialize, snapshot, headers, signIn, forget,
    reject() { rejected = true; } };
}

module.exports = { createConnectionStore, validateBackendUrl, DEFAULT_BACKEND_URL };
