/* This UI-only release deliberately does not activate the unfinished finance workflow. */
(() => {
    const reason = 'Indisponible dans cette version. Arrhes, caisse et suivi d\u2019arriv\u00e9e en pr\u00e9paration.';
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function financePanel(reservation = {}) {
        const deposit = reservation.deposit || {};
        const states = {
            none: ['none', 'Arrhes non encaiss\u00e9es', 'Aucun encaissement enregistr\u00e9.'],
            awaiting: ['awaiting', 'Arrhes non encaiss\u00e9es', 'En attente du paiement.'],
            failed: ['failed', 'Arrhes non encaiss\u00e9es', 'Le paiement n\u2019a pas abouti.'],
            paid: ['paid', 'Arrhes encaiss\u00e9es', ''],
            deducted: ['deducted', 'Arrhes encaiss\u00e9es', 'D\u00e9j\u00e0 d\u00e9duites de l\u2019addition.'],
            refunded: ['refunded', 'Arrhes rembours\u00e9es', ''],
            refund_pending: ['refund_pending', 'Remboursement en cours', 'Le remboursement n\u2019est pas encore confirm\u00e9.'],
            refund_failed: ['refund_failed', 'Remboursement \u00e9chou\u00e9', 'V\u00e9rification n\u00e9cessaire dans Stripe.'],
            refund_review: ['refund_review', 'Remboursement \u00e0 v\u00e9rifier', 'V\u00e9rification n\u00e9cessaire dans Stripe.']
        };
        const status = deposit.status ?? 'none';
        const [tone, label, note] = Object.hasOwn(states, status)
            ? states[status] : ['refund_review', 'Statut des arrhes \u00e0 v\u00e9rifier', ''];
        // Only backend payment states can indicate collection, never booking confirmation.
        const showAmount = ['paid', 'deducted'].includes(status) && Number.isSafeInteger(deposit.amountCents) && deposit.amountCents > 0;
        const currency = /^[a-z]{3}$/i.test(deposit.currency || '') ? deposit.currency.toUpperCase() : 'EUR';
        const amount = showAmount ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(deposit.amountCents / 100) : '';
        const exception = reservation.depositException && ['none', 'awaiting', 'failed'].includes(status)
            ? 'Exception sans arrhes enregistr\u00e9e.' : note;
        return '<section class="release-finance-panel" data-reservation-id="' + escape(reservation._id || '') + '" aria-label="\u00c9tat des arrhes"><div class="release-payment-state" role="status">' +
            '<span class="deposit-badge ' + tone + '">' + label + '</span>' +
            (amount ? '<strong>' + escape(amount) + '</strong>' : '') + '</div>' +
            (exception ? '<p class="release-note">' + exception + '</p>' : '') + '</section>';
    }
    window.ServiceRelease = Object.freeze({
        financeEnabled: false,
        explain: () => window.alert(reason),
        financePanel,
        refreshFinancePanel: (root, reservations) => {
            const panel = root?.querySelector('.release-finance-panel');
            const reservation = panel && reservations.find(r => r._id === panel.dataset.reservationId);
            // Refresh only the read-only status, never the staff's editing form.
            if (reservation) panel.outerHTML = financePanel(reservation);
        }
    });
    document.addEventListener('DOMContentLoaded', () => {
        const bar = document.querySelector('.app-bar');
        if (!bar) return;
        const group = document.createElement('div');
        group.className = 'release-tools';
        group.innerHTML = '<button type="button" class="btn btn-secondary" disabled data-unavailable title="' + reason + '" aria-describedby="release-toolbar-note">Paiements attendus</button><span id="release-toolbar-note">Activation \u00e0 venir</span>';
        bar.appendChild(group);
    });
})();
