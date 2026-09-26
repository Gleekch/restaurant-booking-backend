const Reservation = require('../Reservation');

describe('Reservation payment invariants', () => {
  test('possede des index uniques pour les soumissions et reservations actives', () => {
    const indexes = Reservation.schema.indexes();
    const bookingRequestIndex = indexes.find(([fields]) => fields.bookingRequestKey === 1);
    const activeBookingIndex = indexes.find(([fields]) => fields.activeBookingKey === 1);

    expect(bookingRequestIndex && bookingRequestIndex[1].unique).toBe(true);
    expect(activeBookingIndex && activeBookingIndex[1].unique).toBe(true);
  });

  test.each(['refund_pending', 'refund_failed', 'refund_review', 'refunded'])('accepte le statut financier %s', (status) => {
    const reservation = new Reservation({
      customerName: 'Client',
      phoneNumber: '0262000000',
      numberOfPeople: 6,
      date: new Date('2026-09-01T12:00:00Z'),
      time: '12:30',
      source: 'website',
      deposit: { required: true, status }
    });

    expect(reservation.validateSync()).toBeUndefined();
  });
});
