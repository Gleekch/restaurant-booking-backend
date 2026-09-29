# Staff floor plans and reservation safety release

Prepared from production commit 058a19d. Its proxy configuration, CORS policy and
tests are unchanged. Desktop UI version: 2.4.3-ui.12.

## Scope

- Shared desktop/admin floor plan, terrace/interior zones, table assignments,
  reusable template, optimistic revision checks and network-response recovery.
- Admin Clients and Statistics views; removal of the direct refund button.
- Previously reviewed staff submission idempotency, closed-service enforcement,
  unified legacy availability, notification tracking/retry and reminder safety.
- Previously reviewed Checkout expiry/refund reconciliation protections.

No deposit activation or environment change. Financial controls remain disabled.
No migration or bulk rewrite of Reservation. Floor plans use a separate floorplans
collection. The added reservation notification/reconciliation fields are optional.
Demo reservations and demo table assignments must never be imported into production.
The validated 23-number catalog contains no invented capacities or positions.

## Validation before publishing

- 365 Jest tests, 42 suites; 36 isolated payment/webhook safety tests.
- Full floor UI flows on Chrome PC/Android and WebKit iPhone/tablet emulation.
- 26 deep regression checks on the integrated candidate.
- Real, fresh, loopback-only MongoDB replica set: persistence, two-client conflicts,
  template isolation, unchanged reservation/financial documents, cancellation
  detection, transactional staff idempotency and Sunday/Monday/Tuesday closures.
  No production database access or SMTP/Stripe delivery in these local tests.
- Original Windows candidate was validated by 21 executable checks and user tests.
  Mobile emulation is not a physical-device test at the restaurant.

## Release gate

Do not publish until a fresh complete application-database export and isolated
restore have both passed. An API reservation export alone is not sufficient.
Keep DEPOSIT_ENABLED and DEPOSIT_ACTIVATION_CONFIRMED false.
Fetch origin/main again and require a fast-forward from 058a19d; never force-push.

After publishing, require the expected /api/health commit, connected database and
disabled payments. Verify authenticated floor-plan reads, unauthenticated refusal,
matching admin assets, closure/20-cover wave rules and conservation of existing
reservation IDs. Do not create/cancel real reservations as a smoke test.

The public-site refresh fixes are in a separate repository and are not included
in this backend commit. Publish them separately after compatibility verification.

## Rollback

If the service fails after deployment, restore backend build 058a19d using the
normal deployment procedure. Keep all database collections/documents, including
floorplans, intact. Do not restore an old database snapshot over newer bookings.
Investigate any data discrepancy against the private backup before any data repair.
