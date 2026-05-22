const mongoose = require('mongoose');

const blockedServiceSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  service: { type: String, enum: ['midi', 'soir', 'all'], required: true },
  reason: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

blockedServiceSchema.index({ date: 1, service: 1 }, { unique: true });

module.exports = mongoose.model('BlockedService', blockedServiceSchema);
