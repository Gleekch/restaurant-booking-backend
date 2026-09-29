/* Read-only shared view of server-calculated arrival pressure. */
(() => {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tone = (count, limit) => count > limit ? 'over' : count >= limit ? 'full' : count >= limit * .8 ? 'busy' : 'calm';
    const status = (count, limit) => ({ over: 'Surcharge', full: 'Plafond atteint', busy: '\u00c0 espacer', calm: 'Charge mod\u00e9r\u00e9e' })[tone(count, limit)];
    function placeholder(service, date) {
        return `<section class="service-rhythm" data-rhythm-service="${escape(service)}" data-rhythm-date="${escape(date)}" aria-label="Vagues d'arriv\u00e9e" aria-busy="true">
            <h4>Vagues d'arriv\u00e9e</h4><p role="status">Chargement de la charge du service...</p></section>`;
    }
    function render(data, service) {
        const view = data.services[service];
        return `<div class="rhythm-heading"><h4>Vagues d'arriv\u00e9e</h4><span class="rhythm-limit">${data.limit} couverts / ${data.windowMinutes} min</span></div>
            ${view.provisional ? '<p class="rhythm-note">D\u00e9coupage midi propos\u00e9, \u00e0 confirmer.</p>' : ''}
            ${view.closed ? `<p class="rhythm-closed">${view.closure === 'weekly' ? 'Fermeture aux r\u00e9servations en ligne' : 'Service bloqu\u00e9 en ligne'} : les r\u00e9servations existantes restent visibles.</p>` : ''}
            <div class="rhythm-waves">${view.waves.map(wave => `<div class="rhythm-wave rhythm-${tone(wave.peak30, data.limit)}" data-wave-id="${escape(wave.id)}">
                <div class="rhythm-wave-name">${escape(wave.label)}</div><div class="rhythm-hours">${escape(wave.start)} &ndash; ${escape(wave.end)}</div>
                <div class="rhythm-covers"><strong>${wave.covers}</strong> <span>couverts</span></div>
                <div class="rhythm-pressure">Pic 30 min : <strong>${wave.peak30}</strong> / ${data.limit}</div>
                <div class="rhythm-track" aria-hidden="true"><span style="width:${Math.min(100, wave.peak30 / data.limit * 100)}%"></span></div>
                <div class="rhythm-state">${view.closed ? 'Ferm\u00e9 en ligne' : status(wave.peak30, data.limit)}</div></div>`).join('')}</div>
            <p class="rhythm-note">Le pic inclut les arriv\u00e9es proches des vagues voisines. Une vague ne correspond pas \u00e0 un quota de places libres.</p>
            ${view.paymentHolds ? `<p class="rhythm-note">${view.paymentHolds} couverts retenus en attente de paiement, inclus dans la charge.</p>` : ''}
            ${view.outsideWaves ? `<p class="rhythm-closed">${view.outsideWaves} couverts hors des plages affich\u00e9es : v\u00e9rifier le planning.</p>` : ''}`;
    }
    async function load(container, date, request) {
        const nodes = [...container.querySelectorAll('[data-rhythm-service]')];
        const requestId = {};
        nodes.forEach(node => { node.__rhythmRequest = requestId; node.setAttribute('aria-busy', 'true'); });
        const current = node => node.isConnected && node.__rhythmRequest === requestId && node.dataset.rhythmDate === date;
        try {
            const result = await request(`/api/settings/service-rhythm?date=${encodeURIComponent(date)}`);
            const data = result.data;
            if (!result.success || data?.date !== date || !(data.limit > 0)
                || !['midi', 'soir'].every(service => Array.isArray(data.services?.[service]?.waves)
                    && data.services[service].waves.every(wave => Number.isSafeInteger(wave.covers) && wave.covers >= 0
                        && Number.isSafeInteger(wave.peak30) && wave.peak30 >= 0))) throw new Error('Invalid load');
            nodes.filter(current).forEach(node => { node.innerHTML = render(data, node.dataset.rhythmService); node.setAttribute('aria-busy', 'false'); });
        } catch {
            nodes.filter(current).forEach(node => {
                node.setAttribute('aria-busy', 'false');
                node.innerHTML = '<h4>Vagues d\'arriv\u00e9e</h4><p role="alert">Charge indisponible. Ne pas interpr\u00e9ter cet \u00e9tat comme des places libres.</p><button type="button" class="btn btn-secondary rhythm-retry">R\u00e9essayer</button>';
                node.querySelector('button').onclick = event => { event.stopPropagation(); load(container, date, request); };
            });
        }
    }
    window.ServiceRhythm = Object.freeze({ placeholder, load });
})();
