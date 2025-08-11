const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const io = require('socket.io-client');

let mainWindow;
let tray;
let socket;

// Connexion au serveur backend
function connectToBackend() {
  // Si déjà connecté, déconnecter et nettoyer les listeners
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  
  // Utiliser le backend déployé sur Render
  socket = io('https://restaurant-booking-backend-y3sp.onrender.com');
  
  socket.on('connect', () => {
    console.log('Connecté au serveur backend');
    if (mainWindow && mainWindow.webContents) {
      // Attendre que la page soit chargée avant d'envoyer l'événement
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('backend-connected');
        console.log('Événement backend-connected envoyé');
      });
      // Si déjà chargée, envoyer immédiatement
      if (!mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send('backend-connected');
        console.log('Événement backend-connected envoyé (page déjà chargée)');
      }
    }
  });
  
  socket.on('new-reservation', (reservation) => {
    if (mainWindow) {
      mainWindow.webContents.send('new-reservation', reservation);
      
      // Notification système
      const notification = {
        title: 'Nouvelle Réservation',
        body: `${reservation.customerName} - ${reservation.numberOfPeople} personnes`
      };
      mainWindow.webContents.send('show-notification', notification);
    }
  });
  
  socket.on('update-reservation', (reservation) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-reservation', reservation);
    }
  });
  
  socket.on('cancel-reservation', (reservation) => {
    if (mainWindow) {
      mainWindow.webContents.send('cancel-reservation', reservation);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Déconnecté du serveur backend');
    if (mainWindow) {
      mainWindow.webContents.send('backend-disconnected');
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });
  
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Minimiser dans la barre système au lieu de fermer
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
  
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

// Créer l'icône de la barre système
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  
  // Vérifier si le fichier existe
  const fs = require('fs');
  if (!fs.existsSync(iconPath)) {
    console.error('Tray icon not found at:', iconPath);
    return;
  }
  
  try {
    tray = new Tray(iconPath);
  } catch (error) {
    console.error('Failed to create tray:', error);
    return;
  }
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir',
      click: () => {
        mainWindow.show();
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
  
  tray.setToolTip('Système de Réservation Restaurant');
  tray.setContextMenu(contextMenu);
  
  tray.on('double-click', () => {
    mainWindow.show();
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

// IPC pour la communication avec le renderer
ipcMain.on('get-reservations', (event) => {
  // Demander les réservations au backend
  socket.emit('get-reservations');
});

ipcMain.on('update-reservation', (event, reservation) => {
  socket.emit('update-reservation', reservation);
});

ipcMain.on('cancel-reservation', (event, reservationId) => {
  socket.emit('cancel-reservation', reservationId);
});