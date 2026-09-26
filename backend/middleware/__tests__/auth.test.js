const { apiKey, basicAuth, socketAuth } = require('../auth');

const initialEnv = { ...process.env };
afterEach(() => { process.env = { ...initialEnv }; });
function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn(), setHeader: jest.fn() };
}

test('missing configuration fails closed for API, admin and realtime', () => {
  delete process.env.API_KEY;
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASS;
  for (const middleware of [apiKey, basicAuth]) {
    const next = jest.fn(), res = response();
    middleware({ headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  }
  const next = jest.fn();
  socketAuth({ handshake: { headers: {} } }, next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));
});

test('desktop API headers authenticate HTTP and realtime', () => {
  process.env.API_KEY = 'unit-only-operator-key';
  const headers = { 'x-api-key': process.env.API_KEY };
  const next = jest.fn();
  apiKey({ headers }, response(), next);
  socketAuth({ handshake: { headers } }, next);
  expect(next.mock.calls).toEqual([[], []]);
});

test('wrong or missing realtime credentials are rejected', () => {
  process.env.API_KEY = 'unit-only-operator-key';
  for (const headers of [{}, { 'x-api-key': 'wrong' }]) {
    const next = jest.fn();
    socketAuth({ handshake: { headers } }, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  }
});

test('Basic auth supports a password containing colons without disclosing API key', () => {
  process.env.ADMIN_USER = 'unit';
  process.env.ADMIN_PASS = 'unit:only';
  const headers = { authorization: 'Basic ' + Buffer.from('unit:unit:only').toString('base64') };
  const next = jest.fn();
  apiKey({ headers }, response(), next);
  basicAuth({ headers }, response(), next);
  expect(next.mock.calls).toEqual([[], []]);
});
