(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const eligible = rows => rows.filter(r => r.status !== 'awaiting-payment');
  const active = rows => eligible(rows).filter(r => !['cancelled', 'no-show'].includes(r.status));
  function clients(rows) {
    const groups = new Map();
    for (const r of eligible(rows)) {
      if (!r.customerName || r.anonymizedAt) continue;
      const key = r.phoneNumber ? `phone:${String(r.phoneNumber).replace(/[^\d+]/g, '')}` : r.email ? `email:${normalize(r.email)}` : `booking:${r._id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return [...groups.values()].map(bookings => {
      bookings.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return { ...bookings[0], bookings };
    }).sort((a, b) => a.customerName.localeCompare(b.customerName, 'fr'));
  }
  function mount(root, view, rows, open) {
    if (root.dataset.insights !== view) {
      root.dataset.insights = view;
      root.innerHTML = `<section class="staff-tool"><header class="staff-heading"><div><p class="staff-eyebrow">LA VIE DU RESTAURANT</p><h2>${view === 'clients' ? 'Fichier clients' : 'Statistiques'}</h2></div></header>
        ${view === 'clients' ? '<label class="staff-search">Rechercher un nom, un telephone ou un email<input type="search" data-search placeholder="Rechercher un client"></label>' : '<div class="staff-toolbar"><label>Du<input type="date" data-from></label><label>Au<input type="date" data-to></label><button type="button" data-reset>Toute la periode</button></div>'}
        <p class="staff-muted">Donnees issues des reservations chargees. Les reservations ne constituent pas un historique de visites ni un chiffre d'affaires.</p><div data-results></div></section>`;
      if (!root._insightsBound) {
        root._insightsBound = true;
        root.addEventListener('input', () => root._insightsRender?.());
        root.addEventListener('click', e => {
        if (e.target.closest('[data-reset]')) { root.querySelector('[data-from]').value = ''; root.querySelector('[data-to]').value = ''; root._insightsRender?.(); }
        const button = e.target.closest('[data-booking]');
        if (button) root._insightsOpen?.(button.dataset.booking);
        });
      }
    }
    root._insightsOpen = id => { const r = rows.find(r => r._id === id); if (r) open(r); };
    root._insightsRender = () => {
      const target = root.querySelector('[data-results]');
      if (view === 'clients') {
        const query = normalize(root.querySelector('[data-search]').value);
        const list = clients(rows).filter(c => normalize(`${c.customerName} ${c.phoneNumber || ''} ${c.email || ''}`).includes(query));
        target.innerHTML = `<p class="staff-muted">${list.length} fiche(s)</p><div class="staff-client-grid">${list.map(c => `<article class="staff-client"><h3>${escape(c.customerName)}</h3><p>${escape(c.phoneNumber || 'Telephone non renseigne')}<br>${escape(c.email || 'Email non renseigne')}</p><details><summary>${c.bookings.length} reservation(s), dont ${c.bookings.filter(r => r.status === 'cancelled').length} annulee(s)</summary>${c.bookings.map(r => `<button type="button" data-booking="${escape(r._id)}">${escape(String(r.date).slice(0, 10))} · ${escape(r.time)} · ${Number(r.numberOfPeople) || 0} couv. · ${escape(({ pending: 'En attente', confirmed: 'Confirmee', cancelled: 'Annulee', completed: 'Terminee', 'no-show': 'No-show' })[r.status] || r.status)}</button>`).join('')}</details></article>`).join('') || '<p>Aucun client correspondant.</p>'}</div>`;
      } else {
        const from = root.querySelector('[data-from]').value, to = root.querySelector('[data-to]').value;
        if (from && to && from > to) { target.innerHTML = '<p role="alert">La date de debut doit preceder la date de fin.</p>'; return; }
        const selected = eligible(rows).filter(r => (!from || String(r.date).slice(0, 10) >= from) && (!to || String(r.date).slice(0, 10) <= to));
        const live = active(selected), covers = live.reduce((n, r) => n + (Number(r.numberOfPeople) || 0), 0);
        const items = [['Reservations hors annulations / no-show', live.length], ['Couverts reserves', covers], ['Moyenne par reservation', live.length ? (covers / live.length).toFixed(1) : '0'], ['En attente', selected.filter(r => r.status === 'pending').length], ['Annulees', selected.filter(r => r.status === 'cancelled').length], ['No-show declares', selected.filter(r => r.status === 'no-show').length]];
        target.innerHTML = `<div class="staff-metrics">${items.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('')}</div><h3>Repartition des couverts reserves</h3><div class="staff-metrics">${['Midi', 'Soir'].map((s, i) => `<article><span>${s}</span><strong>${live.filter(r => (String(r.time) < '15:00' ? 0 : 1) === i).reduce((n, r) => n + (Number(r.numberOfPeople) || 0), 0)}</strong></article>`).join('')}</div>`;
      }
    };
    root._insightsRender();
  }
  window.StaffInsights = { mount, clients };
})();
