const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test.each([
  ['desktop/index.html', 'edit-btn'],
  ['backend/public/admin/index.html', 'edit-reservation-btn']
])('%s keeps a unique edit button in the reservation header, not below guest notes', (file, id) => {
  const html = read(file);
  const details = html.slice(html.indexOf('<div id="reservation-modal"'));
  const header = details.slice(0, details.indexOf('<div class="modal-body"'));
  expect(header).toContain(`id="${id}"`);
  expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1);
  expect(header.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))[0]).not.toMatch(/disabled|data-unavailable/);
});

test('the edit action stays above scrolling notes and hidden admin actions stay hidden', () => {
  const css = read('desktop/service-ui.css');
  expect(css).toMatch(/#reservation-modal \.modal-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/);
  expect(css).toMatch(/\.modal-header-actions \.btn\s*\{[^}]*min-height:\s*44px/);
  expect(css).toMatch(/\.modal-header-actions \[hidden\]\s*\{\s*display:\s*none/);
});
