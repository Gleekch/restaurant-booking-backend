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
  transitive dependencies and was replaced. A user screenshot subsequently
  reported the same missing engine.io-client startup error under the UI.13 path.

## Desktop packaging follow-up (2026-09-30)

Distinct local candidate 2.4.3-ui.14, with physical node_modules and no dependency
version changes. Older release folders are preserved. No production deployment.

The afterPack gate now checks first-party startup files and the complete
mandatory socket.io-client dependency tree inside app.asar, including package
entry points and nested/hoisted resolution. It never resolves missing modules
from the development machine. Existing private-file checks remain enabled.
Nine regression tests cover the previously missing engine.io-client and parser,
missing entry files, optional dependencies, cycles and Windows paths.

Capacity test fixtures now use a fixed test clock so today's elapsed lunch slots
do not cause false failures. No availability business rule was changed.

- 388 Jest tests / 43 suites passed on September 30.
  Evidence: audit-artifacts/desktop-packaging-release-jest-20260930.json.
- Actual UI.14 Windows binary: 22 checks passed, including startup, authentication,
  reconnect, floor plans, booking priority, placement, deletion and finance guards.
  Evidence: audit-artifacts/portable-ui-release-hN5GwZ/summary.json.
  Tests use synthetic loopback data; productionTouched is false.
- app.asar SHA256:
  3253EE9CBBEFD1F0801B8DACFF4C866731D48E397E8DAA971871495E403509DE

Output: releases/2.4.3-ui.14/win-unpacked in the workspace. This is an unpacked
application: keep its complete folder, not the EXE alone. The matching backend
release still needs deployment before the new staff features can be used live.
The September 29 backup remains historical evidence, not a fresh September 30
snapshot. Deposits must remain disabled; no production records were modified.

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
