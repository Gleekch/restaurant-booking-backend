const fs = require('fs');
const path = require('path');
const desktop = path.join(__dirname, '../../desktop');

test('spiral is the authentic unmodified path, without the wordmark or white disc', () => {
  const original = fs.readFileSync(path.join(desktop, 'assets/logo.svg'), 'utf8');
  const spiral = fs.readFileSync(path.join(desktop, 'assets/brand-spiral.svg'), 'utf8');
  expect(spiral.match(/d="([^"]+)"/)[1]).toBe(original.match(/<path class="cls-1" d="([^"]+)"/)[1]);
  expect(spiral.match(/<path /g)).toHaveLength(1);
  expect(spiral).toContain('fill="#27777e"');
  expect(spiral).not.toMatch(/<circle|<text|<rect|<script|<image/);
});

test('staff surfaces share the spiral and original brand palette without a slogan', () => {
  for (const file of [path.join(desktop, 'index.html'), path.join(__dirname, '../public/admin/index.html')]) {
    const html = fs.readFileSync(file, 'utf8');
    expect(html).toContain('src="assets/brand-spiral.svg"');
    expect(html).not.toContain('brand-caption');
    expect(html).not.toContain('rail-monogram');
  }
  const css = fs.readFileSync(path.join(desktop, 'service-ui.css'), 'utf8');
  for (const token of ['--brand-teal: #27777e', '--brand-ink: #114a55', '--brand-sand: #b79a6c', '--brand-stone: #b4b1ab']) {
    expect(css).toContain(token);
  }
});

test('primary palette retains readable text contrast on its actual surfaces', () => {
  const css = fs.readFileSync(path.join(desktop, 'service-ui.css'), 'utf8');
  const hex = token => css.match(new RegExp('--' + token + ': (#\\w+);'))[1].slice(1);
  const luminance = value => {
    const rgb = value.match(/../g).map(v => parseInt(v, 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const [text, background] of [
    ['text', 'bg'], ['text-secondary', 'bg'], ['text-tertiary', 'bg'],
    ['surface', 'brand-teal'], ['brass', 'surface']
  ]) {
    const values = [luminance(hex(text)), luminance(hex(background))].sort((a, b) => a - b);
    expect((values[1] + 0.05) / (values[0] + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
