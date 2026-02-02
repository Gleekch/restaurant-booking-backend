// Configuration
const API_URL = window.location.origin;
let reservations = [];
let currentView = 'today';

// DOM Elements
const content = document.getElementById('content');
const loading = document.getElementById('loading');
const connectionStatus = document.getElementById('connection-status');
const pendingBadge = document.getElementById('pending-badge');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initNewReservationForm();
    loadReservations();

    // Refresh every 30 seconds
    setInterval(loadReservations, 30000);
});

// Navigation
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;

            if (view === 'new') {
                openNewModal();
                return;
            }

            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentView = view;
            renderView();
        });
    });
}

// Load Reservations
async function loadReservations() {
    try {
        const response = await fetch(`${API_URL}/api/reservations`);
        if (!response.ok) throw new Error('Erreur réseau');

        reservations = await response.json();
        updateConnectionStatus(true);
        updatePendingBadge();
        renderView();
    } catch (error) {
        console.error('Erreur chargement:', error);
        updateConnectionStatus(false);
    } finally {
        loading.style.display = 'none';
    }
}

// Update Connection Status
function updateConnectionStatus(connected) {
    const dot = connectionStatus.querySelector('.status-dot');
    const text = connectionStatus.querySelector('.status-text');

    if (connected) {
        dot.className = 'status-dot connected';
        text.textContent = 'Connecté';
    } else {
        dot.className = 'status-dot disconnected';
        text.textContent = 'Hors ligne';
    }
}

// Update Pending Badge
function updatePendingBadge() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendingCount = reservations.filter(r => {
        const resDate = new Date(r.date);
        resDate.setHours(0, 0, 0, 0);
        return r.status === 'pending' && resDate >= today;
    }).length;

    if (pendingCount > 0) {
        pendingBadge.style.display = 'block';
        pendingBadge.textContent = pendingCount;
    } else {
        pendingBadge.style.display = 'none';
    }
}

// Render Current View
function renderView() {
    switch (currentView) {
        case 'today':
            renderTodayView();
            break;
        case 'pending':
            renderPendingView();
            break;
        case 'week':
            renderWeekView();
            break;
        default:
            renderTodayView();
    }
}

// Render Today View
function renderTodayView() {
    const today = new Date().toDateString();
    const todayReservations = reservations.filter(r =>
        new Date(r.date).toDateString() === today
    );

    const midi = todayReservations.filter(r => parseInt(r.time.split(':')[0]) < 15);
    const soir = todayReservations.filter(r => parseInt(r.time.split(':')[0]) >= 15);

    const midiCovers = midi.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const soirCovers = soir.reduce((sum, r) => sum + r.numberOfPeople, 0);

    content.innerHTML = `
        <div class="summary-card">
            <h2 class="summary-title">Aujourd'hui - ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            <div class="summary-stats">
                <div class="stat-item">
                    <div class="stat-value">${todayReservations.length}</div>
                    <div class="stat-label">Réservations</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${midiCovers + soirCovers}</div>
                    <div class="stat-label">Couverts</div>
                </div>
            </div>
        </div>

        <div class="service-section">
            <div class="service-header midi">
                <span>☀️</span>
                <h3>Service du Midi</h3>
                <span class="service-count">${midi.length} rés. / ${midiCovers} couv.</span>
            </div>
            ${midi.length === 0 ?
                '<div class="empty-state"><p>Aucune réservation pour le midi</p></div>' :
                `<div class="reservations-grid">${midi.sort((a, b) => a.time.localeCompare(b.time)).map(r => renderReservationCard(r)).join('')}</div>`
            }
        </div>

        <div class="service-section">
            <div class="service-header soir">
                <span>🌙</span>
                <h3>Service du Soir</h3>
                <span class="service-count">${soir.length} rés. / ${soirCovers} couv.</span>
            </div>
            ${soir.length === 0 ?
                '<div class="empty-state"><p>Aucune réservation pour le soir</p></div>' :
                `<div class="reservations-grid">${soir.sort((a, b) => a.time.localeCompare(b.time)).map(r => renderReservationCard(r)).join('')}</div>`
            }
        </div>
    `;

    attachCardListeners();
}

// Render Pending View
function renderPendingView() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pending = reservations.filter(r => {
        const resDate = new Date(r.date);
        resDate.setHours(0, 0, 0, 0);
        return r.status === 'pending' && resDate >= today;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    const totalCovers = pending.reduce((sum, r) => sum + r.numberOfPeople, 0);

    content.innerHTML = `
        <div class="pending-header">
            <div class="pending-info">
                <h2>⏳ Réservations en attente</h2>
                <p>${pending.length} réservation(s) / ${totalCovers} couvert(s)</p>
            </div>
            ${pending.length > 0 ? `
                <button class="btn-confirm-all" onclick="confirmAllPending()">
                    ✅ Tout confirmer
                </button>
            ` : ''}
        </div>

        ${pending.length === 0 ? `
            <div class="empty-state">
                <div class="emoji">🎉</div>
                <h3>Aucune réservation en attente</h3>
                <p>Toutes les réservations ont été traitées</p>
            </div>
        ` : pending.map(r => renderPendingCard(r)).join('')}
    `;
}

// Render Week View
function renderWeekView() {
    const today = new Date();
    const weekDays = [];

    for (let i = 0; i < 7; i++) {
        const day = new Date(today);
        day.setDate(today.getDate() + i);
        weekDays.push(day);
    }

    content.innerHTML = `
        <div class="summary-card">
            <h2 class="summary-title">📆 Planning de la semaine</h2>
        </div>
        <div class="week-grid">
            ${weekDays.map(day => renderDayCard(day)).join('')}
        </div>
    `;

    document.querySelectorAll('.day-service').forEach(el => {
        el.addEventListener('click', () => {
            const date = el.dataset.date;
            const service = el.dataset.service;
            showDayServiceDetail(date, service);
        });
    });
}

// Render Reservation Card
function renderReservationCard(r) {
    const statusText = {
        'pending': 'En attente',
        'confirmed': 'Confirmé',
        'cancelled': 'Annulé'
    };

    return `
        <div class="reservation-card status-${r.status}" data-id="${r._id}">
            <div class="card-header">
                <span class="card-time">${r.time}</span>
                <span class="card-status ${r.status}">${statusText[r.status]}</span>
            </div>
            <div class="card-name">${r.customerName}</div>
            <div class="card-info">
                <span>👥 ${r.numberOfPeople}</span>
                <span>📱 ${r.phoneNumber}</span>
            </div>
            ${r.specialRequests ? `<div class="card-notes">💬 ${r.specialRequests}</div>` : ''}
        </div>
    `;
}

// Render Pending Card
function renderPendingCard(r) {
    const date = new Date(r.date);
    const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    const service = parseInt(r.time.split(':')[0]) < 15 ? '☀️ Midi' : '🌙 Soir';

    return `
        <div class="pending-card">
            <div class="pending-card-header">
                <span class="pending-card-name">${r.customerName}</span>
                <span class="card-status pending">En attente</span>
            </div>
            <div class="pending-card-info">
                <p>📅 ${dateStr} - ${r.time} ${service}</p>
                <p>👥 ${r.numberOfPeople} personne(s)</p>
                <p>📱 ${r.phoneNumber}</p>
                ${r.specialRequests ? `<p>💬 ${r.specialRequests}</p>` : ''}
            </div>
            <div class="pending-actions">
                <button class="btn-confirm" onclick="updateStatus('${r._id}', 'confirmed')">✅ Confirmer</button>
                <button class="btn-cancel" onclick="updateStatus('${r._id}', 'cancelled')">❌ Annuler</button>
            </div>
        </div>
    `;
}

// Render Day Card
function renderDayCard(day) {
    const dayStr = day.toDateString();
    const today = new Date().toDateString();
    const isToday = dayStr === today;

    const dayReservations = reservations.filter(r =>
        new Date(r.date).toDateString() === dayStr
    );

    const midi = dayReservations.filter(r => parseInt(r.time.split(':')[0]) < 15);
    const soir = dayReservations.filter(r => parseInt(r.time.split(':')[0]) >= 15);

    const midiCovers = midi.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const soirCovers = soir.reduce((sum, r) => sum + r.numberOfPeople, 0);

    const dateISO = day.toISOString().split('T')[0];
    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    const getProgressClass = (count) => {
        if (count >= 50) return 'red';
        if (count >= 40) return 'yellow';
        return 'green';
    };

    return `
        <div class="day-card ${isToday ? 'today' : ''}">
            <div class="day-name">${dayNames[day.getDay()]}</div>
            <div class="day-date">${day.getDate()}/${day.getMonth() + 1}</div>
            <div class="day-service midi" data-date="${dateISO}" data-service="midi">
                <div class="day-service-label">☀️ Midi</div>
                <div class="day-service-count">${midiCovers}</div>
                <div class="progress-bar">
                    <div class="progress-fill ${getProgressClass(midiCovers)}" style="width: ${Math.min(midiCovers/50*100, 100)}%"></div>
                </div>
            </div>
            <div class="day-service soir" data-date="${dateISO}" data-service="soir">
                <div class="day-service-label">🌙 Soir</div>
                <div class="day-service-count">${soirCovers}</div>
                <div class="progress-bar">
                    <div class="progress-fill ${getProgressClass(soirCovers)}" style="width: ${Math.min(soirCovers/50*100, 100)}%"></div>
                </div>
            </div>
        </div>
    `;
}

// Show Day Service Detail
function showDayServiceDetail(dateISO, service) {
    const date = new Date(dateISO);
    const dayReservations = reservations.filter(r =>
        new Date(r.date).toDateString() === date.toDateString()
    );

    const filtered = dayReservations.filter(r => {
        const hour = parseInt(r.time.split(':')[0]);
        return service === 'midi' ? hour < 15 : hour >= 15;
    }).sort((a, b) => a.time.localeCompare(b.time));

    const serviceName = service === 'midi' ? '☀️ Midi' : '🌙 Soir';
    const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const totalCovers = filtered.reduce((sum, r) => sum + r.numberOfPeople, 0);

    content.innerHTML = `
        <button class="back-btn" onclick="renderWeekView()">← Retour</button>
        <div class="summary-card">
            <h2 class="summary-title">${serviceName} - ${dateStr}</h2>
            <div class="summary-stats">
                <div class="stat-item">
                    <div class="stat-value">${filtered.length}</div>
                    <div class="stat-label">Réservations</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${totalCovers}</div>
                    <div class="stat-label">Couverts</div>
                </div>
            </div>
        </div>

        ${filtered.length === 0 ? `
            <div class="empty-state">
                <div class="emoji">📭</div>
                <h3>Aucune réservation</h3>
                <p>Pas de réservation pour ce service</p>
            </div>
        ` : `
            <div class="reservations-grid">
                ${filtered.map(r => renderReservationCard(r)).join('')}
            </div>
        `}
    `;

    attachCardListeners();
}

// Attach Card Click Listeners
function attachCardListeners() {
    document.querySelectorAll('.reservation-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const reservation = reservations.find(r => r._id === id);
            if (reservation) showReservationDetail(reservation);
        });
    });
}

// Show Reservation Detail Modal
function showReservationDetail(r) {
    const date = new Date(r.date);
    const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const statusText = {
        'pending': 'En attente',
        'confirmed': 'Confirmé',
        'cancelled': 'Annulé'
    };

    document.getElementById('modal-title').textContent = r.customerName;
    document.getElementById('modal-body').innerHTML = `
        <div class="detail-section">
            <div class="detail-row">
                <span class="detail-label">Statut</span>
                <span class="card-status ${r.status}">${statusText[r.status]}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Date</span>
                <span class="detail-value">${dateStr}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Heure</span>
                <span class="detail-value">${r.time}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Personnes</span>
                <span class="detail-value">${r.numberOfPeople}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Téléphone</span>
                <span class="detail-value"><a href="tel:${r.phoneNumber}">${r.phoneNumber}</a></span>
            </div>
            ${r.email ? `
                <div class="detail-row">
                    <span class="detail-label">Email</span>
                    <span class="detail-value"><a href="mailto:${r.email}">${r.email}</a></span>
                </div>
            ` : ''}
            ${r.specialRequests ? `
                <div class="detail-row">
                    <span class="detail-label">Notes</span>
                    <span class="detail-value">${r.specialRequests}</span>
                </div>
            ` : ''}
        </div>

        <div class="detail-actions">
            ${r.status !== 'confirmed' ? `
                <button class="btn btn-success" onclick="updateStatus('${r._id}', 'confirmed'); closeModal();">✅ Confirmer</button>
            ` : ''}
            ${r.status !== 'cancelled' ? `
                <button class="btn btn-danger" onclick="updateStatus('${r._id}', 'cancelled'); closeModal();">❌ Annuler</button>
            ` : ''}
            <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
        </div>
    `;

    document.getElementById('reservation-modal').classList.add('active');
}

// Close Modal
function closeModal() {
    document.getElementById('reservation-modal').classList.remove('active');
}

// Update Reservation Status
async function updateStatus(id, status) {
    try {
        const response = await fetch(`${API_URL}/api/reservations/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });

        if (!response.ok) throw new Error('Erreur');

        showToast(status === 'confirmed' ? 'Réservation confirmée' : 'Réservation annulée', 'success');
        loadReservations();
    } catch (error) {
        showToast('Erreur lors de la mise à jour', 'error');
    }
}

// Confirm All Pending
async function confirmAllPending() {
    if (!confirm('Confirmer toutes les réservations en attente ?')) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pending = reservations.filter(r => {
        const resDate = new Date(r.date);
        resDate.setHours(0, 0, 0, 0);
        return r.status === 'pending' && resDate >= today;
    });

    let success = 0;
    for (const r of pending) {
        try {
            const response = await fetch(`${API_URL}/api/reservations/${r._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'confirmed' })
            });
            if (response.ok) success++;
        } catch (e) {}
    }

    showToast(`${success} réservation(s) confirmée(s)`, 'success');
    loadReservations();
}

// New Reservation Form
function initNewReservationForm() {
    // Set default date to today
    document.getElementById('date').valueAsDate = new Date();

    document.getElementById('new-reservation-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const data = {
            customerName: document.getElementById('customerName').value,
            phoneNumber: document.getElementById('phoneNumber').value,
            email: document.getElementById('email').value || undefined,
            date: document.getElementById('date').value,
            time: document.getElementById('time').value,
            numberOfPeople: parseInt(document.getElementById('numberOfPeople').value),
            specialRequests: document.getElementById('specialRequests').value || undefined,
            status: 'confirmed'
        };

        try {
            const response = await fetch(`${API_URL}/api/reservations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) throw new Error('Erreur');

            showToast('Réservation créée', 'success');
            closeNewModal();
            document.getElementById('new-reservation-form').reset();
            document.getElementById('date').valueAsDate = new Date();
            loadReservations();
        } catch (error) {
            showToast('Erreur lors de la création', 'error');
        }
    });
}

function openNewModal() {
    document.getElementById('new-reservation-modal').classList.add('active');
}

function closeNewModal() {
    document.getElementById('new-reservation-modal').classList.remove('active');
}

// Toast Notification
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Close modals on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

// Service Worker Registration for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
