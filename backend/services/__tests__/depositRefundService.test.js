jest.mock('../../models/Reservation', () => ({
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
  find: jest.fn()
}));
jest.mock('../paymentService', () => ({ refundDeposit: jest.fn(), retrieveRefund: jest.fn() }));

const Reservation = require('../../models/Reservation');
const { refundDeposit, retrieveRefund } = require('../paymentService');
const {
  refundReservationSafely,
  applyRefundEvent,
  reconcilePendingRefunds
} = require('../depositRefundService');

describe('depositRefundService', () => {
  test('a Dashboard refund without metadata is matched by its unique PaymentIntent', async () => {
    const record = await Reservation.findById('reservation-1');
    Reservation.find.mockReturnValue({ limit: jest.fn().mockResolvedValue([record]) });
    Reservation.findOneAndUpdate.mockResolvedValue({ ...record, deposit: { ...record.deposit, status: 'refunded' } });
    const result = await applyRefundEvent({ id: 're_1', payment_intent: 'pi_1', currency: 'eur', metadata: {} });
    expect(result.deposit.status).toBe('refunded');
    expect(Reservation.find).toHaveBeenCalledWith({ 'deposit.stripePaymentIntentId': 'pi_1' });
    expect(retrieveRefund).toHaveBeenCalledWith('re_1');
  });
  test('a refund unrelated to restaurant payments is ignored, not retried forever', async () => {
    Reservation.find.mockReturnValue({ limit: jest.fn().mockResolvedValue([]) });
    expect(await applyRefundEvent({ id: 're_other', payment_intent: 'pi_other' })).toBeNull();
    expect(retrieveRefund).not.toHaveBeenCalled();
  });
  test('ambiguous PaymentIntent mapping fails closed without modifying either booking', async () => {
    Reservation.find.mockReturnValue({ limit: jest.fn().mockResolvedValue([{}, {}]) });
    await expect(applyRefundEvent({ id: 're_1', payment_intent: 'pi_1' })).rejects.toThrow('unique');
    expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  });
  test('refund after POS deduction is marked for manual reconciliation, not silently cleared', async () => {
    const record = await Reservation.findById('reservation-1'); record.deposit.status = 'deducted';
    Reservation.findById.mockResolvedValue(record); Reservation.findOneAndUpdate.mockResolvedValue(record);
    await applyRefundEvent({ id: 're_1', payment_intent: 'pi_1', currency: 'eur', metadata: { reservationId: 'reservation-1' } });
    const [filter, update] = Reservation.findOneAndUpdate.mock.calls[0];
    expect(filter['deposit.status']).toBe('deducted'); expect(update.$set['deposit.status']).toBe('refund_review');
    expect(update.$set['deposit.refundFailureReason']).toContain('caisse');
  });
  beforeEach(() => {
    jest.resetAllMocks();
    Reservation.findById.mockResolvedValue({ _id: 'reservation-1', deposit: {
      status: 'refund_pending', stripePaymentIntentId: 'pi_1', stripeRefundId: null,
      amountCents: 6000, currency: 'eur', refundVersion: 0
    } });
    retrieveRefund.mockResolvedValue({ id: 're_1', status: 'succeeded', payment_intent: 'pi_1',
      amount: 6000, currency: 'eur', metadata: { reservationId: 'reservation-1' } });
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  });

  afterAll(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  test('reserve atomiquement le remboursement avant Stripe', async () => {
    const claimed = {
      _id: 'reservation-1',
      deposit: { status: 'refund_pending', stripePaymentIntentId: 'pi_1' }
    };
    const refunded = {
      _id: 'reservation-1',
      deposit: { status: 'refunded', stripePaymentIntentId: 'pi_1', stripeRefundId: 're_1' }
    };
    Reservation.findOneAndUpdate
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce(refunded);
    refundDeposit.mockResolvedValue({ id: 're_1', status: 'succeeded' });

    const result = await refundReservationSafely('reservation-1');

    expect(Reservation.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: 'reservation-1',
      'deposit.status': 'paid'
    });
    expect(refundDeposit).toHaveBeenCalledWith(claimed);
    expect(result.refunded).toBe(true);
  });

  test('rejoue sans danger un remboursement reste pending', async () => {
    const pending = {
      _id: 'reservation-1',
      deposit: { status: 'refund_pending', stripePaymentIntentId: 'pi_1' }
    };
    const refunded = {
      _id: 'reservation-1',
      deposit: { status: 'refunded', stripePaymentIntentId: 'pi_1', stripeRefundId: 're_1' }
    };
    Reservation.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(refunded);
    Reservation.findById.mockResolvedValueOnce(pending);
    refundDeposit.mockResolvedValue({ id: 're_1', status: 'succeeded' });

    const result = await refundReservationSafely('reservation-1');

    expect(refundDeposit).toHaveBeenCalledTimes(1);
    expect(result.refunded).toBe(true);
  });

  test('ne rappelle pas Stripe si la reservation est deja remboursee', async () => {
    const refunded = {
      _id: 'reservation-1',
      deposit: { status: 'refunded', stripePaymentIntentId: 'pi_1', stripeRefundId: 're_1' }
    };
    Reservation.findOneAndUpdate.mockResolvedValueOnce(null);
    Reservation.findById.mockResolvedValueOnce(refunded);

    const result = await refundReservationSafely('reservation-1');

    expect(refundDeposit).not.toHaveBeenCalled();
    expect(result.alreadyRefunded).toBe(true);
  });

  test('un ancien evenement pending ne peut pas annuler un statut refunded', async () => {
    const current = { _id: 'reservation-1', deposit: { status: 'refunded',
      stripePaymentIntentId: 'pi_1', stripeRefundId: 're_1', amountCents: 6000, currency: 'eur', refundVersion: 2 } };
    Reservation.findById.mockResolvedValue(current);
    Reservation.findOneAndUpdate.mockResolvedValueOnce(current);
    const result = await applyRefundEvent({
      id: 're_1',
      status: 'pending',
      payment_intent: 'pi_1', currency: 'eur', amount: 6000,
      metadata: { reservationId: 'reservation-1' }
    });

    expect(retrieveRefund).toHaveBeenCalledWith('re_1');
    expect(result.deposit.status).toBe('refunded');
    expect(Reservation.findOneAndUpdate.mock.calls[0][1].$set['deposit.status']).toBe('refunded');
  });

  test('reprend les remboursements pending sans interrompre le lot en cas d erreur', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const lean = jest.fn().mockResolvedValue([
      { _id: 'reservation-1' },
      { _id: 'reservation-2' }
    ]);
    const limit = jest.fn().mockReturnValue({ lean });
    Reservation.find.mockReturnValue({ limit });
    const refundFn = jest.fn()
      .mockResolvedValueOnce({ refunded: true, alreadyRefunded: false })
      .mockRejectedValueOnce(new Error('Stripe indisponible'));

    const summary = await reconcilePendingRefunds({
      now: new Date('2026-08-19T00:00:00Z'),
      minAgeMinutes: 2,
      batchSize: 10,
      refundFn
    });

    expect(refundFn).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({
      scanned: 2,
      refunded: 1,
      pending: 0,
      failed: 1,
      skipped: false
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Reconciliation remboursement reservation-2:',
      'Stripe indisponible'
    );
    consoleError.mockRestore();
  });
});
