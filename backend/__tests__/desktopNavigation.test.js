const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const desktop = path.join(__dirname, '../../desktop');
const source = fs.readFileSync(path.join(desktop, 'main.js'), 'utf8');
const fn = source.slice(source.indexOf('function showConnection('), source.indexOf('\nfunction showReservations('));

function fixture(url = 'file:///index.html') {
  let resolve, reject;
  const loaded = new Promise((yes, no) => { resolve = yes; reject = no; });
  const context = vm.createContext({ path, pathToFileURL, __dirname: desktop,
    setupMessage: '', connectionPageLoading: false, disconnectSocket: jest.fn(), safeError: jest.fn(),
    mainWindow: { isDestroyed: () => false, webContents: { getURL: () => url },
      loadFile: jest.fn().mockReturnValue(loaded) } });
  vm.runInContext(fn, context);
  return { context, resolve, reject };
}

test('simultaneous HTTP and socket rejections do not abort login navigation', async () => {
  const { context, resolve } = fixture();
  context.showConnection('first');
  context.showConnection('latest');
  expect(context.mainWindow.loadFile).toHaveBeenCalledTimes(1);
  expect(context.setupMessage).toBe('latest');
  expect(context.connectionPageLoading).toBe(true);
  resolve();
  await new Promise(setImmediate);
  expect(context.connectionPageLoading).toBe(false);
});

test('explicit menu logout refreshes an already-open login page', async () => {
  const { context, resolve } = fixture(pathToFileURL(path.join(desktop, 'connection.html')).href);
  context.showConnection();
  expect(context.mainWindow.loadFile).not.toHaveBeenCalled();
  context.showConnection('logged out', true);
  expect(context.mainWindow.loadFile).toHaveBeenCalledTimes(1);
  resolve();
  await new Promise(setImmediate);
});

test('failed navigation is handled and allows another attempt', async () => {
  const { context, reject } = fixture();
  context.showConnection();
  reject(new Error('synthetic navigation failure'));
  await new Promise(setImmediate);
  expect(context.connectionPageLoading).toBe(false);
  expect(context.safeError).toHaveBeenCalledTimes(1);
  context.mainWindow.loadFile.mockResolvedValue(undefined);
  context.showConnection();
  expect(context.mainWindow.loadFile).toHaveBeenCalledTimes(2);
  await new Promise(setImmediate);
});
