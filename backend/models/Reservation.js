const mongoose = require('mongoose');
const crypto = require('crypto');

const reservationSchema = new mongoose.Schema({
  customerName: {
    type: String,
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: false
  },
  numberOfPeople: {
    type: Number,
    required: true,
    min: 1
  },
  date: {
    type: Date,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  specialRequests: {
    type: String,
    default: ''
  },
  source: {
    type: String,
    enum: ['website', 'mobile', 'phone', 'walk-in', 'desktop'],
    required: true
  },
  status: {
    type: String,
    enum: ['awaiting-payment', 'pending', 'confirmed', 'cancelled', 'completed', 'no-show'],
    default: 'pending'
  },
  deposit: {
    required: { type: Boolean, default: false },
    amountCents: { type: Number, default: 0 },
    perPersonCents: { type: Number, default: 0 },
    currency: { type: String, default: 'eur' },
    status: {
      type: String,
      enum: ['none', 'awaiting', 'paid', 'refunded', 'deducted', 'failed'],
      default: 'none'
    },
    stripeSessionId: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    deductedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null }
  },
  table: {
    type: String,
    default: null
  },
  notes: {
    type: String,
    default: ''
  },
  reminder24hSentAt: {
    type: Date,
    default: null
  },
  cancellationToken: {
    type: String,
    default: () => crypto.randomBytes(24).toString('hex')
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

reservationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Reservation', reservationSchema);