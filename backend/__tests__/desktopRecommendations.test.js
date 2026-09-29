const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../desktop/renderer.js'), 'utf8');
const fn = source.slice(source.indexOf('async function updateRecommendedHours('), source.indexOf('\nfunction getSelectedDateValue'));
function setup() {
  const nodes = Object.fromEntries(['midi', 'soir'].map(s => [`wave-recommended-${s}`, { isConnected: true, textContent: '' }]));
  const api = { getAvailability: jest.fn() };
  const context = vm.createContext({ api, document: { getElementById: id => nodes[id] } });
  vm.runInContext(fn, context);
  return { nodes, api, update: context.updateRecommendedHours };
}
const response = () => ({ success: true, data: { meta: { recommendationsEnabled: true },
  midi: [{ time: '12:45', available: true, status: 'recommended' }],
  soir: [{ time: '18:00', available: true, status: 'recommended' },
    { time: '20:00', available: true, status: 'recommended' },
    { time: '21:00', available: false, status: 'recommended' },
    { time: '22:00', available: true, status: 'recommended' }] } });

test('staff advice clearly separates tapas/dinner, states party size and filters unavailable/late times', async () => {
  const { nodes, api, update } = setup(); api.getAvailability.mockResolvedValue(response());
  await update('2026-10-03');
  expect(api.getAvailability).toHaveBeenCalledWith('2026-10-03', 2);
  expect(nodes['wave-recommended-midi'].textContent).toContain('2 personnes : 12:45');
  expect(nodes['wave-recommended-soir'].textContent).toContain('Tapas 18:00 ; Dîner 20:00');
  expect(nodes['wave-recommended-soir'].textContent).not.toMatch(/21:00|22:00/);
});
test('an old date cannot overwrite a new request or a detached view', async () => {
  const { nodes, api, update } = setup(); let resolveOld;
  api.getAvailability.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const old = update('2026-10-03');
  const latest = response(); latest.data.soir = [{ time: '19:30', available: true, status: 'recommended' }];
  api.getAvailability.mockResolvedValue(latest); await update('2026-10-07');
  resolveOld(response()); await old;
  expect(nodes['wave-recommended-soir'].textContent).toContain('19:30');
  expect(nodes['wave-recommended-soir'].textContent).not.toContain('18:00');
  nodes['wave-recommended-soir'].isConnected = false;
  api.getAvailability.mockResolvedValue(response()); await update('2026-10-08');
  expect(nodes['wave-recommended-soir'].textContent).toBe('');
});
test('disabled recommendations and network failure never retain old advice', async () => {
  const { nodes, api, update } = setup(); api.getAvailability.mockResolvedValue(response());
  await update('2026-10-03');
  api.getAvailability.mockResolvedValue({ success: true, data: { meta: { recommendationsEnabled: false } } });
  await update('2026-10-03'); expect(nodes['wave-recommended-soir'].textContent).toBe('');
  api.getAvailability.mockRejectedValue(new Error('offline'));
  await update('2026-10-03'); expect(nodes['wave-recommended-soir'].textContent).toContain('indisponibles');
});
