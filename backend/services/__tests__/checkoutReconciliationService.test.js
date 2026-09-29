jest.mock('../../models/Reservation', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../paymentService', () => ({ getStripe: jest.fn(), getStripeMode: () => 'test', expireCheckoutSession: jest.fn() }));
jest.mock('../../routes/webhooks', () => ({ handleCheckoutPaid: jest.fn(), handleCheckoutUnavailable: jest.fn() }));
const Reservation = require('../../models/Reservation');
const payment = require('../paymentService');
const hooks = require('../../routes/webhooks');
const { reconcileCheckout } = require('../checkoutReconciliationService');
const retrieve = jest.fn();
let booking, session;
beforeEach(() => {
  jest.clearAllMocks();
  booking = { _id: 'r1', status: 'awaiting-payment', deposit: { status: 'awaiting', checkoutAttempt: 1,
    stripeSessionId: 'cs_1', expiresAt: new Date(Date.now() - 60000), amountCents: 2000, currency: 'eur' } };
  session = { id: 'cs_1', metadata: { reservationId: 'r1', checkoutAttempt: '1' }, amount_total: 2000, currency: 'eur', livemode: false,
    status: 'expired', payment_status: 'unpaid' };
  Reservation.findOneAndUpdate.mockResolvedValue(booking);
  payment.getStripe.mockReturnValue({ checkout: { sessions: { retrieve } } }); retrieve.mockResolvedValue(session);
  hooks.handleCheckoutPaid.mockResolvedValue({ paid: true }); hooks.handleCheckoutUnavailable.mockResolvedValue({ expired: true });
});
test('a payment completed since the scan is never overwritten by a stale expiry', async () => {
  Reservation.findOneAndUpdate.mockResolvedValue(null);
  expect(await reconcileCheckout(booking)).toEqual({ stale: true });
  expect(retrieve).not.toHaveBeenCalled(); expect(hooks.handleCheckoutUnavailable).not.toHaveBeenCalled();
  expect(Reservation.findOneAndUpdate.mock.calls[0][0]).toEqual(expect.objectContaining({ status: 'awaiting-payment', 'deposit.status': 'awaiting', 'deposit.checkoutAttempt': 1 }));
});
test('Stripe paid wins even after local expiry', async () => {
  retrieve.mockResolvedValue({ ...session, status: 'complete', payment_status: 'paid' });
  expect(await reconcileCheckout(booking)).toEqual({ paid: true }); expect(hooks.handleCheckoutUnavailable).not.toHaveBeenCalled();
});
test('expiry racing payment is resolved by re-reading Stripe, not by the failed expire call', async () => {
  retrieve.mockResolvedValueOnce({ ...session, status: 'open' }).mockResolvedValueOnce({ ...session, status: 'complete', payment_status: 'paid' });
  payment.expireCheckoutSession.mockRejectedValueOnce(new Error('completed concurrently'));
  expect(await reconcileCheckout(booking)).toEqual({ paid: true }); expect(hooks.handleCheckoutUnavailable).not.toHaveBeenCalled();
});
test('only confirmed Stripe expiry delegates the guarded cancellation', async () => {
  expect(await reconcileCheckout(booking)).toEqual({ expired: true }); expect(hooks.handleCheckoutUnavailable).toHaveBeenCalledWith(session, undefined);
});
test.each(['offline', 'identity', 'missing'])('uncertainty (%s) stays awaiting and gets a review marker', async kind => {
  if (kind === 'offline') retrieve.mockRejectedValueOnce(new Error('offline'));
  if (kind === 'identity') retrieve.mockResolvedValueOnce({ ...session, amount_total: 1000 });
  if (kind === 'missing') booking.deposit.stripeSessionId = null;
  await expect(reconcileCheckout(booking)).rejects.toThrow();
  expect(hooks.handleCheckoutUnavailable).not.toHaveBeenCalled(); expect(hooks.handleCheckoutPaid).not.toHaveBeenCalled();
  expect(Reservation.findOneAndUpdate.mock.calls.at(-1)[1].$set).toEqual({ 'deposit.checkoutReviewReason': expect.any(String) });
  expect(booking.deposit.status).toBe('awaiting');
});
test('unexpired sessions are never expired by reconciliation', async () => {
  booking.deposit.expiresAt = new Date(Date.now() + 60000);
  expect(await reconcileCheckout(booking)).toEqual({ skipped: true }); expect(payment.expireCheckoutSession).not.toHaveBeenCalled();
});
