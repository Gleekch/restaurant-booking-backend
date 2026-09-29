// Isolated contract tests: application sources run with in-memory persistence.
// No .env, network, real reservation, email, or Stripe account is accessed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = process.env.BOOKING_SOURCE_ROOT || path.resolve(__dirname, '../..');
const copy = value => structuredClone(value);
const id = '000000000000000000000001';
const config = {
  STRIPE_SECRET_KEY: 'sk_test_mock_only',
  STRIPE_WEBHOOK_SECRET: 'whsec_mock_only',
  DEPOSIT_ENABLED: 'true', DEPOSIT_ACTIVATION_CONFIRMED: 'true',
  DEPOSIT_MIN_PARTY: '6', DEPOSIT_PER_PERSON_CENTS: '1000',
  DEPOSIT_CURRENCY: 'eur', DEPOSIT_CANCELLATION_HOURS: '24',
  PUBLIC_SITE_URL: 'http://localhost:5173', RESTAURANT_TIME_ZONE: 'Indian/Reunion'
};

function load(relative, mocks = {}, extras = {}, suffix = '') {
  const filename = path.join(root, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name),
    process: { env: { ...config } },
    console: { log() {}, error() {}, warn() {} }, Buffer,
    setInterval() { throw new Error('Schedulers forbidden in isolated tests'); },
    ...extras
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + suffix, sandbox, { filename });
  return module.exports;
}

function record(overrides = {}) {
  return {
    _id: id, status: 'awaiting-payment', numberOfPeople: 6,
    date: '2026-10-04T00:00:00.000Z', time: '12:00', email: '',
    deposit: { status: 'awaiting', amountCents: 6000, currency: 'eur',
      checkoutAttempt: 1, stripeSessionId: 'cs_test_isolated',
      stripePaymentIntentId: null, stripeRefundId: null, refundVersion: 0,
      expiresAt: '2026-09-26T01:00:00Z' },
    ...overrides
  };
}

function session(overrides = {}) {
  return { id: 'cs_test_isolated', payment_status: 'paid',
    payment_intent: 'pi_test_isolated', amount_total: 6000, currency: 'eur',
    metadata: { reservationId: id, checkoutAttempt: '1' }, ...overrides };
}

const get = (object, key) => key.split('.').reduce((v, part) => v?.[part], object);
function matches(object, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(item => matches(object, item));
    const current = get(object, key);
    if (value && typeof value === 'object') {
      if ('$in' in value) return value.$in.includes(current ?? null);
      if ('$nin' in value) return !value.$nin.includes(current);
      if ('$exists' in value) return (current !== undefined) === value.$exists;
      throw new Error('Unsupported mock filter ' + key);
    }
    return value === null ? current == null : current === value;
  });
}

function memory(initial) {
  let state = copy(initial);
  const model = {
    beforeUpdate: null,
    async findById() { return copy(state); },
    async findOneAndUpdate(filter, update) {
      if (model.beforeUpdate) { const callback = model.beforeUpdate; model.beforeUpdate = null; callback(state); }
      if (!matches(state, filter)) return null;
      for (const [key, value] of Object.entries(update.$set || {})) {
        const parts = key.split('.'); const last = parts.pop();
        const target = parts.reduce((v, part) => v[part], state);
        target[last] = value;
      }
      for (const [key, value] of Object.entries(update.$inc || {})) {
        const parts = key.split('.'); const last = parts.pop();
        const target = parts.reduce((v, part) => v[part], state);
        target[last] = (target[last] || 0) + value;
      }
      return copy(state);
    }
  };
  return { model, state: () => copy(state) };
}

function webhookHarness(initial, refund = async () => { throw new Error('Unexpected refund'); }) {
  const db = memory(initial);
  const events = [];
  const module = load('backend/routes/webhooks.js', {
    '../models/Reservation': db.model,
    '../services/paymentService': { getStripe() { throw new Error('No Stripe'); } },
    '../services/depositRefundService': { refundReservationSafely: refund, applyRefundEvent: async () => null },
    '../services/notificationService': {
      sendEmail: async () => {}, formatReservationMessage: () => '',
      sendPendingEmailToClient: async () => {}, sendDepositExpiredEmailToClient: async () => {}
    }
  });
  return { ...db, module, io: { emit: (...args) => events.push(args) }, events };
}

test('unpaid Checkout must not confirm the reservation', async () => {
  const h = webhookHarness(record());
  await h.module.handleCheckoutPaid(session({ payment_status: 'unpaid' }), h.io);
  assert.equal(h.state().status, 'awaiting-payment');
  assert.equal(h.events.length, 0);
});

for (const [field, value] of [['amount_total', 1], ['currency', 'usd'], ['id', 'cs_wrong'], ['payment_intent', null]]) {
  test('reject mismatching Checkout ' + field, async () => {
    const h = webhookHarness(record());
    await assert.rejects(h.module.handleCheckoutPaid(session({ [field]: value }), h.io));
    assert.equal(h.state().deposit.status, 'awaiting');
  });
}

test('successful payment requests restaurant confirmation once; duplicate event has no side effect', async () => {
  const h = webhookHarness(record());
  await h.module.handleCheckoutPaid(session(), h.io);
  const duplicate = await h.module.handleCheckoutPaid(session(), h.io);
  assert.equal(h.state().status, 'pending');
  assert.equal(h.state().deposit.status, 'paid');
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(h.events.map(([name]) => name), ['new-reservation', 'update-reservation']);
  assert.ok(h.events.every(([, booking]) => booking.status === 'pending' && booking.deposit.status === 'paid'));
});

test('Checkout expiration cancels unpaid booking, not an already paid booking', async () => {
  const h = webhookHarness(record());
  await h.module.handleCheckoutUnavailable(session(), h.io);
  assert.equal(h.state().status, 'cancelled');
  const paid = webhookHarness(record({ status: 'confirmed', deposit: { ...record().deposit, status: 'paid' } }));
  await paid.module.handleCheckoutUnavailable(session(), paid.io);
  assert.equal(paid.state().status, 'confirmed');
  assert.equal(paid.state().deposit.status, 'paid');
});

test('payment concurrent with cancellation must not reactivate the booking', async () => {
  const h = webhookHarness(record(), async () => ({ reservation: record({ status: 'cancelled' }) }));
  h.model.beforeUpdate = state => { state.status = 'cancelled'; state.activeBookingKey = null; };
  await h.module.handleCheckoutPaid(session(), h.io);
  assert.equal(h.state().status, 'cancelled', 'Payment restored confirmed from a stale pre-cancellation read');
});

test('paid webhook retry must retry refund after cancellation if first attempt failed', async () => {
  let refundCalls = 0;
  const h = webhookHarness(record({ status: 'cancelled' }), async () => {
    refundCalls++;
    if (refundCalls === 1) throw new Error('Database unavailable before refund claim');
    return { reservation: record({ status: 'cancelled' }), refunded: true };
  });
  await assert.rejects(h.module.handleCheckoutPaid(session(), h.io));
  await h.module.handleCheckoutPaid(session(), h.io);
  assert.equal(refundCalls, 2, 'Webhook replay acknowledged duplicate without retrying the refund');
});

function refundHarness(initial, refundResponse) {
  const db = memory(initial);
  let calls = 0;
  const currentRefund = { id: 're_test', amount: 6000, currency: 'eur',
    payment_intent: 'pi_test_isolated', metadata: { reservationId: id },
    status: initial.deposit.status === 'refunded' ? 'succeeded' : 'pending', ...refundResponse };
  const module = load('backend/services/depositRefundService.js', {
    '../models/Reservation': db.model,
    './paymentService': { refundDeposit: async () => { calls++; return copy(currentRefund); },
      retrieveRefund: async () => copy(currentRefund) }
  });
  return { ...db, module, calls: () => calls, stripeState: currentRefund };
}

function paidRecord() {
  return record({ status: 'cancelled', deposit: { ...record().deposit, status: 'paid', stripePaymentIntentId: 'pi_test_isolated' } });
}

test('successful refund is persisted; duplicate request does not call Stripe', async () => {
  const h = refundHarness(paidRecord(), { id: 're_test', status: 'succeeded' });
  await h.module.refundReservationSafely(id);
  const again = await h.module.refundReservationSafely(id);
  assert.equal(h.state().deposit.status, 'refunded');
  assert.equal(again.alreadyRefunded, true);
  assert.equal(h.calls(), 1);
});

test('pending refund must not be announced as successful', async () => {
  const h = refundHarness(paidRecord(), { id: 're_test', status: 'pending' });
  const result = await h.module.refundReservationSafely(id);
  assert.equal(result.refunded, false);
  assert.equal(result.pending, true);
});

test('failed refund response must not remain indefinitely refund_pending', async () => {
  const h = refundHarness(paidRecord(), { id: 're_test', status: 'failed' });
  const result = await h.module.refundReservationSafely(id);
  assert.equal(result.pending, false, 'A terminal Stripe failure was stored as refund_pending');
});

test('late pending refund event cannot regress a successful refund', async () => {
  const initial = paidRecord(); initial.deposit.status = 'refunded'; initial.deposit.stripeRefundId = 're_test';
  const h = refundHarness(initial, {});
  await h.module.applyRefundEvent({ id: 're_test', status: 'pending', payment_intent: 'pi_test_isolated',
    currency: 'eur', amount: 6000, metadata: { reservationId: id } });
  assert.equal(h.state().deposit.status, 'refunded');
});

test('refund webhook must reject a different payment intent', async () => {
  const h = refundHarness(paidRecord(), {});
  await h.module.applyRefundEvent({ id: 're_test', status: 'succeeded', payment_intent: 'pi_other', amount: 6000, currency: 'eur', metadata: { reservationId: id } });
  assert.notEqual(h.state().deposit.status, 'refunded', 'Reservation metadata alone accepted a different payment');
});

test('partial refund webhook must not mark the entire deposit refunded', async () => {
  const h = refundHarness(paidRecord(), { amount: 100, status: 'succeeded' });
  await h.module.applyRefundEvent({ id: 're_test', status: 'succeeded', payment_intent: 'pi_test_isolated', amount: 100, currency: 'eur', metadata: { reservationId: id } });
  assert.notEqual(h.state().deposit.status, 'refunded', 'One euro refund was recorded as full repayment of 60 euros');
});

function clock(now) {
  return class extends Date { constructor(...args) { super(...(args.length ? args : [now.value])); } static now() { return now.value; } };
}

test('Checkout retry must preserve all parameters for its idempotency key', async () => {
  const calls = [];
  const now = { value: Date.parse('2026-09-26T00:00:00Z') };
  const module = load('backend/services/paymentService.js', {
    '../models/Reservation': memory(record()).model,
    stripe: function () { return { checkout: { sessions: { create: async (body, options) => {
      calls.push({ body, options }); return { id: 'cs_test', url: 'http://localhost/test' };
    } } } }; }
  }, { Date: clock(now) });
  await module.createCheckoutSession(record()); now.value += 31000;
  await module.createCheckoutSession(record());
  assert.equal(calls[0].options.idempotencyKey, calls[1].options.idempotencyKey);
  assert.equal(calls[0].body.expires_at, calls[1].body.expires_at, 'expires_at changes between retries with the same Stripe key');
});

function cancellationHarness(hours, options = {}) {
  const initial = options.initial || paidRecord();
  if (!options.initial) initial.status = 'confirmed';
  const db = memory(initial);
  let refunds = 0;
  const startUtc = Date.parse('2026-10-04T08:00:00Z');
  const now = { value: startUtc - hours * 3600000 };
  const module = load('backend/routes/reservations.js', {
    '../models/Reservation': db.model,
    '../services/notificationService': {},
    '../services/capacityService': {},
    '../middleware/auth': { apiKey: (_req, _res, next) => next() },
    '../services/publicReservationService': {},
    '../services/paymentService': { getDepositConfig: () => ({ cancellationHours: 24 }) },
    '../services/depositRefundService': { refundReservationSafely: async () => {
      refunds++;
      if (options.refund) return options.refund();
      return { reservation: { ...initial, status: 'cancelled' }, refunded: true };
    } }
  }, { Date: clock(now) }, '\nmodule.exports.auditCancel = cancelReservationCore;');
  return { ...db, module, now, refunds: () => refunds };
}

for (const hours of [48, 24, 23.99]) {
  test('cancellation refund threshold: ' + hours + ' hours before Reunion service', async () => {
    const h = cancellationHarness(hours);
    const result = await h.module.auditCancel(id);
    assert.equal(result.refunded, hours >= 24);
    assert.equal(h.refunds(), hours >= 24 ? 1 : 0);
  });
}

test('stale refund lookup loses CAS and re-reads Stripe before persisting', async () => {
  const h = refundHarness(paidRecord(), { status: 'pending' });
  h.model.beforeUpdate = state => {
    state.deposit.refundVersion = 1;
    state.deposit.status = 'refunded';
    h.stripeState.status = 'succeeded';
  };
  await h.module.applyRefundEvent({ ...h.stripeState });
  assert.equal(h.state().deposit.status, 'refunded');
  assert.equal(h.state().deposit.refundVersion, 2);
});

test('failed refund needs attention and never starts a new financial operation', async () => {
  const initial = paidRecord(); initial.deposit.status = 'refund_failed';
  const h = refundHarness(initial, { status: 'failed' });
  const result = await h.module.refundReservationSafely(id);
  assert.equal(result.needsAttention, true);
  assert.equal(result.pending, false);
  assert.equal(h.calls(), 0);
});

test('refund requiring customer action is visible as review, not success', async () => {
  const h = refundHarness(paidRecord(), { status: 'requires_action' });
  const result = await h.module.refundReservationSafely(id);
  assert.equal(result.needsAttention, true);
  assert.equal(result.refunded, false);
  assert.equal(h.state().deposit.status, 'refund_review');
});

test('wrong-currency refund cannot mark the booking refunded', async () => {
  const h = refundHarness(paidRecord(), { currency: 'usd', status: 'succeeded' });
  await h.module.applyRefundEvent({ ...h.stripeState });
  assert.equal(h.state().deposit.status, 'paid');
});

test('timely cancellation persists refund obligation before a database or Stripe outage', async () => {
  const h = cancellationHarness(48, { refund: async () => { throw new Error('Temporary outage'); } });
  const result = await h.module.auditCancel(id);
  assert.equal(result.changed, true);
  assert.equal(h.state().status, 'cancelled');
  assert.equal(h.state().deposit.status, 'refund_pending');
  assert.ok(h.state().deposit.refundRequestedAt);
  h.now.value += 30 * 3600000;
  await h.module.auditCancel(id);
  assert.equal(h.refunds(), 2, 'Retry must not become a late cancellation');
});

test('cancellation re-reads a payment which wins the concurrent update', async () => {
  const h = cancellationHarness(48, { initial: record() });
  h.model.beforeUpdate = state => {
    state.status = 'confirmed'; state.deposit.status = 'paid';
    state.deposit.stripePaymentIntentId = 'pi_test_isolated';
  };
  await h.module.auditCancel(id);
  assert.equal(h.state().status, 'cancelled');
  assert.equal(h.state().deposit.status, 'refund_pending');
  assert.equal(h.refunds(), 1);
});

test('legacy booking without deposit remains cancellable', async () => {
  const initial = record({ status: 'pending' }); delete initial.deposit;
  const h = cancellationHarness(48, { initial });
  await h.module.auditCancel(id);
  assert.equal(h.state().status, 'cancelled');
  assert.equal(h.refunds(), 0);
});

test('cancellation re-reads a concurrent earlier date before deciding a refund', async () => {
  const h = cancellationHarness(48);
  h.model.beforeUpdate = state => {
    state.date = '2026-10-02T00:00:00.000Z'; state.time = '19:00';
    state.cancellationReference = { date: state.date, time: state.time, numberOfPeople: 6 };
  };
  await h.module.auditCancel(id);
  assert.equal(h.state().status, 'cancelled');
  assert.equal(h.state().deposit.status, 'paid');
  assert.equal(h.refunds(), 0);
});

test('cancellation also protects a time-only concurrent edit', async () => {
  const h = cancellationHarness(23.5, { initial: { ...paidRecord(), status: 'confirmed', time: '13:00' } });
  h.model.beforeUpdate = state => { state.time = '12:00'; };
  await h.module.auditCancel(id);
  assert.equal(h.refunds(), 0);
});

test('a concurrently accepted postponement recalculates eligibility using the new date', async () => {
  const h = cancellationHarness(1);
  h.model.beforeUpdate = state => { state.date = '2026-10-07T00:00:00.000Z'; };
  await h.module.auditCancel(id);
  assert.equal(h.state().date, '2026-10-07T00:00:00.000Z');
  assert.equal(h.state().deposit.status, 'refund_pending');
  assert.equal(h.refunds(), 1);
});

test('legacy earlier refund reference never overrides the accepted date policy', async () => {
  const h = cancellationHarness(48);
  h.model.beforeUpdate = state => {
    state.cancellationReference = { date: '2026-10-02T00:00:00.000Z', time: '19:00', numberOfPeople: 6 };
  };
  await h.module.auditCancel(id);
  assert.equal(h.refunds(), 1);
});

test('late payment for an expired cancelled Checkout is refunded, never reactivated', async () => {
  let count = 0;
  const initial = record({ status: 'cancelled' }); initial.deposit.status = 'failed';
  const h = webhookHarness(initial, async () => { count++; return { reservation: initial, refunded: true }; });
  await h.module.handleCheckoutPaid(session(), h.io);
  assert.equal(h.state().status, 'cancelled');
  assert.equal(h.state().deposit.status, 'refund_pending');
  assert.ok(h.state().deposit.refundRequestedAt);
  assert.equal(count, 1);
});

test('Checkout request snapshot survives configuration and customer changes', async () => {
  const db = memory(record());
  const calls = [];
  const env = { ...config };
  const module = load('backend/services/paymentService.js', {
    '../models/Reservation': db.model,
    stripe: function () { return { checkout: { sessions: { create: async body => {
      calls.push(copy(body)); return { id: 'cs_test', url: 'http://localhost/test' };
    } } } }; }
  }, { process: { env } });
  await module.createCheckoutSession(record());
  env.PUBLIC_SITE_URL = 'http://localhost:9999'; env.DEPOSIT_CANCELLATION_HOURS = '48';
  const changed = record({ email: 'changed@example.test', numberOfPeople: 8 });
  await module.createCheckoutSession(changed);
  assert.deepEqual(calls[0], calls[1]);
});
