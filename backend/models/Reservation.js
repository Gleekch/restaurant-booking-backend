const mongoose = require('mongoose');
const crypto = require('crypto');

const scheduleSchema = new mongoose.Schema({
  date: { type: Date, required: true }, time: { type: String, required: true },
  numberOfPeople: { type: Number, required: true, min: 1 }
}, { _id: false });
const changeRequestSchema = new mongoose.Schema({
  requestId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], required: true },
  from: { type: scheduleSchema, required: true },
  proposed: { type: scheduleSchema, required: true },
  requestedAt: { type: Date, required: true },
  reviewedAt: Date,
  reviewedBy: String
}, { _id: false });

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
  bookingRequestKey: { type: String, default: null },
  clientNotification: {
    type: new mongoose.Schema({ state: { type: String, enum: ['sending', 'sent', 'failed'] },
      kind: String, attempt: String, fingerprint: String, attemptedAt: Date, completedAt: Date, code: String
    }, { _id: false }),
    default: undefined
  },
  bookingRequestFingerprint: { type: String, default: null },
  activeBookingKey: { type: String, default: null },
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
      enum: ['none', 'awaiting', 'paid', 'refund_pending', 'refund_failed', 'refund_review', 'refunded', 'deducted', 'failed'],
      default: 'none'
    },
    checkoutAttempt: { type: Number, default: 0, min: 0 },
    checkoutParameters: { type: mongoose.Schema.Types.Mixed, default: null },
    checkoutCheckedAt: { type: Date },
    checkoutReviewReason: { type: String },
    stripeSessionId: { type: String, default: null },
    stripeCheckoutUrl: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },
    stripeRefundId: { type: String, default: null },
    refundVersion: { type: Number, default: 0 },
    refundFailureReason: { type: String, default: null },
    refundStripeStatus: { type: String, default: null },
    refundAmountCents: { type: Number, default: 0 },
    paidAt: { type: Date, default: null },
    refundRequestedAt: { type: Date, default: null },
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
  changeRequests: { type: [changeRequestSchema], default: undefined },
  cancellationToken: {
    type: String,
    default: () => crypto.randomBytes(24).toString('hex')
  },
  anonymizedAt: {
    type: Date,
    default: null
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

reservationSchema.index(
  { bookingRequestKey: 1 },
  { unique: true, partialFilterExpression: { bookingRequestKey: { $type: 'string' } } }
);
reservationSchema.index(
  { activeBookingKey: 1 },
  { unique: true, partialFilterExpression: { activeBookingKey: { $type: 'string' } } }
);

module.exports = mongoose.model('Reservation', reservationSchema);
