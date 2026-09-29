# Booking priority for table placement

## Scope

Local candidate 2.4.3-ui.13, based on cea0bf1 (full floor-plan release), itself
based on production network fix 058a19d. No production deployment in this change.

The requested order is the order in which reservations were taken, not guest
arrival time. Earlier bookings have priority for tables closest to the sea.
Placement stays manual: geometry is not treated as a sea-distance map and no
existing assignment is moved automatically.

- The private floor-plan API adds createdAt and bookingOrder, read-only.
- Priority uses the original creation timestamp within the selected service.
  Confirmation, payment, changes to time or guest count do not reset that date.
  Rank is recalculated among currently included bookings, not a permanent ID.
- Identical timestamps share a rank; IDs only stabilize display order.
- Missing/invalid creation dates are not inferred from updatedAt or ObjectId.
  Those bookings are shown last by default, with a manual-verification notice.
- The service list defaults to booking order and offers a meal-time sort.
  Changing this preference preserves table selection and unsaved properties.
- The list shows rank, creation date in Reunion time, meal time and assigned
  tables. Cards and details show the service rank alongside table attribution.
- Existing capacity, grouping, concurrent-edit and draft-preservation safeguards
  remain in place. No reservation schema migration or new arrival action.
- No payment enablement, confirmation, refund, accounting or closure changes.

## Local validation

- 379 Jest tests in 42 suites passed, including 14 new priority assertions/tests.
- Four browser profiles passed the priority workflow: Chrome PC, Android,
  WebKit iPhone and tablet. Synthetic data, loopback only; production inaccessible.
- Existing floor-plan UI suite passed on all four profiles.
- 26 deep regression scenarios passed on desktop and iPhone profiles.
- 11 local real-MongoDB checks passed, including creation-date projection,
  concurrency, persistence, exact reservation conservation and staff closures.
- Windows unpacked binary: 22 checks passed, including real IPC priority display,
  placements, persistence, authentication, logout and disabled financial actions.
  Evidence: audit-artifacts/portable-ui-release-EUsMud/summary.json in the workspace.
  Build uses physical node_modules; the initial junction-based build omitted
  transitive dependencies and was replaced, not distributed.

## Release prerequisites

The complete backup run production-preflight-2026-09-29T16-56-04-953Z passed
production-snapshot-export and isolated-restore: 1701 reservation documents,
33 blocked services and 8 booking days. Production was not modified.
Read-only inspection of this local snapshot found a valid createdAt value on all
1701 reservations; no historical-date backfill is needed for this snapshot.

Keep deposits disabled. Deploy the API and shared admin assets together before
distributing the matching desktop version. Old APIs remain supported but cannot
supply booking priority; the UI must not fabricate it. No UI.12 demo state or
synthetic floor plans may be imported into production.
