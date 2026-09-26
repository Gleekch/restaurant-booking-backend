const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../public/admin/app.js'), 'utf8');

function fixture() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { style: {}, value: '', hidden: true,
      addEventListener: jest.fn(), querySelector: selector => node(id + selector) });
    return nodes.get(id);
  }
  Object.defineProperty(node('date'), 'valueAsDate', {
    set() { throw new Error('Date setter unsupported in this browser'); }
  });
  const sandbox = vm.createContext({
    document: { getElementById: node, querySelectorAll: () => [], addEventListener: jest.fn() },
    window: { location: { origin: 'https://unit.invalid' }, __API_KEY: '' }, navigator: {},
    fetch: jest.fn().mockResolvedValue({ status: 401, ok: false }),
    console: { error: jest.fn() }, Intl, Date
  });
  vm.runInContext(source, sandbox);
  return { sandbox, node };
}

test('tablet date initialization does not depend on valueAsDate support', () => {
  const { sandbox, node } = fixture();
  expect(() => vm.runInContext('initNewReservationForm()', sandbox)).not.toThrow();
  expect(node('date').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(node('new-reservation-form').addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
});

test('default reservation date follows Reunion midnight, not UTC midnight', () => {
  const { sandbox } = fixture();
  expect(vm.runInContext("getRestaurantDateISO(new Date('2026-09-26T19:59:00Z'))", sandbox)).toBe('2026-09-26');
  expect(vm.runInContext("getRestaurantDateISO(new Date('2026-09-26T20:01:00Z'))", sandbox)).toBe('2026-09-27');
});

test('tablet fetch retains browser auth and avoids caching private reservations', async () => {
  const { sandbox } = fixture();
  await vm.runInContext("apiFetch('/api/reservations')", sandbox);
  expect(sandbox.fetch).toHaveBeenCalledWith('/api/reservations', {
    credentials: 'same-origin', cache: 'no-store', headers: {}
  });
});

test('expired login is distinguished from an outage and preserves loaded data', async () => {
  const { sandbox, node } = fixture();
  vm.runInContext("reservations = [{ _id: 'synthetic-cached-only' }]", sandbox);
  await vm.runInContext('loadReservations()', sandbox);
  expect(node('connection-status.status-text').textContent).toBe('Connexion requise');
  expect(node('reconnect-button').hidden).toBe(false);
  expect(node('loading').style.display).toBe('none');
  expect(vm.runInContext('reservations.length', sandbox)).toBe(1);
  vm.runInContext('updateConnectionStatus(true)', sandbox);
  expect(node('connection-status.status-text').textContent).toBe('Connecté');
  expect(node('reconnect-button').hidden).toBe(true);
});
