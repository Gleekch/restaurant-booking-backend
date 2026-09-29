const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../desktop/floor-plan.js'), 'utf8');
const row = (id = 'r1', time = '12:00') => ({ _id: id, date: '2026-09-30', time });
function fixture(rows = [row()]) {
  const window = { addEventListener: jest.fn() };
  vm.runInNewContext(source, { window });
  const nodes = rows.map(r => ({ dataset: { tableReservation: r._id }, isConnected: true, textContent: '' }));
  return { api: window.FloorPlan, nodes, root: { querySelectorAll: () => nodes } };
}
const response = (name = '1', review = false) => ({ success: true, data: { layout: { tables: [{ id: 't1', name }] }, assignments: [{ reservationId: 'r1', tableIds: ['t1'], review }] } });
test('cards and details use one read per service rather than one per reservation', async () => {
  const rows = [row('r1'), row('r2'), row('r3', '19:00')]; const { api, nodes, root } = fixture(rows);
  const request = jest.fn().mockResolvedValue(response());
  await api.annotate(root, rows, request);
  expect(request.mock.calls).toEqual([['/api/floor-plans/service?date=2026-09-30&service=midi'], ['/api/floor-plans/service?date=2026-09-30&service=soir']]);
  expect(nodes[0].textContent).toBe('Tables : 1'); expect(nodes[1].textContent).toBe('Table a attribuer');
});
test('stored table notes never become an authoritative placement', async () => {
  const rows = [{ ...row(), table: '200' }]; const { api, nodes, root } = fixture(rows);
  await api.annotate(root, rows, async () => ({ success: true, data: { layout: { tables: [] }, assignments: [] } }));
  expect(nodes[0].textContent).toBe('Table a attribuer (ancienne note : 200)');
});
test('network failure is not displayed as a free or unassigned table', async () => {
  const { api, nodes, root } = fixture();
  await api.annotate(root, [row()], async () => { throw new Error('offline'); });
  expect(nodes[0].textContent).toBe('Placement indisponible');
});
test('changed or cancelled bookings retain the review warning', async () => {
  const { api, nodes, root } = fixture(); await api.annotate(root, [row()], async () => response('1', true));
  expect(nodes[0].textContent).toBe('Placement a revoir : 1');
});
test('older responses cannot overwrite newer placement information', async () => {
  const { api, nodes, root } = fixture(); let finish;
  const older = api.annotate(root, [row()], () => new Promise(resolve => { finish = resolve; }));
  await api.annotate(root, [row()], async () => response('200'));
  finish(response('1')); await older; expect(nodes[0].textContent).toBe('Tables : 200');
});
test('table labels and reservation IDs cannot inject HTML', async () => {
  const { api, nodes, root } = fixture();
  expect(api.tableLabel({ _id: '"><img src=x>' })).not.toContain('<img');
  await api.annotate(root, [row()], async () => response('<img src=x>'));
  expect(nodes[0].textContent).toBe('Tables : <img src=x>'); expect(nodes[0].innerHTML).toBeUndefined();
});
