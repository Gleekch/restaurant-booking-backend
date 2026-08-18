const mongoose = require('mongoose');
require('dotenv').config();

const Reservation = require('../backend/models/Reservation');

async function ensureReservationIndexes() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI non configure');

  await mongoose.connect(uri);
  await Reservation.createIndexes();
  const indexes = await Reservation.collection.indexes();
  console.log('Index Reservation verifies:', indexes.map((index) => index.name).join(', '));
}

ensureReservationIndexes()
  .catch((error) => {
    console.error('Creation des index Reservation impossible:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
