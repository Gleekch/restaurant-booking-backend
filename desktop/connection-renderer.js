const form = document.getElementById('connection-form');
const password = document.getElementById('connection-password');
const message = document.getElementById('connection-message');
const submit = document.getElementById('connection-submit');
const back = document.getElementById('connection-back');
const forget = document.getElementById('connection-forget');

async function refresh() {
  const config = await window.api.getConfig();
  document.getElementById('connection-server').textContent = config.backendUrl;
  back.hidden = !config.hasCredentials || config.requiresSetup;
  forget.hidden = !config.hasCredentials;
  message.textContent = config.setupMessage || config.storageWarning || '';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  back.disabled = true;
  forget.disabled = true;
  message.textContent = 'Verification de la connexion...';
  try {
    const result = await window.api.saveConnection({
      username: document.getElementById('connection-user').value, password: password.value
    });
    password.value = '';
    if (result.success) await window.api.openReservations();
    else message.textContent = result.message;
  } catch {
    message.textContent = 'Connexion impossible. Veuillez reessayer.';
  } finally {
    password.value = '';
    submit.disabled = false;
    back.disabled = false;
    forget.disabled = false;
  }
});
back.addEventListener('click', () => window.api.openReservations());
forget.addEventListener('click', async () => {
  if (!confirm('Oublier les identifiants sur ce poste ? Les reservations resteront sur le serveur.')) return;
  const result = await window.api.forgetConnection();
  await refresh();
  message.textContent = result.success ? 'Connexion oubliee sur ce poste.' : result.message;
});
refresh().catch(() => { message.textContent = 'Configuration indisponible. Relancez l application.'; });
