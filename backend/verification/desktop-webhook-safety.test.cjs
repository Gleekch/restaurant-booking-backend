// Local-only tests of event display and webhook signatures. No network calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = process.env.BOOKING_SOURCE_ROOT || path.resolve(__dirname, '../..');

function load(relative, mocks, env = {}) {
  const filename = path.join(root, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name),
    process: { env }, console: { log() {}, error() {}, warn() {} }
  }, { filename });
  return module.exports;
}

test('desktop cancellation event must refresh refunded deposit, not only booking status', () => {
  const source = fs.readFileSync(path.join(root, 'desktop/renderer.js'), 'utf8');
  const start = source.indexOf("ipcRenderer.on('cancel-reservation'");
  const end = source.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  let callback;
  const initial = { _id: 'test', status: 'confirmed', deposit: { status: 'paid' } };
  const sandbox = { reservations: [initial], ipcRenderer: { on: (_name, cb) => { callback = cb; } },
    displayReservations() {}, updateStats() {}, modal: { style: {}, dataset: {} } };
  vm.runInNewContext(source.slice(start, end), sandbox);
  callback(null, { ...initial, status: 'cancelled', deposit: { status: 'refunded' } });
  assert.equal(initial.status, 'cancelled');
  assert.equal(initial.deposit.status, 'refunded', 'Desktop retains paid deposit until a full reload');
});

for (const valid of [true, false]) {
  test('webhook signature ' + (valid ? 'accepted when authentic' : 'rejected when forged'), async () => {
    const Stripe = createRequire(path.join(root, 'package.json'))('stripe');
    const stripe = new Stripe('sk_test_mock_only');
    const secret = 'whsec_local_isolated_only';
    const payload = JSON.stringify({ id: 'evt_local', livemode: false, type: 'audit.unhandled', data: { object: {} } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: valid ? secret : 'whsec_wrong' });
    const router = load('backend/routes/webhooks.js', {
      '../models/Reservation': {}, '../services/notificationService': {},
      '../services/paymentService': { getStripe: () => stripe, getStripeMode: () => 'test' },
      '../services/depositRefundService': {}
    }, { STRIPE_WEBHOOK_SECRET: secret });
    const route = router.stack.find(layer => layer.route?.path === '/stripe').route;
    const handler = route.stack[route.stack.length - 1].handle;
    let status = 200;
    const response = { status(code) { status = code; return this; }, json() {}, send() {} };
    await handler({ headers: { 'stripe-signature': signature }, body: Buffer.from(payload), app: { get() {} } }, response);
    assert.equal(status, valid ? 200 : 400);
  });
}

test('a bank refund failure after initial success must not remain labelled refunded', async () => {
  let currentStatus = 'refunded';
  const currentRefund = { id: 're_test', status: 'failed', failure_reason: 'declined',
    payment_intent: 'pi_test', currency: 'eur', amount: 6000,
    metadata: { reservationId: '000000000000000000000001' } };
  const module = load('backend/services/depositRefundService.js', {
    './paymentService': { retrieveRefund: async () => currentRefund },
    '../models/Reservation': {
      async findById() { return { _id: '000000000000000000000001', deposit: {
        status: currentStatus, stripePaymentIntentId: 'pi_test', stripeRefundId: 're_test',
        currency: 'eur', amountCents: 6000, refundVersion: 0 } }; },
      async findOneAndUpdate(filter, update) {
      currentStatus = update.$set['deposit.status'];
      return { deposit: { status: currentStatus } };
    } }
  });
  await module.applyRefundEvent(currentRefund);
  assert.notEqual(currentStatus, 'refunded', 'Refund bank failure is silently ignored after initial success');
});
