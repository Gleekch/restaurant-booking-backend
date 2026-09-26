const mongoose = require('mongoose');
const BookingDay = require('../models/BookingDay');
const { parseDateInput } = require('./capacityService');

async function withBookingTransaction(dates, operation) {
  const days = [...new Set(dates)].sort();
  for (const day of days) {
    parseDateInput(day);
    try {
      await BookingDay.updateOne({ _id: day }, { $setOnInsert: { version: 0 } }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      for (const day of days) {
        await BookingDay.updateOne({ _id: day }, { $inc: { version: 1 } }, { session });
      }
      result = await operation(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { withBookingTransaction };
