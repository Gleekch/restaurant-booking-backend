const { app, BrowserWindow, ipcMain, Tray, Menu, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const io = require('socket.io-client');
const { createConnectionStore } = require('./connection-store');

// En mode packagé (exe), stdout/stderr causent EPIPE sur Windows.
// __dirname contient 'app.asar' uniquement quand l'app est packagée.
const IS_PACKAGED = __dirname.includes('app.asar') || app.isPackaged;
process.on('uncaughtException', (error) => {
  if (error && error.code === 'EPIPE') return;
  if (IS_PACKAGED) return;
  throw error;
});

// Dans l'exe portable, stdout/stderr n'ont pas de console → EPIPE inévitable.
// On neutralise complètement toutes les sorties console.

let connection;
let setupMessage = '';
let connectionPageLoading = false;

let mainWindow;
let tray;
let socket;

function writeToStream() {}
function safeLog() {}
function safeError() {

}

function safeWarn() {}

function buildAuthHeaders() {
  return connection.headers();
}

async function apiRequest(endpoint, options = {}) {
  if (connection.snapshot().requiresSetup) throw new Error('Connexion requise sur ce poste');
  const backendUrl = connection.snapshot().backendUrl;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/api/')) throw new Error('Route non autorisee');
  const target = new URL(endpoint, backendUrl);
  if (target.origin !== backendUrl || !target.pathname.startsWith('/api/')) throw new Error('Route non autorisee');
  if (/^\/api\/reservations\/[^/]+\/(?:complete|close|deposit\/(?:request|refund|deducted|exemption))\/?$/.test(target.pathname)) {
    throw new Error('Fonction indisponible dans cette version');
  }
  const headers = buildAuthHeaders();

  const requestOptions = {
    method: options.method || 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(20000)
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(target, requestOptions);
  if (response.status === 401) {
    connection.reject();
    showConnection('Identifiants refuses par le serveur. Veuillez vous reconnecter.');
    throw new Error('Connexion requise sur ce poste');
  }
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

  if (connection.snapshot().requiresSetup) return;

  const authHeaders = buildAuthHeaders();
  const socketOptions = Object.keys(authHeaders).length > 0
    ? { extraHeaders: authHeaders }
    : undefined;

  socket = io(connection.snapshot().backendUrl, socketOptions);

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
    if (error.message === 'Authentification requise') {
      connection.reject();
      showConnection('Identifiants refuses par le serveur. Veuillez vous reconnecter.');
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

function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

function showConnection(message = '', forceReload = false) {
  setupMessage = message;
  disconnectSocket();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const file = path.join(__dirname, 'connection.html');
    if (!forceReload && (connectionPageLoading || mainWindow.webContents.getURL() === pathToFileURL(file).href)) return;
    connectionPageLoading = true;
    mainWindow.loadFile(file)
      .catch(() => safeError('Impossible d ouvrir la connexion'))
      .finally(() => { connectionPageLoading = false; });
  }
}

function showReservations() {
  if (connection.snapshot().requiresSetup) return;
  setupMessage = '';
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  connectToBackend();
}

function trustedConnectionSender(event) {
  return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame
    && event.senderFrame.url === pathToFileURL(path.join(__dirname, 'connection.html')).href;
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

  mainWindow.loadFile(path.join(__dirname, connection.snapshot().requiresSetup ? 'connection.html' : 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', () => {
    sendToRenderer(socket && socket.connected ? 'backend-connected' : 'backend-disconnected');
  });

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

app.whenReady().then(async () => {
  try {
    connection = createConnectionStore({ directory: app.getPath('userData'), safeStorage, env: process.env });
    await connection.initialize();
  } catch {
    dialog.showErrorBox('Configuration du poste', 'Adresse du serveur non autorisee. Aucun identifiant n a ete transmis.');
    app.quit();
    return;
  }
  createWindow();
  createTray();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Fichier', submenu: [
      { label: 'Configurer la connexion...', click: () => showConnection('', true) },
      { label: 'Deconnecter ce poste', click: () => {
        try { connection.forget(); showConnection('Ce poste est deconnecte. Les reservations restent sur le serveur.', true); }
        catch { dialog.showErrorBox('Deconnexion', 'Impossible d effacer la connexion locale. Reessayez avant de partager ce poste.'); }
      } },
      { type: 'separator' },
      { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } }
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]));
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
  ...connection.snapshot(), setupMessage
}));

ipcMain.handle('save-connection', async (event, input) => {
  if (!trustedConnectionSender(event)) return { success: false, message: 'Action non autorisee.' };
  return connection.signIn(input);
});

ipcMain.handle('open-reservations', event => {
  if (!trustedConnectionSender(event) || connection.snapshot().requiresSetup) return false;
  setImmediate(showReservations);
  return true;
});

ipcMain.handle('forget-connection', event => {
  if (!trustedConnectionSender(event)) return { success: false, message: 'Action non autorisee.' };
  try { connection.forget(); return { success: true }; }
  catch { return { success: false, message: 'Impossible d effacer la connexion locale.' }; }
});

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

ipcMain.handle('cancel-reservation', async (_event, payload) => {
  const { id, cancellationInitiator } = typeof payload === 'string' ? { id: payload } : payload;
  return apiRequest(`/api/reservations/${id}`, {
    method: 'PUT',
    body: { status: 'cancelled', cancellationInitiator }
  });
});

ipcMain.handle('get-availability', async (_event, { date, people = 2 }) => {
  return apiRequest(`/api/reservations/availability?date=${date}&people=${people}`);
});

ipcMain.handle('api-request', async (_event, { endpoint, options = {} }) => {
  return apiRequest(endpoint, options);
});
