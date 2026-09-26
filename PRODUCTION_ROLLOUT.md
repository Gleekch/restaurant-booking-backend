# Controlled rollout - 2026-09-26

Release 2.4.2. Preserve the existing MongoDB database and all bookings.
Do not restore a snapshot over production or run data cleanup during deployment.

## Verified before rollout

- Application snapshot: 1679 reservations and 31 blocked services, restored into
  a new local database with exact document hashes and recreated indexes.
- 65 Jest tests, 32 financial regression tests, 13 isolated integration checks.
- Hosted Stripe TEST Checkout -> signed webhook -> paid/pending booking ->
  packaged desktop -> staff approval -> public cancellation -> one full refund.
- The connected live account reports charges_enabled and payouts_enabled true,
  with no currently_due or past_due requirements.
- The live webhook is enabled at the backend /api/webhooks/stripe URL and
  subscribes to the four Checkout and three refund events handled by this code.

## Order

1. Keep DEPOSIT_ENABLED=false and DEPOSIT_ACTIVATION_CONFIRMED=false.
2. Deploy the backend first. Use Node >=22.12 <25 and the committed lockfile.
   MongoDB must be a replica set. Booking-day guards are additive; no destructive
   Reservation migration is required.
3. Check /api/health, private API and Socket.IO authentication, availability on
   closed/open dates, and /api/settings/deposit-policy before deploying the site.
4. Authenticated GET /api/settings/production-readiness?verifySmtp=1 checks the
   effective server settings and SMTP TLS/authentication WITHOUT sending mail.
   Its response contains flags and error codes, never credentials.
5. Deploy the site. It reads deposit rules from the backend and rechecks them
   before submission; VITE_DEPOSIT_ENABLED is no longer the source of truth.
6. Configure a live Stripe key in Render, preferably a restricted key whose
   Checkout and refund read/write permissions have been tested. Store its value
   only in STRIPE_SECRET_KEY, never in Git, chat, site or portable configuration.
   STRIPE_WEBHOOK_SECRET must belong to the verified LIVE destination.
7. Confirm the business policy with the owner. Prepared defaults are 6 guests,
   EUR 10 per guest, refundable when cancellation is at least 24 hours before.
   Do not change the policy for existing paid bookings without a separate review.
8. Install portable 2.4.2 on the restaurant PC and verify access and synchronization.
9. Only after these checks and explicit activation approval, set both activation
   flags true. Check genuine webhook delivery, app synchronization and monitoring.

Configuration names: DEPOSIT_MIN_PARTY, DEPOSIT_PER_PERSON_CENTS,
DEPOSIT_CANCELLATION_HOURS, DEPOSIT_CURRENCY=eur, PUBLIC_SITE_URL.
Production refuses activation with test keys, absent signing secret, or invalid
financial values. This checks configuration shape, not secret correspondence;
genuine signed live delivery still requires verification.

## Incident response

Stop NEW payments by disabling DEPOSIT_ENABLED. Keep webhooks and refund
reconciliation running for existing transactions. Inspect refund_pending,
refund_failed and refund_review; never force these states to paid/refunded.
Do not blindly roll back to code that lacks the new financial states. If a
rollback is needed, keep the site/backend API contract consistent.

The Atlas scheduled backup feature remains inactive. Keep exports private and
arrange recurring backups and retention separately. TEST success is not proof
of bank settlement, real payment permissions or successful live email delivery.
