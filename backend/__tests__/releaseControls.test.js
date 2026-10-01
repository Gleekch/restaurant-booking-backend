const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function fixture() {
  const window = { alert: jest.fn() };
  const context = vm.createContext({ window, document: { addEventListener: jest.fn() },
    apiFetch: jest.fn(() => { throw new Error('Unexpected financial request'); }),
    api: { apiRequest: jest.fn(() => { throw new Error('Unexpected financial IPC'); }) } });
  vm.runInContext(read('desktop/release-controls.js'), context);
  return context;
}

function exposeFunction(context, file, name) {
  const source = read(file);
  const start = source.indexOf('async function ' + name + '(');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}', start) + 2;
  vm.runInContext(source.slice(start, end), context);
}

test('payment state is read-only and financial workflows cannot self-activate', () => {
  const { window } = fixture();
  expect(window.ServiceRelease.financeEnabled).toBe(false);
  expect(Object.isFrozen(window.ServiceRelease)).toBe(true);
  const panel = window.ServiceRelease.financePanel();
  expect(panel).toContain('Arrhes non encaiss\u00e9es');
  expect(panel).toContain('role="status"');
  expect(panel).not.toContain('<button');
  expect(panel).not.toContain('Demander');
  expect(panel).not.toContain('D\u00e9duire en caisse');
  expect(panel).not.toContain('Rembourser');
  expect(panel).not.toMatch(/onclick|href=/);
  const html = read('desktop/index.html');
  expect(html).not.toContain('deposit-request-btn');
  expect(html.match(/<button id="completed-btn"[^>]+>/)[0]).toContain('disabled');
  expect(read('desktop/renderer.js')).toContain('financePanel(reservation)');
  expect(read('backend/public/admin/app.js')).toContain('financePanel(r)');
});

test.each([
  ['none', 'Arrhes non encaiss\u00e9es'],
  ['awaiting', 'Arrhes non encaiss\u00e9es'],
  ['failed', 'Le paiement n\u2019a pas abouti'],
  ['paid', 'Arrhes encaiss\u00e9es'],
  ['deducted', 'D\u00e9j\u00e0 d\u00e9duites'],
  ['refunded', 'Arrhes rembours\u00e9es'],
  ['refund_pending', 'Le remboursement n\u2019est pas encore confirm\u00e9'],
  ['refund_failed', 'Remboursement \u00e9chou\u00e9'],
  ['refund_review', 'Remboursement \u00e0 v\u00e9rifier'],
  ['unknown', 'Statut des arrhes \u00e0 v\u00e9rifier']
])('payment state %s remains accurate, independently of booking status', (status, expected) => {
  const { window } = fixture();
  for (const bookingStatus of ['pending', 'confirmed', 'cancelled', 'completed']) {
    const panel = window.ServiceRelease.financePanel({ status: bookingStatus,
      deposit: { required: false, status, amountCents: 6000 } });
    expect(panel).toContain(expected);
    expect(panel.includes('<strong>60')).toBe(['paid', 'deducted'].includes(status));
    expect(panel).not.toMatch(/<button|onclick|href=/);
  }
});

test('confirmation, exception or a stale paidAt cannot masquerade as a collected deposit', () => {
  const { window } = fixture();
  const panel = window.ServiceRelease.financePanel({ status: 'confirmed', depositException: true,
    deposit: { status: 'awaiting', paidAt: '2026-09-30', amountCents: 6000 } });
  expect(panel).toContain('Arrhes non encaiss\u00e9es');
  expect(panel).toContain('Exception sans arrhes');
  expect(panel).not.toContain('<strong>');
});

test('invalid payment data is not interpolated as HTML or a fictitious amount', () => {
  const { window } = fixture();
  const render = deposit => window.ServiceRelease.financePanel({ deposit });
  for (const amountCents of [NaN, Infinity, -100, null, '6000', '<img src=x onerror=alert(1)>']) {
    expect(render({ status: 'paid', amountCents })).not.toMatch(/<strong>|<img|NaN|Infinity/);
  }
  for (const status of ['__proto__', 'constructor', '<img src=x onerror=alert(1)>']) {
    expect(render({ status })).toContain('Statut des arrhes');
    expect(render({ status })).not.toContain('<img');
  }
  expect(render({ status: 'paid', amountCents: 6000, currency: '<img>' })).not.toContain('<img');
});

test('background refresh changes only the open reservation payment panel', () => {
  const { window } = fixture();
  const panel = { dataset: { reservationId: 'fixture' }, outerHTML: 'OLD STATUS' };
  const root = { querySelector: jest.fn(() => panel), innerHTML: 'DO NOT REPLACE THE FORM' };
  window.ServiceRelease.refreshFinancePanel(root, [{ _id: 'another', deposit: { status: 'paid' } }]);
  expect(panel.outerHTML).toBe('OLD STATUS');
  window.ServiceRelease.refreshFinancePanel(root, [{ _id: 'fixture', deposit: { status: 'paid', amountCents: 6000 } }]);
  expect(panel.outerHTML).toContain('Arrhes encaiss\u00e9es');
  expect(root.innerHTML).toBe('DO NOT REPLACE THE FORM');
  expect(() => window.ServiceRelease.refreshFinancePanel({ querySelector: () => null }, [])).not.toThrow();
});

test.each(['markCompleted', 'requestDeposit', 'refundDepositReservation', 'markDepositDeducted'])(
  'tablet handler %s does not call the API even if invoked directly', async name => {
    const context = fixture();
    exposeFunction(context, 'backend/public/admin/app.js', name);
    await context[name]('000000000000000000000001');
    expect(context.apiFetch).not.toHaveBeenCalled();
    expect(context.window.alert).toHaveBeenCalledTimes(1);
  }
);

test('desktop guards block financial and old completion actions', async () => {
  const context = fixture();
  exposeFunction(context, 'desktop/renderer.js', 'requestDepositDesktop');
  exposeFunction(context, 'desktop/renderer.js', 'markReservationOutcome');
  await context.requestDepositDesktop('000000000000000000000001');
  await context.markReservationOutcome('000000000000000000000001', 'complete');
  expect(context.api.apiRequest).not.toHaveBeenCalled();
  expect(context.window.alert).toHaveBeenCalledTimes(2);
});
