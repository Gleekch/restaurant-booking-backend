/* Shared staff review UI. This module never writes a payment field. */
(() => {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pending = r => ['pending', 'confirmed'].includes(r.status) && (r.changeRequests || []).find(c => c.status === 'pending');
    const summary = r => `${new Date(r.date).toLocaleDateString('fr-FR', { timeZone: 'UTC' })} a ${r.time} - ${r.numberOfPeople} couverts`;
    const badge = r => pending(r) ? '<span class="change-request-badge">Modification a valider</span>' : '';
    function panel(r) {
        const change = pending(r);
        if (!change) return '';
        return `<section class="change-request-panel" aria-label="Demande de modification">
            <h3>Modification demandee par le client</h3>
            <p><strong>Reservation actuelle :</strong> ${escape(summary(r))}</p>
            <p><strong>Souhait du client :</strong> ${escape(summary(change.proposed))}</p>
            <p>Les arrhes deja payees sont conservees. Aucun supplement pour les personnes ajoutees.</p>
            <p>Le creneau sera reverifie a l'acceptation. La date limite de remboursement sera recalculee selon la nouvelle date et le nouvel horaire.</p>
            <div class="change-request-actions">
                <button type="button" class="btn btn-primary" data-change-decision="accept">Accepter la modification</button>
                <button type="button" class="btn btn-secondary" data-change-decision="reject">Refuser la demande</button>
            </div><p role="status" class="change-request-result"></p>
        </section>`;
    }
    function bind(container, r, request, refreshed) {
        const change = pending(r);
        if (!change) return;
        for (const button of container.querySelectorAll('[data-change-decision]')) {
            button.addEventListener('click', async () => {
                const decision = button.dataset.changeDecision;
                if (!window.confirm(decision === 'accept'
                    ? `Accepter : ${summary(change.proposed)} ? Les arrhes deja payees restent inchangees.`
                    : 'Refuser cette demande et conserver la reservation actuelle ?')) return;
                const buttons = container.querySelectorAll('[data-change-decision]');
                const message = container.querySelector('.change-request-result');
                buttons.forEach(item => { item.disabled = true; });
                message.textContent = 'Traitement en cours...';
                try {
                    const result = await request(`/api/reservations/${encodeURIComponent(r._id)}/change-requests/${encodeURIComponent(change.requestId)}/decision`,
                        { method: 'POST', body: { decision } });
                    if (!result.success) throw new Error(result.message || 'Modification non enregistree.');
                    await refreshed();
                } catch (error) {
                    message.textContent = error.message || 'Echec de la modification. Rechargez avant de reessayer.';
                    buttons.forEach(item => { item.disabled = false; });
                }
            });
        }
    }
    function updateQueue(records, openDetails) {
        const requests = records.filter(pending);
        document.querySelector('.app-bar')?.classList.toggle('has-change-requests', requests.length > 0);
        let button = document.getElementById('change-requests-button');
        if (!button) {
            button = document.createElement('button');
            button.id = 'change-requests-button'; button.type = 'button'; button.className = 'btn btn-primary';
            document.querySelector('.app-bar')?.append(button);
        }
        button.hidden = requests.length === 0;
        button.textContent = `Modifications (${requests.length})`;
        button.onclick = () => {
            document.getElementById('change-requests-dialog')?.close();
            document.getElementById('change-requests-dialog')?.remove();
            const dialog = document.createElement('dialog');
            dialog.id = 'change-requests-dialog'; dialog.className = 'workflow-dialog';
            dialog.innerHTML = '<h3>Modifications a valider</h3><p>La reservation initiale reste en place tant que vous ne validez pas.</p>';
            for (const r of requests) {
                const item = document.createElement('button');
                item.type = 'button'; item.className = 'change-queue-item';
                item.textContent = `${r.customerName} : ${summary(pending(r).proposed)}`;
                item.onclick = () => { dialog.close(); openDetails(r); };
                dialog.append(item);
            }
            const close = document.createElement('button');
            close.type = 'button'; close.className = 'btn btn-secondary'; close.textContent = 'Fermer';
            close.onclick = () => dialog.close(); dialog.append(close);
            dialog.addEventListener('close', () => { dialog.remove(); button.focus(); });
            document.body.append(dialog); dialog.showModal();
        };
    }
    window.ReservationChanges = Object.freeze({ pending, badge, panel, bind, updateQueue });
})();
