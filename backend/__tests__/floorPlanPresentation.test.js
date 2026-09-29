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

test('cards and details display the service booking priority beside assigned tables', async () => {
  const { api, nodes, root } = fixture();
  const result = response('20');
  result.data.bookings = [{ id: 'r1', bookingOrder: 2 }];
  await api.annotate(root, [row()], async () => result);
  expect(nodes[0].textContent).toBe('Tables : 20 · Ordre de reservation : n° 2');
});

test('unplaced bookings also show priority without inventing an assigned table', async () => {
  const { api, nodes, root } = fixture();
  const result = response();
  result.data.assignments = [];
  result.data.bookings = [{ id: 'r1', bookingOrder: 1 }];
  await api.annotate(root, [row()], async () => result);
  expect(nodes[0].textContent).toBe('Table a attribuer · Ordre de reservation : n° 1');
});

test('list defaults to creation priority and can switch to meal time without changing ranks', () => {
  const { api } = fixture();
  const rows = [{ id: 'late', time: '12:00', bookingOrder: 2 }, { id: 'early', time: '13:30', bookingOrder: 1 }, { id: 'legacy', time: '12:15', bookingOrder: null }];
  const before = JSON.stringify(rows);
  expect(api.orderedBookings(rows).map(b => b.id)).toEqual(['early', 'late', 'legacy']);
  expect(api.orderedBookings(rows, 'time').map(b => b.id)).toEqual(['late', 'legacy', 'early']);
  expect(JSON.stringify(rows)).toBe(before);
});

test('ties and unknown dates have stable ordering independent of API array order', () => {
  const { api } = fixture();
  const rows = [{ id: 'r3', bookingOrder: null }, { id: 'r2', bookingOrder: 1 }, { id: 'r1', bookingOrder: 1 }];
  expect(api.orderedBookings(rows).map(b => b.id)).toEqual(['r1', 'r2', 'r3']);
});

test('creation dates use Reunion time rather than the device timezone', () => {
  const { api } = fixture();
  expect(api.creationLabel({ createdAt: '2026-09-28T22:30:00Z' })).toMatch(/29\/09\/2026.*02:30.*Reunion/);
  expect(api.creationLabel({ createdAt: null })).toMatch(/inconnue/);
  expect(api.creationLabel({ createdAt: 'invalid' })).toMatch(/inconnue/);
});
