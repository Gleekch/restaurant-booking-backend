(function () {
  'use strict';
  const retention = 30 * 86400000;
  const storageKey = 'mdf-staff-cancellations-v1';
  const copy = value => ({ ...value });
  function createTracker(options = {}) {
    const now = options.now || Date.now;
    const previous = new Map(), pending = new Map(), legacy = new Map(), states = new Map();
    let storage;
    try { storage = options.storage === undefined ? window.localStorage : options.storage; } catch (_) { /* Private mode can forbid storage. */ }
    try {
      const saved = JSON.parse(storage?.getItem(storageKey) || '[]');
      if (Array.isArray(saved)) for (const item of saved) {
        if (Array.isArray(item) && typeof item[0] === 'string' && item[0].length < 100
          && ['presented', 'ack'].includes(item[1]) && Number.isFinite(item[2]) && item[2] >= now() - retention) states.set(item[0], { state: item[1], at: item[2] });
      }
    } catch (_) { /* Notifications must still work without browser persistence. */ }
    function persist() {
      for (const [key, state] of states) if (state.at < now() - retention) states.delete(key);
      try { storage?.setItem(storageKey, JSON.stringify([...states].map(([key, s]) => [key, s.state, s.at]))); } catch (_) { /* Keep the in-memory queue. */ }
    }
    const list = () => [...pending.values()].map(copy);
    const changed = () => options.onChange?.(list());
    function receive(row, explicit = false) {
      const id = String(row?._id || '');
      if (!/^[a-f0-9]{24}$/i.test(id)) return;
      const old = previous.get(id);
      previous.set(id, { status: row.status });
      if (row.status !== 'cancelled') {
        let removed = false;
        for (const [key, entry] of pending) if (entry.reservationId === id) { pending.delete(key); removed = true; }
        if (removed) changed();
        return;
      }
      if (row.cancellationInitiator === 'restaurant') return;
      const at = row.cancelledAt ? new Date(row.cancelledAt).getTime() : NaN;
      const tracked = row.cancellationInitiator === 'client' && Number.isFinite(at);
      if (tracked && (at < now() - retention || at > now() + 60000)) return;
      // Old servers provide no durable cancellation event: only observe an actual
      // status transition or an explicit socket event, never an absent booking.
      if (!tracked && !(old && old.status !== 'cancelled' || explicit && !old)) return;
      let key;
      if (tracked) key = id + ':' + new Date(at).toISOString();
      else { legacy.set(id, (legacy.get(id) || 0) + 1); key = id + ':legacy:' + legacy.get(id); }
      const state = states.get(key);
      if (state?.state === 'ack' || pending.has(key)) return;
      const entry = { key, reservationId: id, name: String(row.customerName || 'Client').slice(0, 200),
        date: String(row.date || '').slice(0, 10), time: String(row.time || '').slice(0, 8),
        people: Number.isInteger(row.numberOfPeople) && row.numberOfPeople > 0 ? row.numberOfPeople : null,
        clientInitiated: tracked, tableNote: row.table ? String(row.table).slice(0, 100) : '', cancelledAt: tracked ? new Date(at).toISOString() : null };
      pending.set(key, entry);
      if (tracked && !state) { states.set(key, { state: 'presented', at }); persist(); }
      changed();
      if (!state) options.onNew?.(copy(entry));
    }
    return {
      observe(rows) { if (Array.isArray(rows)) for (const row of rows) receive(row); },
      event(row) { receive(row, true); },
      list,
      acknowledge(key) {
        const entry = pending.get(key); if (!entry) return;
        if (entry.cancelledAt) { states.set(key, { state: 'ack', at: new Date(entry.cancelledAt).getTime() }); persist(); }
        pending.delete(key); changed();
      }
    };
  }
  function attach(options = {}) {
    const appBar = document.querySelector('.app-bar');
    let tracker, root;
    const text = (tag, value, className) => {
      const node = document.createElement(tag); node.textContent = value;
      if (className) node.className = className;
      return node;
    };
    function render(entries) {
      if (!root) return;
      const expanded = root.querySelector('details')?.open;
      root.replaceChildren(); root.hidden = !entries.length;
      if (!entries.length) return;
      const details = document.createElement('details'); details.open = expanded !== false;
      const summary = text('summary', `Annulations a verifier (${entries.length})`);
      details.append(summary);
      const list = document.createElement('div'); list.className = 'staff-cancellation-list';
      for (const entry of entries) {
        const row = document.createElement('article'); row.className = 'staff-cancellation-row';
        const info = document.createElement('div');
        info.append(text('strong', entry.name));
        const date = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date.split('-').reverse().join('/') : 'Date a verifier';
        info.append(text('p', `${date} · ${entry.time} · ${entry.people ?? '?'} couvert(s)`));
        info.append(text('p', entry.clientInitiated ? 'Annulation par le client. Verifiez le placement dans le plan de salle.' : 'Annulation recue. Verifiez le placement dans le plan de salle.', 'staff-cancellation-hint'));
        if (entry.tableNote) info.append(text('p', 'Ancienne note de table : ' + entry.tableNote));
        const actions = document.createElement('div'); actions.className = 'staff-cancellation-actions';
        const open = text('button', 'Voir la reservation'); open.type = 'button';
        open.addEventListener('click', () => options.onOpen?.(entry.reservationId));
        const ack = text('button', 'Vu'); ack.type = 'button';
        ack.setAttribute('aria-label', 'Marquer comme vue l annulation de ' + entry.name);
        ack.addEventListener('click', () => tracker.acknowledge(entry.key));
        actions.append(open, ack); row.append(info, actions); list.append(row);
      }
      details.append(list); root.append(details);
    }
    if (appBar?.insertAdjacentElement && document.createElement) {
      root = document.createElement('section'); root.hidden = true; root.className = 'staff-cancellations';
      root.setAttribute('aria-label', 'Annulations a verifier');
      appBar.insertAdjacentElement('afterend', root);
      const live = document.createElement('div'); live.className = 'staff-cancellation-live';
      live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); root.after(live);
      options = { ...options, onNew: entry => {
        root.querySelector('details')?.setAttribute('open', '');
        live.textContent = `Reservation annulee : ${entry.name}, ${entry.time}, ${entry.people ?? '?'} couverts.`;
        try { options.notify?.(entry.clientInitiated ? 'Annulation client' : 'Reservation annulee', live.textContent); } catch (_) { /* Visible alert stays available. */ }
      } };
    }
    tracker = createTracker({ ...options, onChange: render });
    return tracker;
  }
  window.StaffCancellationAlerts = { createTracker, attach };
}());
