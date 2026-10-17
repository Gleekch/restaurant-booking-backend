const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../desktop/staff-cancellations.js'), 'utf8');
const now = new Date('2026-10-17T08:00:00Z').getTime();
const id = '333333333333333333333333';
const row = overrides => ({ _id: id, customerName: '<img src=x onerror=alert(1)>', date: '2026-10-18',
  time: '12:30', numberOfPeople: 4, status: 'confirmed', cancellationToken: 'secret-not-to-store', ...overrides });
const cancelled = overrides => row({ status: 'cancelled', cancelledAt: new Date(now).toISOString(), cancellationInitiator: 'client', ...overrides });
function setup() {
  const data = new Map(); const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const window = {}; vm.runInNewContext(source, { window, Date, Map, Number });
  const onNew = jest.fn(), onChange = jest.fn();
  const create = () => window.StaffCancellationAlerts.createTracker({ storage, onNew, onChange, now: () => now });
  return { create, tracker: create(), data, onNew, onChange };
}
test('client cancellation stays visible until explicitly acknowledged', () => {
  const f = setup(); f.tracker.observe([row()]); f.tracker.observe([cancelled()]);
  expect(f.tracker.list()).toHaveLength(1); expect(f.onNew).toHaveBeenCalledTimes(1);
  f.tracker.observe([cancelled()]); f.tracker.event(cancelled());
  expect(f.onNew).toHaveBeenCalledTimes(1);
  f.tracker.acknowledge(f.tracker.list()[0].key);
  expect(f.tracker.list()).toHaveLength(0);
  f.tracker.observe([cancelled()]); expect(f.tracker.list()).toHaveLength(0);
});
test('unread alert survives reload without repeating native notification', () => {
  const f = setup(); f.tracker.observe([cancelled()]);
  const second = f.create(); second.observe([cancelled()]);
  expect(second.list()).toHaveLength(1); expect(f.onNew).toHaveBeenCalledTimes(1);
  second.acknowledge(second.list()[0].key);
  const third = f.create(); third.observe([cancelled()]); expect(third.list()).toHaveLength(0);
});
test('first successful snapshot catches a client cancellation missed during disconnection', () => {
  const f = setup(); f.tracker.observe([cancelled()]); expect(f.tracker.list()[0]).toMatchObject({ reservationId: id, clientInitiated: true, people: 4 });
});
test('historical cancellations without a traceable timestamp do not create invented alerts', () => {
  const f = setup(); f.tracker.observe([row({ status: 'cancelled' })]); expect(f.tracker.list()).toHaveLength(0);
});
test('old backend transition is detected but never attributed to the client without evidence', () => {
  const f = setup(); f.tracker.observe([row()]); f.tracker.observe([row({ status: 'cancelled' })]);
  expect(f.tracker.list()).toHaveLength(1); expect(f.tracker.list()[0].clientInitiated).toBe(false);
});
test('restaurant cancellation is not incorrectly labelled as a client cancellation', () => {
  const f = setup(); f.tracker.observe([row()]); f.tracker.event(cancelled({ cancellationInitiator: 'restaurant' })); expect(f.tracker.list()).toHaveLength(0);
});
test('a missing booking, failed response or active update is never an invented cancellation', () => {
  const f = setup(); f.tracker.observe([row()]); f.tracker.observe([]); f.tracker.observe(null); f.tracker.event(row()); expect(f.tracker.list()).toHaveLength(0);
});
test('reactivation then another client cancellation creates a distinct event', () => {
  const f = setup(); f.tracker.observe([cancelled()]); f.tracker.acknowledge(f.tracker.list()[0].key);
  f.tracker.observe([row()]); f.tracker.observe([cancelled({ cancelledAt: new Date(now + 1000).toISOString() })]);
  expect(f.tracker.list()).toHaveLength(1); expect(f.onNew).toHaveBeenCalledTimes(2);
});
test('a reactivated reservation no longer has an actionable cancellation banner', () => {
  const f = setup(); f.tracker.observe([cancelled()]); f.tracker.observe([row()]); expect(f.tracker.list()).toHaveLength(0);
});
test('persistent browser state stores only event identifiers and receipt states, never contact details or tokens', () => {
  const f = setup(); f.tracker.observe([cancelled()]); const saved = [...f.data.values()].join('');
  expect(saved).toContain(id); expect(saved).not.toContain('secret-not-to-store'); expect(saved).not.toContain('onerror'); expect(saved).not.toContain('12:30');
});
test('storage failure does not prevent receiving and acknowledging an alert', () => {
  const window = {}; vm.runInNewContext(source, { window, Date, Map, Number });
  const tracker = window.StaffCancellationAlerts.createTracker({ now: () => now,
    storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  tracker.observe([cancelled()]); expect(tracker.list()).toHaveLength(1); tracker.acknowledge(tracker.list()[0].key); expect(tracker.list()).toHaveLength(0);
});
test('expired, future-dated and malformed events are ignored', () => {
  const f = setup();
  f.tracker.observe([cancelled({ cancelledAt: new Date(now - 31 * 86400000).toISOString() })]);
  f.tracker.event(cancelled({ cancelledAt: new Date(now + 3600000).toISOString() }));
  f.tracker.event(cancelled({ _id: '<script>' })); expect(f.tracker.list()).toHaveLength(0);
});
test('rendering uses text nodes, not interpolated client HTML, and offers a persistent accessible queue', () => {
  expect(source).not.toMatch(/innerHTML|insertAdjacentHTML/); expect(source).toContain('node.textContent = value');
  expect(source).toContain("live.setAttribute('aria-live', 'polite')"); expect(source).toContain("text('button', 'Vu')");
});
test('desktop and web load the same cancellation module before their application script', () => {
  for (const file of ['../../desktop/index.html', '../public/admin/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8'); expect(html).toContain('src="staff-cancellations.js"');
  }
});
