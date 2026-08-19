const mockStripeClient = {
  checkout: {
    sessions: {
      create: jest.fn(),
      expire: jest.fn()
    }
  },
  refunds: { create: jest.fn() }
};

jest.mock('stripe', () => jest.fn(() => mockStripeClient));

const Stripe = require('stripe');
const {
  createCheckoutSession,
  refundDeposit,
  expireCheckoutSession,
  isDepositRequired
} = require('../paymentService');

describe('paymentService idempotence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    process.env.DEPOSIT_PER_PERSON_CENTS = '1000';
    process.env.DEPOSIT_CURRENCY = 'eur';
    process.env.CHECKOUT_EXPIRY_MINUTES = '30';
    process.env.PUBLIC_SITE_URL = 'https://example.test';
    process.env.DEPOSIT_ENABLED = 'true';
    delete process.env.DEPOSIT_ACTIVATION_CONFIRMED;
  });

  test('garde les arrhes desactivees sans confirmation explicite', () => {
    expect(isDepositRequired(6)).toBe(false);

    process.env.DEPOSIT_ACTIVATION_CONFIRMED = 'true';
    expect(isDepositRequired(6)).toBe(true);
  });

  test('reutilise une cle Checkout stable et ne force pas card', async () => {
    mockStripeClient.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.test/1'
    });
    const reservation = {
      _id: 'reservation-1',
      numberOfPeople: 6,
      date: new Date('2026-09-01T12:00:00Z'),
      time: '12:30',
      email: 'client@example.test',
      deposit: { amountCents: 6000, checkoutAttempt: 2 }
    };

    await createCheckoutSession(reservation);

    expect(Stripe).toHaveBeenCalledWith('sk_test_unit', { apiVersion: '2026-06-24.dahlia' });
    const [payload, options] = mockStripeClient.checkout.sessions.create.mock.calls[0];
    expect(options).toEqual({ idempotencyKey: 'deposit-checkout:reservation-1:2' });
    expect(payload).not.toHaveProperty('payment_method_types');
    expect(payload.metadata).toEqual(expect.objectContaining({
      reservationId: 'reservation-1',
      checkoutAttempt: '2',
      amountCents: '6000',
      currency: 'eur'
    }));
    expect(payload.integration_identifier).toMatch(/^booking_deposit_[a-z]{8}$/);
  });

  test('reutilise une cle de remboursement stable', async () => {
    mockStripeClient.refunds.create.mockResolvedValue({ id: 're_1', status: 'succeeded' });
    const reservation = {
      _id: 'reservation-1',
      deposit: { stripePaymentIntentId: 'pi_1' }
    };

    await refundDeposit(reservation);
    await refundDeposit(reservation);

    expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(2);
    for (const call of mockStripeClient.refunds.create.mock.calls) {
      expect(call[1]).toEqual({ idempotencyKey: 'deposit-refund:reservation-1:pi_1' });
    }
  });

  test('expire une session avec une cle stable', async () => {
    mockStripeClient.checkout.sessions.expire.mockResolvedValue({ id: 'cs_1', status: 'expired' });
    const reservation = { _id: 'reservation-1', deposit: { stripeSessionId: 'cs_1' } };

    await expireCheckoutSession(reservation);

    expect(mockStripeClient.checkout.sessions.expire).toHaveBeenCalledWith(
      'cs_1',
      {},
      { idempotencyKey: 'deposit-checkout-expire:reservation-1:cs_1' }
    );
  });
});
