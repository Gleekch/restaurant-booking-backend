const { toPublicReservationData } = require('../publicReservationService');

describe('publicReservationService', () => {
  test('ne renvoie aucun champ interne ou personnel', () => {
    const result = toPublicReservationData({
      _id: 'reservation-1',
      status: 'awaiting-payment',
      customerName: 'Client',
      phoneNumber: '0600000000',
      email: 'client@example.test',
      cancellationToken: 'secret-token',
      bookingRequestKey: 'secret-request',
      activeBookingKey: 'secret-active',
      deposit: {
        stripeSessionId: 'cs_secret',
        stripePaymentIntentId: 'pi_secret'
      }
    });

    expect(result).toEqual({
      reservationId: 'reservation-1',
      status: 'awaiting-payment'
    });
  });
});
