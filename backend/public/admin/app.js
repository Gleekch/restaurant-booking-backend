// Configuration
const API_URL = window.location.origin;
let reservations = [];
let currentView = 'today';

// Fetch wrapper qui envoie les credentials Basic Auth
function apiFetch(url, options = {}) {
    return fetch(url, { ...options, credentials: 'include' });
}

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
        const response = await apiFetch(`${API_URL}/api/reservations`);
        if (!response.ok) throw new Error('Erreur réseau');

        const data = await response.json();
        // L'API retourne { success: true, data: [...] }
        if (data.success) {
            reservations = data.data;
        } else {
            reservations = Array.isArray(data) ? data : [];
        }
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
        case 'month':
            renderMonthView();
            break;
        default:
            renderTodayView();
    }
}

// Render Today View (ou prochaine date avec des réservations si aujourd'hui est vide)
function renderTodayView() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let displayDate = today;
    let todayReservations = reservations.filter(r =>
        new Date(r.date).toDateString() === today.toDateString()
    );

    // Si aucune réservation aujourd'hui, trouver la prochaine date
    if (todayReservations.length === 0 && reservations.length > 0) {
        const futureDates = reservations
            .filter(r => {
                const d = new Date(r.date);
                d.setHours(0, 0, 0, 0);
                return d >= today && r.status !== 'cancelled';
            })
            .map(r => new Date(r.date))
            .sort((a, b) => a - b);
        if (futureDates.length > 0) {
            displayDate = futureDates[0];
            todayReservations = reservations.filter(r =>
                new Date(r.date).toDateString() === displayDate.toDateString()
            );
        }
    }

    const isToday = displayDate.toDateString() === new Date().toDateString();
    const dateLabel = isToday
        ? `Aujourd'hui - ${displayDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`
        : `${displayDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`;

    const active = todayReservations.filter(r => r.status !== 'cancelled');
    const midi = active.filter(r => parseInt(r.time.split(':')[0]) < 15);
    const soir = active.filter(r => parseInt(r.time.split(':')[0]) >= 15);

    const midiCovers = midi.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const soirCovers = soir.reduce((sum, r) => sum + r.numberOfPeople, 0);

    content.innerHTML = `
        <div class="summary-card">
            <h2 class="summary-title">${dateLabel}</h2>
            <div class="summary-stats">
                <div class="stat-item">
                    <div class="stat-value">${active.length}</div>
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
                <span class="icon">☀️</span>
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
                <span class="icon">🌙</span>
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

// State for month navigation
let currentMonthDate = new Date();

// Render Month View
function renderMonthView() {
    const firstDay = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth(), 1);
    const firstGridDay = new Date(firstDay);
    const firstGridWeekDay = firstGridDay.getDay() || 7;
    firstGridDay.setDate(firstGridDay.getDate() - firstGridWeekDay + 1);

    const monthLabel = firstDay.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const weekLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const days = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(firstGridDay);
        d.setDate(firstGridDay.getDate() + i);
        days.push(d);
    }

    const todayStr = new Date().toDateString();

    content.innerHTML = `
        <div class="month-toolbar">
            <button class="btn-month-nav" id="month-prev">&larr;</button>
            <h2 class="month-title">${monthLabel}</h2>
            <button class="btn-month-nav" id="month-next">&rarr;</button>
        </div>
        <div class="month-grid">
            ${weekLabels.map(l => `<div class="month-weekday-label">${l}</div>`).join('')}
            ${days.map(day => {
                const dateISO = day.getFullYear() + '-' + String(day.getMonth()+1).padStart(2,'0') + '-' + String(day.getDate()).padStart(2,'0');
                const dayReservations = reservations.filter(r =>
                    new Date(r.date).toDateString() === day.toDateString()
                );
                const active = dayReservations.filter(r => r.status !== 'cancelled');
                const midi = active.filter(r => parseInt(r.time.split(':')[0]) < 15);
                const soir = active.filter(r => parseInt(r.time.split(':')[0]) >= 15);
                const midiCovers = midi.reduce((sum, r) => sum + r.numberOfPeople, 0);
                const soirCovers = soir.reduce((sum, r) => sum + r.numberOfPeople, 0);
                const isToday = day.toDateString() === todayStr;
                const isOutside = day.getMonth() !== firstDay.getMonth();

                const dayClasses = ['month-day', isToday ? 'month-today' : '', isOutside ? 'month-outside' : '', midi.length > 0 ? 'has-midi' : '', soir.length > 0 ? 'has-soir' : ''].filter(Boolean).join(' ');

                return `
                    <div class="${dayClasses}" data-day-date="${dateISO}">
                        <div class="month-day-num">${day.getDate()}</div>
                        ${active.length > 0 ? `
                            <div class="month-day-midi"><span class="icon">☀️</span> ${midi.length}r / ${midiCovers}c</div>
                            <div class="month-day-soir"><span class="icon">🌙</span> ${soir.length}r / ${soirCovers}c</div>
                        ` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;

    document.getElementById('month-prev').addEventListener('click', () => {
        currentMonthDate.setMonth(currentMonthDate.getMonth() - 1);
        renderMonthView();
    });
    document.getElementById('month-next').addEventListener('click', () => {
        currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
        renderMonthView();
    });
    document.querySelectorAll('[data-day-date]').forEach(el => {
        el.addEventListener('click', () => {
            showDayDetail(el.dataset.dayDate);
        });
    });
}

// Show day detail from month view
function showDayDetail(dateISO) {
    const [y, m, d] = dateISO.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayReservations = reservations.filter(r =>
        new Date(r.date).toDateString() === date.toDateString()
    );
    const active = dayReservations.filter(r => r.status !== 'cancelled');
    const midi = active.filter(r => parseInt(r.time.split(':')[0]) < 15).sort((a, b) => a.time.localeCompare(b.time));
    const soir = active.filter(r => parseInt(r.time.split(':')[0]) >= 15).sort((a, b) => a.time.localeCompare(b.time));
    const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    content.innerHTML = `
        <button class="back-btn" onclick="renderMonthView()">← Retour au mois</button>
        <div class="summary-card">
            <h2 class="summary-title">${dateStr}</h2>
            <div class="summary-stats">
                <div class="stat-item">
                    <div class="stat-value">${active.length}</div>
                    <div class="stat-label">Réservations</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${active.reduce((s, r) => s + r.numberOfPeople, 0)}</div>
                    <div class="stat-label">Couverts</div>
                </div>
            </div>
        </div>
        <div class="service-section">
            <div class="service-header midi"><span>☀️</span><h3>Midi</h3><span class="service-count">${midi.length} rés. / ${midi.reduce((s, r) => s + r.numberOfPeople, 0)} couv.</span></div>
            ${midi.length === 0 ? '<div class="empty-state"><p>Aucune réservation</p></div>' :
                `<div class="reservations-grid">${midi.map(r => renderReservationCard(r)).join('')}</div>`}
        </div>
        <div class="service-section">
            <div class="service-header soir"><span>🌙</span><h3>Soir</h3><span class="service-count">${soir.length} rés. / ${soir.reduce((s, r) => s + r.numberOfPeople, 0)} couv.</span></div>
            ${soir.length === 0 ? '<div class="empty-state"><p>Aucune réservation</p></div>' :
                `<div class="reservations-grid">${soir.map(r => renderReservationCard(r)).join('')}</div>`}
        </div>
    `;
    attachCardListeners();
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
                <span><span class="icon">👥</span> ${r.numberOfPeople}</span>
                <span><span class="icon">📱</span> ${r.phoneNumber}</span>
            </div>
            ${r.specialRequests ? `<div class="card-notes"><span class="icon">💬</span> ${r.specialRequests}</div>` : ''}
        </div>
    `;
}

// Render Pending Card
function renderPendingCard(r) {
    const date = new Date(r.date);
    const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    const service = parseInt(r.time.split(':')[0]) < 15 ? '<span class="icon">☀️</span> Midi' : '<span class="icon">🌙</span> Soir';

    return `
        <div class="pending-card">
            <div class="pending-card-header">
                <span class="pending-card-name">${r.customerName}</span>
                <span class="card-status pending">En attente</span>
            </div>
            <div class="pending-card-info">
                <p><span class="icon">📅</span> ${dateStr} - ${r.time} ${service}</p>
                <p><span class="icon">👥</span> ${r.numberOfPeople} personne(s)</p>
                <p><span class="icon">📱</span> ${r.phoneNumber}</p>
                ${r.specialRequests ? `<p><span class="icon">💬</span> ${r.specialRequests}</p>` : ''}
            </div>
            <div class="pending-actions">
                <button class="btn-confirm" onclick="updateStatus('${r._id}', 'confirmed')"><span class="icon">✅</span> Confirmer</button>
                <button class="btn-cancel" onclick="updateStatus('${r._id}', 'cancelled')"><span class="icon">❌</span> Annuler</button>
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
        new Date(r.date).toDateString() === dayStr && r.status !== 'cancelled'
    );

    const midi = dayReservations.filter(r => parseInt(r.time.split(':')[0]) < 15);
    const soir = dayReservations.filter(r => parseInt(r.time.split(':')[0]) >= 15);

    const midiCovers = midi.reduce((sum, r) => sum + r.numberOfPeople, 0);
    const soirCovers = soir.reduce((sum, r) => sum + r.numberOfPeople, 0);

    const dateISO = day.getFullYear() + '-' + String(day.getMonth()+1).padStart(2,'0') + '-' + String(day.getDate()).padStart(2,'0');
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
                <div class="day-service-label"><span class="icon">☀️</span> Midi</div>
                <div class="day-service-count">${midiCovers}</div>
                <div class="progress-bar">
                    <div class="progress-fill ${getProgressClass(midiCovers)}" style="width: ${Math.min(midiCovers/50*100, 100)}%"></div>
                </div>
            </div>
            <div class="day-service soir" data-date="${dateISO}" data-service="soir">
                <div class="day-service-label"><span class="icon">🌙</span> Soir</div>
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
    const [y, m, d] = dateISO.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayReservations = reservations.filter(r =>
        new Date(r.date).toDateString() === date.toDateString() && r.status !== 'cancelled'
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
                <button class="btn btn-success" onclick="updateStatus('${r._id}', 'confirmed'); closeModal();"><span class="icon">✅</span> Confirmer</button>
            ` : ''}
            ${r.status !== 'cancelled' ? `
                <button class="btn btn-danger" onclick="updateStatus('${r._id}', 'cancelled'); closeModal();"><span class="icon">❌</span> Annuler</button>
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
        const response = await apiFetch(`${API_URL}/api/reservations/${id}`, {
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
            const response = await apiFetch(`${API_URL}/api/reservations/${r._id}`, {
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
            source: 'desktop',
            status: 'confirmed'
        };

        try {
            const response = await apiFetch(`${API_URL}/api/reservations/desktop`, {
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
