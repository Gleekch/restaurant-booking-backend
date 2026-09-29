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

test('unavailable controls are disabled, explained and cannot self-activate', () => {
  const { window } = fixture();
  expect(window.ServiceRelease.financeEnabled).toBe(false);
  expect(Object.isFrozen(window.ServiceRelease)).toBe(true);
  const panel = window.ServiceRelease.financePanel();
  expect(panel.match(/ disabled /g)).toHaveLength(2);
  expect(panel).not.toContain('Rembourser');
  expect(panel).toContain('release-finance-note');
  expect(panel).not.toMatch(/onclick|href=/);
  const html = read('desktop/index.html');
  for (const id of ['deposit-request-btn', 'completed-btn']) {
    expect(html.match(new RegExp('<button id="' + id + '"[^>]+>'))[0]).toContain('disabled');
  }
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
