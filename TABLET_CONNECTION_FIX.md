# Tablet and phone connection hotfix - 2026-09-26

## Cause and scope

- After the API key was removed from the admin page, the private API accepted
  Basic credentials but replied to unauthenticated browser fetches without a
  Basic challenge. Browser credentials cached for `/admin/` were not necessarily
  sent to `/api/`. Reproduced in isolated Chrome with a 401 and an offline badge.
- The WebKit test engine also threw during `valueAsDate` initialization, before
  reservation loading. The default date now uses a plain ISO input value and
  the restaurant's Reunion timezone, including around UTC midnight.
- Private API 401 responses now challenge with the same realm as the admin page.
  No API key or password is exposed to JavaScript/localStorage.
- A 401 displays a login-required message rather than a misleading network outage;
  a reload control is available. Browser fetches explicitly use same-origin
  credentials and no-store. Existing loaded data is not erased on failure.
- Only the manifest and two public install icons bypass authentication. Admin
  HTML, scripts/config and reservation data remain protected. Protected admin
  files have private/no-store caching; public metadata contains no customer data.

## Verification before deployment

- 72 Jest tests passed, including challenge, wrong/missing credentials, exact
  public metadata allowlist, protected admin config and private reservations.
- 32 payment/webhook/desktop regressions passed, without real payments.
- Isolated Chromium and WebKit at 390x844 and 1024x768: authenticated page and
  reservation fetch, displayed connected status, reload, explicit reconnect,
  no runtime errors or horizontal page overflow. One synthetic booking only.
- Existing production admin credentials were checked in memory through read-only
  HTTP requests; `/admin/` and authenticated `/api/reservations` both returned 200.
- Workspace evidence: `audit-artifacts/admin-connection-after.json` and local-only
  synthetic screenshots. No production customer data saved in screenshots/logs.

No reservation model, business rule, payment/refund route, database or payment
activation setting is changed. The public-site terms draft is not part of this fix.
After Render deploys this commit, verify the health commit and the real mobile
admin page again, with all mutation methods blocked in the test browser.

References:
- https://www.rfc-editor.org/rfc/rfc7617#section-2.2
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/valueAsDate
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/manifest
