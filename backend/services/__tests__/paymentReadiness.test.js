const { getPaymentReadiness, getPublicDepositPolicy, isDepositRequired } = require('../paymentService');

describe('production payment activation', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env = { ...original, NODE_ENV: 'production', DEPOSIT_ENABLED: 'true',
      DEPOSIT_ACTIVATION_CONFIRMED: 'true', STRIPE_SECRET_KEY: 'rk_live_unit',
      STRIPE_WEBHOOK_SECRET: 'whsec_unit', DEPOSIT_MIN_PARTY: '6',
      DEPOSIT_PER_PERSON_CENTS: '1000', DEPOSIT_CANCELLATION_HOURS: '24', DEPOSIT_CURRENCY: 'eur' };
  });
  afterEach(() => { process.env = original; });
  test('live restricted key and complete config can be active', () => {
    expect(getPaymentReadiness()).toMatchObject({ active: true, mode: 'live', readyToActivate: true });
  });
  test('test key cannot activate payments in production', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    expect(getPaymentReadiness()).toMatchObject({ active: false, issues: ['LIVE_KEY_REQUIRED'] });
  });
  test('missing webhook blocks new payments', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(getPaymentReadiness().active).toBe(false);
  });
  test('invalid monetary config is not silently accepted', () => {
    process.env.DEPOSIT_PER_PERSON_CENTS = '-10';
    expect(getPaymentReadiness().issues).toContain('DEPOSIT_PER_PERSON_CENTS_INVALID');
  });
  test('disabled deposits remain disabled even with live config', () => {
    process.env.DEPOSIT_ENABLED = 'false';
    expect(getPaymentReadiness()).toMatchObject({ readyToActivate: true, active: false });
  });
  test('public policy has no credentials and reflects configured threshold', () => {
    process.env.DEPOSIT_MIN_PARTY = '1';
    expect(isDepositRequired(2)).toBe(true);
    expect(getPublicDepositPolicy()).toEqual({ enabled: true, minParty: 1,
      perPersonCents: 1000, currency: 'eur', cancellationHours: 24 });
  });
  test('non-production test environments remain supported', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.RENDER;
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    expect(getPaymentReadiness().active).toBe(true);
  });
});
