# Payment safety corrections - 2026-09-26

## Production preparation follow-up, 13:35 UTC

65 Jest + 32 financial regression tests now pass. Public deposit rules are
served by the backend, and private readiness diagnostics can verify SMTP
TLS/auth without sending email. Production activation refuses test keys,
missing signing secrets and invalid monetary configuration.
The updated site completed a further full Stripe TEST payment and refund flow.
The live account capability and live webhook configuration were read and
verified successfully. Render key/secret correspondence and actual delivery
still require verification; see PRODUCTION_ROLLOUT.md for the rollout gates.

## Latest local hardening and 2.4.2 verification

53 Jest tests and 32 financial regression tests pass after the last change.
13 additional integration checks pass with a real local replica set and two
backend instances, including concurrent capacity, authenticated realtime,
legacy bookings without deposit fields, and inert customer HTML in both UIs.
The packaged Electron 2.4.2 passed its isolated browser/runtime checks.

Two full hosted Stripe TEST Checkout journeys passed again with this portable
and the site reconciled onto current origin/main: cancellation before and after
staff approval each produced exactly one full refund. Repeated cancellation
did not issue another refund; the open app reflected the persisted state.
An expired unpaid Checkout stayed hidden. No live payment or customer email.

Socket authentication, payment activation guards, protected update fields,
HTML escaping, capacity transactions and dependency updates are local only.
Both npm audits report zero known vulnerabilities. The production backend
remains at 8928a09 with payments disabled. No commit, push or deployment.

Current portable: dist/security-2.4.2, version 2.4.2.
SHA256: 333071AA53A4C05788748DE5F8AE2F4567E651401FB216024ED5158DBA2068A9.
Application snapshot and local restore passed at 13:09 UTC: 1679 reservations
and 31 blocked services, exact document hashes and recreated indexes. Production
was read-only; the local restore process has stopped. Scheduled backups are
still not active. Live Stripe setup, real SMTP/TLS delivery and restaurant
installation still need validation. See the workspace report
SECURISATION_PRODUCTION_2026-09-26.md for evidence and the release gates.
The sections below are historical; their 2.4.1 counts and open-code warnings
describe earlier checks, not the current local source.

## End-to-end follow-up, same day

The complete isolated journey has now passed with hosted Stripe TEST Checkout,
genuine signed webhook delivery, real local MongoDB, captured local SMTP, and
the packaged Electron 2.4.1 application. Both cancellation before restaurant
approval and cancellation after approval produced exactly one full refund.

The owner clarified the required flow: hide unpaid online attempts; payment
changes the booking to pending, never automatically confirmed; the restaurant
then confirms it manually. The backend and site messages have been corrected.
Confirmation is conditional on the saved status/payment to avoid overwriting a
concurrent cancellation. Existing bookings were not migrated or modified.

Current tests: 28 Jest + 32 financial regressions, all passing; site build passes.
Detailed evidence and remaining limits are recorded in the workspace document
VALIDATION_PARCOURS_ARRHES_2026-09-26.md. The sections below describe the earlier
API-only verification and portable build, not the limits of this new E2E run.
Production remains at 8928a09 with payments disabled; no deployment performed.

Release prepared: 2.4.1. Local changes only; no push, deployment, activation,
database migration, or live transaction was performed.

## Eight reproduced failures corrected

1. Checkout payment uses compare-and-set on booking and deposit status. A
   concurrent cancellation cannot be overwritten by confirmation.
2. A late payment and its refund obligation are saved atomically. A failed
   refund attempt remains refund_pending and is resumed on webhook replay
   or by the reconciliation scheduler, including after the 24-hour boundary.
3. Terminal refund failures use refund_failed, never paid or refund_pending.
   Action-required and partial amounts use refund_review. Neither state starts
   another refund automatically.
4. Refund events trigger a fresh Stripe GET. A bank failure after initial
   success is recorded, while old events cannot restore stale financial state.
   A refundVersion compare-and-set protects concurrent lookups and updates.
5. Refunds must match the saved PaymentIntent, currency, and reservation
   metadata. Metadata alone cannot attach an unrelated payment to a booking.
6. Only an exact full amount can become refunded. Partial or inconsistent
   amounts require staff review, with the amount and Stripe state recorded.
7. The complete Checkout request is persisted before creating the session.
   Retries use identical parameters, including the expiration and return URLs.
   A one-minute minimum creation margin avoids Stripe's 30-minute minimum.
8. Desktop cancellation updates the whole reservation, including deposit and
   the open details dialog. Staff interfaces show failures/review explicitly;
   background reconciliation also broadcasts updated financial status.

Refund creation first retrieves a known refund, or searches by PaymentIntent
when a response was lost. Existing refunds are never recreated blindly. More
than one existing refund requires review instead of another financial operation.

## Verification

- 21 Jest tests: existing coverage plus model states and refund recovery.
- 32 isolated source-level regression tests: all original 23 audit cases and
  9 additional race, restart, legacy booking and frozen-parameter checks.
- JavaScript syntax checks and git diff --check pass.
- Stripe TEST: Checkout creation and retry both pass, same request accepted.
- Stripe TEST: 60 EUR fictitious payment succeeded and was fully refunded.
- Duplicate refund request returned the same refund; declined card rejected.

Test run identifiers (no live funds):

- auditRun: 6ce45647a3c2ec43610ef6f6
- PaymentIntent: pi_3UJgCkJpIgM6OUcH1zJNyFeq
- Refund: re_3UJgCkJpIgM6OUcH1ye21qgM

Commands from the repository root:

```powershell
node node_modules/jest/bin/jest.js --runInBand
npm run test:payments
```

The regression tests simulate persistence and Stripe responses. The separate
Stripe TEST check exercised real test APIs, not a complete browser payment with
a real MongoDB and webhook delivery. No email was sent during these checks.

## Portable build

Build completed successfully in a new directory, leaving 2.4.0 intact:

`dist/payment-safety-2.4.1/Au Murmure des Flots - Réservations 2.4.1.exe`

- Size: 70,358,069 bytes.
- SHA256: A443BCE74A23D70E164DB1F71C7AD51813B6CA0E01AD7AE63B19F7540CB7AEDB.
- Packaged desktop files exactly match the corrected sources.
- Packaged version is 2.4.1; dotenv and socket.io-client load in its Electron runtime.
- No server .env is in app.asar. The external desktop config contains only API_KEY.
- No interactive launch or visual end-to-end test on the restaurant computer.

## Before enabling deposits

Deploy the backend explicitly and install the new desktop build separately.
Keep DEPOSIT_ACTIVATION_CONFIRMED false until an isolated end-to-end test passes:
site -> Checkout -> signed webhook -> test database -> desktop -> cancellation
and refund. Check webhook subscriptions, test/live key separation, and Stripe
read/list/refund permissions. Do not point sandbox callbacks at the live database.

The production health endpoint still reports payments=disabled at commit
8928a09. This flag controls automatic deposit requests, not all authenticated
administrative financial routes. The public site's success URL alone still
is not proof of a persisted payment. These pre-existing activation concerns
are not certified as resolved by the eight corrections above.

New Reservation fields and financial statuses are additive. No existing
reservation was rewritten, removed, or migrated. Legacy records lacking the
version field remain compatible via an explicit null-or-zero comparison.
