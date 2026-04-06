const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const util = require('util');
const dotenv = require('dotenv');
const io = require('socket.io-client');

const DEFAULT_BACKEND_URL = 'https://restaurant-booking-backend-y3sp.onrender.com';

function getCandidateEnvPaths() {
  const candidates = [
    process.env.RESTAURANT_ENV_PATH,
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env')
  ].filter(Boolean);

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, '.env'));
  }

  if (process.execPath) {
    candidates.push(path.join(path.dirname(process.execPath), '.env'));
  }

  return [...new Set(candidates)];
}

function loadEnvironmentConfig() {
  for (const envPath of getCandidateEnvPaths()) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenv.config({ path: envPath });
    if (!result.error) {
      return envPath;
    }
  }

  dotenv.config();
  return null;
}

const loadedEnvPath = loadEnvironmentConfig();

// Prevent EPIPE crashes when stdout/stderr are closed on Windows.
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
console.log = (...args) => { try { originalLog.apply(console, args); } catch (error) { if (error.code !== 'EPIPE') throw error; } };
console.error = (...args) => { try { originalError.apply(console, args); } catch (error) { if (error.code !== 'EPIPE') throw error; } };
console.warn = (...args) => { try { originalWarn.apply(console, args); } catch (error) { if (error.code !== 'EPIPE') throw error; } };

const BACKEND_URL = (process.env.BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/$/, '');
const API_KEY = process.env.API_KEY || '';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '';

let mainWindow;
let tray;
let socket;

function writeToStream(stream, args) {
  if (!stream || typeof stream.write !== 'function' || stream.destroyed || stream.writable === false) {
    return;
  }

  stream.write(`${util.format(...args)}\n`);
}

function safeLog(...args) {
  try {
    writeToStream(process.stdout, args);
  } catch (error) {
    if (error && error.code !== 'EPIPE') {
      throw error;
    }
  }
}

function safeError(...args) {
  try {
    writeToStream(process.stderr, args);
  } catch (error) {
    if (error && error.code !== 'EPIPE') {
      throw error;
    }
  }
}

if (loadedEnvPath) {
  safeLog('Configuration chargee depuis:', loadedEnvPath);
} else {
  safeWarn('Aucun fichier .env trouve, utilisation des variables deja presentes.');
}

safeLog('Backend cible:', BACKEND_URL);

function safeWarn(...args) {
  try {
    writeToStream(process.stderr, args);
  } catch (error) {
    if (error && error.code !== 'EPIPE') {
      throw error;
    }
  }
}

function buildAuthHeaders() {
  if (API_KEY) {
    return { 'X-API-Key': API_KEY };
  }

  if (ADMIN_USER && ADMIN_PASS) {
    const token = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  return {};
}

async function apiRequest(endpoint, options = {}) {
  const headers = buildAuthHeaders();

  const requestOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${BACKEND_URL}${endpoint}`, requestOptions);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null
      ? payload.message
      : payload;
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return payload;
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function connectToBackend() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  const authHeaders = buildAuthHeaders();
  const socketOptions = Object.keys(authHeaders).length > 0
    ? { extraHeaders: authHeaders }
    : undefined;

  socket = io(BACKEND_URL, socketOptions);

  socket.on('connect', () => {
    safeLog('Connecte au serveur backend');

    if (mainWindow && mainWindow.webContents) {
      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', () => {
          sendToRenderer('backend-connected');
        });
      } else {
        sendToRenderer('backend-connected');
      }
    }
  });

  socket.on('connect_error', (error) => {
    safeError('Connexion Socket.IO impossible:', error.message);
    sendToRenderer('backend-disconnected');
  });

  socket.on('new-reservation', (reservation) => {
    sendToRenderer('new-reservation', reservation);
  });

  socket.on('update-reservation', (reservation) => {
    sendToRenderer('update-reservation', reservation);
  });

  socket.on('cancel-reservation', (reservation) => {
    sendToRenderer('cancel-reservation', reservation);
  });

  socket.on('disconnect', () => {
    safeLog('Deconnecte du serveur backend');
    sendToRenderer('backend-disconnected');
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.minimize();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');

  if (!fs.existsSync(iconPath)) {
    safeError('Tray icon not found at:', iconPath);
    return;
  }

  try {
    tray = new Tray(iconPath);
  } catch (error) {
    safeError('Failed to create tray:', error);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      }
    },
    {
      label: 'Quitter',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Systeme de Reservation Restaurant');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  connectToBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle('get-config', async () => ({
  backendUrl: BACKEND_URL,
  hasApiKey: Boolean(API_KEY),
  hasCredentials: Boolean(API_KEY || (ADMIN_USER && ADMIN_PASS))
}));

ipcMain.handle('get-reservations', async (_event, filters = {}) => {
  const searchParams = new URLSearchParams();

  if (filters.date) {
    searchParams.set('date', filters.date);
  }

  if (filters.status && filters.status !== 'all') {
    searchParams.set('status', filters.status);
  }

  const query = searchParams.toString();
  return apiRequest(`/api/reservations${query ? `?${query}` : ''}`);
});

ipcMain.handle('create-reservation', async (_event, data) => {
  return apiRequest('/api/reservations/desktop', {
    method: 'POST',
    body: data
  });
});

ipcMain.handle('update-reservation', async (_event, payload) => {
  const { id, data } = payload;
  return apiRequest(`/api/reservations/${id}`, {
    method: 'PUT',
    body: data
  });
});

ipcMain.handle('confirm-reservation', async (_event, id) => {
  return apiRequest(`/api/reservations/${id}`, {
    method: 'PUT',
    body: { status: 'confirmed' }
  });
});

ipcMain.handle('cancel-reservation', async (_event, id) => {
  return apiRequest(`/api/reservations/${id}`, {
    method: 'PUT',
    body: { status: 'cancelled' }
  });
});
