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

test('private API challenges use the admin realm so browser credentials can be reused', () => {
  process.env.ADMIN_USER = 'unit';
  process.env.ADMIN_PASS = 'unit-only';
  const adminResponse = response();
  const apiResponse = response();
  const next = jest.fn();
  basicAuth({ headers: {} }, adminResponse, next);
  apiKey({ headers: {} }, apiResponse, next);
  expect(next).not.toHaveBeenCalled();
  expect(apiResponse.status).toHaveBeenCalledWith(401);
  expect(apiResponse.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Au Murmure des Flots - Admin"');
  expect(adminResponse.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Au Murmure des Flots - Admin"');
  expect(apiResponse.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});

test('a rejected Basic credential is never authorized by adding a challenge', () => {
  process.env.ADMIN_USER = 'unit';
  process.env.ADMIN_PASS = 'unit-only';
  const next = jest.fn(), res = response();
  apiKey({ headers: { authorization: 'Basic ' + Buffer.from('unit:wrong').toString('base64') } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(401);
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
