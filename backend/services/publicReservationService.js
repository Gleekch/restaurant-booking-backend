function toPublicReservationData(reservation) {
  if (!reservation) return null;

  const reservationId = reservation._id || reservation.id;
  return {
    reservationId: reservationId ? String(reservationId) : null,
    status: reservation.status || null
  };
}

module.exports = { toPublicReservationData };
