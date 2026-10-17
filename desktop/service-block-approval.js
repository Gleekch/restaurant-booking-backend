(function () {
  'use strict';
  let current;
  function request(date, service) {
    if (current) return Promise.resolve(null);
    return new Promise(resolve => {
      const trigger = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'service-block-approval';
      dialog.setAttribute('aria-labelledby', 'service-block-title');
      const form = document.createElement('form');
      form.method = 'dialog';
      const title = document.createElement('h2');
      title.id = 'service-block-title'; title.textContent = 'Marquer le service complet';
      const summary = document.createElement('p');
      const displayDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('/') : 'Date a verifier';
      summary.textContent = `${displayDate} - ${service === 'midi' ? 'Midi' : service === 'soir' ? 'Soir' : 'Toute la journee'}. Cette action ferme les reservations en ligne pour ce service, sans annuler les reservations existantes.`;
      const label = document.createElement('label');
      label.htmlFor = 'service-block-password'; label.textContent = 'Mot de passe du responsable';
      const password = document.createElement('input');
      password.id = 'service-block-password'; password.type = 'password'; password.required = true;
      password.maxLength = 1024; password.autocomplete = 'off';
      const hint = document.createElement('p');
      hint.className = 'service-block-hint'; hint.textContent = 'Validation obligatoire a chaque fermeture. Le mot de passe ne sera pas memorise par cette application.';
      const actions = document.createElement('div'); actions.className = 'service-block-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Annuler';
      const confirm = document.createElement('button'); confirm.type = 'submit'; confirm.textContent = 'Valider et marquer complet';
      function finish(value) {
        if (current !== dialog) return;
        password.value = ''; current = null; dialog.close(); dialog.remove(); trigger?.focus(); resolve(value);
      }
      cancel.addEventListener('click', () => finish(null));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      dialog.addEventListener('close', () => { if (current === dialog) finish(null); });
      form.addEventListener('submit', event => { event.preventDefault(); if (password.value) finish(password.value); });
      actions.append(cancel, confirm); form.append(title, summary, label, password, hint, actions); dialog.append(form);
      document.body.append(dialog); current = dialog;
      try { dialog.showModal(); password.focus(); } catch (_) { finish(null); }
    });
  }
  window.ServiceBlockApproval = { request };
}());
