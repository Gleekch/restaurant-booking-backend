const mongoose = require('mongoose');

// A shared write inside each transaction serializes capacity increases per day,
// including when multiple backend instances run during a deployment.
const schema = new mongoose.Schema({
  _id: String,
  version: { type: Number, default: 0 }
}, { versionKey: false });

module.exports = mongoose.model('BookingDay', schema);
