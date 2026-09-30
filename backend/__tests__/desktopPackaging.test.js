const { assertDesktopRuntime } = require('../../scripts/after-pack-desktop');

function fixture() {
  const contents = new Map(['main.js', 'preload.js', 'connection-store.js', 'index.html', 'connection.html']
    .map(name => ['desktop/' + name, 'fixture']));
  const add = (name, dependencies = {}, directory = 'node_modules/' + name) => {
    contents.set(directory + '/package.json', JSON.stringify({ name, main: './index.js', dependencies }));
    contents.set(directory + '/index.js', 'fixture');
  };
  add('socket.io-client', { 'engine.io-client': '1', 'socket.io-parser': '1' });
  add('engine.io-client', { 'engine.io-parser': '1' });
  add('engine.io-parser'); add('socket.io-parser');
  return { contents, add, check: () => assertDesktopRuntime([...contents.keys()], name => contents.get(name)) };
}

test('complete desktop archive passes without resolving host node_modules', () => {
  expect(fixture().check()).toBe(4);
});

test('missing engine.io-client fails the build despite socket.io-client being present', () => {
  const f = fixture(); f.contents.delete('node_modules/engine.io-client/package.json');
  expect(f.check).toThrow('engine.io-client requis');
});

test('missing dependency entry file fails the build', () => {
  const f = fixture(); f.contents.delete('node_modules/engine.io-client/index.js');
  expect(f.check).toThrow("engine.io-client : point d'entree absent");
});

test('missing transitive dependency fails the build', () => {
  const f = fixture(); f.contents.delete('node_modules/engine.io-parser/package.json');
  expect(f.check).toThrow('engine.io-parser requis');
});

test('nested dependency locations are supported', () => {
  const f = fixture();
  f.contents.delete('node_modules/engine.io-client/package.json');
  f.contents.delete('node_modules/engine.io-client/index.js');
  f.add('engine.io-client', { 'engine.io-parser': '1' }, 'node_modules/socket.io-client/node_modules/engine.io-client');
  expect(f.check()).toBe(4);
});

test('dependency cycles terminate; optional-only dependencies are not mandatory', () => {
  const f = fixture();
  f.contents.set('node_modules/engine.io-parser/package.json', JSON.stringify({
    main: './index.js', dependencies: { 'socket.io-client': '1', 'optional-native': '1' }, optionalDependencies: { 'optional-native': '1' }
  }));
  expect(f.check()).toBe(4);
});

test('Windows archive separators are normalized', () => {
  const f = fixture();
  expect(assertDesktopRuntime([...f.contents.keys()].map(name => '\\' + name.replace(/\//g, '\\')), name => f.contents.get(name))).toBe(4);
});

test('missing first-party startup code fails the build', () => {
  const f = fixture(); f.contents.delete('desktop/preload.js');
  expect(f.check).toThrow('desktop/preload.js');
});

test('an entry directory must contain an actual index file', () => {
  const f = fixture();
  f.contents.set('node_modules/engine.io-client/package.json', JSON.stringify({ main: './build' }));
  f.contents.set('node_modules/engine.io-client/build', null);
  expect(f.check).toThrow("engine.io-client : point d'entree absent");
  f.contents.set('node_modules/engine.io-client/build/index.js', 'fixture');
  expect(f.check()).toBe(3);
});
