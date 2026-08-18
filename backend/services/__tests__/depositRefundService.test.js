jest.mock('../../models/Reservation', () => ({
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
  find: jest.fn()
}));
jest.mock('../paymentService', () => ({ refundDeposit: jest.fn() }));

const Reservation = require('../../models/Reservation');
const { refundDeposit } = require('../paymentService');
const {
  refundReservationSafely,
  applyRefundEvent,
  reconcilePendingRefunds
} = require('../depositRefundService');

describe('depositRefundService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    Reservation.findOneAndUpdate.mockResolvedValueOnce(null);

    await applyRefundEvent({
      id: 're_1',
      status: 'pending',
      metadata: { reservationId: 'reservation-1' }
    });

    expect(Reservation.findOneAndUpdate.mock.calls[0][0]['deposit.status']).toEqual({
      $in: ['paid', 'refund_pending']
    });
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
