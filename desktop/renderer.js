const { ipcRenderer } = require('electron');

// État de l'application
let reservations = [];
let currentFilter = 'all';
let currentView = 'today';
let notifiedReservations = new Set(); // Pour éviter les notifications en double

// Éléments DOM
const connectionStatus = document.getElementById('connection-status');
const reservationsContainer = document.getElementById('reservations-container');
const modal = document.getElementById('reservation-modal');
const closeModal = document.querySelector('.close');
const statusFilter = document.getElementById('status-filter');
const searchInput = document.getElementById('search-input');
const dateFilter = document.getElementById('date-filter');
const serviceFilter = document.getElementById('service-filter');
const reservationsTitle = document.getElementById('reservations-title');

// Mise à jour de l'heure
function updateDateTime() {
    const now = new Date();
    document.getElementById('current-date').textContent = now.toLocaleDateString('fr-FR');
    document.getElementById('current-time').textContent = now.toLocaleTimeString('fr-FR');
}

setInterval(updateDateTime, 1000);
updateDateTime();

// Gestion de la connexion backend
ipcRenderer.on('backend-connected', () => {
    connectionStatus.textContent = 'Connecté';
    connectionStatus.className = 'status connected';
    loadReservations();
});

ipcRenderer.on('backend-disconnected', () => {
    connectionStatus.textContent = 'Déconnecté';
    connectionStatus.className = 'status disconnected';
});

// Réception des nouvelles réservations
ipcRenderer.on('new-reservation', (event, reservation) => {
    // Vérifier si la réservation existe déjà
    const existingIndex = reservations.findIndex(r => r._id === reservation._id);
    if (existingIndex === -1) {
        reservations.push(reservation);
        displayReservations();
        updateStats();
        
        // N'afficher la notification qu'une seule fois par réservation
        if (!notifiedReservations.has(reservation._id)) {
            notifiedReservations.add(reservation._id);
            showNotification('Nouvelle Réservation', `${reservation.customerName} - ${reservation.numberOfPeople} personnes`);
            
            // Nettoyer les anciennes notifications après 5 minutes
            setTimeout(() => {
                notifiedReservations.delete(reservation._id);
            }, 5 * 60 * 1000);
        }
    }
});

// Mise à jour des réservations
ipcRenderer.on('update-reservation', (event, reservation) => {
    const index = reservations.findIndex(r => r._id === reservation._id);
    if (index !== -1) {
        reservations[index] = reservation;
        displayReservations();
        updateStats();
    }
});

// Annulation de réservation
ipcRenderer.on('cancel-reservation', (event, reservation) => {
    const index = reservations.findIndex(r => r._id === reservation._id);
    if (index !== -1) {
        reservations[index].status = 'cancelled';
        displayReservations();
        updateStats();
    }
});

// Charger les réservations
async function loadReservations() {
    console.log('Tentative de chargement des réservations...');
    try {
        const response = await fetch('https://restaurant-booking-backend-y3sp.onrender.com/api/reservations');
        console.log('Réponse reçue:', response.status);
        const data = await response.json();
        console.log('Données reçues:', data);
        if (data.success) {
            reservations = data.data;
            console.log(`${reservations.length} réservations chargées`);
            displayReservations();
            updateStats();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des réservations:', error);
    }
}

// Afficher les réservations
function displayReservations() {
    // Gérer les vues spéciales
    if (currentView === 'clients') {
        displayClients();
        return;
    } else if (currentView === 'week') {
        displayWeekView();
        return;
    } else if (currentView === 'statistics') {
        displayStatistics();
        return;
    } else if (currentView === 'pending') {
        displayPendingReservations();
        return;
    }
    
    let filteredReservations = reservations;
    
    console.log('Affichage des réservations, vue actuelle:', currentView);
    console.log('Nombre total de réservations:', reservations.length);
    
    // Filtrer par vue ou par date sélectionnée
    if (dateFilter && dateFilter.value) {
        // Si une date est sélectionnée, filtrer par cette date
        const selectedDate = new Date(dateFilter.value).toDateString();
        filteredReservations = filteredReservations.filter(r => 
            new Date(r.date).toDateString() === selectedDate
        );
        console.log(`Réservations du ${selectedDate}:`, filteredReservations.length);
    } else if (currentView === 'today') {
        // Pour Aujourd'hui, on affiche la vue détaillée
        displayTodayView();
        return;
    } else if (currentView === 'upcoming') {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Réinitialiser à minuit pour comparer les dates correctement
        filteredReservations = filteredReservations.filter(r => {
            const resDate = new Date(r.date);
            resDate.setHours(0, 0, 0, 0);
            return resDate >= today;
        });
        console.log('Réservations à venir:', filteredReservations.length);
        console.log('Réservations à venir détails:', filteredReservations.map(r => ({
            name: r.customerName,
            date: r.date,
            status: r.status
        })));
    } else if (currentView === 'history') {
        // Afficher toutes les réservations passées
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        filteredReservations = filteredReservations.filter(r => 
            new Date(r.date) < today
        );
        console.log('Historique des réservations:', filteredReservations.length);
    }
    
    // Filtrer par statut
    if (currentFilter !== 'all') {
        filteredReservations = filteredReservations.filter(r => 
            r.status === currentFilter
        );
    }
    
    // Filtrer par recherche
    const searchTerm = searchInput.value.toLowerCase();
    if (searchTerm) {
        filteredReservations = filteredReservations.filter(r => 
            r.customerName.toLowerCase().includes(searchTerm) ||
            r.phoneNumber.includes(searchTerm)
        );
    }
    
    // Trier par heure
    filteredReservations.sort((a, b) => {
        const timeA = a.time.split(':').map(Number);
        const timeB = b.time.split(':').map(Number);
        return (timeA[0] * 60 + timeA[1]) - (timeB[0] * 60 + timeB[1]);
    });
    
    // Filtrer par service sélectionné
    const selectedService = serviceFilter ? serviceFilter.value : 'all';
    if (selectedService !== 'all') {
        filteredReservations = filteredReservations.filter(r => {
            const hour = parseInt(r.time.split(':')[0]);
            if (selectedService === 'midi') {
                return hour >= 12 && hour < 15;
            } else if (selectedService === 'soir') {
                return hour >= 18 && hour < 23;
            }
            return false;
        });
    }
    
    // Séparer les réservations par service pour l'affichage
    const serviceMidi = filteredReservations.filter(r => {
        const hour = parseInt(r.time.split(':')[0]);
        return hour >= 12 && hour < 15; // 12h00 à 14h59
    });
    
    const serviceSoir = filteredReservations.filter(r => {
        const hour = parseInt(r.time.split(':')[0]);
        return hour >= 18 && hour < 23; // 18h00 à 22h59
    });
    
    // Afficher
    reservationsContainer.innerHTML = '';
    
    if (filteredReservations.length === 0) {
        reservationsContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                <p style="font-size: 18px; margin-bottom: 10px;">Aucune réservation ${
                    currentView === 'today' ? "aujourd'hui" : 
                    currentView === 'upcoming' ? 'à venir' : 
                    currentView === 'history' ? 'dans l\'historique' : ''
                }</p>
                <p style="font-size: 14px; color: #999;">
                    ${currentView === 'today' ? 'Cliquez sur "À venir" pour voir les prochaines réservations' : ''}
                </p>
            </div>
        `;
    } else {
        // Service du Midi
        if (serviceMidi.length > 0) {
            const midiActive = serviceMidi.filter(r => r.status !== 'cancelled');
            const midiConfirmed = serviceMidi.filter(r => r.status === 'confirmed');
            const midiPending = serviceMidi.filter(r => r.status === 'pending');
            
            const midiHeader = document.createElement('div');
            midiHeader.className = 'service-header';
            midiHeader.innerHTML = `
                <h3 style="color: #f39c12; margin: 20px 0 10px 0; padding: 10px; background: #fff3cd; border-radius: 5px;">
                    ☀️ SERVICE MIDI (12h-15h) - ${midiActive.reduce((sum, r) => sum + r.numberOfPeople, 0)} couverts
                    <span style="font-size: 14px; font-weight: normal;">
                        (${midiConfirmed.reduce((sum, r) => sum + r.numberOfPeople, 0)} confirmés, 
                        ${midiPending.reduce((sum, r) => sum + r.numberOfPeople, 0)} en attente)
                    </span>
                </h3>
            `;
            reservationsContainer.appendChild(midiHeader);
            
            serviceMidi.forEach(reservation => {
                const card = createReservationCard(reservation);
                reservationsContainer.appendChild(card);
            });
        }
        
        // Service du Soir
        if (serviceSoir.length > 0) {
            const soirActive = serviceSoir.filter(r => r.status !== 'cancelled');
            const soirConfirmed = serviceSoir.filter(r => r.status === 'confirmed');
            const soirPending = serviceSoir.filter(r => r.status === 'pending');
            
            const soirHeader = document.createElement('div');
            soirHeader.className = 'service-header';
            soirHeader.innerHTML = `
                <h3 style="color: #3498db; margin: 20px 0 10px 0; padding: 10px; background: #d1ecf1; border-radius: 5px;">
                    🌙 SERVICE SOIR (18h-23h) - ${soirActive.reduce((sum, r) => sum + r.numberOfPeople, 0)} couverts
                    <span style="font-size: 14px; font-weight: normal;">
                        (${soirConfirmed.reduce((sum, r) => sum + r.numberOfPeople, 0)} confirmés, 
                        ${soirPending.reduce((sum, r) => sum + r.numberOfPeople, 0)} en attente)
                    </span>
                </h3>
            `;
            reservationsContainer.appendChild(soirHeader);
            
            serviceSoir.forEach(reservation => {
                const card = createReservationCard(reservation);
                reservationsContainer.appendChild(card);
            });
        }
    }
    
    console.log(`${filteredReservations.length} réservation(s) affichée(s)`);
}

// Créer une carte de réservation
function createReservationCard(reservation) {
    const card = document.createElement('div');
    card.className = 'reservation-card';
    card.innerHTML = `
        <div class="reservation-header">
            <div class="reservation-time">${reservation.time}</div>
            <span class="reservation-status status-${reservation.status}">${getStatusText(reservation.status)}</span>
        </div>
        <div class="reservation-info">
            <div class="info-row">
                <span class="info-label">Nom:</span>
                <strong>${reservation.customerName}</strong>
            </div>
            <div class="info-row">
                <span class="info-label">Téléphone:</span>
                ${reservation.phoneNumber}
            </div>
            <div class="info-row">
                <span class="info-label">Personnes:</span>
                ${reservation.numberOfPeople}
            </div>
            ${reservation.specialRequests ? `
            <div class="info-row">
                <span class="info-label">Notes:</span>
                ${reservation.specialRequests}
            </div>
            ` : ''}
        </div>
    `;
    
    card.addEventListener('click', () => showReservationDetails(reservation));
    return card;
}

// Obtenir le texte du statut
function getStatusText(status) {
    const statusTexts = {
        pending: 'En attente',
        confirmed: 'Confirmée',
        cancelled: 'Annulée',
        completed: 'Terminée'
    };
    return statusTexts[status] || status;
}

// Afficher les détails de la réservation
function showReservationDetails(reservation) {
    const details = document.getElementById('reservation-details');
    details.innerHTML = `
        <p><strong>Client:</strong> ${reservation.customerName}</p>
        <p><strong>Téléphone:</strong> ${reservation.phoneNumber}</p>
        <p><strong>Email:</strong> ${reservation.email || 'Non renseigné'}</p>
        <p><strong>Date:</strong> ${new Date(reservation.date).toLocaleDateString('fr-FR')}</p>
        <p><strong>Heure:</strong> ${reservation.time}</p>
        <p><strong>Nombre de personnes:</strong> ${reservation.numberOfPeople}</p>
        <p><strong>Statut:</strong> ${getStatusText(reservation.status)}</p>
        <p><strong>Source:</strong> ${reservation.source}</p>
        ${reservation.specialRequests ? `<p><strong>Demandes spéciales:</strong> ${reservation.specialRequests}</p>` : ''}
        ${reservation.notes ? `<p><strong>Notes:</strong> ${reservation.notes}</p>` : ''}
    `;
    
    // Configurer les boutons
    const confirmBtn = document.getElementById('confirm-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const editBtn = document.getElementById('edit-btn');
    
    // Retirer les anciens event listeners
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    editBtn.replaceWith(editBtn.cloneNode(true));
    
    // Récupérer les nouveaux éléments
    document.getElementById('confirm-btn').onclick = () => {
        console.log('Bouton Confirmer cliqué pour:', reservation._id);
        updateReservationStatus(reservation._id, 'confirmed');
    };
    document.getElementById('cancel-btn').onclick = () => {
        console.log('Bouton Annuler cliqué pour:', reservation._id);
        updateReservationStatus(reservation._id, 'cancelled');
    };
    document.getElementById('edit-btn').onclick = () => {
        console.log('Bouton Modifier cliqué pour:', reservation._id);
        editReservation(reservation);
    };
    
    modal.style.display = 'block';
}

// Mettre à jour le statut de la réservation
async function updateReservationStatus(id, status) {
    console.log(`Mise à jour du statut: ${id} -> ${status}`);
    try {
        const url = `https://restaurant-booking-backend-y3sp.onrender.com/api/reservations/${id}`;
        console.log('URL de mise à jour:', url);
        
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ status })
        });
        
        console.log('Réponse de mise à jour:', response.status);
        console.log('Réponse headers:', response.headers);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Erreur response:', errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Données de mise à jour:', data);
        
        if (data.success) {
            modal.style.display = 'none';
            loadReservations();
            showNotification('Succès', `Réservation ${status === 'confirmed' ? 'confirmée' : 'annulée'}`);
        } else {
            alert(`Erreur: ${data.message}`);
        }
    } catch (error) {
        console.error('Erreur détaillée:', error);
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
        alert(`Erreur lors de la mise à jour de la réservation: ${error.message}`);
    }
}

// Éditer une réservation
function editReservation(reservation) {
    // Ici, on pourrait ouvrir un formulaire d'édition
    console.log('Édition de la réservation:', reservation);
    modal.style.display = 'none';
}

// Mise à jour des statistiques
function updateStats() {
    const today = new Date().toDateString();
    const todayReservations = reservations.filter(r => 
        new Date(r.date).toDateString() === today
    );
    
    // Filtrer les réservations actives (non annulées)
    const activeReservations = todayReservations.filter(r => r.status !== 'cancelled');
    const confirmedReservations = todayReservations.filter(r => r.status === 'confirmed');
    const pendingReservations = todayReservations.filter(r => r.status === 'pending');
    
    // Calculer les couverts
    const totalCovers = activeReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const confirmedCovers = confirmedReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const pendingCovers = pendingReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    
    document.getElementById('today-count').textContent = activeReservations.length;
    document.getElementById('today-covers').textContent = `${totalCovers} (${confirmedCovers} confirmés + ${pendingCovers} en attente)`;
    document.getElementById('today-confirmed').textContent = confirmedReservations.length;
}

// Afficher une notification
function showNotification(title, body) {
    if (Notification.permission === 'granted') {
        new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, { body });
            }
        });
    }
}

// Gestion des événements
closeModal.onclick = () => {
    modal.style.display = 'none';
};

window.onclick = (event) => {
    if (event.target === modal) {
        modal.style.display = 'none';
    }
};

statusFilter.addEventListener('change', (e) => {
    currentFilter = e.target.value;
    displayReservations();
});

searchInput.addEventListener('input', displayReservations);

// Filtre par date
if (dateFilter) {
    // Définir la date d'aujourd'hui par défaut
    dateFilter.value = new Date().toISOString().split('T')[0];
    
    dateFilter.addEventListener('change', (e) => {
        const selectedDate = new Date(e.target.value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        selectedDate.setHours(0, 0, 0, 0);
        
        // Mettre à jour le titre
        if (selectedDate.getTime() === today.getTime()) {
            reservationsTitle.textContent = "Réservations d'aujourd'hui";
        } else {
            reservationsTitle.textContent = `Réservations du ${selectedDate.toLocaleDateString('fr-FR')}`;
        }
        
        displayReservations();
    });
}

// Filtre par service
if (serviceFilter) {
    serviceFilter.addEventListener('change', displayReservations);
}

// Navigation
document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('nav a.active').classList.remove('active');
        link.classList.add('active');
        currentView = link.dataset.view;
        displayReservations();
    });
});

// Fonction pour extraire et analyser les clients
function extractClients() {
    const clientsMap = new Map();

    reservations.forEach(reservation => {
        const key = reservation.email || reservation.phoneNumber || reservation.phone;
        if (!key) return;

        if (!clientsMap.has(key)) {
            clientsMap.set(key, {
                name: reservation.customerName,
                email: reservation.email || '',
                phone: reservation.phoneNumber || reservation.phone || '',
                firstVisit: reservation.date,
                lastVisit: reservation.date,
                totalVisits: 0,
                totalCovers: 0,
                reservations: []
            });
        }
        
        const client = clientsMap.get(key);
        client.totalVisits++;
        client.totalCovers += reservation.numberOfPeople;
        client.reservations.push(reservation);

        // Mettre à jour le téléphone si manquant
        if (!client.phone && (reservation.phoneNumber || reservation.phone)) {
            client.phone = reservation.phoneNumber || reservation.phone;
        }
        
        // Mettre à jour première et dernière visite
        if (new Date(reservation.date) < new Date(client.firstVisit)) {
            client.firstVisit = reservation.date;
        }
        if (new Date(reservation.date) > new Date(client.lastVisit)) {
            client.lastVisit = reservation.date;
        }
    });
    
    return Array.from(clientsMap.values()).sort((a, b) => b.totalVisits - a.totalVisits);
}

// Afficher les clients
function displayClients() {
    const clientsSection = document.getElementById('clients-section');
    const reservationsContainer = document.getElementById('reservations-container');
    const clientsContainer = document.getElementById('clients-container');
    
    // Masquer les réservations, afficher les clients
    reservationsContainer.style.display = 'none';
    clientsSection.style.display = 'block';
    
    const clients = extractClients();
    
    clientsContainer.innerHTML = `
        <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
            <h3>📊 Statistiques Clients</h3>
            <p>Total clients uniques: <strong>${clients.length}</strong></p>
            <p>Clients fidèles (3+ visites): <strong>${clients.filter(c => c.totalVisits >= 3).length}</strong></p>
        </div>
        <table style="width: 100%; background: white; border-radius: 10px; overflow: hidden;">
            <thead style="background: #147c7f; color: white;">
                <tr>
                    <th style="padding: 10px; text-align: left;">Client</th>
                    <th style="padding: 10px;">Contact</th>
                    <th style="padding: 10px;">Visites</th>
                    <th style="padding: 10px;">Couverts Total</th>
                    <th style="padding: 10px;">Première Visite</th>
                    <th style="padding: 10px;">Dernière Visite</th>
                    <th style="padding: 10px;">Fidélité</th>
                </tr>
            </thead>
            <tbody>
                ${clients.map(client => {
                    const daysSinceFirst = Math.floor((new Date() - new Date(client.firstVisit)) / (1000 * 60 * 60 * 24));
                    const loyalty = client.totalVisits >= 5 ? '⭐️ VIP' : 
                                  client.totalVisits >= 3 ? '💎 Fidèle' : 
                                  client.totalVisits >= 2 ? '🌟 Régulier' : '🆕 Nouveau';
                    
                    return `
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 10px;"><strong>${client.name}</strong></td>
                            <td style="padding: 10px;">
                                ${client.email ? `📧 ${client.email}<br>` : ''}
                                ${client.phone ? `📱 ${client.phone}` : ''}
                            </td>
                            <td style="padding: 10px; text-align: center;"><strong>${client.totalVisits}</strong></td>
                            <td style="padding: 10px; text-align: center;">${client.totalCovers}</td>
                            <td style="padding: 10px;">${new Date(client.firstVisit).toLocaleDateString('fr-FR')}</td>
                            <td style="padding: 10px;">${new Date(client.lastVisit).toLocaleDateString('fr-FR')}</td>
                            <td style="padding: 10px; text-align: center;">${loyalty}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    
    // Mettre à jour le titre
    document.getElementById('reservations-title').textContent = '👥 Fichier Clients';
}

// Export CSV des clients
function exportClients() {
    const clients = extractClients();
    let csv = 'Nom,Email,Téléphone,Visites,Couverts Total,Première Visite,Dernière Visite\n';
    
    clients.forEach(client => {
        csv += `"${client.name}","${client.email}","${client.phone}",${client.totalVisits},${client.totalCovers},"${new Date(client.firstVisit).toLocaleDateString('fr-FR')}","${new Date(client.lastVisit).toLocaleDateString('fr-FR')}"\n`;
    });
    
    // Créer un blob et télécharger
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `clients_murmure_des_flots_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// Recherche de clients
function searchClients(e) {
    const search = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#clients-container tbody tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(search) ? '' : 'none';
    });
}

// Vue Semaine - Planning hebdomadaire
function displayWeekView() {
    const weekSection = document.getElementById('week-section');
    const weekContainer = document.getElementById('week-container');
    const reservationsContainer = document.getElementById('reservations-container');
    
    reservationsContainer.style.display = 'none';
    weekSection.style.display = 'block';
    
    // Obtenir les dates de la semaine
    const today = new Date();
    const currentDay = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - currentDay + 1); // Lundi
    
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        weekDays.push(date);
    }
    
    // Grouper les réservations par jour
    const reservationsByDay = {};
    weekDays.forEach(day => {
        const dayStr = day.toDateString();
        reservationsByDay[dayStr] = {
            date: day,
            midi: [],
            soir: []
        };
    });
    
    reservations.forEach(res => {
        const resDate = new Date(res.date);
        const dayStr = resDate.toDateString();
        if (reservationsByDay[dayStr]) {
            const hour = parseInt(res.time.split(':')[0]);
            if (hour < 15) {
                reservationsByDay[dayStr].midi.push(res);
            } else {
                reservationsByDay[dayStr].soir.push(res);
            }
        }
    });
    
    // Afficher le planning
    weekContainer.innerHTML = `
        <h2 style="margin-bottom: 20px;">📆 Planning de la Semaine</h2>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">
            ${weekDays.map(day => {
                const dayStr = day.toDateString();
                const dayData = reservationsByDay[dayStr];
                const dayName = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][day.getDay()];
                const isToday = dayStr === today.toDateString();
                const dateISO = day.toISOString().split('T')[0];

                const midiCount = dayData.midi.reduce((sum, r) => sum + r.numberOfPeople, 0);
                const soirCount = dayData.soir.reduce((sum, r) => sum + r.numberOfPeople, 0);

                return `
                    <div style="background: ${isToday ? '#e3f2fd' : 'white'}; border-radius: 10px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                        <h3 style="text-align: center; color: #147c7f; margin-bottom: 10px;">
                            ${dayName}<br>
                            <small>${day.getDate()}/${day.getMonth() + 1}</small>
                        </h3>
                        <div class="week-service-card" data-date="${dateISO}" data-service="midi" style="margin-bottom: 10px; padding: 10px; background: #fff3cd; border-radius: 5px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;">
                            <strong>☀️ Midi</strong><br>
                            ${dayData.midi.length} rés. / ${midiCount} couv.<br>
                            <div style="width: 100%; background: #e9ecef; height: 10px; border-radius: 5px; margin-top: 5px;">
                                <div style="width: ${(midiCount/50)*100}%; background: ${midiCount >= 50 ? '#dc3545' : midiCount >= 40 ? '#ffc107' : '#28a745'}; height: 10px; border-radius: 5px;"></div>
                            </div>
                        </div>
                        <div class="week-service-card" data-date="${dateISO}" data-service="soir" style="padding: 10px; background: #d1ecf1; border-radius: 5px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;">
                            <strong>🌙 Soir</strong><br>
                            ${dayData.soir.length} rés. / ${soirCount} couv.<br>
                            <div style="width: 100%; background: #e9ecef; height: 10px; border-radius: 5px; margin-top: 5px;">
                                <div style="width: ${(soirCount/50)*100}%; background: ${soirCount >= 50 ? '#dc3545' : soirCount >= 40 ? '#ffc107' : '#28a745'}; height: 10px; border-radius: 5px;"></div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    // Ajouter les événements de clic sur les cartes
    document.querySelectorAll('.week-service-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'scale(1.05)';
            card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'scale(1)';
            card.style.boxShadow = 'none';
        });
        card.addEventListener('click', () => {
            const date = card.dataset.date;
            const service = card.dataset.service;
            showDayServiceReservations(date, service);
        });
    });

    document.getElementById('reservations-title').textContent = '📆 Planning de la Semaine';
}

// Vue Statistiques
function displayStatistics() {
    const statsSection = document.getElementById('statistics-section');
    const statsContainer = document.getElementById('statistics-container');
    const reservationsContainer = document.getElementById('reservations-container');
    
    reservationsContainer.style.display = 'none';
    statsSection.style.display = 'block';
    
    // Calculer les statistiques
    const stats = {
        totalReservations: reservations.length,
        totalCovers: reservations.reduce((sum, r) => sum + r.numberOfPeople, 0),
        avgCovers: (reservations.reduce((sum, r) => sum + r.numberOfPeople, 0) / reservations.length).toFixed(1),
        confirmedRate: ((reservations.filter(r => r.status === 'confirmed').length / reservations.length) * 100).toFixed(1)
    };
    
    // Statistiques par jour de la semaine
    const dayStats = {};
    ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].forEach(day => {
        dayStats[day] = { midi: 0, soir: 0 };
    });
    
    reservations.forEach(res => {
        const date = new Date(res.date);
        const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
        const dayName = dayNames[date.getDay()];
        const hour = parseInt(res.time.split(':')[0]);
        
        if (hour < 15) {
            dayStats[dayName].midi += res.numberOfPeople;
        } else {
            dayStats[dayName].soir += res.numberOfPeople;
        }
    });
    
    // Top clients
    const clients = extractClients();
    const topClients = clients.slice(0, 5);
    
    statsContainer.innerHTML = `
        <h2 style="margin-bottom: 20px;">📊 Statistiques du Restaurant</h2>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
            <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <h3 style="color: #147c7f;">📋 Total Réservations</h3>
                <p style="font-size: 36px; font-weight: bold; margin: 10px 0;">${stats.totalReservations}</p>
            </div>
            <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <h3 style="color: #147c7f;">👥 Total Couverts</h3>
                <p style="font-size: 36px; font-weight: bold; margin: 10px 0;">${stats.totalCovers}</p>
            </div>
            <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <h3 style="color: #147c7f;">📊 Moyenne/Réservation</h3>
                <p style="font-size: 36px; font-weight: bold; margin: 10px 0;">${stats.avgCovers}</p>
            </div>
            <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <h3 style="color: #147c7f;">✅ Taux Confirmation</h3>
                <p style="font-size: 36px; font-weight: bold; margin: 10px 0;">${stats.confirmedRate}%</p>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div style="background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <h3 style="color: #147c7f; margin-bottom: 15px;">📅 Affluence par Jour</h3>
                ${Object.entries(dayStats).map(([day, data]) => `
                    <div style="margin-bottom: 10px;">
                        <strong>${day}</strong>
                        <div style="display: flex; gap: 10px; margin-top: 5px;">
                            <div style="flex: 1;">
                                <small>Midi: ${data.midi} couv.</small>
                                <div style="width: 100%; background: #e9ecef; height: 8px; border-radius: 4px;">
                                    <div style="width: ${Math.min((data.midi/100)*100, 100)}%; background: #ffc107; height: 8px; border-radius: 4px;"></div>
                                </div>
                            </div>
                            <div style="flex: 1;">
                                <small>Soir: ${data.soir} couv.</small>
                                <div style="width: 100%; background: #e9ecef; height: 8px; border-radius: 4px;">
                                    <div style="width: ${Math.min((data.soir/100)*100, 100)}%; background: #6f42c1; height: 8px; border-radius: 4px;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <h3 style="color: #147c7f; margin-bottom: 15px;">🏆 Top 5 Clients</h3>
                ${topClients.map((client, index) => `
                    <div style="display: flex; justify-content: space-between; padding: 10px; background: ${index % 2 ? '#f8f9fa' : 'white'}; border-radius: 5px; margin-bottom: 5px;">
                        <span><strong>${index + 1}.</strong> ${client.name}</span>
                        <span>${client.totalVisits} visites / ${client.totalCovers} couv.</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    document.getElementById('reservations-title').textContent = '📊 Statistiques';
}

// Afficher les réservations d'un jour et service spécifique (depuis le planning semaine)
function showDayServiceReservations(dateISO, service) {
    const weekSection = document.getElementById('week-section');
    const reservationsContainer = document.getElementById('reservations-container');

    // Masquer la vue semaine, afficher les réservations
    weekSection.style.display = 'none';
    reservationsContainer.style.display = 'block';

    const selectedDate = new Date(dateISO);
    const dayReservations = reservations.filter(r => {
        const resDate = new Date(r.date);
        return resDate.toDateString() === selectedDate.toDateString();
    });

    // Filtrer par service
    const filteredReservations = dayReservations.filter(r => {
        const hour = parseInt(r.time.split(':')[0]);
        if (service === 'midi') {
            return hour < 15;
        } else {
            return hour >= 15;
        }
    });

    // Trier par heure
    filteredReservations.sort((a, b) => {
        const timeA = a.time.split(':').map(Number);
        const timeB = b.time.split(':').map(Number);
        return (timeA[0] * 60 + timeA[1]) - (timeB[0] * 60 + timeB[1]);
    });

    const serviceName = service === 'midi' ? '☀️ Midi' : '🌙 Soir';
    const dateFormatted = selectedDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const totalCovers = filteredReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);

    // Mettre à jour le titre
    document.getElementById('reservations-title').textContent = `${serviceName} - ${dateFormatted}`;

    // Afficher les réservations
    reservationsContainer.innerHTML = `
        <div style="margin-bottom: 20px;">
            <button id="back-to-week-btn" style="background: #147c7f; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-bottom: 15px;">
                ← Retour au planning
            </button>
            <div style="background: ${service === 'midi' ? '#fff3cd' : '#d1ecf1'}; padding: 15px; border-radius: 10px;">
                <h3>${serviceName} - ${dateFormatted}</h3>
                <p style="font-size: 20px; font-weight: bold;">${totalCovers} couverts / ${filteredReservations.length} réservations</p>
            </div>
        </div>
        ${filteredReservations.length === 0 ? `
            <div style="text-align: center; padding: 40px; color: #666;">
                <p style="font-size: 18px;">Aucune réservation pour ce service</p>
            </div>
        ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
                ${filteredReservations.map(reservation => `
                    <div class="reservation-card clickable-card" data-id="${reservation._id}" style="cursor: pointer;">
                        <div class="reservation-header">
                            <div class="reservation-time">${reservation.time}</div>
                            <span class="reservation-status status-${reservation.status}">${getStatusText(reservation.status)}</span>
                        </div>
                        <div class="reservation-info">
                            <div class="info-row">
                                <span class="info-label">Nom:</span>
                                <strong>${reservation.customerName}</strong>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Téléphone:</span>
                                ${reservation.phoneNumber}
                            </div>
                            <div class="info-row">
                                <span class="info-label">Personnes:</span>
                                ${reservation.numberOfPeople}
                            </div>
                            ${reservation.specialRequests ? `
                            <div class="info-row">
                                <span class="info-label">Notes:</span>
                                ${reservation.specialRequests}
                            </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `}
    `;

    // Bouton retour
    document.getElementById('back-to-week-btn').addEventListener('click', () => {
        currentView = 'week';
        displayWeekView();
    });

    // Clic sur les cartes de réservation
    document.querySelectorAll('.clickable-card').forEach(card => {
        card.addEventListener('click', () => {
            const resId = card.dataset.id;
            const reservation = reservations.find(r => r._id === resId);
            if (reservation) {
                showReservationDetails(reservation);
            }
        });
    });
}

// Vue À confirmer - Toutes les réservations en attente
function displayPendingReservations() {
    const pendingSection = document.getElementById('pending-section');
    const pendingContainer = document.getElementById('pending-container');
    const reservationsContainer = document.getElementById('reservations-container');

    reservationsContainer.style.display = 'none';
    pendingSection.style.display = 'block';

    // Filtrer les réservations en attente (futures uniquement)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendingReservations = reservations.filter(r => {
        const resDate = new Date(r.date);
        resDate.setHours(0, 0, 0, 0);
        return r.status === 'pending' && resDate >= today;
    });

    // Trier par date puis par heure
    pendingReservations.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA.getTime() !== dateB.getTime()) {
            return dateA - dateB;
        }
        const timeA = a.time.split(':').map(Number);
        const timeB = b.time.split(':').map(Number);
        return (timeA[0] * 60 + timeA[1]) - (timeB[0] * 60 + timeB[1]);
    });

    const totalCovers = pendingReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);

    pendingContainer.innerHTML = `
        <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <div style="background: #fff3cd; padding: 15px 25px; border-radius: 10px; border-left: 5px solid #ffc107;">
                <h3 style="margin: 0; color: #856404;">⏳ Réservations en attente</h3>
                <p style="margin: 5px 0 0 0; font-size: 18px;"><strong>${pendingReservations.length}</strong> réservations / <strong>${totalCovers}</strong> couverts</p>
            </div>
            ${pendingReservations.length > 0 ? `
                <button id="confirm-all-btn" style="background: #28a745; color: white; border: none; padding: 15px 30px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; transition: background 0.2s;">
                    ✅ Tout confirmer (${pendingReservations.length})
                </button>
            ` : ''}
        </div>

        ${pendingReservations.length === 0 ? `
            <div style="text-align: center; padding: 60px; color: #666; background: #f8f9fa; border-radius: 10px;">
                <p style="font-size: 48px; margin: 0;">🎉</p>
                <p style="font-size: 20px; margin: 15px 0 0 0;">Aucune réservation en attente !</p>
                <p style="font-size: 14px; color: #999;">Toutes les réservations ont été traitées.</p>
            </div>
        ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px;">
                ${pendingReservations.map(reservation => {
                    const resDate = new Date(reservation.date);
                    const dateStr = resDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
                    const hour = parseInt(reservation.time.split(':')[0]);
                    const service = hour < 15 ? '☀️ Midi' : '🌙 Soir';

                    return `
                        <div class="pending-card" data-id="${reservation._id}" style="background: white; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #ffc107; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <span style="font-weight: bold; font-size: 16px;">${reservation.customerName}</span>
                                <span style="background: #fff3cd; color: #856404; padding: 3px 10px; border-radius: 15px; font-size: 12px;">En attente</span>
                            </div>
                            <div style="color: #666; font-size: 14px;">
                                <p style="margin: 5px 0;">📅 ${dateStr} - ${reservation.time} ${service}</p>
                                <p style="margin: 5px 0;">👥 ${reservation.numberOfPeople} personne${reservation.numberOfPeople > 1 ? 's' : ''}</p>
                                <p style="margin: 5px 0;">📱 ${reservation.phoneNumber}</p>
                                ${reservation.specialRequests ? `<p style="margin: 5px 0; font-style: italic;">💬 ${reservation.specialRequests}</p>` : ''}
                            </div>
                            <div style="display: flex; gap: 10px; margin-top: 15px;">
                                <button class="confirm-single-btn" data-id="${reservation._id}" style="flex: 1; background: #28a745; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer;">✅ Confirmer</button>
                                <button class="cancel-single-btn" data-id="${reservation._id}" style="flex: 1; background: #dc3545; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer;">❌ Annuler</button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `}
    `;

    // Bouton tout confirmer
    const confirmAllBtn = document.getElementById('confirm-all-btn');
    if (confirmAllBtn) {
        confirmAllBtn.addEventListener('mouseenter', () => {
            confirmAllBtn.style.background = '#218838';
        });
        confirmAllBtn.addEventListener('mouseleave', () => {
            confirmAllBtn.style.background = '#28a745';
        });
        confirmAllBtn.addEventListener('click', async () => {
            if (confirm(`Confirmer les ${pendingReservations.length} réservations en attente ?`)) {
                confirmAllBtn.disabled = true;
                confirmAllBtn.textContent = '⏳ Confirmation en cours...';

                let successCount = 0;
                for (const reservation of pendingReservations) {
                    try {
                        const response = await fetch(`https://restaurant-booking-backend-y3sp.onrender.com/api/reservations/${reservation._id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'confirmed' })
                        });
                        if (response.ok) successCount++;
                    } catch (error) {
                        console.error('Erreur confirmation:', error);
                    }
                }

                showNotification('Succès', `${successCount} réservation(s) confirmée(s)`);
                loadReservations();
            }
        });
    }

    // Boutons individuels confirmer/annuler
    document.querySelectorAll('.confirm-single-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            updateReservationStatus(btn.dataset.id, 'confirmed');
        });
    });

    document.querySelectorAll('.cancel-single-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Annuler cette réservation ?')) {
                updateReservationStatus(btn.dataset.id, 'cancelled');
            }
        });
    });

    // Clic sur les cartes pour voir les détails
    document.querySelectorAll('.pending-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-2px)';
            card.style.boxShadow = '0 4px 15px rgba(0,0,0,0.15)';
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(0)';
            card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        });
        card.addEventListener('click', () => {
            const reservation = reservations.find(r => r._id === card.dataset.id);
            if (reservation) {
                showReservationDetails(reservation);
            }
        });
    });

    document.getElementById('reservations-title').textContent = '⏳ À confirmer';
}

// Vue Aujourd'hui améliorée
function displayTodayView() {
    const reservationsContainer = document.getElementById('reservations-container');
    const today = new Date().toDateString();
    const todayReservations = reservations.filter(r => 
        new Date(r.date).toDateString() === today
    );
    
    // Séparer midi et soir
    const midiReservations = todayReservations.filter(r => {
        const hour = parseInt(r.time.split(':')[0]);
        return hour < 15;
    });
    
    const soirReservations = todayReservations.filter(r => {
        const hour = parseInt(r.time.split(':')[0]);
        return hour >= 15;
    });
    
    const midiCovers = midiReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const soirCovers = soirReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    
    // Afficher avec séparation claire midi/soir
    reservationsContainer.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
            <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); padding: 15px; border-radius: 10px;">
                <h3>☀️ Service du Midi (12h00 - 13h15)</h3>
                <p style="font-size: 24px; font-weight: bold;">${midiCovers}/50 couverts</p>
                <p>${midiReservations.length} réservations</p>
                <div style="width: 100%; background: rgba(255,255,255,0.5); height: 10px; border-radius: 5px; margin-top: 10px;">
                    <div style="width: ${(midiCovers/50)*100}%; background: ${midiCovers >= 50 ? '#dc3545' : midiCovers >= 40 ? '#ffc107' : '#28a745'}; height: 10px; border-radius: 5px;"></div>
                </div>
            </div>
            <div style="background: linear-gradient(135deg, #d1ecf1 0%, #a8d8ea 100%); padding: 15px; border-radius: 10px;">
                <h3>🌙 Service du Soir (18h30 - 21h00)</h3>
                <p style="font-size: 24px; font-weight: bold;">${soirCovers}/50 couverts</p>
                <p>${soirReservations.length} réservations</p>
                <div style="width: 100%; background: rgba(255,255,255,0.5); height: 10px; border-radius: 5px; margin-top: 10px;">
                    <div style="width: ${(soirCovers/50)*100}%; background: ${soirCovers >= 50 ? '#dc3545' : soirCovers >= 40 ? '#ffc107' : '#28a745'}; height: 10px; border-radius: 5px;"></div>
                </div>
            </div>
        </div>
        
        <h3 style="margin-bottom: 10px;">☀️ Midi - ${midiReservations.length} réservations</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; margin-bottom: 30px;">
            ${midiReservations.map(reservation => `
                <div class="reservation-card ${reservation.status}" data-id="${reservation._id}">
                    <div class="reservation-time">${reservation.time}</div>
                    <div class="reservation-name">${reservation.customerName}</div>
                    <div class="reservation-details">
                        <span>👥 ${reservation.numberOfPeople} personnes</span>
                        ${reservation.phone ? `<span>📱 ${reservation.phone}</span>` : ''}
                    </div>
                    ${reservation.specialRequests ? `<div class="reservation-note">📝 ${reservation.specialRequests}</div>` : ''}
                    <div class="reservation-status status-${reservation.status}">
                        ${reservation.status === 'confirmed' ? '✅ Confirmée' : 
                          reservation.status === 'cancelled' ? '❌ Annulée' : 
                          '⏳ En attente'}
                    </div>
                </div>
            `).join('')}
        </div>
        
        <h3 style="margin-bottom: 10px;">🌙 Soir - ${soirReservations.length} réservations</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
            ${soirReservations.map(reservation => `
                <div class="reservation-card ${reservation.status}" data-id="${reservation._id}">
                    <div class="reservation-time">${reservation.time}</div>
                    <div class="reservation-name">${reservation.customerName}</div>
                    <div class="reservation-details">
                        <span>👥 ${reservation.numberOfPeople} personnes</span>
                        ${reservation.phone ? `<span>📱 ${reservation.phone}</span>` : ''}
                    </div>
                    ${reservation.specialRequests ? `<div class="reservation-note">📝 ${reservation.specialRequests}</div>` : ''}
                    <div class="reservation-status status-${reservation.status}">
                        ${reservation.status === 'confirmed' ? '✅ Confirmée' : 
                          reservation.status === 'cancelled' ? '❌ Annulée' : 
                          '⏳ En attente'}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Demander la permission pour les notifications
if ('Notification' in window) {
    Notification.requestPermission();
}

// Initialisation quand le DOM est prêt
document.addEventListener('DOMContentLoaded', () => {
    // Gestion de la navigation
    document.querySelectorAll('[data-view]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.view;
            
            // Mettre à jour la vue actuelle
            currentView = view;
            
            // Mettre à jour les classes actives
            document.querySelectorAll('[data-view]').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Masquer/afficher les sections appropriées
            const clientsSection = document.getElementById('clients-section');
            const weekSection = document.getElementById('week-section');
            const statsSection = document.getElementById('statistics-section');
            const pendingSection = document.getElementById('pending-section');
            const reservationsContainer = document.getElementById('reservations-container');
            const filters = document.querySelector('.filters');

            clientsSection.style.display = 'none';
            weekSection.style.display = 'none';
            statsSection.style.display = 'none';
            pendingSection.style.display = 'none';

            if (view === 'clients') {
                reservationsContainer.style.display = 'none';
                clientsSection.style.display = 'block';
                if (filters) filters.style.display = 'none';
                displayClients();
            } else if (view === 'week') {
                reservationsContainer.style.display = 'none';
                weekSection.style.display = 'block';
                if (filters) filters.style.display = 'none';
                displayWeekView();
            } else if (view === 'statistics') {
                reservationsContainer.style.display = 'none';
                statsSection.style.display = 'block';
                if (filters) filters.style.display = 'none';
                displayStatistics();
            } else if (view === 'pending') {
                reservationsContainer.style.display = 'none';
                pendingSection.style.display = 'block';
                if (filters) filters.style.display = 'none';
                displayPendingReservations();
            } else if (view === 'today') {
                reservationsContainer.style.display = 'block';
                if (filters) filters.style.display = 'flex';
                document.getElementById('reservations-title').textContent = "📅 Aujourd'hui";
                displayTodayView();
            } else {
                reservationsContainer.style.display = 'grid';
                if (filters) filters.style.display = 'flex';
                displayReservations();
            }
        });
    });
    
    // Initialiser les boutons d'export et de recherche
    const exportBtn = document.getElementById('export-clients-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportClients);
    }
    
    const clientSearch = document.getElementById('client-search');
    if (clientSearch) {
        clientSearch.addEventListener('input', searchClients);
    }
    
    // Gestion du formulaire de nouvelle réservation
    const addReservationBtn = document.getElementById('add-reservation-btn');
    const newReservationModal = document.getElementById('new-reservation-modal');
    const closeNewModal = document.querySelector('.close-new-modal');
    const cancelNewBtn = document.getElementById('cancel-new-btn');
    const newReservationForm = document.getElementById('new-reservation-form');
    
    // Ouvrir le modal
    if (addReservationBtn) {
        addReservationBtn.addEventListener('click', () => {
            newReservationModal.style.display = 'block';
            // Définir la date par défaut à aujourd'hui
            document.getElementById('new-date').valueAsDate = new Date();
        });
    }
    
    // Fermer le modal
    if (closeNewModal) {
        closeNewModal.addEventListener('click', () => {
            newReservationModal.style.display = 'none';
            newReservationForm.reset();
        });
    }
    
    if (cancelNewBtn) {
        cancelNewBtn.addEventListener('click', () => {
            newReservationModal.style.display = 'none';
            newReservationForm.reset();
        });
    }
    
    // Soumettre le formulaire
    if (newReservationForm) {
        newReservationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = {
                customerName: document.getElementById('new-name').value,
                date: document.getElementById('new-date').value,
                time: document.getElementById('new-time').value,
                numberOfPeople: parseInt(document.getElementById('new-people').value),
                phoneNumber: document.getElementById('new-phone').value, // Corriger phone en phoneNumber
                email: document.getElementById('new-email').value || '',
                specialRequests: document.getElementById('new-requests').value || '',
                status: 'confirmed', // Les réservations créées depuis l'app sont confirmées automatiquement
                source: 'desktop' // Ajouter la source requise
            };
            
            // DEBUG: Afficher les données envoyées
            console.log('Données envoyées:', formData);
            alert('DEBUG - Données envoyées:\n' + JSON.stringify(formData, null, 2));
            
            try {
                // Utiliser la route desktop qui permet jusqu'à 80 couverts
                const response = await fetch('https://restaurant-booking-backend-y3sp.onrender.com/api/reservations/desktop', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(formData)
                });
                
                const result = await response.json();
                
                // DEBUG: Afficher la réponse d'erreur
                console.log('Réponse du serveur:', result);
                if (!result.success) {
                    alert('DEBUG - Erreur serveur:\n' + JSON.stringify(result, null, 2));
                }
                
                if (result.success) {
                    // Afficher une notification de succès
                    showNotification('Succès', 'Réservation créée avec succès');
                    
                    // Fermer le modal et réinitialiser le formulaire
                    newReservationModal.style.display = 'none';
                    newReservationForm.reset();
                    
                    // Recharger les réservations
                    loadReservations();
                } else {
                    alert('Erreur: ' + result.message);
                }
            } catch (error) {
                console.error('Erreur lors de la création de la réservation:', error);
                alert('Erreur lors de la création de la réservation');
            }
        });
    }
    
    // Fermer le modal en cliquant en dehors
    window.addEventListener('click', (event) => {
        if (event.target === newReservationModal) {
            newReservationModal.style.display = 'none';
            newReservationForm.reset();
        }
    });

    // QR Code pour accès tablette
    const qrModal = document.getElementById('qr-modal');
    const showQrBtn = document.getElementById('show-qr-btn');
    const closeQrModal = document.querySelector('.close-qr-modal');
    const qrCodeImg = document.getElementById('qr-code-img');
    const adminUrlDisplay = document.getElementById('admin-url-display');
    const copyUrlBtn = document.getElementById('copy-url-btn');

    const ADMIN_URL = 'https://restaurant-booking-backend-y3sp.onrender.com/admin/';

    if (showQrBtn) {
        showQrBtn.addEventListener('click', () => {
            // Générer le QR code via API
            const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(ADMIN_URL)}`;
            qrCodeImg.src = qrApiUrl;
            adminUrlDisplay.textContent = ADMIN_URL;
            qrModal.style.display = 'block';
        });
    }

    if (closeQrModal) {
        closeQrModal.addEventListener('click', () => {
            qrModal.style.display = 'none';
        });
    }

    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(ADMIN_URL).then(() => {
                copyUrlBtn.textContent = '✅ Copié !';
                setTimeout(() => {
                    copyUrlBtn.textContent = '📋 Copier l\'URL';
                }, 2000);
            });
        });
    }

    // Fermer le QR modal en cliquant en dehors
    window.addEventListener('click', (event) => {
        if (event.target === qrModal) {
            qrModal.style.display = 'none';
        }
    });

    // Charger les réservations au démarrage
    console.log('Chargement des réservations au démarrage...');
    loadReservations();
});