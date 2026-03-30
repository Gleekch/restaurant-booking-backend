const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const util = require('util');

// Empêcher les crashs EPIPE quand stdout/stderr sont fermés (Windows sans console).
// console.log lance l'erreur de manière synchrone, donc on doit wrapper les fonctions
// plutôt que d'écouter l'événement 'error' du stream.
const _log = console.log;
const _error = console.error;
const _warn = console.warn;
console.log = (...a) => { try { _log.apply(console, a); } catch (e) { if (e.code !== 'EPIPE') throw e; } };
console.error = (...a) => { try { _error.apply(console, a); } catch (e) { if (e.code !== 'EPIPE') throw e; } };
console.warn = (...a) => { try { _warn.apply(console, a); } catch (e) { if (e.code !== 'EPIPE') throw e; } };

const io = require('socket.io-client');
require('dotenv').config();

const DEFAULT_BACKEND_URL = 'https://restaurant-booking-backend-y3sp.onrender.com';
const BACKEND_URL = (process.env.BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/$/, '');

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

async function apiRequest(endpoint, options = {}) {
  const headers = {};
  // Ajouter la clé API si configurée
  const apiKeyValue = process.env.API_KEY;
  if (apiKeyValue) {
    headers['X-API-Key'] = apiKeyValue;
  }
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

  socket = io(BACKEND_URL);

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
  backendUrl: BACKEND_URL
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
