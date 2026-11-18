# Lead Atlas 1.9.0 — instant dashboard and a signed-in home redirect

This PR makes the workspace feel instant on a return visit and stops signed-in users from
landing on the marketing home page.

It is stacked on **PR #1** (`feat/outreach-dashboard-stable-leads`) while that PR is open, so
the 1.8.0 work is not duplicated. Merge PR #1 first, or let GitHub retarget this PR to
`main` after #1 lands.

## The two problems

1. **The dashboard took a visible moment to show data.** After sign-in, `app.js` waited for
   config, then the profile, then scripts, then the library, then counts and activity — all
   in sequence — before the numbers appeared.
2. **A signed-in visit to the site always landed on the marketing home page.** The home page
   had no idea a session was stored, so it painted the landing page and left the user to
   click through again.

## What changed

### 1. A signed-in visit goes straight to the workspace

`public/session-guard.js` is a tiny, dependency-free script loaded in the `<head>` of
`public/index.html`. Before the home page paints, it checks the stored Supabase session:

- Both an access token and a refresh token must be present.
- Only `/` and `/index.html` are redirected; `/pricing.html`, `/how-it-works.html`,
  `/auth.html`, and `/app.html` are never touched.
- Malformed storage or blocked navigation leaves the marketing page usable.

The redirect target is `/app.html#dashboard`, so the workspace opens on the overview.

### 2. The dashboard paints from the last visit, then refreshes

`public/boot-cache-core.js` provides small, versioned snapshots:

- **Dashboard** — recent reports, headline stats, and up to 5,000 outreach-activity rows,
  stored under `leadAtlas.dashboardCache.v1.<user-id>`. Capped at 200 reports and 5,000
  activity rows.
- **Server config** — stored under `leadAtlas.config.v1` so Supabase can be configured
  before the stored session is read.

On boot, `enterApp()` now:

1. Reads the snapshot for the signed-in account.
2. Reveals the workspace shell, paints the dashboard and library, and opens the deep-linked
   view immediately.
3. Refreshes profile, scripts, and library **together** through one `Promise.allSettled`.
4. Fetches reports, three counts, and activity in one `Promise.allSettled` inside
   `loadLibrary()` instead of sequentially.

If a refresh fails, the cached copy stays on screen rather than being replaced with zeros or
an empty state. A first visit, or a visit after clearing site data, waits for the live reads
exactly as before.

### 3. The cache is kept fresh and stays private

- The dashboard snapshot is rewritten after a successful library load.
- Marking a saved lead as contacted updates the snapshot too.
- Identical writes are skipped.
- The snapshot is removed on sign-out and on a `SIGNED_OUT` event, and the in-memory
  reports/activity/analytics are cleared with it.
- Corrupt JSON, outdated versions, missing arrays, and unusable rows are rejected/dropped by
  the pure cache helpers.

## Files changed

| File | Change |
| --- | --- |
| `public/boot-cache-core.js` | New: versioned, validated dashboard/config snapshot helpers and caps |
| `public/session-guard.js` | New: blocking signed-in home redirect |
| `public/index.html` | Loads the guard in `<head>` |
| `public/app.js` | Early cached paint, parallel boot refresh, single-pass library fetch, cache writes/clears |
| `test/boot-cache-core.test.js` | New: round-trip, versioning, caps, corrupt data, config validation |
| `test/session-guard.test.js` | New: `vm` sandbox tests for stored, missing, malformed, and blocked sessions |
| `README.md` | Documents the redirect, cache, privacy notes, tests, and file map |
| `TASKS.md` | B1–B7 progress |
| `MEMORY.md` | Session state and release history |
| `package.json` | Version 1.8.0 → 1.9.0 |

Also fixes a small related bug: `accountAnalyticsLabel()` referenced a removed
`accountName()` helper. It now calls `accountDisplayName()`, so rebuilding analytics no
longer throws when the profile has no full name or company — a path the cached dashboard
uses on every boot.

No Supabase schema, RLS, CSP, API-shape, or dependency changes.

## Verification

- `npm test` — **310/310 passing** (290 existing + 20 new).
- `node --check` — green on `app.js`, `boot-cache-core.js`, `session-guard.js`, and both new
  test files.
- Browser smoke against the local app: with a stored session seeded on the origin, opening
  `/` did not remain on the marketing page — it went through `/app.html#dashboard`. The fake
  token was then rejected by Supabase, the app returned to the sign-in page, and the stored
  session plus dashboard cache were removed, confirming the sign-out privacy rule.

## How to try it

1. Sign in normally and let the dashboard load once.
2. Reload the workspace and switch away/back: the last counts and recent reports should be
   there immediately while the refresh runs.
3. Open the bare site URL (`/`) in the same browser: it should land on the dashboard, not
   the marketing page.
4. Sign out: the cached dashboard should be gone, and the next visit should show the
   marketing page again.

## Notes and limits

- The cache is a first-paint optimisation, not the source of truth. Supabase still wins as
  soon as the background refresh returns.
- A first visit after clearing site data is still a normal network load. This is expected.
- The cache is per account and is never shared between users on the same browser.
- To roll back, revert the `feat/instant-dashboard-session` commit; no database or
  deployment configuration needs undoing.
