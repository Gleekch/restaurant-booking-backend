const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../desktop/renderer.js'), 'utf8');
const fn = source.slice(source.indexOf('function refreshStaffTimeOptions'), source.indexOf('\nfunction editReservation'));
function options(date, retained) {
  const select = { value: '', options: [], replaceChildren(option) { this.options = [option]; }, add(option) { this.options.push(option); } };
  const context = { document: { getElementById: () => select }, Option: function (text, value) { return { text, value }; } };
  vm.runInNewContext(fn + `\nrefreshStaffTimeOptions(${JSON.stringify(date)}, ${JSON.stringify(retained || '')});`, context);
  return select.options.map(option => option.value);
}
test.each(['2026-10-05', '2026-10-06'])('staff dropdown keeps closed date empty: %s', date => expect(options(date)).toEqual(['']));
test('Wednesday stops at 13:45 and 21:30 but includes all tapas slots', () => {
  const times = options('2026-09-30');
  expect(times).toEqual(expect.arrayContaining(['13:30', '13:45', '18:00', '18:15', '21:15', '21:30']));
  expect(times).not.toContain('14:00'); expect(times).not.toContain('21:45');
});
test('Sunday contains lunch only, through 14:00', () => {
  const times = options('2026-10-04'); expect(times).toContain('14:00'); expect(times).not.toContain('18:00');
});
test('an old closed-date time can be retained without opening new bookings', () => {
  expect(options('2026-10-05', '12:30')).toEqual(['', '12:30']);
  expect(options('2026-10-05')).toEqual(['']);
});
