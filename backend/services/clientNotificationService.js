const crypto = require('crypto');
const Reservation = require('../models/Reservation');

// Persist a delivery attempt, never re-save a potentially stale reservation.
// SMTP acknowledgement is not proof of inbox delivery; retries stay manual.
async function deliver(reservation, kind, send, { force = false } = {}) {
  if (!reservation.email) return { skipped: true };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([
    kind, reservation.email, reservation.status, new Date(reservation.date).toISOString(),
    reservation.time, reservation.numberOfPeople
  ])).digest('hex');
  const attempt = crypto.randomUUID();
  const filter = { _id: reservation._id, status: reservation.status, date: reservation.date,
    time: reservation.time, numberOfPeople: reservation.numberOfPeople, email: reservation.email,
    $and: [{ $or: [{ 'clientNotification.state': { $ne: 'sending' } },
      { 'clientNotification.fingerprint': { $ne: fingerprint } },
      { 'clientNotification.attemptedAt': { $lt: new Date(Date.now() - 120000) } }] }] };
  if (!force) filter.$and.push({ $or: [{ 'clientNotification.fingerprint': { $ne: fingerprint } },
    { 'clientNotification.state': { $ne: 'sent' } }] });
  const state = { state: 'sending', kind, attempt, fingerprint, attemptedAt: new Date() };
  const claimed = await Reservation.findOneAndUpdate(filter, { $set: { clientNotification: state } }, { new: true });
  if (!claimed) return { skipped: true };
  reservation.clientNotification = state;
  const finish = async (status, code) => {
    const updated = { ...state, state: status, code, completedAt: new Date() };
    await Reservation.findOneAndUpdate({ _id: reservation._id, 'clientNotification.attempt': attempt },
      { $set: { clientNotification: updated } });
    reservation.clientNotification = updated;
  };
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) throw new Error('SMTP_NOT_CONFIGURED');
    await send();
    await finish('sent');
    return { sent: true };
  } catch (error) {
    await finish('failed', error.message === 'SMTP_NOT_CONFIGURED' ? 'SMTP_NOT_CONFIGURED' : 'EMAIL_SEND_FAILED');
    throw error;
  }
}

module.exports = { deliver };
