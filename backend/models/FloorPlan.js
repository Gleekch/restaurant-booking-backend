const mongoose = require('mongoose');

// Separate documents: editing a room never migrates or overwrites a reservation.
const schema = new mongoose.Schema({
  _id: String,
  revision: { type: Number, required: true },
  layout: { type: mongoose.Schema.Types.Mixed, required: true },
  assignments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  updatedAt: { type: Date, required: true }
}, { versionKey: false, minimize: false });

module.exports = mongoose.model('FloorPlan', schema);
