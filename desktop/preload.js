const { contextBridge, ipcRenderer } = require('electron');

const reservationEvents = new Set([
  'backend-connected',
  'backend-disconnected',
  'new-reservation',
  'update-reservation',
  'cancel-reservation',
  'show-notification'
]);

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getReservations: (filters = {}) => ipcRenderer.invoke('get-reservations', filters),
  createReservation: (data) => ipcRenderer.invoke('create-reservation', data),
  updateReservation: (id, data) => ipcRenderer.invoke('update-reservation', { id, data }),
  confirmReservation: (id) => ipcRenderer.invoke('confirm-reservation', id),
  cancelReservation: (id) => ipcRenderer.invoke('cancel-reservation', id),
  getAvailability: (date, people = 2) => ipcRenderer.invoke('get-availability', { date, people }),
  onReservationEvent: (eventName, callback) => {
    if (!reservationEvents.has(eventName)) {
      throw new Error(`Unsupported reservation event: ${eventName}`);
    }

    if (typeof callback !== 'function') {
      throw new Error('A callback function is required.');
    }

    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(eventName, listener);

    return () => {
      ipcRenderer.removeListener(eventName, listener);
    };
  }
});
