jest.mock('../../models/Reservation', () => ({
  findById: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../../services/notificationService', () => ({
  sendEmail: jest.fn(() => Promise.resolve()),
  formatReservationMessage: jest.fn(() => 'message'),
  sendConfirmationEmailToClient: jest.fn(() => Promise.resolve()),
  sendPendingEmailToClient: jest.fn(() => Promise.resolve()),
  sendDepositExpiredEmailToClient: jest.fn(() => Promise.resolve())
}));
jest.mock('../../services/paymentService', () => ({
  getStripe: jest.fn(() => ({ webhooks: { constructEvent: jest.fn() } }))
}));
jest.mock('../../services/depositRefundService', () => ({
  refundReservationSafely: jest.fn(),
  applyRefundEvent: jest.fn()
}));

const Reservation = require('../../models/Reservation');
const notificationService = require('../../services/notificationService');
const { refundReservationSafely } = require('../../services/depositRefundService');
const { handleCheckoutPaid } = require('../webhooks');

function session(overrides = {}) {
  return {
    id: 'cs_current',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 6000,
    currency: 'eur',
    metadata: {
      reservationId: 'reservation-1',
      checkoutAttempt: '2'
    },
    ...overrides
  };
}

function reservation(overrides = {}) {
  return {
    _id: 'reservation-1',
    status: 'awaiting-payment',
    email: 'client@example.test',
    deposit: {
      status: 'awaiting',
      checkoutAttempt: 2,
      stripeSessionId: 'cs_current',
      stripePaymentIntentId: null,
      amountCents: 6000,
      currency: 'eur'
    },
    ...overrides
  };
}

describe('webhook Checkout anti-doublon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EMAIL_USER;
  });

  test('payment waits for restaurant confirmation and sends only an acknowledgement', async () => {
    const before = reservation();
    const after = reservation({ status: 'pending', deposit: { ...before.deposit, status: 'paid' } });
    Reservation.findById.mockResolvedValue(before);
    Reservation.findOneAndUpdate.mockResolvedValue(after);
    const io = { emit: jest.fn() };
    await handleCheckoutPaid(session(), io);
    expect(Reservation.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('pending');
    expect(notificationService.sendPendingEmailToClient).toHaveBeenCalledWith(after);
    expect(notificationService.sendConfirmationEmailToClient).not.toHaveBeenCalled();
    expect(io.emit).toHaveBeenCalledWith('new-reservation', after);
    expect(io.emit).toHaveBeenCalledWith('update-reservation', after);
  });

  test('refuse une ancienne session Checkout', async () => {
    Reservation.findById.mockResolvedValue(reservation());

    await expect(handleCheckoutPaid(session({ id: 'cs_old' }))).rejects.toThrow('inattendue');

    expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('absorbe un webhook repete sans renvoyer de confirmation', async () => {
    const alreadyPaid = reservation({
      status: 'confirmed',
      deposit: {
        status: 'paid',
        checkoutAttempt: 2,
        stripeSessionId: 'cs_current',
        stripePaymentIntentId: 'pi_1',
        amountCents: 6000,
        currency: 'eur'
      }
    });
    Reservation.findById.mockResolvedValue(alreadyPaid);
    Reservation.findOneAndUpdate.mockResolvedValue(null);

    const result = await handleCheckoutPaid(session());

    expect(result.duplicate).toBe(true);
    expect(notificationService.sendConfirmationEmailToClient).not.toHaveBeenCalled();
  });

  test('rembourse un paiement qui gagne la course avec une annulation', async () => {
    const cancelled = reservation({ status: 'cancelled' });
    const paidCancelled = reservation({
      status: 'cancelled',
      deposit: { ...cancelled.deposit, status: 'paid', stripePaymentIntentId: 'pi_1' }
    });
    const refundedCancelled = reservation({
      status: 'cancelled',
      deposit: { ...cancelled.deposit, status: 'refunded', stripePaymentIntentId: 'pi_1', stripeRefundId: 're_1' }
    });
    Reservation.findById.mockResolvedValueOnce(cancelled);
    Reservation.findOneAndUpdate.mockResolvedValueOnce(paidCancelled);
    refundReservationSafely.mockResolvedValue({ reservation: refundedCancelled, refunded: true });

    const result = await handleCheckoutPaid(session());

    expect(refundReservationSafely).toHaveBeenCalledWith('reservation-1');
    expect(result.refundedAfterCancellation).toBe(true);
  });
});
