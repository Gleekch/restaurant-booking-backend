function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function safeReservationId(value) {
    return /^[a-f0-9]{24}$/i.test(String(value)) ? String(value) : '';
}

const api = window.api;
const ipcRenderer = {
    on(eventName, callback) {
        return api.onReservationEvent(eventName, (payload) => callback(null, payload));
    }
};

// État de l'application
let reservations = [];
let currentFilter = 'all';
let currentView = 'today';
let currentServiceFilter = 'all';
let serviceDetailState = null;
let editingReservationId = null;
let reservationSubmitBusy = false;
let reservationSubmitKey = null;
let reservationSubmitFingerprint = null;
let floorPlanTarget = null;
let notifiedReservations = new Set();

// Limite couverts en ligne — miroir de ONLINE_CAPACITY côté backend (défaut 50)
const ONLINE_CAPACITY_LIMIT = 50;

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
const weekSection = document.getElementById('week-section');
const floorPlanSection = document.getElementById('floor-plan-section');
const monthSection = document.getElementById('month-section');
const statisticsSection = document.getElementById('statistics-section');
const clientsSection = document.getElementById('clients-section');
const serviceDetailSection = document.getElementById('service-detail-section');
const weekContainer = document.getElementById('week-container');
const monthContainer = document.getElementById('month-container');
const serviceDetailContainer = document.getElementById('service-detail-container');
const pendingSection = document.getElementById('pending-section');
const pendingContainer = document.getElementById('pending-container');

function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseDateInput(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function getDayKey(value) {
    const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? parseDateInput(value)
        : new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.toDateString();
}

function isActiveReservation(reservation) {
    // Exclut les annulées ET les réservations non payées (awaiting-payment, transitoires)
    return !['cancelled', 'awaiting-payment'].includes(reservation.status);
}

function getReservationService(reservation) {
    const hour = parseInt(reservation.time.split(':')[0], 10);
    return hour < 15 ? 'midi' : 'soir';
}

function getReservationsForDate(dateValue) {
    const targetDay = getDayKey(dateValue);
    return reservations.filter((reservation) => getDayKey(reservation.date) === targetDay);
}

function getServiceReservations(dateValue, service) {
    return getReservationsForDate(dateValue).filter((reservation) => getReservationService(reservation) === service);
}

function getServiceSummary(serviceReservations) {
    const activeReservations = serviceReservations.filter(isActiveReservation);
    return {
        totalReservations: activeReservations.length,
        totalCovers: activeReservations.reduce((sum, reservation) => sum + reservation.numberOfPeople, 0),
        cancelledCount: serviceReservations.length - activeReservations.length
    };
}

function getLoadClass(totalCovers, limit = ONLINE_CAPACITY_LIMIT) {
    if (totalCovers >= limit) {
        return 'danger';
    }

    if (totalCovers >= limit * 0.8) {
        return 'warning';
    }

    return '';
}

async function updateRecommendedHours(selectedDate) {
    const nodes = ['midi', 'soir'].map(service => document.getElementById(`wave-recommended-${service}`));
    const request = {};
    nodes.filter(Boolean).forEach(node => { node.__recommendationRequest = request; node.textContent = ''; });
    const current = node => node?.isConnected && node.__recommendationRequest === request;
    try {
        const data = await api.getAvailability(selectedDate, 2);
        if (!data?.success) throw new Error('Availability unavailable');
        if (!data.data?.meta?.recommendationsEnabled) return;
        const recommended = slots => slots.filter(s => s.available && s.status === 'recommended'
            && /^\d{2}:\d{2}$/.test(s.time));
        const midi = recommended(data.data.midi || []).map(s => s.time).join(', ');
        const soir = recommended(data.data.soir || []).filter(s => s.time >= '18:00' && s.time <= '21:30');
        const tapas = soir.filter(s => s.time < '19:00').map(s => s.time).join(', ');
        const dinner = soir.filter(s => s.time >= '19:00').map(s => s.time).join(', ');
        if (current(nodes[0]) && midi) nodes[0].textContent = `Conseils pour 2 personnes : ${midi}`;
        if (current(nodes[1]) && (tapas || dinner)) nodes[1].textContent = 'Conseils pour 2 personnes : '
            + [tapas && `Tapas ${tapas}`, dinner && `Dîner ${dinner}`].filter(Boolean).join(' ; ');
    } catch (_) {
        nodes.filter(current).forEach(node => { node.textContent = 'Conseils horaires indisponibles.'; });
    }
}

function getSelectedDateValue() {
    return dateFilter && dateFilter.value ? dateFilter.value : formatDateInput(new Date());
}

function formatLongDate(dateValue) {
    const date = typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
        ? parseDateInput(dateValue)
        : new Date(dateValue);
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function hideSections() {
    [reservationsContainer, clientsSection, weekSection, monthSection, floorPlanSection,
     statisticsSection, serviceDetailSection, pendingSection].forEach(el => {
        if (el) el.style.display = 'none';
    });
}

async function switchView(view) {
    if (currentView === 'floor-plan' && view !== currentView && !await window.FloorPlan.canLeave(floorPlanSection)) return;
    currentView = view;
    document.querySelectorAll('[data-view]').forEach((link) => {
        link.classList.toggle('active', link.dataset.view === view);
    });
    displayReservations();
}

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

ipcRenderer.on('show-notification', (event, notification) => {
    if (notification) {
        showNotification(notification.title, notification.body);
    }
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
        Object.assign(reservations[index], reservation);
        displayReservations();
        updateStats();
        if (modal.style.display === 'block' && modal.dataset.reservationId === reservation._id) {
            showReservationDetails(reservations[index]);
        }
    }
});

// Annulation de réservation
ipcRenderer.on('cancel-reservation', (event, reservation) => {
    const index = reservations.findIndex(r => r._id === reservation._id);
    if (index !== -1) {
        Object.assign(reservations[index], reservation);
        displayReservations();
        updateStats();
        if (modal.style.display === 'block' && modal.dataset.reservationId === reservation._id) {
            showReservationDetails(reservations[index]);
        }
    }
});

// Charger les réservations
async function loadReservations() {
    console.log('Tentative de chargement des réservations...');
    try {
        const data = await api.getReservations();
        console.log('Données reçues:', data);
        if (data.success) {
            reservations = data.data;
            console.log(`${reservations.length} réservations chargées`);

            // Si aucune réservation aujourd'hui, pointer vers la prochaine date avec des réservations
            const todayKey = getDayKey(new Date());
            const todayHasReservations = reservations.some(r => getDayKey(r.date) === todayKey);
            if (!todayHasReservations && reservations.length > 0) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const futureDates = reservations
                    .filter(r => {
                        const d = new Date(r.date);
                        d.setHours(0, 0, 0, 0);
                        return d >= today && !['cancelled', 'awaiting-payment'].includes(r.status);
                    })
                    .map(r => new Date(r.date))
                    .sort((a, b) => a - b);
                if (futureDates.length > 0 && dateFilter) {
                    dateFilter.value = formatDateInput(futureDates[0]);
                }
            }

            displayReservations();
            updateStats();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des réservations:', error);
    }
}

// Afficher les réservations
function displayReservations() {
    window.ReservationChanges?.updateQueue(reservations, showReservationDetails);
    hideSections();

    if (currentView === 'floor-plan') {
        floorPlanSection.style.display = 'block';
        reservationsTitle.textContent = 'Plan de salle';
        document.querySelector('.filters').style.display = 'none';
        window.FloorPlan.mount(floorPlanSection, {
            date: floorPlanTarget?.date || getSelectedDateValue(),
            service: floorPlanTarget?.service,
            reservationId: floorPlanTarget?.reservationId,
            request: (endpoint, options) => api.apiRequest(endpoint, options),
            onSaved: () => { loadReservations(); },
            onOpenReservation: id => { const r = reservations.find(r => r._id === id); if (r) showReservationDetails(r); }
        });
        floorPlanTarget = null;
        return;
    }

    if (currentView === 'service-detail') {
        displayServiceDetail();
        return;
    }

    // Gérer les vues spéciales
    if (currentView === 'pending') {
        displayPending();
        return;
    } else if (currentView === 'clients') {
        displayClients();
        return;
    } else if (currentView === 'week') {
        displayWeekView();
        return;
    } else if (currentView === 'month') {
        displayMonthView();
        return;
    } else if (currentView === 'statistics') {
        displayStatistics();
        return;
    } else if (currentView === 'today') {
        displayTodayView();
        return;
    }
    
    reservationsContainer.style.display = 'grid';
    const filters = document.querySelector('.filters');
    if (filters) filters.style.display = 'flex';
    let filteredReservations = reservations;
    
    console.log('Affichage des réservations, vue actuelle:', currentView);
    console.log('Nombre total de réservations:', reservations.length);
    
    // Filtrer par vue ou par date sélectionnée
    if (dateFilter && dateFilter.value) {
        // Si une date est sélectionnée, filtrer par cette date
        const selectedDate = getDayKey(dateFilter.value);
        filteredReservations = filteredReservations.filter(r => 
            getDayKey(r.date) === selectedDate
        );
        console.log(`Réservations du ${selectedDate}:`, filteredReservations.length);
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
            const midiActive = serviceMidi.filter(r => !['cancelled', 'awaiting-payment'].includes(r.status));
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
            const soirActive = serviceSoir.filter(r => !['cancelled', 'awaiting-payment'].includes(r.status));
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
    card.className = 'reservation-card status-' + reservation.status;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Voir la réservation de ' + reservation.customerName + ' à ' + reservation.time);
    card.innerHTML = `
        <div class="reservation-header">
            <div class="reservation-time">${escapeHtml(reservation.time)}</div>
            <span class="reservation-status status-${escapeHtml(reservation.status)}">${escapeHtml(getStatusText(reservation.status))}</span>
        </div>
        <div class="card-name">${escapeHtml(reservation.customerName)}</div>
        ${window.ReservationChanges?.badge(reservation) || ''}
        ${clientEmailNotice(reservation)}
        <div class="guest-line"><span><strong>${escapeHtml(reservation.numberOfPeople)}</strong> couverts</span>${window.FloorPlan.tableLabel(reservation)}</div>
        <div class="guest-phone">${escapeHtml(reservation.phoneNumber)}</div>
        <div class="card-deposit">
            ${getDepositText(reservation) ? `<span class="deposit-badge ${escapeHtml(reservation.deposit.status)}">Arrhes ${getDepositText(reservation)}</span>` : ''}
            ${reservation.depositException ? '<span class="deposit-badge exception">Exception sans arrhes</span>' : ''}
            ${reservation.arrivedAt ? '<span class="presence-badge">Client installé</span>' : ''}
        </div>
        ${reservation.specialRequests ? `<div class="card-notes"><strong>Attention particulière</strong>${escapeHtml(reservation.specialRequests)}</div>` : ''}
    `;
    card.addEventListener('click', () => showReservationDetails(reservation));
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); }
    });
    return card;
}

// Obtenir le texte du statut
function getStatusText(status) {
    const statusTexts = {
        'awaiting-payment': 'Paiement en attente',
        pending: 'En attente',
        confirmed: 'Confirmée',
        cancelled: 'Annulée',
        completed: 'Terminée',
        'no-show': 'No-show'
    };
    return statusTexts[status] || status;
}

// Texte d'état des arrhes (vide si pas d'arrhes)
function getDepositText(reservation) {
    const d = reservation.deposit;
    if (!d || !d.required) return '';
    const amount = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((d.amountCents || 0) / 100);
    const labels = {
        awaiting: 'non payées',
        paid: `${amount} payées`,
        refund_pending: 'remboursement en cours',
        refund_failed: 'Remboursement echoue - verification necessaire',
        refund_review: 'Remboursement a verifier dans Stripe',
        deducted: `déduites (${amount})`,
        refunded: 'remboursées',
        failed: 'non abouti'
    };
    return labels[d.status] || '';
}

function clientEmailNotice(reservation) {
    const state = reservation.clientNotification?.state;
    if (!state || state === 'sent') return '';
    return `<p class="card-notes" role="status">${state === 'failed' ? 'Email non envoye : contacter le client ou relancer depuis sa fiche.' : 'Email en cours ou a verifier.'}</p>`;
}

// Afficher les détails de la réservation
function showReservationDetails(reservation) {
    modal.dataset.reservationId = reservation._id;
    const details = document.getElementById('reservation-details');
    details.innerHTML = `
        <div class="guest-identity"><p class="eyebrow">Votre hôte</p><h3>${escapeHtml(reservation.customerName)}</h3>
            <span class="reservation-status status-${escapeHtml(reservation.status)}">${escapeHtml(getStatusText(reservation.status))}</span>
            ${reservation.arrivedAt ? '<span class="presence-badge">Client installé</span>' : ''}
        </div>
        <div class="detail-grid">
            <div class="detail-field"><span>Date</span>${new Date(reservation.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <div class="detail-field"><span>Heure</span>${escapeHtml(reservation.time)}</div>
            <div class="detail-field"><span>Couverts</span>${escapeHtml(reservation.numberOfPeople)} personnes</div>
            <div class="detail-field"><span>Tables</span>${window.FloorPlan.tableLabel(reservation)}</div>
            <div class="detail-field"><span>Téléphone</span>${escapeHtml(reservation.phoneNumber)}</div>
            <div class="detail-field"><span>Email</span>${escapeHtml(reservation.email || 'Non renseigné')}</div>
        </div>
        ${getDepositText(reservation) ? `<div class="finance-summary"><span>Arrhes · suivi du paiement</span>${getDepositText(reservation)}</div>` : ''}
        ${window.ReservationChanges?.panel(reservation) || ''}
        ${clientEmailNotice(reservation)}
        ${reservation.email && ['pending', 'confirmed', 'cancelled'].includes(reservation.status) ? '<button type="button" class="btn btn-secondary" id="retry-client-email">Renvoyer l\'email au client</button>' : ''}
        ${window.ServiceRelease.financePanel(false)}
        ${!['cancelled', 'awaiting-payment'].includes(reservation.status) ? '<button type="button" class="btn btn-secondary" id="assign-tables-btn">Attribuer / modifier les tables</button>' : ''}
        <p><strong>Source :</strong> ${escapeHtml(reservation.source)}</p>
        ${reservation.specialRequests ? `<div class="guest-note"><strong>Demandes spéciales</strong>${escapeHtml(reservation.specialRequests)}</div>` : ''}
        ${reservation.notes ? `<div class="guest-note"><strong>Notes de service</strong>${escapeHtml(reservation.notes)}</div>` : ''}
    `;

    details.querySelector('#assign-tables-btn')?.addEventListener('click', async () => {
        if (!await window.FloorPlan.canLeave(floorPlanSection)) return;
        floorPlanTarget = { date: window.FloorPlan.dateOf(reservation), service: window.FloorPlan.serviceOf(reservation), reservationId: reservation._id };
        modal.style.display = 'none';
        switchView('floor-plan');
    });
    window.ReservationChanges?.bind(details, reservation, (endpoint, options) => api.apiRequest(endpoint, options), async () => {
        modal.style.display = 'none';
        await loadReservations();
    });
    const retryEmail = details.querySelector('#retry-client-email');
    if (retryEmail) retryEmail.onclick = async () => {
        if (!confirm('Renvoyer au client un email avec le statut et les horaires actuels ?')) return;
        retryEmail.disabled = true;
        try {
            const result = await api.apiRequest(`/api/reservations/${encodeURIComponent(reservation._id)}/notification/retry`, { method: 'POST' });
            if (!result.success) throw new Error(result.message);
            showNotification('Email', result.message);
            await loadReservations();
            showReservationDetails(result.data);
        } catch (error) { showNotification('Email non envoye', error.message); }
        finally { retryEmail.disabled = false; }
    };
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
    
    // Bouton "Demander les arrhes" : visible si résa active, email présent, arrhes non payées
    const depositRequestBtn = document.getElementById('deposit-request-btn');
    depositRequestBtn.replaceWith(depositRequestBtn.cloneNode(true));
    const newDepositBtn = document.getElementById('deposit-request-btn');
    const canRequestDeposit = reservation.email
        && ['pending', 'confirmed'].includes(reservation.status)
        && (!reservation.deposit || reservation.deposit.status === 'none' || reservation.deposit.status === 'failed');
    newDepositBtn.style.display = 'inline-flex';
    if (canRequestDeposit) {
        newDepositBtn.onclick = () => requestDepositDesktop(reservation._id);
    }

    // Boutons "Client arrivé" / "No-show" : visibles si résa active
    const isActive = ['pending', 'confirmed'].includes(reservation.status);
    const completedBtn = document.getElementById('completed-btn');
    const noshowBtn = document.getElementById('noshow-btn');
    completedBtn.replaceWith(completedBtn.cloneNode(true));
    noshowBtn.replaceWith(noshowBtn.cloneNode(true));
    const newCompletedBtn = document.getElementById('completed-btn');
    const newNoshowBtn = document.getElementById('noshow-btn');
    newCompletedBtn.style.display = isActive ? 'inline-flex' : 'none';
    newNoshowBtn.style.display = isActive ? 'inline-flex' : 'none';
    if (isActive) {
        newCompletedBtn.onclick = () => markReservationOutcome(reservation._id, 'complete');
        newNoshowBtn.onclick = () => markReservationOutcome(reservation._id, 'no-show');
    }

    modal.style.display = 'block';
}

// Marquer l'issue d'une réservation : 'complete' (client arrivé) ou 'no-show'
async function markReservationOutcome(id, kind) {
    if (kind === 'complete' && !window.ServiceRelease.financeEnabled) return window.ServiceRelease.explain();
    const label = kind === 'complete' ? 'arrivé' : 'en no-show';
    if (!confirm(`Marquer ce client comme ${label} ?`)) return;
    try {
        const data = await api.apiRequest(`/api/reservations/${id}/${kind}`, { method: 'POST' });
        if (data.success) {
            modal.style.display = 'none';
            await loadReservations();
            showNotification('Succès', `Client marqué comme ${label}`);
        } else {
            alert(`Erreur : ${data.message}`);
        }
    } catch (error) {
        alert(`Erreur lors de la mise à jour : ${error.message}`);
    }
}

// Demander les arrhes depuis le desktop
async function requestDepositDesktop(id) {
    if (!window.ServiceRelease.financeEnabled) return window.ServiceRelease.explain();
    if (!confirm('Envoyer un lien de paiement des arrhes par email au client ?')) return;
    try {
        const data = await api.apiRequest(`/api/reservations/${id}/deposit/request`, { method: 'POST' });
        if (data.success) {
            modal.style.display = 'none';
            await loadReservations();
            showNotification('Succès', 'Lien de paiement envoyé au client');
        } else {
            alert(`Erreur : ${data.message}`);
        }
    } catch (error) {
        alert(`Erreur lors de l'envoi : ${error.message}`);
    }
}

// Mettre à jour le statut de la réservation
async function updateReservationStatus(id, status) {
    console.log(`Mise à jour du statut: ${id} -> ${status}`);
    try {
        const data = status === 'confirmed'
            ? await api.confirmReservation(id)
            : await api.cancelReservation(id);
        console.log('Données de mise à jour:', data);
        
        if (data.success) {
            modal.style.display = 'none';
            await loadReservations();
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
function refreshStaffTimeOptions(date, existingTime = '') {
    const select = document.getElementById('new-time');
    const selected = existingTime || select.value;
    const day = new Date(date + 'T12:00:00Z').getUTCDay();
    const times = [];
    if (Number.isFinite(day) && day !== 1 && day !== 2) {
        const lunchEnd = [0, 5, 6].includes(day) ? 14 * 60 : 13 * 60 + 45;
        for (let minute = 12 * 60; minute <= lunchEnd; minute += 15) times.push(minute);
        if (day !== 0) for (let minute = 18 * 60; minute <= 21 * 60 + 30; minute += 15) times.push(minute);
    }
    const values = times.map(minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
    select.replaceChildren(new Option(times.length ? 'Choisir' : 'Restaurant ferme', ''));
    for (const value of values) select.add(new Option(value, value));
    // Keep historical times only for contact-only corrections, not new bookings.
    if (existingTime && !values.includes(existingTime)) select.add(new Option(existingTime + ' (horaire existant)', existingTime));
    select.value = selected;
}

function editReservation(reservation) {
    console.log('Édition de la réservation:', reservation);
    const newReservationModal = document.getElementById('new-reservation-modal');
    const newReservationTitle = document.getElementById('new-reservation-title');
    const submitReservationBtn = document.getElementById('submit-reservation-btn');

    editingReservationId = reservation._id;
    newReservationTitle.textContent = 'Modifier la réservation';
    submitReservationBtn.textContent = 'Enregistrer';

    document.getElementById('new-name').value = reservation.customerName || '';
    document.getElementById('new-date').value = formatDateInput(new Date(reservation.date));
    refreshStaffTimeOptions(document.getElementById('new-date').value, reservation.time);
    document.getElementById('new-time').value = reservation.time || '';
    document.getElementById('new-people').value = String(reservation.numberOfPeople || 2);
    document.getElementById('new-phone').value = reservation.phoneNumber || '';
    document.getElementById('new-email').value = reservation.email || '';
    document.getElementById('new-requests').value = reservation.specialRequests || '';

    modal.style.display = 'none';
    newReservationModal.style.display = 'block';
}

// Mise à jour des statistiques
function updateStats() {
    const today = getDayKey(new Date());
    const todayReservations = reservations.filter(r => 
        getDayKey(r.date) === today
    );
    
    // Filtrer les réservations actives (non annulées)
    const activeReservations = todayReservations.filter(r => !['cancelled', 'awaiting-payment'].includes(r.status));
    const confirmedReservations = todayReservations.filter(r => r.status === 'confirmed');
    const pendingReservations = todayReservations.filter(r => r.status === 'pending');
    
    // Calculer les couverts
    const totalCovers = activeReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const confirmedCovers = confirmedReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const pendingCovers = pendingReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    
    const countEl = document.getElementById('today-count');
    const coversEl = document.getElementById('today-covers');
    const confirmedEl = document.getElementById('today-confirmed');
    if (countEl) countEl.textContent = activeReservations.length;
    if (coversEl) coversEl.textContent = `${totalCovers} (${confirmedCovers} confirmés + ${pendingCovers} en attente)`;
    if (confirmedEl) confirmedEl.textContent = confirmedReservations.length;
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
    dateFilter.value = formatDateInput(new Date());
    
    dateFilter.addEventListener('change', (e) => {
        const selectedDate = parseDateInput(e.target.value);
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
    currentServiceFilter = serviceFilter.value;
    serviceFilter.addEventListener('change', (event) => {
        currentServiceFilter = event.target.value;
        displayReservations();
    });
}

// Fonction pour extraire et analyser les clients
function extractClients(source = reservations) {
    const clientsMap = new Map();

    // Exclure les réservations annulées
    const activeSource = source.filter(r => !['cancelled', 'awaiting-payment'].includes(r.status));

    activeSource.forEach(reservation => {
        const key = reservation.email || reservation.phoneNumber;
        if (!key) return;
        
        if (!clientsMap.has(key)) {
            clientsMap.set(key, {
                name: reservation.customerName,
                email: reservation.email || '',
                phone: reservation.phoneNumber || '',
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
    const filters = document.querySelector('.filters');
    
    // Masquer les réservations, afficher les clients
    reservationsContainer.style.display = 'none';
    if (filters) filters.style.display = 'none';
    clientsSection.style.display = 'block';
    
    const clients = extractClients();
    
    clientsContainer.innerHTML = `
        <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
            <h3>Statistiques Clients</h3>
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
                            <td style="padding: 10px;"><strong>${escapeHtml(client.name)}</strong></td>
                            <td style="padding: 10px;">
                                ${client.email ? `📧 ${escapeHtml(client.email)}<br>` : ''}
                                ${client.phone ? `📱 ${escapeHtml(client.phone)}` : ''}
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
    const reservationsContainer = document.getElementById('reservations-container');
    const filters = document.querySelector('.filters');

    reservationsContainer.style.display = 'none';
    if (filters) filters.style.display = 'none';
    weekSection.style.display = 'block';

    const anchorDate = parseDateInput(getSelectedDateValue());
    const weekStart = new Date(anchorDate);
    const dayOfWeek = weekStart.getDay() || 7;
    weekStart.setDate(weekStart.getDate() - dayOfWeek + 1);

    const weekDays = [];
    for (let index = 0; index < 7; index += 1) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + index);
        weekDays.push(date);
    }

    weekContainer.innerHTML = `
        <div class="week-grid">
            ${weekDays.map(day => {
                const dateValue = formatDateInput(day);
                const midiSummary = getServiceSummary(getServiceReservations(dateValue, 'midi'));
                const soirSummary = getServiceSummary(getServiceReservations(dateValue, 'soir'));
                const isToday = getDayKey(day) === getDayKey(new Date());

                return `
                    <div class="day-card ${isToday ? 'today' : ''}">
                        <h3 class="service-clickable" data-open-day="${dateValue}" >
                            ${day.toLocaleDateString('fr-FR', { weekday: 'short' })}<br>
                            <small>${day.getDate()}/${day.getMonth() + 1}</small>
                        </h3>
                        <div class="day-service midi service-clickable" data-date="${dateValue}" data-service="midi">
                            ${renderOnlineClosure(dateValue, 'midi')}<strong>Midi</strong><br>
                            ${midiSummary.totalReservations} rés. / ${midiSummary.totalCovers} couv.
                        </div>
                        <div class="day-service soir service-clickable" data-date="${dateValue}" data-service="soir">
                            ${renderOnlineClosure(dateValue, 'soir')}<strong>Soir</strong><br>
                            ${soirSummary.totalReservations} rés. / ${soirSummary.totalCovers} couv.
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    weekContainer.querySelectorAll('[data-open-day]').forEach((element) => {
        element.addEventListener('click', () => {
            dateFilter.value = element.dataset.openDay;
            switchView('today');
        });
    });

    weekContainer.querySelectorAll('[data-service]').forEach((element) => {
        element.addEventListener('click', () => {
            openServiceDetail(element.dataset.date, element.dataset.service, 'week');
        });
    });

    document.getElementById('reservations-title').textContent = 'Planning de la semaine';
}

function displayMonthView() {
    const reservationsContainer = document.getElementById('reservations-container');
    const filters = document.querySelector('.filters');
    const anchorDate = parseDateInput(getSelectedDateValue());
    const firstDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const firstGridDay = new Date(firstDay);
    const firstGridWeekDay = firstGridDay.getDay() || 7;
    firstGridDay.setDate(firstGridDay.getDate() - firstGridWeekDay + 1);

    reservationsContainer.style.display = 'none';
    if (filters) filters.style.display = 'none';
    monthSection.style.display = 'block';

    const weekLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const monthDays = [];

    for (let index = 0; index < 42; index += 1) {
        const date = new Date(firstGridDay);
        date.setDate(firstGridDay.getDate() + index);
        monthDays.push(date);
    }

    monthContainer.innerHTML = `
        <div class="month-toolbar">
            <button type="button" class="btn btn-primary" data-month-nav="-1">Mois précédent</button>
            <h2>${firstDay.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</h2>
            <button type="button" class="btn btn-primary" data-month-nav="1">Mois suivant</button>
        </div>
        <div class="month-grid">
            ${weekLabels.map(label => `<div class="month-weekday">${label}</div>`).join('')}
            ${monthDays.map(day => {
                const dateValue = formatDateInput(day);
                const midiSummary = getServiceSummary(getServiceReservations(dateValue, 'midi'));
                const soirSummary = getServiceSummary(getServiceReservations(dateValue, 'soir'));
                const isToday = getDayKey(day) === getDayKey(new Date());
                const isOutsideMonth = day.getMonth() !== firstDay.getMonth();

                return `
                    <div class="month-day-card ${isToday ? 'today' : ''} ${isOutsideMonth ? 'outside-month' : ''}" data-open-day="${dateValue}">
                        <div class="month-day-number">
                            <span>${day.getDate()}</span>
                            <small>${day.toLocaleDateString('fr-FR', { weekday: 'short' })}</small>
                        </div>
                        <div class="month-service-block midi" data-date="${dateValue}" data-service="midi">
                            <span class="month-service-name">Midi</span>
                            <span class="month-service-value">${renderOnlineClosure(dateValue, 'midi') && !midiSummary.totalReservations && !midiSummary.cancelledCount ? 'Fermé en ligne' : `${renderOnlineClosure(dateValue, 'midi')}${midiSummary.totalReservations} rés / ${midiSummary.totalCovers} couv`}</span>
                        </div>
                        <div class="month-service-block soir" data-date="${dateValue}" data-service="soir">
                            <span class="month-service-name">Soir</span>
                            <span class="month-service-value">${renderOnlineClosure(dateValue, 'soir') && !soirSummary.totalReservations && !soirSummary.cancelledCount ? 'Fermé en ligne' : `${renderOnlineClosure(dateValue, 'soir')}${soirSummary.totalReservations} rés / ${soirSummary.totalCovers} couv`}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    monthContainer.querySelectorAll('[data-month-nav]').forEach((button) => {
        button.addEventListener('click', () => {
            const nextDate = parseDateInput(getSelectedDateValue());
            nextDate.setDate(1);
            nextDate.setMonth(nextDate.getMonth() + Number(button.dataset.monthNav));
            dateFilter.value = formatDateInput(nextDate);
            displayMonthView();
        });
    });

    monthContainer.querySelectorAll('[data-open-day]').forEach((element) => {
        element.addEventListener('click', () => {
            dateFilter.value = element.dataset.openDay;
            switchView('today');
        });
    });

    monthContainer.querySelectorAll('.month-service-block').forEach((element) => {
        element.addEventListener('click', (event) => {
            event.stopPropagation();
            openServiceDetail(element.dataset.date, element.dataset.service, 'month');
        });
    });

    document.getElementById('reservations-title').textContent = 'Planning du mois';
}

function openServiceDetail(dateValue, service, returnView = 'week') {
    serviceDetailState = {
        dateValue,
        service,
        returnView
    };
    dateFilter.value = dateValue;
    currentView = 'service-detail';
    displayReservations();
}

function displayServiceDetail() {
    if (!serviceDetailState) {
        switchView('today');
        return;
    }

    const filters = document.querySelector('.filters');
    const serviceReservations = getServiceReservations(serviceDetailState.dateValue, serviceDetailState.service);
    const summary = getServiceSummary(serviceReservations);
    const serviceLabel = serviceDetailState.service === 'midi' ? 'Midi' : 'Soir';

    if (filters) filters.style.display = 'none';
    serviceDetailSection.style.display = 'block';

    serviceDetailContainer.innerHTML = `
        <div class="service-detail-header">
            <h2>${serviceDetailState.service === 'midi' ? '☀️' : '🌙'} ${serviceLabel} - ${formatLongDate(serviceDetailState.dateValue)}</h2>
            <button type="button" class="btn back-button" id="back-to-planning">← Retour au planning</button>
        </div>
        <div class="service-detail-banner">
            ${renderOnlineClosure(serviceDetailState.dateValue, serviceDetailState.service)}
            <h3>${serviceDetailState.service === 'midi' ? '☀️' : '🌙'} ${serviceLabel} - ${formatLongDate(serviceDetailState.dateValue)}</h3>
            <p>${summary.totalCovers} couverts / ${summary.totalReservations} réservations</p>
            ${summary.cancelledCount > 0 ? `<small>${summary.cancelledCount} réservation(s) annulée(s) visible(s), non comptée(s).</small>` : ''}
        </div>
        ${window.ServiceRhythm?.placeholder(serviceDetailState.service, serviceDetailState.dateValue) || ''}
        <div class="reservations-subgrid" id="service-detail-cards"></div>
    `;

    window.ServiceRhythm?.load(serviceDetailContainer, serviceDetailState.dateValue, endpoint => api.apiRequest(endpoint));
    const cardsContainer = document.getElementById('service-detail-cards');

    if (serviceReservations.length === 0) {
        cardsContainer.innerHTML = '<div class="empty-state">Aucune réservation sur ce service.</div>';
    } else {
        serviceReservations
            .sort((a, b) => a.time.localeCompare(b.time))
            .forEach((reservation) => cardsContainer.appendChild(createReservationCard(reservation)));
    }

    document.getElementById('back-to-planning').addEventListener('click', () => {
        switchView(serviceDetailState.returnView || 'week');
    });
}

// Vue Statistiques
function displayStatistics() {
    const statsSection = document.getElementById('statistics-section');
    const statsContainer = document.getElementById('statistics-container');
    const reservationsContainer = document.getElementById('reservations-container');
    const filters = document.querySelector('.filters');
    
    reservationsContainer.style.display = 'none';
    if (filters) filters.style.display = 'none';
    statsSection.style.display = 'block';
    
    // Calculer les statistiques
    const activeReservations = reservations.filter(isActiveReservation);
    const totalCovers = activeReservations.reduce((sum, reservation) => sum + reservation.numberOfPeople, 0);
    const stats = {
        totalReservations: activeReservations.length,
        totalCovers,
        avgCovers: activeReservations.length ? (totalCovers / activeReservations.length).toFixed(1) : '0.0',
        confirmedRate: activeReservations.length
            ? ((activeReservations.filter(r => r.status === 'confirmed').length / activeReservations.length) * 100).toFixed(1)
            : '0.0'
    };
    
    // Statistiques par jour de la semaine
    const dayStats = {};
    ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].forEach(day => {
        dayStats[day] = { midi: 0, soir: 0 };
    });
    
    activeReservations.forEach(res => {
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
    const clients = extractClients(activeReservations);
    const topClients = clients.slice(0, 5);
    
    statsContainer.innerHTML = `
        <h2 style="margin-bottom: 20px;">Statistiques du Restaurant</h2>
        
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
                <h3 style="color: #147c7f;">Taux Confirmation</h3>
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
                        <span><strong>${index + 1}.</strong> ${escapeHtml(client.name)}</span>
                        <span>${client.totalVisits} visites / ${client.totalCovers} couv.</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    document.getElementById('reservations-title').textContent = 'Statistiques';
}

function renderOperationalDayView() {
    const filters = document.querySelector('.filters');
    const selectedDate = getSelectedDateValue();
    const dayReservations = getReservationsForDate(selectedDate);
    const midiReservations = dayReservations.filter(r => getReservationService(r) === 'midi');
    const soirReservations = dayReservations.filter(r => getReservationService(r) === 'soir');
    const midiSummary = getServiceSummary(midiReservations);
    const soirSummary = getServiceSummary(soirReservations);
    const selectedDateObj = parseDateInput(selectedDate);
    const dayOfWeek = selectedDateObj.getDay();
    const isMidiExtended = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;

    const midiEndStr = isMidiExtended ? '14h00' : '13h45';
    const soirEndStr = '21h30';

    const showMidi = currentServiceFilter === 'all' || currentServiceFilter === 'midi';
    const showSoir = currentServiceFilter === 'all' || currentServiceFilter === 'soir';

    reservationsContainer.style.display = 'block';
    if (filters) filters.style.display = 'flex';
    reservationsTitle.textContent = getDayKey(selectedDate) === getDayKey(new Date())
        ? "Le service d'aujourd'hui"
        : `Le service du ${formatLongDate(selectedDate)}`;

    reservationsContainer.innerHTML = `
        <div class="service-summary-grid">
            ${showMidi ? `
                <div class="service-summary-card midi service-clickable" data-date="${selectedDate}" data-service="midi">
                    <div class="service-overline"><h3>Midi</h3><span class="service-hours">12h00 &ndash; ${midiEndStr}</span></div>
                    ${renderOnlineClosure(selectedDate, 'midi')}
                    <div class="service-totals"><strong>${midiSummary.totalCovers}</strong><span>/ ${ONLINE_CAPACITY_LIMIT} couverts</span><span class="service-reservations">${midiSummary.totalReservations} réservations</span></div>
                    ${midiSummary.cancelledCount > 0 ? `<p>${midiSummary.cancelledCount} annulée(s) non comptée(s)</p>` : ''}
                    <div class="progress-track">
                        <div class="progress-fill ${getLoadClass(midiSummary.totalCovers)}" style="width: ${Math.min((midiSummary.totalCovers / ONLINE_CAPACITY_LIMIT) * 100, 100)}%;"></div>
                    </div>
                    ${window.ServiceRhythm?.placeholder('midi', selectedDate) || ''}
                    <div class="wave-recommended" id="wave-recommended-midi"></div>
                    <div class="service-controls"><span>Gestion du service</span>
                        <button class="btn-block-service" data-date="${selectedDate}" data-service="midi" style="font-size:11px; padding:4px 10px; border:1px solid #dc2626; background:transparent; color:#dc2626; border-radius:4px; cursor:pointer;">Marquer complet</button>
                    </div>
                </div>
            ` : ''}
            ${showSoir ? `
                <div class="service-summary-card soir service-clickable" data-date="${selectedDate}" data-service="soir">
                    <div class="service-overline"><h3>Soir</h3><span class="service-hours">18h00 &ndash; ${soirEndStr}</span></div>
                    ${renderOnlineClosure(selectedDate, 'soir')}
                    <div class="service-totals"><strong>${soirSummary.totalCovers}</strong><span>/ ${ONLINE_CAPACITY_LIMIT} couverts</span><span class="service-reservations">${soirSummary.totalReservations} réservations</span></div>
                    ${soirSummary.cancelledCount > 0 ? `<p>${soirSummary.cancelledCount} annulée(s) non comptée(s)</p>` : ''}
                    <div class="progress-track">
                        <div class="progress-fill ${getLoadClass(soirSummary.totalCovers)}" style="width: ${Math.min((soirSummary.totalCovers / ONLINE_CAPACITY_LIMIT) * 100, 100)}%;"></div>
                    </div>
                    ${window.ServiceRhythm?.placeholder('soir', selectedDate) || ''}
                    <div class="wave-recommended" id="wave-recommended-soir"></div>
                    <div class="service-controls"><span>Gestion du service</span>
                        <button class="btn-block-service" data-date="${selectedDate}" data-service="soir" style="font-size:11px; padding:4px 10px; border:1px solid #dc2626; background:transparent; color:#dc2626; border-radius:4px; cursor:pointer;">Marquer complet</button>
                    </div>
                </div>
            ` : ''}
        </div>
        ${showMidi ? `<div class="service-list-heading"><h3>Midi</h3><span>${midiSummary.totalReservations} réservations</span></div><div class="reservations-subgrid" id="today-midi-grid"></div>` : ''}
        ${showSoir ? `<div class="service-list-heading"><h3>Soir</h3><span>${soirSummary.totalReservations} réservations</span></div><div class="reservations-subgrid" id="today-soir-grid"></div>` : ''}
    `;

    updateRecommendedHours(selectedDate);
    window.ServiceRhythm?.load(reservationsContainer, selectedDate, endpoint => api.apiRequest(endpoint));

    if (showMidi) {
        const midiGrid = document.getElementById('today-midi-grid');
        midiReservations.sort((a, b) => a.time.localeCompare(b.time)).forEach((reservation) => {
            midiGrid.appendChild(createReservationCard(reservation));
        });
    }

    if (showSoir) {
        const soirGrid = document.getElementById('today-soir-grid');
        soirReservations.sort((a, b) => a.time.localeCompare(b.time)).forEach((reservation) => {
            soirGrid.appendChild(createReservationCard(reservation));
        });
    }

    reservationsContainer.querySelectorAll('.service-summary-card').forEach((element) => {
        element.addEventListener('click', (e) => {
            if (e.target.closest('.btn-block-service, .service-rhythm')) return;
            openServiceDetail(element.dataset.date, element.dataset.service, 'today');
        });
    });

    reservationsContainer.querySelectorAll('.btn-block-service').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const date = btn.dataset.date;
            const service = btn.dataset.service;
            try {
                const check = await api.apiRequest(`/api/blocked-services?date=${date}`);
                const isBlocked = (check.data || []).some(b => b.service === service || b.service === 'all');
                if (isBlocked) {
                    await api.apiRequest('/api/blocked-services', { method: 'DELETE', body: { date, service } });
                    showNotification('Service débloqué', `Le service du ${service} est à nouveau ouvert.`);
                } else {
                    await api.apiRequest('/api/blocked-services', { method: 'POST', body: { date, service, reason: 'Complet' } });
                    showNotification('Service bloqué', `Le service du ${service} est marqué complet sur le site.`);
                }
                displayReservations();
            } catch (error) {
                alert('Erreur : ' + error.message);
            }
        });
    });
}

// Vue "À confirmer" — toutes les réservations pending, toutes dates, triées par date
function displayPending() {
    const filters = document.querySelector('.filters');
    if (filters) filters.style.display = 'none';
    pendingSection.style.display = 'block';
    reservationsTitle.textContent = 'À confirmer';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendingReservations = reservations
        .filter(r => r.status === 'pending' && new Date(r.date) >= today)
        .sort((a, b) => {
            const dateDiff = new Date(a.date) - new Date(b.date);
            return dateDiff !== 0 ? dateDiff : a.time.localeCompare(b.time);
        });

    if (pendingReservations.length === 0) {
        pendingContainer.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Aucune réservation en attente de confirmation.';
        pendingContainer.appendChild(empty);
        return;
    }

    pendingContainer.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'service-detail-banner';
    const totalCovers = pendingReservations.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const headerTitle = document.createElement('h3');
    headerTitle.textContent = `${pendingReservations.length} réservation(s) en attente — ${totalCovers} couverts`;
    header.appendChild(headerTitle);
    pendingContainer.appendChild(header);

    // Grouper par date
    const byDate = new Map();
    pendingReservations.forEach(r => {
        const key = getDayKey(r.date);
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push(r);
    });

    byDate.forEach((dateReservations, dateKey) => {
        const dateLabel = document.createElement('h3');
        dateLabel.className = 'pending-date-heading';
        dateLabel.textContent = formatLongDate(dateReservations[0].date) +
            ` — ${dateReservations.length} rés. / ${dateReservations.reduce((s, r) => s + r.numberOfPeople, 0)} couv.`;
        pendingContainer.appendChild(dateLabel);

        const grid = document.createElement('div');
        grid.className = 'reservations-subgrid';
        dateReservations.forEach(r => grid.appendChild(createReservationCard(r)));
        pendingContainer.appendChild(grid);
    });
}

// Vue Aujourd'hui
function displayTodayView() {
    renderOperationalDayView();
}

// Demander la permission pour les notifications
if ('Notification' in window) {
    Notification.requestPermission();
}

// Initialisation quand le DOM est prêt
document.addEventListener('DOMContentLoaded', () => {
    window.FloorPlan.watch(document.body, () => reservations, (endpoint, options) => api.apiRequest(endpoint, options));
    // Gestion de la navigation
    document.querySelectorAll('[data-view]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(link.dataset.view);
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
            editingReservationId = null;
            document.getElementById('new-reservation-title').textContent = '➕ Nouvelle Réservation';
            document.getElementById('submit-reservation-btn').textContent = 'Créer la réservation';
            newReservationModal.style.display = 'block';
            // Définir la date par défaut à aujourd'hui
            document.getElementById('new-date').value = getSelectedDateValue();
            refreshStaffTimeOptions(document.getElementById('new-date').value);
        });
    }
    
    // Fermer le modal
    if (closeNewModal) {
        closeNewModal.addEventListener('click', () => {
            editingReservationId = null;
            document.getElementById('new-reservation-title').textContent = '➕ Nouvelle Réservation';
            document.getElementById('submit-reservation-btn').textContent = 'Créer la réservation';
            newReservationModal.style.display = 'none';
            newReservationForm.reset();
        });
    }
    
    if (cancelNewBtn) {
        cancelNewBtn.addEventListener('click', () => {
            editingReservationId = null;
            document.getElementById('new-reservation-title').textContent = '➕ Nouvelle Réservation';
            document.getElementById('submit-reservation-btn').textContent = 'Créer la réservation';
            newReservationModal.style.display = 'none';
            newReservationForm.reset();
        });
    }
    
    // Soumettre le formulaire
    document.getElementById('new-date').addEventListener('change', event => {
        const existing = reservations.find(r => r._id === editingReservationId);
        const retained = existing && formatDateInput(new Date(existing.date)) === event.target.value ? existing.time : '';
        refreshStaffTimeOptions(event.target.value, retained);
    });
    if (newReservationForm) {
        newReservationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (reservationSubmitBusy) return;
            reservationSubmitBusy = true;
            const submitButton = document.getElementById('submit-reservation-btn');
            submitButton.disabled = true;
            
            const formData = {
                customerName: document.getElementById('new-name').value,
                date: document.getElementById('new-date').value,
                time: document.getElementById('new-time').value,
                numberOfPeople: parseInt(document.getElementById('new-people').value),
                phoneNumber: document.getElementById('new-phone').value,
                email: document.getElementById('new-email').value || '',
                specialRequests: document.getElementById('new-requests').value || ''
            };
            const fingerprint = JSON.stringify({ id: editingReservationId, ...formData });
            if (reservationSubmitFingerprint !== fingerprint || !reservationSubmitKey) {
                reservationSubmitFingerprint = fingerprint;
                reservationSubmitKey = crypto.randomUUID();
            }
            
            try {
                const result = editingReservationId
                    ? await api.updateReservation(editingReservationId, formData)
                    : await api.createReservation({
                        ...formData,
                        status: 'confirmed',
                        source: 'desktop'
                    }, reservationSubmitKey);
                
                if (result.success) {
                    reservationSubmitKey = null;
                    reservationSubmitFingerprint = null;
                    showNotification('Succès', editingReservationId
                        ? 'Réservation modifiée avec succès'
                        : 'Réservation créée avec succès');
                    
                    newReservationModal.style.display = 'none';
                    newReservationForm.reset();
                    editingReservationId = null;
                    document.getElementById('new-reservation-title').textContent = '➕ Nouvelle Réservation';
                    document.getElementById('submit-reservation-btn').textContent = 'Créer la réservation';
                    
                    await loadReservations();
                } else {
                    alert('Erreur: ' + result.message);
                }
            } catch (error) {
                console.error('Erreur lors de l\'enregistrement de la réservation:', error);
                alert(`Erreur lors de l'enregistrement de la réservation: ${error.message}`);
            } finally {
                reservationSubmitBusy = false;
                submitButton.disabled = false;
            }
        });
    }
    
    // Fermer le modal en cliquant en dehors
    window.addEventListener('click', (event) => {
        if (event.target === newReservationModal) {
            editingReservationId = null;
            document.getElementById('new-reservation-title').textContent = '➕ Nouvelle Réservation';
            document.getElementById('submit-reservation-btn').textContent = 'Créer la réservation';
            newReservationModal.style.display = 'none';
            newReservationForm.reset();
        }
    });
    
    // Gestion du QR modal
    const showQrBtn = document.getElementById('show-qr-btn');
    const qrModal = document.getElementById('qr-modal');
    const closeQrModal = document.querySelector('.close-qr-modal');
    const qrCodeImg = document.getElementById('qr-code-img');
    const adminUrlDisplay = document.getElementById('admin-url-display');
    const copyUrlBtn = document.getElementById('copy-url-btn');

    if (showQrBtn && qrModal) {
        showQrBtn.addEventListener('click', async () => {
            const config = await api.getConfig();
            const adminUrl = config.backendUrl + '/admin/';
            if (adminUrlDisplay) adminUrlDisplay.textContent = adminUrl;
            if (qrCodeImg) {
                qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(adminUrl)}`;
            }
            qrModal.style.display = 'block';
        });
    }
    if (closeQrModal && qrModal) {
        closeQrModal.addEventListener('click', () => { qrModal.style.display = 'none'; });
    }
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', async () => {
            const config = await api.getConfig();
            const adminUrl = config.backendUrl + '/admin/';
            navigator.clipboard.writeText(adminUrl);
            copyUrlBtn.textContent = 'Copié !';
            setTimeout(() => { copyUrlBtn.textContent = 'Copier l\'URL'; }, 2000);
        });
    }

    // Charger les réservations au démarrage
    console.log('Chargement des réservations au démarrage...');
    loadReservations();
});


function renderOnlineClosure(dateISO, service) {
    const day = new Date(String(dateISO).slice(0, 10) + 'T12:00:00Z').getUTCDay();
    return day === 1 || day === 2 || (day === 0 && service === 'soir')
        ? '<span class="closure-badge">Fermé en ligne</span>' : '';
}
