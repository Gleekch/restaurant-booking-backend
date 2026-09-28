/* This UI-only release deliberately does not activate the unfinished finance workflow. */
(() => {
    const reason = 'Indisponible dans cette version. Arrhes, caisse et suivi d\u2019arriv\u00e9e en pr\u00e9paration.';
    const button = label => '<button type="button" class="btn btn-secondary" disabled data-unavailable title="' + reason + '" aria-describedby="release-finance-note">' + label + '</button>';
    window.ServiceRelease = Object.freeze({
        financeEnabled: false,
        explain: () => window.alert(reason),
        financePanel: (includeRequest = true) => '<section class="release-finance-panel" aria-label="Fonctions en pr\u00e9paration"><p id="release-finance-note" class="release-note">' + reason + '</p><div class="release-finance-actions">' +
            (includeRequest ? button('Demander les arrhes') : '') + button('D\u00e9duire en caisse') + button('Rembourser') + '</div></section>'
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
