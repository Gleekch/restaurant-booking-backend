/* Accessibility for the existing overlays, without changing their action handlers. */
(() => {
    const focusable = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const entries = new Map();
    document.querySelectorAll('.modal').forEach((modal, index) => {
        const heading = modal.querySelector('.modal-header h2');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.tabIndex = -1;
        if (heading) {
            if (!heading.id) heading.id = 'service-dialog-title-' + index;
            modal.setAttribute('aria-labelledby', heading.id);
        }
        const entry = { open: false, trigger: null };
        entries.set(modal, entry);
        const sync = () => {
            const open = visible(modal);
            if (open === entry.open) return;
            entry.open = open;
            if (open) {
                entry.trigger = document.activeElement;
                const first = [...modal.querySelectorAll(focusable)].find(node => !node.disabled && visible(node));
                (first || modal).focus();
            } else if (entry.trigger?.isConnected && visible(entry.trigger)) {
                entry.trigger.focus();
            }
        };
        new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
        sync();
    });
    document.addEventListener('keydown', event => {
        // Native finance dialogs own their focus and Escape handling while open.
        if (document.querySelector('dialog[open]')) return;
        const modal = [...entries.keys()].reverse().find(visible);
        if (!modal) return;
        if (event.key === 'Escape') {
            const close = modal.querySelector('.modal-close, .close-btn');
            if (close) { event.preventDefault(); close.click(); }
        } else if (event.key === 'Tab') {
            const nodes = [...modal.querySelectorAll(focusable)].filter(node => !node.disabled && visible(node));
            const first = nodes[0], last = nodes[nodes.length - 1];
            if (!first) { event.preventDefault(); modal.focus(); return; }
            if (!modal.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
                event.preventDefault(); (event.shiftKey ? last : first).focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        }
    });
})();
