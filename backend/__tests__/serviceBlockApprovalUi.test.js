const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'desktop/service-block-approval.js'), 'utf8');
function setup() {
  const nodes = [];
  const trigger = { focus: jest.fn() };
  const document = { activeElement: trigger, body: { append: jest.fn() }, createElement: tag => {
    const node = { tag, value: '', children: [], listeners: {}, setAttribute: jest.fn(), focus: jest.fn(),
      append(...children) { this.children.push(...children); }, addEventListener(name, handler) { this.listeners[name] = handler; },
      showModal: jest.fn(), close: jest.fn(), remove: jest.fn() };
    nodes.push(node); return node;
  } };
  const window = {}; vm.runInNewContext(source, { window, document, Promise });
  return { request: window.ServiceBlockApproval.request, nodes, trigger };
}
test('password is masked and confirmation identifies date, service and consequences', async () => {
  const f = setup(), pending = f.request('2026-10-21', 'soir');
  expect(f.nodes.find(n => n.tag === 'input')).toMatchObject({ type: 'password', required: true, autocomplete: 'off' });
  expect(f.nodes.find(n => n.tag === 'p').textContent).toContain('21/10/2026 - Soir');
  f.nodes.find(n => n.textContent === 'Annuler').listeners.click();
  expect(await pending).toBeNull(); expect(f.trigger.focus).toHaveBeenCalled();
});
test('submit returns approval once and clears the detached input', async () => {
  const f = setup(), pending = f.request('2026-10-21', 'midi');
  const input = f.nodes.find(n => n.tag === 'input'); input.value = 'fictional-password';
  f.nodes.find(n => n.tag === 'form').listeners.submit({ preventDefault() {} });
  expect(await pending).toBe('fictional-password'); expect(input.value).toBe(''); expect(f.nodes[0].remove).toHaveBeenCalled();
});
test('Escape discards approval and prevents concurrent dialogs', async () => {
  const f = setup(), pending = f.request('2026-10-21', 'midi');
  expect(await f.request('2026-10-21', 'soir')).toBeNull();
  f.nodes.find(n => n.tag === 'input').value = 'discard-me';
  f.nodes[0].listeners.cancel({ preventDefault() {} });
  expect(await pending).toBeNull(); expect(f.nodes.find(n => n.tag === 'input').value).toBe('');
});
test('no password storage and both interfaces load approval before their handlers', () => {
  expect(source).not.toMatch(/localStorage|sessionStorage|console\.|innerHTML/);
  for (const [htmlPath, handler] of [['desktop/index.html', 'renderer.js'], ['backend/public/admin/index.html', 'app.js']]) {
    const html = fs.readFileSync(path.join(root, htmlPath), 'utf8');
    expect(html.indexOf('src="service-block-approval.js"')).toBeGreaterThan(0);
    expect(html.indexOf('src="service-block-approval.js"')).toBeLessThan(html.indexOf('src="' + handler + '"'));
  }
});
function adminSetup(approval, response) {
  const app = fs.readFileSync(path.join(root, 'backend/public/admin/app.js'), 'utf8');
  const code = app.slice(app.indexOf('async function toggleBlockService('), app.indexOf('function attachBlockButtons('));
  const context = { window: { ServiceBlockApproval: { request: jest.fn().mockResolvedValue(approval) } },
    isServiceBlocked: () => false, API_URL: 'http://fixture.invalid', apiFetch: jest.fn().mockResolvedValue(response),
    showToast: jest.fn(), loadBlockedServices: jest.fn(), renderTodayView: jest.fn() };
  vm.runInNewContext(code, context); return context;
}
test('cancelling approval performs no API write and no success toast', async () => {
  const f = adminSetup(null); await f.toggleBlockService('2026-10-21', 'midi');
  expect(f.apiFetch).not.toHaveBeenCalled(); expect(f.showToast).not.toHaveBeenCalled();
});
test('server denial never falsely shows service complete', async () => {
  const f = adminSetup('wrong', { ok: false, json: async () => ({ success: false, message: 'Refused' }) });
  await expect(f.toggleBlockService('2026-10-21', 'midi')).rejects.toThrow('Refused');
  expect(f.showToast).not.toHaveBeenCalled(); expect(f.loadBlockedServices).not.toHaveBeenCalled();
});
test('successful approval is sent only in the write body and refreshes after server success', async () => {
  const f = adminSetup('fictional-password', { ok: true, json: async () => ({ success: true }) });
  await f.toggleBlockService('2026-10-21', 'midi');
  expect(JSON.parse(f.apiFetch.mock.calls[0][1].body).approvalPassword).toBe('fictional-password');
  expect(f.showToast).toHaveBeenCalledTimes(1); expect(f.loadBlockedServices).toHaveBeenCalledTimes(1);
});
