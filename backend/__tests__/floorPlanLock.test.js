const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../desktop/floor-plan.js'), 'utf8');

async function fixture() {
  const handlers = {}, nodes = new Map();
  const data = { revision: 1, inherited: false, layout: { zones: [{ id: 'terrace', name: 'Terrasse' }],
    tables: [{ id: 't1', name: '1', seats: 4, zone: 'terrace', shape: 'rectangle', x: 50, y: 60, width: 130, height: 100 }] },
    assignments: [], bookings: [{ id: 'r1', name: 'CLIENT FICTIF', time: '12:00', people: 4, fingerprint: 'fixture' }] };
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { dataset: {}, focus: jest.fn(), scrollLeft: 0, scrollTop: 0 });
    return nodes.get(selector);
  };
  const root = { innerHTML: '', contains: () => false, querySelector: node,
    addEventListener: (name, fn) => { (handlers[name] ||= []).push(fn); } };
  const request = jest.fn(async (_url, opts) => ({ success: true, data: opts ? { ...data, ...opts.body, revision: 2 } : data }));
  const window = { addEventListener: jest.fn() };
  vm.runInNewContext(source, { window, document: { activeElement: null }, AbortController,
    setInterval: jest.fn(), clearInterval: jest.fn(), setTimeout, Intl });
  window.FloorPlan.mount(root, { request, date: '2026-10-02' });
  await new Promise(resolve => setImmediate(resolve));
  const emit = async (name, dataset, extra = {}) => {
    const element = { dataset, disabled: false, ...extra };
    const event = { target: { closest: () => element }, ...extra };
    for (const fn of handlers[name] || []) await fn(event);
  };
  const click = dataset => emit('click', dataset);
  return { root, data, request, click, emit, node, writes: () => request.mock.calls.filter(([, opts]) => opts) };
}

test('each floor plan opens locked, without an API write or dirty state', async () => {
  const f = await fixture();
  expect(f.root.innerHTML).toContain('data-layout-locked="true"');
  expect(f.root.innerHTML).not.toContain('data-action="add"');
  expect(f.root.innerHTML).toMatch(/data-action="base" disabled/);
  expect(f.root.innerHTML).toMatch(/data-action="save" disabled/);
  expect(f.writes()).toHaveLength(0);
  await f.click({ action: 'toggle-lock' });
  expect(f.root.innerHTML).toContain('data-layout-locked="false"');
  await f.click({ action: 'toggle-lock' });
  expect(f.root.innerHTML).toContain('data-layout-locked="true"');
  expect(f.writes()).toHaveLength(0);
});

test.each(['add', 'duplicate', 'remove', 'base', 'save-template'])('locked layout rejects %s even through a stale control', async action => {
  const f = await fixture(), before = JSON.stringify(f.data);
  await f.click({ table: 't1' });
  await f.click({ action });
  expect(JSON.stringify(f.data)).toBe(before);
  expect(f.writes()).toHaveLength(0);
});

test('locked tables remain selectable and assignable; saving keeps geometry intact', async () => {
  const f = await fixture(), layout = JSON.stringify(f.data.layout);
  await f.click({ table: 't1' });
  expect(f.node('.fp-board').innerHTML).toContain('aria-pressed="true"');
  await f.click({ place: 'r1' });
  await f.click({ action: 'save' });
  expect(f.writes()).toHaveLength(1);
  const payload = f.writes()[0][1].body;
  expect(JSON.stringify(payload.layout)).toBe(layout);
  expect(payload.assignments[0].tableIds).toEqual(['t1']);
  expect(f.root.innerHTML).toContain('data-layout-locked="true"');
});

test('locked layout ignores drag, move controls and arrows but unlocked arrows still work', async () => {
  const f = await fixture(), originalX = f.data.layout.tables[0].x;
  const capture = jest.fn(), preventDefault = jest.fn();
  await f.click({ table: 't1' });
  await f.emit('pointerdown', { table: 't1' }, { button: 0, setPointerCapture: capture });
  await f.emit('keydown', { table: 't1' }, { key: 'ArrowRight', preventDefault });
  await f.click({ move: 'right' });
  await f.click({ catalog: '2' });
  expect(capture).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(f.data.layout.tables[0].x).toBe(originalX);
  await f.click({ action: 'toggle-lock' });
  await f.emit('keydown', { table: 't1' }, { key: 'ArrowRight', preventDefault });
  expect(f.data.layout.tables[0].x).toBe(originalX + 10);
  await f.click({ action: 'toggle-lock' });
  await f.emit('keydown', { table: 't1' }, { key: 'ArrowRight', preventDefault });
  expect(f.data.layout.tables[0].x).toBe(originalX + 10);
  expect(f.writes()).toHaveLength(0);
});

test('selection rerender preserves the board scroll position on a narrow screen', async () => {
  const f = await fixture();
  f.node('.fp-board-wrap').scrollLeft = 123;
  await f.click({ table: 't1' });
  expect(f.node('.fp-board-wrap').scrollLeft).toBe(123);
});
