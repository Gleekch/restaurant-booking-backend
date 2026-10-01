(function () {
  'use strict';
  const instances = new WeakMap();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const serviceOf = r => String(r.time) < '15:00' ? 'midi' : 'soir';
  const dateOf = r => String(r.date).slice(0, 10);
  const planPath = r => `/api/floor-plans/service?date=${dateOf(r)}&service=${serviceOf(r)}`;
  const hasOrder = b => Number.isInteger(b.bookingOrder) && b.bookingOrder > 0;
  function orderedBookings(rows, order = 'booking') {
    const priority = b => hasOrder(b) ? b.bookingOrder : Infinity;
    return [...rows].sort((a, b) =>
      (order === 'time' ? a.time.localeCompare(b.time) : 0)
      || priority(a) - priority(b) || String(a.id).localeCompare(String(b.id)));
  }
  function creationLabel(b) {
    const date = b.createdAt ? new Date(b.createdAt) : null;
    return date && Number.isFinite(date.getTime())
      ? `Prise le ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Indian/Reunion', dateStyle: 'short', timeStyle: 'short' }).format(date)} (Reunion)`
      : 'Date de prise inconnue : priorite a verifier.';
  }
  function tableLabel(r) {
    return `<span data-table-reservation="${escape(r._id)}">Chargement des tables...</span>`;
  }
  async function annotate(root, rows, request) {
    const targets = [...root.querySelectorAll('[data-table-reservation]')];
    const token = {};
    const groups = new Map();
    for (const el of targets) {
      const r = rows.find(r => String(r._id) === el.dataset.tableReservation);
      if (!r) continue;
      el.floorPlanLabelRequest = token;
      const path = planPath(r);
      if (!groups.has(path)) groups.set(path, []);
      groups.get(path).push({ el, r });
    }
    for (const [path, entries] of groups) {
      try {
        const result = await request(path);
        const plan = result?.data;
        if (!result?.success || !Array.isArray(plan?.assignments) || !Array.isArray(plan?.layout?.tables)) throw new Error('Unavailable');
        for (const { el, r } of entries) {
          if (!el.isConnected || el.floorPlanLabelRequest !== token) continue;
          const a = plan.assignments.find(a => a.reservationId === String(r._id));
          const names = a?.tableIds.map(id => plan.layout.tables.find(t => t.id === id)?.name || '?');
          el.textContent = a ? `${a.review ? 'Placement a revoir : ' : 'Tables : '}${names.join(' + ')}` : 'Table a attribuer';
          if (r.table) el.textContent += ` (ancienne note : ${r.table})`;
          const b = plan.bookings?.find(b => b.id === String(r._id));
          if (b && hasOrder(b)) el.textContent += ` · Ordre de reservation : n° ${b.bookingOrder}`;
        }
      } catch (_) {
        for (const { el, r } of entries) if (el.isConnected && el.floorPlanLabelRequest === token) el.textContent = `Placement indisponible${r.table ? ` (ancienne note : ${r.table})` : ''}`;
      }
    }
  }
  function watch(root, getRows, request) {
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; annotate(root, getRows(), request); }, 0);
    };
    new MutationObserver(changes => {
      if (changes.some(change => [...change.addedNodes].some(node => node.nodeType === 1 && (node.matches('[data-table-reservation]') || node.querySelector('[data-table-reservation]'))))) refresh();
    }).observe(root, { childList: true, subtree: true });
    refresh();
  }
  function confirmPlan(state, title, message, action, danger = false) {
    if (state.confirming) return Promise.resolve(false);
    state.confirming = true;
    const dialog = document.createElement('dialog'), id = `fp-confirm-${crypto.randomUUID()}`;
    dialog.className = 'staff-tool fp-confirm';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-message`);
    dialog.innerHTML = `<form method="dialog"><h2 id="${id}-title">${escape(title)}</h2><p id="${id}-message">${escape(message)}</p><div class="fp-actions"><button value="cancel" autofocus>Annuler</button><button value="confirm" class="${danger ? 'staff-danger' : 'staff-primary'}">${escape(action)}</button></div></form>`;
    document.body.append(dialog);
    return new Promise(resolve => {
      dialog.addEventListener('close', () => {
        state.confirming = false;
        const accepted = dialog.returnValue === 'confirm';
        dialog.remove(); resolve(accepted);
      }, { once: true });
      dialog.showModal();
    });
  }
  async function canLeave(root) {
    const state = instances.get(root);
    if (state?.busy || state?.confirming) return false;
    if ((state?.dirty || state?.editDirty || state?.adding) && !await confirmPlan(state, 'Quitter le plan ?', 'Les modifications non enregistrees seront perdues. Les reservations sont conservees.', 'Quitter sans enregistrer', true)) return false;
    if (state) { state.disposed = true; state.events.abort(); clearInterval(state.timer); instances.delete(root); root.innerHTML = ''; }
    return true;
  }
  function mount(root, options) {
    if (instances.has(root)) { instances.get(root).refresh?.(); return; }
    const s = { date: options.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), service: options.service || 'midi', focusBooking: options.reservationId || null, template: false, zone: 'terrace', selected: new Set(), dirty: false, editDirty: false, edit: null, busy: false, data: null, adding: null, message: '', error: false, generation: 0, refreshing: false, remoteChanged: false, syncError: '' };
    instances.set(root, s);
    s.order = 'booking';
    s.events = new AbortController();
    const on = (name, handler) => root.addEventListener(name, handler, { signal: s.events.signal });
    const endpoint = () => s.template ? '/api/floor-plans/template' : `/api/floor-plans/service?date=${s.date}&service=${s.service}`;
    const selectedTables = () => s.data.layout.tables.filter(t => s.selected.has(t.id));
    const assigned = id => s.data.assignments.find(a => a.tableIds.includes(id));
    const booking = id => s.data.bookings.find(b => b.id === id);
    const mark = () => { s.dirty = true; s.error = false; s.message = 'Modifications non enregistrees.'; };
    const discard = async () => !(s.dirty || s.editDirty || s.adding) || await confirmPlan(s, 'Abandonner le brouillon ?', 'Les modifications non enregistrees du plan seront perdues. Les reservations sont conservees.', 'Abandonner les modifications', true);
    function updateControls() {
      const save = root.querySelector('[data-action="save"]');
      if (save) save.disabled = !s.data || !(s.dirty || s.editDirty) || s.busy || Boolean(s.adding);
    }
    function syncStatus() {
      const el = root.querySelector('.fp-sync');
      if (!el) return;
      const reviews = s.data?.assignments.filter(a => a.review).length || 0;
      const messages = [];
      if (s.remoteChanged) messages.push('Plan modifie sur un autre poste. Votre disposition reste affichee : rechargez pour consulter la version partagee.');
      if (reviews) messages.push(`${reviews} placement(s) a revoir : reservation modifiee ou annulee.`);
      if (s.syncError) messages.push('Actualisation indisponible. Les donnees peuvent etre anciennes ; votre brouillon est conserve.');
      if (s.refreshing) messages.push('Actualisation en cours ; vous pouvez continuer a travailler.');
      const text = messages.join(' ');
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !text; el.dataset.error = String(Boolean(reviews || s.remoteChanged || s.syncError));
    }
    function invalidateReads() {
      s.generation++; s.refreshToken = null; s.refreshing = false; s.pendingRefresh = null;
    }
    function status(message, error = false) {
      s.message = message; s.error = error;
      const el = root.querySelector('.fp-message');
      if (el) { el.textContent = message; el.dataset.error = String(error); }
    }
    async function request(path, opts) {
      const result = await options.request(path, opts);
      if (!result?.success || !result.data) throw new Error(result?.message || 'Plan indisponible.');
      return result.data;
    }
    function refreshReviews() {
      for (const a of s.data.assignments) a.review = !booking(a.reservationId) || a.fingerprint !== booking(a.reservationId).fingerprint;
    }
    function versionOf(data) {
      // Older backends have no template revision; compare the loaded layout instead.
      return JSON.stringify([data.revision, Boolean(data.inherited),
        data.inherited ? data.templateRevision ?? data.layout : null]);
    }
    function acceptData(data) {
      s.data = data;
      s.loadedVersion = versionOf(data);
    }
    function acceptTemplateVersion(template) {
      if (!s.data.inherited) return;
      if (Number.isInteger(s.data.templateRevision)) s.data.templateRevision = template.revision;
      s.loadedVersion = versionOf({ ...s.data, layout: template.layout });
      s.remoteChanged = false;
    }
    function receiveRefresh(data) {
      if (s.dragging) { s.pendingRefresh = data; return; }
      const protectedDraft = s.dirty || s.editDirty || s.adding || s.confirming || root.contains(document.activeElement);
      const changed = versionOf(data) !== s.loadedVersion;
      s.syncError = '';
      if (changed && !protectedDraft) {
        acceptData(data); s.remoteChanged = false;
        s.selected = new Set([...s.selected].filter(id => data.layout.tables.some(t => t.id === id)));
        render(); return;
      }
      const before = JSON.stringify([s.data.bookings, s.data.assignments]);
      s.remoteChanged = changed;
      s.data.bookings = data.bookings; s.data.closed = data.closed;
      refreshReviews();
      if (before !== JSON.stringify([s.data.bookings, s.data.assignments])) {
        const active = document.activeElement;
        const tableId = active?.dataset?.table;
        const bookingAction = ['open', 'place', 'unplace'].find(key => active?.dataset?.[key]);
        const bookingId = bookingAction && active.dataset[bookingAction];
        board(); bookings();
        if (tableId) root.querySelector(`[data-table="${tableId}"]`)?.focus({ preventScroll: true });
        if (bookingAction) root.querySelector(`[data-${bookingAction}="${bookingId}"]`)?.focus({ preventScroll: true });
      }
      syncStatus();
    }
    async function refresh() {
      if (!s.data || s.busy || s.refreshing || s.confirming || s.dragging || s.disposed) return;
      const generation = s.generation, token = {};
      s.refreshing = true; s.refreshToken = token; syncStatus();
      try {
        const data = await request(endpoint());
        if (!s.disposed && s.generation === generation) receiveRefresh(data);
      } catch (error) {
        if (!s.disposed && s.generation === generation) s.syncError = error.message;
      } finally {
        if (s.refreshToken === token) { s.refreshing = false; syncStatus(); }
      }
    }
    s.refresh = refresh;
    async function load() {
      if (s.busy || s.confirming || s.disposed) return;
      invalidateReads();
      s.busy = true;
      status('Chargement du plan...'); render();
      try {
        const data = await request(endpoint());
        if (s.disposed) return;
        acceptData(data); s.dirty = false; s.edit = null; s.editDirty = false; s.adding = null; s.remoteChanged = false; s.syncError = ''; s.selected = new Set([...s.selected].filter(id => data.layout.tables.some(t => t.id === id)));
        if (s.focusBooking && !s.focused) {
          s.focused = true;
          const a = data.assignments.find(a => a.reservationId === s.focusBooking);
          if (a) { s.selected = new Set(a.tableIds); s.zone = data.layout.tables.find(t => t.id === a.tableIds[0])?.zone || s.zone; }
        }
        const reviews = data.assignments.filter(a => a.review).length;
        status(reviews ? `${reviews} placement(s) a revoir : reservation modifiee ou annulee.` : data.inherited ? 'Plan type applique a ce service. Enregistrez pour conserver cette disposition.' : `Plan charge${data.updatedAt ? ` · enregistre le ${new Date(data.updatedAt).toLocaleString('fr-FR')}` : ''}.`, reviews > 0);
      } catch (error) { status(error.message, true); }
      finally { s.busy = false; if (!s.disposed) render(); }
    }
    function planContent(data) {
      const byId = (a, b) => a.id.localeCompare(b.id);
      return JSON.stringify({
        zones: data.layout.zones.map(z => ({ id: z.id, name: z.name })).sort(byId),
        tables: data.layout.tables.map(t => ({ id: t.id, name: t.name, seats: t.seats, zone: t.zone, shape: t.shape, x: t.x, y: t.y, width: t.width, height: t.height })).sort(byId),
        assignments: data.assignments.map(a => ({ id: a.reservationId, tableIds: [...a.tableIds].sort(), fingerprint: a.fingerprint })).sort(byId)
      });
    }
    async function writeVerified(path, payload) {
      try { return await request(path, { method: 'PUT', body: payload }); }
      catch (error) {
        status('Verification de l enregistrement apres une erreur de reponse...');
        let latest;
        try { latest = await request(path); }
        catch (_) { throw new Error('Resultat de l enregistrement incertain : verification impossible. Votre brouillon est conserve. Reessayez lorsque la connexion revient.'); }
        // A lost acknowledgement (including a browser retry returning 409) is not a failed write.
        if (latest.revision > payload.revision && planContent(latest) === planContent(payload)) return latest;
        if (path === endpoint()) receiveRefresh(latest);
        if (latest.revision !== payload.revision) throw new Error('Ce plan a ete modifie sur un autre poste. Votre brouillon est conserve ; rechargez pour consulter la version partagee.');
        throw new Error(`${error.message} Enregistrement non confirme. Votre brouillon reste affiche.`);
      }
    }
    async function save() {
      if (s.busy || !s.data || !applyEditor()) return;
      invalidateReads();
      s.busy = true; render();
      try {
        const data = await writeVerified(endpoint(), clone({ revision: s.data.revision, layout: s.data.layout, assignments: s.data.assignments }));
        acceptData(data); s.dirty = false; s.remoteChanged = false; s.syncError = '';
        status(s.template ? 'Plan enregistre. Le plan type sera propose aux nouveaux services, sans copier de reservations.' : 'Plan enregistre. Les attributions sont visibles sur les reservations. Les paiements sont inchanges.');
        options.onSaved?.(data);
      } catch (error) { status(error.message, true); }
      finally { s.busy = false; render(); }
    }
    async function saveAsTemplate() {
      if (s.busy || s.confirming || s.adding || !s.data || s.template || !applyEditor()) return;
      invalidateReads();
      const layout = clone(s.data.layout);
      s.busy = true; render();
      try {
        const base = await request('/api/floor-plans/template');
        if (!await confirmPlan(s, base.revision ? 'Remplacer le plan type ?' : 'Creer un plan type ?',
          `Enregistrer cette disposition de ${layout.tables.length} table(s) comme modele reutilisable ? ${base.revision ? 'Le plan type existant sera remplace. ' : ''}Seules les tables et leurs places sont copiees, jamais les reservations. Les services deja enregistres restent inchanges.`, 'Enregistrer le plan type')) return;
        const saved = await writeVerified('/api/floor-plans/template', { revision: base.revision, layout, assignments: [] });
        acceptTemplateVersion(saved);
        status(`Plan type enregistre. Il sera propose aux nouveaux services, sans copier de reservations.${s.dirty ? ' Le brouillon de ce service reste a enregistrer avec Enregistrer le plan.' : ' Le service affiche reste inchange.'}`);
      } catch (error) { status(`Plan type : ${error.message} Votre disposition reste affichee.`, true); }
      finally { s.busy = false; render(); }
    }
    function board() {
      const el = root.querySelector('.fp-board');
      if (!el || !s.data) return;
      const tables = s.data.layout.tables.filter(t => t.zone === s.zone);
      el.innerHTML = tables.map(t => {
        const a = assigned(t.id), b = a && booking(a.reservationId);
        return `<button type="button" class="fp-table" data-table="${escape(t.id)}" data-round="${t.shape === 'round'}" data-occupied="${Boolean(a)}" aria-pressed="${s.selected.has(t.id)}" aria-label="${escape(`${t.name}, ${t.seats} places${b ? `, ${b.name}` : ''}`)}" style="left:${t.x / 10}%;top:${t.y / 6.5}%;width:${t.width / 10}%;height:${t.height / 6.5}%"><strong>${escape(t.name)}</strong><small>${t.seats} places</small>${a ? `<small>${a.review ? 'A revoir' : escape(b?.name || 'Placement a revoir')}</small>` : ''}</button>`;
      }).join('') || '<div class="fp-empty"><strong>Composez votre espace</strong>Ajoutez vos tables, puis deplacez-les sur le plan.</div>';
    }
    function render() {
      const focus = root.contains(document.activeElement) ? document.activeElement?.dataset?.control : null;
      const active = root.contains(document.activeElement) ? document.activeElement : null;
      const formSelector = active?.closest('[data-table-form]') ? '[data-table-form]' : active?.closest('[data-new-table-form]') ? '[data-new-table-form]' : null;
      const field = formSelector && active.name, start = active?.selectionStart, end = active?.selectionEnd;
      root.innerHTML = `<section class="staff-tool"><header class="staff-heading"><div><p class="staff-eyebrow">ORGANISATION DU SERVICE</p><h2>Plan de salle</h2></div><div class="fp-actions">${!s.template ? `<button type="button" data-action="save-template" ${!s.data || s.busy || s.adding ? 'disabled' : ''}>Enregistrer comme plan type</button>` : ''}<button type="button" class="staff-primary" data-action="save" ${!s.data || !(s.dirty || s.editDirty) || s.busy || s.adding ? 'disabled' : ''}>${s.template ? 'Enregistrer le plan type' : 'Enregistrer le plan'}</button></div></header>
        <fieldset class="fp-fieldset" ${s.busy ? 'disabled' : ''}><div class="staff-toolbar fp-context">
          <label>Disposition<select data-control="mode"><option value="service" ${!s.template ? 'selected' : ''}>Ce service</option><option value="template" ${s.template ? 'selected' : ''}>Plan type reutilisable</option></select></label>
          ${!s.template ? `<label>Date<input type="date" data-control="date" value="${escape(s.date)}" required></label><label>Service<select data-control="service"><option value="midi" ${s.service === 'midi' ? 'selected' : ''}>Midi</option><option value="soir" ${s.service === 'soir' ? 'selected' : ''}>Soir</option></select></label>` : ''}
          <button type="button" data-action="reload">Recharger</button>${!s.template && s.data ? '<button type="button" data-action="base">Utiliser le plan type</button>' : ''}</div>
        <div class="fp-message" role="status" aria-live="polite" data-error="${s.error}">${escape(s.message)}</div>
        <p class="fp-sync" role="status" aria-live="polite" hidden></p>
        ${s.data ? `<p class="staff-muted">${s.template ? 'Le plan type initialise les futurs services. Les services deja enregistres restent inchanges.' : `${s.data.closed ? 'Service habituellement ferme : aucune nouvelle reservation autorisee. ' : ''}Une table est attribuee a un seul groupe pour tout le service. Pas de second placement automatique.`} Les places du plan ne remplacent pas les limites de reservation.</p>
        <div class="fp-workspace"><div><div class="fp-tabs">${s.data.layout.zones.map(z => `<button type="button" data-zone="${z.id}" aria-pressed="${s.zone === z.id}">${escape(z.name)} · ${s.data.layout.tables.filter(t => t.zone === z.id).reduce((n, t) => n + t.seats, 0)} places</button>`).join('')}</div><div class="fp-board-wrap"><div class="fp-board" aria-label="Disposition des tables"></div></div><p class="staff-muted">Glissez les tables pour les deplacer. Touchez plusieurs tables pour les regrouper. Sur telephone, faites defiler le plan horizontalement depuis une zone vide. Les fleches du clavier deplacent la table selectionnee.</p></div>
        <aside class="fp-side"><div><h3>Composer la salle</h3><p class="staff-muted">${s.data.layout.tables.length} table(s) · ${s.selected.size} selectionnee(s)</p><div class="fp-actions"><button type="button" data-action="add">+ Ajouter une table</button><button type="button" data-action="clear">Deselectionner</button></div><details class="fp-catalog" ${!s.data.layout.tables.length ? 'open' : ''}><summary>Numeros du restaurant</summary><p class="staff-muted">Choisissez un numero, sa zone et ses places. Rien n'est ajoute sans validation.</p><div>${(s.data.tableCatalog || []).map(name => `<button type="button" data-catalog="${escape(name)}" aria-label="Ajouter la table ${escape(name)}" ${s.data.layout.tables.some(t => t.name === name) ? 'disabled' : ''}>${escape(name)}</button>`).join('')}</div></details></div><div data-editor></div></aside></div>
        ${!s.template ? `<div class="fp-bookings"><div class="fp-bookings-heading"><div><h3>Reservations du service</h3><p class="staff-muted">Les premieres reservations sont prioritaires pour les tables proches de la mer. Le rang suit la date de prise initiale, pas l'heure du repas ni la confirmation.</p></div><label>Trier les reservations<select data-control="order"><option value="booking" ${s.order === 'booking' ? 'selected' : ''}>Ordre de reservation</option><option value="time" ${s.order === 'time' ? 'selected' : ''}>Heure du repas</option></select></label></div><p class="staff-muted">Selectionnez les tables sur le plan, puis cliquez sur Placer et Enregistrer le plan. Le placement reste manuel, selon les places et les demandes des clients. Aucun placement existant n'est deplace automatiquement.</p><div data-bookings></div></div>` : ''}` : '<p class="staff-muted">Le plan necessite le backend mis a jour. Aucune donnee existante n\'est modifiee en cas d\'indisponibilite.</p>'}</fieldset></section>`;
      if (s.data) { board(); editor(); bookings(); }
      if (focus) root.querySelector(`[data-control="${focus}"]`)?.focus();
      if (field) {
        const input = root.querySelector(`${formSelector} [name="${field}"]`);
        input?.focus({ preventScroll: true });
        if (input && start !== null && start !== undefined) input.setSelectionRange(start, end);
      }
      syncStatus();
    }
    function editor() {
      const target = root.querySelector('[data-editor]'), tables = selectedTables();
      if (!target) return;
      if (s.adding) {
        target.innerHTML = `<form data-new-table-form><h3>Ajouter une table</h3><label>Numero / nom<input name="name" maxlength="24" value="${escape(s.adding.name)}" required></label><label>Places pour cette disposition<input name="seats" type="number" min="1" max="20" value="${escape(s.adding.seats || '')}" placeholder="A renseigner" required></label><label>Zone<select name="zone" required><option value="">Choisir la zone</option>${s.data.layout.zones.map(z => `<option value="${z.id}" ${s.adding.zone === z.id ? 'selected' : ''}>${escape(z.name)}</option>`).join('')}</select></label><button type="submit" class="staff-primary">Ajouter au plan</button><button type="button" data-action="cancel-add">Annuler l'ajout</button></form>`;
        return;
      }
      if (!tables.length) { target.innerHTML = '<p class="staff-muted">Selectionnez une table pour modifier son nom, ses places, sa forme et sa zone.</p>'; return; }
      const t = { ...tables[0], ...(s.edit?.id === tables[0].id ? s.edit.values : {}) };
      target.innerHTML = `${tables.length === 1 ? `<form data-table-form><h3>Table ${escape(t.name)}</h3><label>Nom<input name="name" value="${escape(t.name)}" maxlength="24" required></label><div class="fp-pair"><label>Places<input name="seats" type="number" value="${escape(t.seats)}" min="1" max="20" required></label><label>Forme<select name="shape"><option value="rectangle" ${t.shape === 'rectangle' ? 'selected' : ''}>Rectangle</option><option value="round" ${t.shape === 'round' ? 'selected' : ''}>Ronde</option></select></label></div><label>Zone<select name="zone">${s.data.layout.zones.map(z => `<option value="${z.id}" ${t.zone === z.id ? 'selected' : ''}>${escape(z.name)}</option>`).join('')}</select></label><div class="fp-pair"><label>Largeur<input name="width" type="number" min="70" max="260" value="${escape(t.width)}" required></label><label>Profondeur<input name="height" type="number" min="60" max="200" value="${escape(t.height)}" required></label></div><button type="submit">Appliquer les proprietes</button></form>` : `<h3>${tables.length} tables selectionnees</h3><p>${tables.reduce((n, t) => n + t.seats, 0)} places au total</p>`}
        <p class="staff-muted">Deplacer la selection</p><div class="fp-move"><button type="button" data-move="left" aria-label="Deplacer a gauche">&larr;</button><button type="button" data-move="up" aria-label="Deplacer vers le haut">&uarr;</button><button type="button" data-move="down" aria-label="Deplacer vers le bas">&darr;</button><button type="button" data-move="right" aria-label="Deplacer a droite">&rarr;</button></div><div class="fp-actions"><button type="button" data-action="duplicate" ${tables.length !== 1 ? 'disabled' : ''}>Dupliquer</button><button type="button" data-action="remove" class="staff-danger">Supprimer</button></div>`;
    }
    function placementFeedback(b, tables) {
      if (!tables.length) return { error: false, message: `Choisissez une ou plusieurs tables pour ces ${b.people} couverts.` };
      const occupied = tables.filter(t => assigned(t.id) && assigned(t.id).reservationId !== b.id);
      if (occupied.length) return { error: true, message: `Une table selectionnee est deja attribuee a un autre groupe (${occupied.map(t => t.name).join(', ')}). Deselectionnez-la ou choisissez des tables libres.` };
      if (new Set(tables.map(t => t.zone)).size !== 1) return { error: true, message: 'Les tables du groupe doivent rester dans la meme zone.' };
      const seats = tables.reduce((n, t) => n + t.seats, 0);
      if (seats < b.people) return { error: true, message: `Places insuffisantes : ${seats} places selectionnees pour ${b.people} couverts. Ajoutez ${b.people - seats} place(s) en selectionnant d'autres tables libres dans la meme zone, ou ajustez les places si la disposition reelle le permet.` };
      return { error: false, message: `${seats} places selectionnees pour ${b.people} couverts. Vous pouvez placer ce groupe.` };
    }
    function bookings() {
      const el = root.querySelector('[data-bookings]');
      if (!el) return;
      const tables = selectedTables();
      const placedIds = new Set(s.data.assignments.map(a => a.reservationId));
      const rows = orderedBookings(s.data.bookings, s.order);
      for (const a of s.data.assignments) if (!booking(a.reservationId)) rows.push({ id: a.reservationId, name: 'Reservation annulee ou deplacee', time: '', people: null });
      const selection = tables.length ? `Tables selectionnees : ${tables.map(t => t.name).join(' + ')} / ${tables.reduce((n, t) => n + t.seats, 0)} places au total.` : 'Aucune table selectionnee. Choisissez les tables du prochain groupe sur le plan.';
      const unknown = s.data.bookings.filter(b => !hasOrder(b)).length;
      el.innerHTML = `<p class="fp-selection-summary" role="status">${escape(selection)}</p><p class="staff-muted">Rang parmi les reservations de ce service dont la date de prise est connue ; un meme horodatage donne le meme rang.${unknown ? ` ${unknown} reservation(s) sans date connue : verifiez leur priorite manuellement.` : ''}</p>` + (rows.map(b => {
        const a = s.data.assignments.find(a => a.reservationId === b.id);
        const labels = a?.tableIds.map(id => s.data.layout.tables.find(t => t.id === id)?.name || '?').join(' + ');
        // A selection advises unplaced groups only; Replacer still validates on click.
        const feedback = b.people && !a && placementFeedback(b, tables);
        return `<article class="fp-booking" data-booking-id="${escape(b.id)}" data-focus-booking="${s.focusBooking === b.id}" data-review="${Boolean(a?.review)}"><div class="fp-booking-info">${b.people ? `<span class="fp-booking-order">${hasOrder(b) ? `Ordre de reservation · n° ${b.bookingOrder}` : 'Ordre a verifier'}</span>` : ''}<strong>${escape(b.name)}</strong>${b.people ? `<p class="fp-created-at">${escape(creationLabel(b))}</p>` : ''}${s.focusBooking === b.id ? '<p>Reservation selectionnee : choisissez ses tables puis enregistrez le plan.</p>' : ''}<p>Repas : ${escape(b.time)}${b.people ? ` · ${b.people} couverts` : ''}${b.status === 'pending' ? ' · A confirmer' : ''}</p><p>${a ? `${a.review ? 'A revoir : ' : 'Tables : '}${escape(labels)}` : 'Non placee'}${b.legacyTable ? ` · Ancienne note : ${escape(b.legacyTable)}` : ''}</p>${feedback ? `<p id="fp-placement-${escape(b.id)}" class="fp-placement-feedback" data-placement-feedback="${escape(b.id)}" data-error="${feedback.error}">${escape(feedback.message)}</p>` : ''}</div><div class="fp-actions">${b.people ? `<button type="button" data-open="${escape(b.id)}">Fiche</button><button type="button" data-place="${escape(b.id)}" ${feedback ? `aria-describedby="fp-placement-${escape(b.id)}"` : ''} ${!s.selected.size ? 'disabled' : ''}>${placedIds.has(b.id) ? 'Replacer' : 'Placer'}</button>` : ''}${a ? `<button type="button" data-unplace="${escape(b.id)}">Retirer du plan</button>` : ''}</div></article>`;
      }).join('') || '<p class="staff-muted">Aucune reservation pour ce service. Le plan ne cree aucune reservation.</p>');
    }
    function move(dx, dy) {
      const tables = selectedTables();
      if (!tables.length) return;
      dx = Math.max(-Math.min(...tables.map(t => t.x)), Math.min(dx, Math.min(...tables.map(t => 1000 - t.width - t.x))));
      dy = Math.max(-Math.min(...tables.map(t => t.y)), Math.min(dy, Math.min(...tables.map(t => 650 - t.height - t.y))));
      for (const t of tables) { t.x += dx; t.y += dy; }
      mark(); render();
    }
    function nextName() {
      const available = (s.data.tableCatalog || []).find(name => !s.data.layout.tables.some(t => t.name === name));
      if (available) return available;
      let n = 1; while (s.data.layout.tables.some(t => t.name === String(n))) n++; return String(n);
    }
    function addTable(t) {
      let positioned = false;
      for (let y = 40; y + t.height <= 650 && !positioned; y += 120) {
        for (let x = 40; x + t.width <= 1000; x += 150) {
          if (!s.data.layout.tables.some(other => other.zone === t.zone && x < other.x + other.width + 8 && x + t.width + 8 > other.x && y < other.y + other.height + 8 && y + t.height + 8 > other.y)) { t.x = x; t.y = y; positioned = true; break; }
        }
      }
      s.data.layout.tables.push(t); s.zone = t.zone; s.selected = new Set([t.id]); s.adding = null; mark(); render();
    }
    function captureEditor(form) {
      const old = selectedTables()[0];
      if (!old) return;
      const values = Object.fromEntries(new FormData(form));
      s.editDirty = Object.entries(values).some(([key, value]) => String(old[key]) !== value);
      s.edit = s.editDirty ? { id: old.id, values } : null;
      updateControls();
    }
    function applyEditor() {
      if (!s.editDirty) return true;
      const form = root.querySelector('[data-table-form]');
      if (!form || !form.reportValidity()) return false;
      const old = s.data.layout.tables.find(t => t.id === s.edit.id), f = s.edit.values;
      const updated = { ...old, name: f.name.trim(), seats: Number(f.seats), shape: f.shape, zone: f.zone, width: Number(f.width), height: Number(f.height) };
      if (!updated.name || s.data.layout.tables.some(t => t.id !== old.id && t.name.toLowerCase() === updated.name.toLowerCase())) { status('Choisissez un nom de table distinct.', true); return false; }
      if (!Number.isInteger(updated.seats) || updated.seats < 1 || updated.seats > 20) { status('Indiquez de 1 a 20 places.', true); return false; }
      const a = assigned(old.id);
      if (a) {
        const group = a.tableIds.map(id => id === old.id ? updated : s.data.layout.tables.find(t => t.id === id));
        if (a.review || !booking(a.reservationId)) { status('Verifiez le placement avant de modifier cette table.', true); return false; }
        if (new Set(group.map(t => t.zone)).size !== 1 || group.reduce((n, t) => n + t.seats, 0) < booking(a.reservationId).people) { status('Le groupe doit rester dans la meme zone avec assez de places pour ses convives.', true); return false; }
      }
      updated.x = Math.min(updated.x, 1000 - updated.width); updated.y = Math.min(updated.y, 650 - updated.height);
      Object.assign(old, updated); s.zone = updated.zone; s.edit = null; s.editDirty = false; mark();
      return true;
    }
    async function changeContext(e) {
      const c = e.target.dataset.control;
      if (!c || s.busy || s.confirming) return;
      const value = e.target.value;
      if (c === 'order') {
        if (!['booking', 'time'].includes(value)) return;
        s.order = value; bookings(); return;
      }
      if ((c === 'date' || c === 'service') && s[c] === value) return;
      if (!await discard()) { render(); return; }
      if (c === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { render(); return; }
      if (c === 'mode') s.template = value === 'template'; else s[c] = value;
      s.data = null; s.dirty = false; s.edit = null; s.editDirty = false; s.adding = null; s.focusBooking = null; s.selected.clear(); load();
    }
    on('change', changeContext);
    // Safari may defer date change until blur; never leave the old plan under a new date.
    on('input', e => { if (e.target.dataset.control === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) changeContext(e); });
    const trackForm = e => {
      const tableForm = e.target.closest('[data-table-form]');
      if (tableForm) { captureEditor(tableForm); status(s.editDirty ? 'Proprietes modifiees. Enregistrer le plan les appliquera aussi.' : s.dirty ? 'Modifications non enregistrees.' : 'Proprietes inchangees.'); }
      const newForm = e.target.closest('[data-new-table-form]');
      if (newForm && s.adding) Object.assign(s.adding, Object.fromEntries(new FormData(newForm)));
    };
    on('input', trackForm); on('change', trackForm);
    on('submit', e => {
      if (e.target.matches('[data-new-table-form]')) {
        e.preventDefault(); if (s.busy) return;
        const f = new FormData(e.target), name = f.get('name').trim(), seats = Number(f.get('seats')), zone = f.get('zone');
        if (!name || s.data.layout.tables.some(t => t.name.toLowerCase() === name.toLowerCase())) { status('Choisissez un numero ou nom distinct.', true); return; }
        if (!Number.isInteger(seats) || seats < 1 || seats > 20 || !s.data.layout.zones.some(z => z.id === zone) || s.data.layout.tables.length >= 80) { status('Renseignez la zone et de 1 a 20 places (80 tables maximum).', true); return; }
        addTable({ id: crypto.randomUUID(), name, seats, zone, shape: 'rectangle', width: 130, height: 100, x: 40, y: 40 }); return;
      }
      if (!e.target.matches('[data-table-form]')) return;
      e.preventDefault();
      if (s.busy) return;
      captureEditor(e.target);
      if (applyEditor()) render();
    });
    on('click', async e => {
      if (s.busy || s.confirming) return;
      const el = e.target.closest('button'); if (!el) return;
      if ((el.dataset.catalog || el.dataset.table || el.dataset.zone || el.dataset.move || el.dataset.place || el.dataset.open || ['add', 'duplicate', 'clear'].includes(el.dataset.action)) && !applyEditor()) return;
      if (el.dataset.catalog) { if (s.adding && !await discard()) return; s.adding = { name: el.dataset.catalog }; render(); root.querySelector('[data-new-table-form]')?.scrollIntoView({ block: 'nearest' }); return; }
      if (s.adding && (el.dataset.zone || el.dataset.table || el.dataset.action === 'clear' || el.dataset.action === 'duplicate' || el.dataset.place)) { status('Terminez ou annulez l ajout de table avant de continuer.', true); return; }
      if (el.dataset.zone) { s.zone = el.dataset.zone; s.selected.clear(); render(); return; }
      if (el.dataset.table) {
        if (s.suppressClick) { s.suppressClick = false; return; }
        const id = el.dataset.table;
        if (s.selected.has(id)) s.selected.delete(id); else s.selected.add(id);
        render(); return;
      }
      if (el.dataset.open) { options.onOpenReservation?.(el.dataset.open); return; }
      if (el.dataset.unplace) { s.data.assignments = s.data.assignments.filter(a => a.reservationId !== el.dataset.unplace); mark(); render(); return; }
      if (el.dataset.place) {
        const b = booking(el.dataset.place), tables = selectedTables();
        if (!b || !tables.length) return;
        const feedback = placementFeedback(b, tables);
        if (feedback.error) { status(feedback.message, true); return; }
        s.data.assignments = s.data.assignments.filter(a => a.reservationId !== b.id);
        s.data.assignments.push({ reservationId: b.id, tableIds: tables.map(t => t.id), fingerprint: b.fingerprint });
        s.selected.clear();
        s.focusBooking = orderedBookings(s.data.bookings, s.order).find(b => !s.data.assignments.some(a => a.reservationId === b.id))?.id || null;
        mark(); status(`${b.name} : tables ${tables.map(t => t.name).join(' + ')} attribuees dans le brouillon. Choisissez les tables du prochain groupe, puis enregistrez le plan.`);
        render(); return;
      }
      if (el.dataset.move) { const [x, y] = { left: [-10, 0], right: [10, 0], up: [0, -10], down: [0, 10] }[el.dataset.move]; move(x, y); return; }
      switch (el.dataset.action) {
        case 'save': await save(); break;
        case 'save-template': await saveAsTemplate(); break;
        case 'reload': if (await discard()) await load(); break;
        case 'base':
          if (!await confirmPlan(s, 'Utiliser le plan type ?', 'La disposition et les placements affiches seront remplaces. Les reservations sont conservees et seront a replacer. Enregistrez ensuite le plan pour appliquer ce changement au service.', 'Utiliser le plan type')) break;
          invalidateReads(); s.busy = true; render();
          try { const base = await request('/api/floor-plans/template'); s.data.layout = clone(base.layout); s.data.assignments = []; acceptTemplateVersion(base); s.adding = null; s.edit = null; s.editDirty = false; s.selected.clear(); mark(); } catch (error) { status(error.message, true); }
          finally { s.busy = false; render(); } break;
        case 'clear': s.selected.clear(); render(); break;
        case 'cancel-add': s.adding = null; render(); break;
        case 'add': case 'duplicate': {
          if (s.data.layout.tables.length >= 80) { status('80 tables maximum.', true); break; }
          if (el.dataset.action === 'add') { if (s.adding && !await discard()) break; s.adding = { name: nextName() }; render(); root.querySelector('[data-new-table-form]')?.scrollIntoView({ block: 'nearest' }); break; }
          const source = el.dataset.action === 'duplicate' ? selectedTables()[0] : null;
          const t = { ...(source || { seats: 2, width: 130, height: 100, shape: 'rectangle', x: 80, y: 80, zone: s.zone }), id: crypto.randomUUID(), name: nextName() };
          addTable(t); break;
        }
        case 'remove': {
          if (!s.selected.size) break;
          const names = selectedTables().map(t => t.name).join(', ');
          const displaced = s.data.assignments.filter(a => a.tableIds.some(id => s.selected.has(id))).length;
          if (!await confirmPlan(s, `Supprimer ${s.selected.size > 1 ? 'les tables' : 'la table'} ${names} ?`,
            `Ces tables seront retirees de cette disposition uniquement.${displaced ? ` ${displaced} reservation(s) seront a replacer : leur placement sera retire en entier, meme si certaines tables du groupe restent sur le plan.` : ''} Aucune reservation ni aucun paiement ne sera supprime. Enregistrez ensuite le plan pour conserver ce changement.`, 'Supprimer du plan', true)) break;
          s.data.assignments = s.data.assignments.filter(a => !a.tableIds.some(id => s.selected.has(id)));
          s.data.layout.tables = s.data.layout.tables.filter(t => !s.selected.has(t.id)); s.edit = null; s.editDirty = false; s.selected.clear(); mark();
          status(`Table(s) retiree(s) du brouillon. Enregistrez le plan pour conserver ce changement.${displaced ? ` ${displaced} reservation(s) a replacer, aucune reservation supprimee.` : ''}`);
          render(); root.querySelector('[data-action="add"]')?.focus(); break;
        }
      }
    });
    on('keydown', e => {
      const table = e.target.closest('[data-table]');
      if (!table || s.busy || s.adding || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      if (!applyEditor()) { e.preventDefault(); return; }
      e.preventDefault(); s.selected = new Set([table.dataset.table]);
      const [x, y] = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key]; move(x, y);
      root.querySelector(`[data-table="${table.dataset.table}"]`)?.focus();
    });
    // Keep the dragged DOM node alive until pointerup: pointer capture is lost on rerender.
    on('pointerdown', e => {
      const el = e.target.closest('[data-table]'); if (!el || s.busy || s.adding || e.button !== 0) return;
      if (!applyEditor()) { e.preventDefault(); return; }
      s.dragging = true;
      s.suppressClick = false;
      const t = s.data.layout.tables.find(t => t.id === el.dataset.table), bounds = root.querySelector('.fp-board').getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }; let dragged = false;
      el.setPointerCapture(e.pointerId);
      const change = ev => {
        if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 6 && !dragged) return;
        dragged = true;
        t.x = Math.round(Math.max(0, Math.min(1000 - t.width, start.tx + (ev.clientX - start.x) * 1000 / bounds.width)));
        t.y = Math.round(Math.max(0, Math.min(650 - t.height, start.ty + (ev.clientY - start.y) * 650 / bounds.height)));
        el.style.left = `${t.x / 10}%`; el.style.top = `${t.y / 6.5}%`;
      };
      const finish = () => {
        el.removeEventListener('pointermove', change); el.removeEventListener('pointerup', finish); el.removeEventListener('pointercancel', finish);
        s.dragging = false;
        if (dragged) { s.selected = new Set([t.id]); s.suppressClick = true; mark(); setTimeout(() => { if (!s.disposed) render(); }, 0); }
        if (s.pendingRefresh) {
          const pending = s.pendingRefresh, generation = s.generation;
          s.pendingRefresh = null;
          setTimeout(() => { if (!s.disposed && s.generation === generation) receiveRefresh(pending); }, 0);
        }
      };
      el.addEventListener('pointermove', change); el.addEventListener('pointerup', finish); el.addEventListener('pointercancel', finish);
    });
    s.timer = setInterval(() => {
      if (s.disposed || !root.isConnected) { clearInterval(s.timer); return; }
      if (root.getClientRects().length) refresh();
    }, 30000);
    load();
  }
  window.addEventListener('beforeunload', e => {
    for (const root of document.querySelectorAll('[data-floor-plan]')) if (instances.get(root)?.dirty || instances.get(root)?.editDirty || instances.get(root)?.adding) { e.preventDefault(); e.returnValue = ''; break; }
  });
  window.FloorPlan = { mount, canLeave, tableLabel, annotate, watch, dateOf, serviceOf, orderedBookings, creationLabel };
})();
