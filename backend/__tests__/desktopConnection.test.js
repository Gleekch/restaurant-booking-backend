const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createConnectionStore, validateBackendUrl, DEFAULT_BACKEND_URL } = require('../../desktop/connection-store');
const { assertSafePackagedFiles } = require('../../scripts/after-pack-desktop');

describe('desktop connection and credential-free packaging', () => {
  let directory, file, safeStorage, request;
  const input = { username: 'operator-test', password: 'private-test-password' };
  const basic = 'Basic ' + Buffer.from(input.username + ':' + input.password).toString('base64');
  const create = (options = {}) => createConnectionStore({ directory, safeStorage, request, ...options });

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-connection-unit-'));
    file = path.join(directory, 'operator-connection.json');
    const key = crypto.randomBytes(32);
    safeStorage = {
      isAsyncEncryptionAvailable: jest.fn().mockResolvedValue(true),
      encryptStringAsync: jest.fn(async value => {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), body]);
      }),
      decryptStringAsync: jest.fn(async value => {
        const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
        cipher.setAuthTag(value.subarray(12, 28));
        return { result: Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8'), shouldReEncrypt: false };
      })
    };
    request = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(directory)).toMatch(/^booking-connection-unit-/);
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  });

  test('first launch is disconnected and never uses inherited production secrets', async () => {
    const store = create({ env: { API_KEY: 'real-looking-key-not-to-use', ADMIN_USER: input.username, ADMIN_PASS: input.password } });
    expect(await store.initialize()).toMatchObject({ hasCredentials: false, requiresSetup: true });
    expect(store.headers()).toEqual({});
    expect(request).not.toHaveBeenCalled();
  });
  test('explicit loopback fixture keys remain in memory only', async () => {
    const store = create({ env: { BACKEND_URL: 'http://127.0.0.1:3001', API_KEY: 'local-only' } });
    expect(await store.initialize()).toMatchObject({ hasApiKey: true, requiresSetup: false });
    expect(store.headers()).toEqual({ 'X-API-Key': 'local-only' });
    expect(fs.existsSync(file)).toBe(false);
  });
  test('login is read-only, does not follow redirects, and saves encrypted credentials', async () => {
    const store = create();
    expect(await store.signIn(input)).toEqual({ success: true });
    expect(request).toHaveBeenCalledWith(DEFAULT_BACKEND_URL + '/api/settings/production-readiness', expect.objectContaining({
      method: 'GET', redirect: 'error', headers: { Authorization: basic }
    }));
    expect(store.headers()).toEqual({ Authorization: basic });
    const saved = fs.readFileSync(file, 'utf8');
    for (const sensitive of [input.username, input.password, basic, 'API_KEY', 'ADMIN_PASS']) expect(saved).not.toContain(sensitive);
    expect(JSON.stringify(store.snapshot())).not.toContain(basic);
    expect(JSON.stringify(store.snapshot())).not.toContain(input.password);
    const restarted = create();
    expect(await restarted.initialize()).toMatchObject({ requiresSetup: false, hasCredentials: true, hasApiKey: false });
    expect(restarted.headers()).toEqual({ Authorization: basic });
  });
  test('wrong credentials do not overwrite the working connection', async () => {
    const store = create(); await store.signIn(input);
    const saved = fs.readFileSync(file, 'utf8');
    request.mockResolvedValueOnce({ status: 401 });
    expect((await store.signIn({ ...input, password: 'wrong' })).success).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(saved);
    expect(store.headers()).toEqual({ Authorization: basic });
  });
  test('network errors are sanitized and create no configuration', async () => {
    request.mockRejectedValue(new Error('internal ' + input.password));
    const result = await create().signIn(input);
    expect(result.success).toBe(false);
    expect(result.message).not.toContain(input.password);
    expect(fs.existsSync(file)).toBe(false);
  });
  test('a generic 200 HTML page is not accepted as authentication', async () => {
    request.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('html'); } });
    expect((await create().signIn(input)).success).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });
  test('no plaintext fallback if Windows encryption is unavailable', async () => {
    safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false);
    expect((await create().signIn(input)).success).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(fs.existsSync(file)).toBe(false);
  });
  test('encryption failure does not overwrite a working connection', async () => {
    const store = create(); await store.signIn(input);
    const saved = fs.readFileSync(file, 'utf8');
    safeStorage.encryptStringAsync.mockRejectedValue(new Error('private OS error'));
    expect((await store.signIn(input)).success).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(saved);
  });
  test('disk failure preserves previous configuration and removes temporary ciphertext', async () => {
    const store = create(); await store.signIn(input);
    const saved = fs.readFileSync(file, 'utf8');
    jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk full'); });
    expect((await store.signIn(input)).success).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(saved);
    expect(fs.readdirSync(directory)).toEqual(['operator-connection.json']);
  });
  test('corrupt profile asks for new credentials without deleting the file', async () => {
    fs.writeFileSync(file, '{');
    const config = await create().initialize();
    expect(config.requiresSetup).toBe(true);
    expect(config.storageWarning).toBeTruthy();
    expect(fs.readFileSync(file, 'utf8')).toBe('{');
  });
  test('saved credentials cannot be sent to a different backend', async () => {
    await create().signIn(input);
    const store = create({ env: { BACKEND_URL: 'http://127.0.0.1:9000' } });
    expect((await store.initialize()).requiresSetup).toBe(true);
    expect(store.headers()).toEqual({});
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('rejected credentials are not sent again until a successful sign in', async () => {
    const store = create(); await store.signIn(input); store.reject();
    expect(store.snapshot().requiresSetup).toBe(true);
    expect(store.headers()).toEqual({});
    await store.signIn(input);
    expect(store.snapshot().requiresSetup).toBe(false);
  });
  test('forget removes only local authentication and performs no server request', async () => {
    const store = create(); await store.signIn(input); request.mockClear(); store.forget();
    expect(fs.existsSync(file)).toBe(false);
    expect(store.headers()).toEqual({});
    expect(request).not.toHaveBeenCalled();
  });
  test('forget invalidates a login that is still awaiting a network response', async () => {
    let finish;
    request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const store = create(); const attempt = store.signIn(input);
    await new Promise(resolve => setImmediate(resolve));
    store.forget();
    finish({ status: 200, ok: true, json: async () => ({ success: true, data: {} }) });
    expect((await attempt).success).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });
  test.each([{}, { username: 'x:y', password: 'secret' }, { username: 'x\ny', password: 'secret' },
    { username: 'valid', password: '' }])('invalid form makes no network request: %p', async input => {
    expect((await create().signIn(input)).success).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  test.each(['http://restaurant-booking-backend-y3sp.onrender.com', 'https://other.example',
    'https://restaurant-booking-backend-y3sp.onrender.com.evil.example', 'https://user:pass@localhost',
    'file:///etc/passwd', 'http://localhost/path', 'http://localhost/?key=secret'])('rejects untrusted backend %s', url => {
    expect(() => validateBackendUrl(url)).toThrow();
  });
  test.each(['/.env', '/desktop/.env.desktop', 'operator-connection.json', '/backend/server.js',
    '\\desktop\\.env'])('packaging fails closed for private file %s', file => {
    expect(() => assertSafePackagedFiles([file])).toThrow();
  });
  test('normal desktop sources and dependencies are permitted', () => {
    expect(() => assertSafePackagedFiles(['/desktop/main.js', '/desktop/connection-store.js', '/node_modules/dotenv/lib/main.js'])).not.toThrow();
  });
});
