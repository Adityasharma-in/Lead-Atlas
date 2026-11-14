# MEMORY.md — Session state

## Last Updated: 2026-11-13

## Current Phase: SHIP — live on Vercel at https://lead-atlas-ochre.vercel.app; Supabase email redirect allowlist pending

## Last Completed Task: Instant workspace boot and signed-in home redirect (2026-11-13)

## Next Task: Merge PR #1 (`feat/outreach-dashboard-stable-leads`), then PR #2
(`feat/instant-dashboard-session`, stacked on PR #1), and let the GitHub-connected Vercel
project build `main`. In Supabase **Authentication → URL Configuration**, set the Site URL
to `https://lead-atlas-ochre.vercel.app` and add
`https://lead-atlas-ochre.vercel.app/auth.html` plus
`https://lead-atlas-ochre.vercel.app/**` to Redirect URLs, then test confirmation,
magic-link, and password-recovery emails on the live domain.

## Instant workspace boot and signed-in home redirect (2026-11-13)
- Goal: a signed-in visit must not flash the marketing home page, and the dashboard must
  paint without waiting for visible Supabase round trips.
- Guard: `public/session-guard.js` is a tiny classic script loaded in `index.html`’s
  `<head>`. It redirects `/` and `/index.html` to `/app.html#dashboard` only when both
  access and refresh tokens exist; malformed storage or blocked navigation leaves the
  marketing page usable. Other public pages and `auth.html` are never touched.
- Cache: `public/boot-cache-core.js` owns versioned, account-scoped snapshots. The dashboard
  key is `leadAtlas.dashboardCache.v1.<user-id>` (recent reports, stats, up to 5,000
  activity rows); the public server config is `leadAtlas.config.v1`. Both reject corrupt or
  outdated entries and drop unusable rows; dashboard caps are 200 reports / 5,000 activity
  rows.
- Boot: `enterApp()` hydrates the snapshot, reveals the shell, paints the dashboard and
  library, and opens the deep-linked view before any request. Profile, scripts and library
  then refresh together through one `Promise.allSettled`; `loadLibrary()` fetches reports,
  three counts and activity in one `Promise.allSettled` instead of sequentially. A failed
  refresh keeps the cached copy visible.
- Invalidation: the dashboard cache is rewritten after a successful library load and after
  an outreach mark (`recordSavedLeadActivity`), skips identical writes, and is removed on
  sign-out and `SIGNED_OUT`. Sign-out also clears in-memory reports, activity and analytics.
- Verification: `npm test` 310/310 (new `test/boot-cache-core.test.js` and
  `test/session-guard.test.js`), `node --check` green on the touched modules. Cache
  parse/serialize/version/cap/corruption paths and the guard’s stored, missing, malformed
  and blocked-storage cases are covered.
- Version: 1.8.0 → 1.9.0. No schema, RLS, CSP, API-shape or dependency changes.
- PR: branch `feat/instant-dashboard-session`; PR #2
  (https://github.com/Adityasharma-in/Lead-Atlas/pull/2) is stacked on
  `feat/outreach-dashboard-stable-leads` (PR #1) while PR #1 is open, so the 1.8.0 work is
  not duplicated.

## Outreach dashboard, accurate leads, stable indexes, review gate and filter repair (2026-11-13)
- Goal: show daily and monthly outreach performance, remove scrape/import mismatches and
  duplicates, tie each lead number to its contact permanently, exclude low-review fluff at
  setup, and reduce filtering/sorting to a tested, useful set.
- Identity: `public/lead-identity-core.js` is now the single identity layer for the scrape
  and import paths. It normalizes place IDs (case-insensitive), phones (North American
  `+1` and trunk-zero variants), emails, and name + address (address required, placeholder
  names ignored), then groups duplicates with union-find. Fixed-point passes catch rows
  that only become duplicates after a merge fills a missing identity field. Stable IDs
  prefer the lowercased place ID, otherwise a 64-bit content hash over contact fields,
  postal code, coordinates and the prior id.
- Numbering: each lead stores its own `index` after dedupe and quality filtering. The
  report table, sorting, filtering, pagination, saved payloads and legacy rows all use
  `lead.index`; row position is never the lead number.
- Scrape/import: both paths share the identity and merge code. Merged leads fill missing
  fields without mixing businesses, then recompute derived fields so phone, domain,
  website flag and Maps URL cannot go stale. Rating and review count are taken as one
  fresh snapshot from the winning row.
- Quality gate: setup has a separate **Minimum reviews** control (`#minReviews`, default
  10) beside **Minimum rating**. Apify has no review-count filter, so the server validates
  the value, includes it in the brief, sends no unsupported Actor field, and filters after
  normalization. Empty/`all`/`any` means no gate; omitted input gets 10; junk values are
  rejected. The filtered count and reasons appear in the post-scan notice.
- Analytics: `public/analytics-core.js` aggregates saved leads by local calendar day and
  month. It reports reached today with a yesterday comparison, a 14-day series, monthly
  leads/reached/to-call totals split by scan, import and unfiled, and the account label.
  `contacted_at` drives day/month reached counts; status-only contacted rows count in the
  lifetime total only. `public/app.js` fetches saved leads in pages and recomputes locally
  when a lead is marked or a report is saved/deleted.
- Filter repair: `public/report-core.js` owns search, website, contact, outreach, rating
  and review filters plus five sorts (best rated, lowest rated, most reviewed, name A–Z,
  last contacted), deterministic tie-breaks and clamped pagination. The duplicate outreach
  select was removed; the tally chips are the outreach filter. Every change resets to page
  one.
- Verification: `npm test` 290/290. New `test/lead-identity-core.test.js`,
  `test/report-core.test.js` and `test/analytics-core.test.js`; extended import, leads,
  validation and server tests for stable IDs, reorder/import stability, bridged duplicates,
  review gates and config shape. `node --check` green on all touched modules. Static
  390 px and 1280 px iframe smoke found no horizontal overflow, analytics visible, review
  controls present, and no `#filterOutreach`.
- Version: 1.7.0 → 1.8.0. No Supabase schema, RLS, CSP or API-shape changes; the
  call-status marker work is preserved.

## Call-status markers on phone numbers (2026-11-13)
- Goal: on a phone, tapping a lead's number opens the dialer; the operator needed to see
  which lead had already been called when they returned to the site.
- Model: reused the outreach ledger instead of adding a schema field. Tapping a `tel:`
  phone link on a `To contact` lead writes `OUTREACH.CONTACTED` with a timestamp
  synchronously, then refreshes the table/drawer after 120 ms so the native dialer handoff
  is not interrupted. `visibilitychange` / `pageshow` refresh covers the return trip.
- Marker: `CALL_MARK` in `public/outreach-core.js` maps `To contact` → green dot,
  `Reached out` → green tick, and `Do not contact` → orange stop. DNC taps do not change
  status; a second tap on a called lead does not replace `contactedAt`.
- Surfaces: report table/cards and the drawer contact book both use `callMarkHtml()` with
  `role="img"` plus `aria-label`/`title`, and phone links carry the call state in their
  title. Phone rows get a 32 px tap target at mobile widths.
- Persistence: ledger key `leadAtlas.outreach.v1`; saved reports continue to sync through
  the existing `syncSavedLead()` path, and imports restore marks via `hydrateOutreach()`.
- Verification: 390 px and 1280 px Playwright runs with a fake Supabase session/API covered
  dot → tick, drawer taps, reload/re-import persistence, original timestamp preservation,
  DNC blocking, no overflow, and no console/page errors. `npm test` 199/199.
- Version: 1.6.1 → 1.7.0.

## Vercel deployment (2026-11-05)
- Goal: deploy the working app — multipage public site, account-only workspace, Supabase
  library, account-bound Apify token, and call scripts — to a public URL without exposing
  secrets.
- Project: `lead-atlas` in `adityatek14-4344` (`prj_uqn2DQRBOEvxbNo0p5BHqA5X60IR`), Express
  preset, root `.`, no Build Command or Output Directory, Node.js 26.x. Production alias
  `https://lead-atlas-ochre.vercel.app`; tested preview
  `https://lead-atlas-grauitu43-adityatek14-4344.vercel.app`; promoted production
  deployment `https://lead-atlas-2atudagdj-adityatek14-4344.vercel.app`.
- Serverless adapter: `src/server.js` default-exports a lazy `handleRequest` that builds one
  Express app on the first request with `canRestart: false`; the named `createApp` export
  remains for local use and tests. The previous default export was the factory itself,
  which made every function request time out after 300s.
- Static/CDN: `public/**` is served by Vercel; `express.static()` is ignored. `vercel.json`
  rewrites `/` to `/index.html` and sets security headers plus CSP; function responses use
  the exact configured Supabase origin, while static HTML uses a Supabase wildcard CSP.
- Environment variables for Production, Preview, and Development: `SUPABASE_URL`,
  `SUPABASE_ANON_KEY` (non-sensitive because the anon key is public by design), and
  `SELF_UPDATE=off` (serverless has no git clone or restartable process). No service-role
  key is present anywhere.
- `.vercelignore` excludes `.env*`, `.vercel`, tests, docs, and node_modules. `.gitignore`
  ignores `.env.*` but explicitly keeps `.env.example`; `.vercel/` and `.env.local` are
  ignored. `vercel link` created `.env.local` with a short-lived OIDC token; it is
  gitignored and must never be committed.
- Deployment protection disabled with
  `vercel project protection disable lead-atlas --sso`; without it every route redirected
  to `vercel.com/sso-api`.
- Verification: preview and production passed `/`, `/index.html`, `/app.html`, `/auth.html`,
  `/pricing.html`, `/how-it-works.html`, CSS/JS assets, `/api/health`, `/api/config`,
  `/api/version`, and `/api/runs` (401 `APIFY_KEY_REQUIRED` without a token), plus CSP and
  security headers. A Playwright pass covered a real password sign-in, workspace version
  1.6.0, the **Saved to account** badge, a 390 px workspace and script dialog with no
  overflow, the phone landing page, and zero console errors. `/api/health` had one
  transient connection reset on the first preview cold start, then answered 3/3 times.
- Live Supabase: `script_libraries` now exists; the test account has one empty library row
  with 0 scripts and no `active_id`. A cross-device check created a temporary script in
  session A, saw it in an independent session B, deleted it in A, and saw the deletion in
  B. The temporary script was removed. No paid Apify scan was started.
- Git state: all source changes remain uncommitted. The live deployment was built from the
  local working tree with `vercel deploy`; the GitHub-connected project still points at
  commit `df898b2`, which contains the old server default export. Commit and push before
  relying on a Git-triggered deployment.

## Account-backed call scripts (2026-11-05)
- Goal: scripts previously lived only in `localStorage`, so they did not follow the
  account. They now persist in Supabase while keeping instant local editing.
- Schema: idempotent `public.script_libraries` with `user_id uuid primary key`, `active_id
  text`, `scripts jsonb not null default '[]'`, timestamps, array and active-id length
  checks, the shared `touch_updated_at()` trigger, and owner-only select/insert/update/
  delete RLS policies.
- Model: one row per account holding the whole normalized script array plus the default
  script, so a create/edit/delete/default change is one atomic full-library write. The
  newest full-library write wins; there is no per-script merge.
- Pure helpers in `public/scripts-core.js` (+ `test/scripts-core.test.js`, now 17 tests):
  `scriptStoreFromRow`, `scriptLibraryRow`, `isMissingScriptTableError`. Script text goes
  only to the account's Supabase project, never to Apify or the local server.
- Browser flow: `enterApp()` awaits `loadAccountProfile()` then `loadAccountScripts()`.
  The cache key is account-scoped (`leadAtlas.scripts.v1.<user-id>`) with a `.dirty`
  marker. Edits write the local cache first, then debounce a cloud upsert (update, insert
  when absent, retry update on duplicate key) and flush when the library closes or the
  user signs out. A missing table or failed write keeps the local library usable, shows
  **Local only**, and offers an actionable schema message.
- Legacy `leadAtlas.scripts.v1` is migrated once when the account has no row, then removed;
  a dirty cache wins over the cloud copy so a previously failed upload is retried.
- Sign-out flushes pending work, then resets scripts in memory and removes the old
  unscoped key; the account row remains for the next sign-in.
- Verification: `node --check` on all nine `public/*.js` files; full suite 198/198 green.
  A Playwright harness with a fake Supabase API exercised the real `app.js` and client:
  legacy migration, create/edit/default sync, close and sign-out flushes, reload, a fresh
  browser context loading the account row, the **Saved to account** badge at 390 px with no
  dialog overflow, and the missing-table fallback to **Local only**. Live Supabase still
  needs the schema run before the real cross-device check.
- Version: 1.5.0 → 1.6.0 (new feature).

## Inline call scripts at the bottom of leads (2026-11-07)
- Goal: the saved call script should be readable at the bottom of the extracted leads
  without opening a dialog or clicking a button.
- Report: `#reportScriptSection` sits after the pager in `report-body`. It shows the
  active/default script filled with the report’s niche and location, in a two-column
  editorial panel (label/title/note on the left, paper reading surface on the right).
  Below 820 px it stacks. An empty library shows guidance text, not a button.
- Lead drawer: `#drawerScriptSection` sits after **At a glance** and shows the same script
  filled with the open lead’s name, category, city, address, phone, email, website, niche,
  and location. Copy/outreach still live in the call-sheet dialog opened from the existing
  top action.
- Rendering: `renderReportScript()` and `renderDrawerScript(lead)` live in `app.js` and are
  called from `renderScriptChip()` (so live edits and default changes update the panels),
  `renderReport()` (report query changes), and `openLead()` (per-lead details). Both set
  text with `textContent`, never HTML.
- Verification: visual browser pass at desktop widths with real report/table styling and a
  548 px drawer preview; `node --check` on `public/app.js`; `npm test` 198/198 green.
- Version: 1.6.0 → 1.6.1 (refinement).

## Multipage site + account-only workspace (2026-11-05)
- Goal: turn the one long document into a real multipage site, gate the workspace behind
  auth, add visual/interaction polish, and keep every surface usable at phone widths.
- Pages: `index.html` (home), `how-it-works.html` (field method), `pricing.html` (pricing
  + FAQ), `auth.html` (sign in/create/recovery), `app.html` (account-only workspace with
  report and dialogs). The public pages share the marketing nav/footer via `site.js`.
- Auth handoff: signed-out `app.html` visits redirect to `auth.html?mode=signin` and store
  the intended workspace URL in `leadAtlas.authNext`; `auth-page.js` reads it once after
  sign-in, clears it, and returns to that view. Sign-out returns to the public home and
  leaves `leadAtlas.siteNotice` for `site.js` to show as a dismissible notice.
- Workspace routing: `app.js` owns `#dashboard`, `#library`, `#setup`, `#report`, `#data`
  and `#progress`, syncs `document.title`, and handles both `hashchange` and `popstate` so
  browser back/forward works. Existing setup/report/data IDs were preserved.
- Phone nav: a five-item bottom bar (Overview, Scan, Library, Data, More) appears at phone
  widths; More opens the account/tools sidebar over a scrim. Desktop keeps the sidebar.
- Fixes: removed the stale `#viewAuth hidden` wrapper that blanked `auth.html`, restored
  accidentally dropped `viewDashboard`/`viewLibrary` element-cache entries, made
  `#bottomLibraryCount` hide at zero, and moved body classes to static
  `is-landing`/`is-auth`/`is-app` so backgrounds paint before JS.
- Verification: desktop plus 390/360/320 px across home, how-it-works, pricing, auth and
  workspace views; no horizontal overflow, deep links and back/forward work, bottom nav and
  key dialogs fit. Signed-out `app.html#library` returns to the auth page with the right
  notice. `node --check` passes; `npm test` 196 green. Version bumped 1.4.0 → 1.5.0.
- Pending manual: run `supabase/schema.sql`; add `/auth.html` or `/**` to Supabase redirect
  URLs; test a real confirmation/magic/recovery email and a live cross-device key load.

## Account-bound Apify key (2026-11-05)
- Goal: the Apify token a user saves must live in Supabase with that account, not only in
  one browser's `localStorage`.
- Schema: idempotent `alter table public.profiles add column if not exists apify_token
  text` plus a column comment. The existing owner-only `profiles` RLS select/insert/update
  policies already restrict the column; no new policies or public exposure.
- Pure rules in `public/account-core.js` (+ 7 tests in `test/account-core.test.js`):
  `normalizeApifyToken`, `isMissingTokenColumnError`, `resolveAccountToken`. Precedence:
  account profile token wins; a legacy browser token is migrated once when the account has
  none; a missing column or unreachable profile falls back to the browser copy without
  blocking scans.
- Browser flow: `enterApp()` awaits `loadAccountProfile()` before validating the key.
  `profiles.select` now asks for `full_name,email,company,apify_token`; a missing-column
  response triggers an actionable toast and a fallback profile read. Saving a key validates
  it with Apify first, then `saveTokenToAccount()` updates the profile row (inserts one if
  the account predates the signup trigger), then caches in `localStorage` and marks the key
  connected. If the Supabase write fails, the dialog stays open with a clear message — the
  key is not presented as saved.
- **Forget key** now nulls `profiles.apify_token` first, then clears the browser cache; if
  the account write fails, the key is kept and the toast says so. Sign-out clears the
  browser cache only, so the account copy is waiting on the next sign-in.
- Copy: key dialog/privacy note, dashboard card, FAQ, landing key note, README,
  `docs/SUPABASE-SETUP.md` and AGENTS now describe account storage. Version 1.3.0 → 1.4.0.
- Verification: `npm test` 196 green; `node --check` passes for `app.js`,
  `account-core.js` and `supabase-client.js`. Live Supabase project check returned
  `42703 column profiles.apify_token does not exist` on 2026-11-05, confirming K7 (schema
  rerun) is still required before end-to-end use.

## Phone responsiveness + touch polish (2026-11-04)
- Goal: make every surface usable at phone widths without touching desktop behavior,
  starting from a clipped call-sheet screenshot.
- Overflow root causes: long unbreakable lead names expanded flex/grid children. Fixed
  with `min-width: 0` on `.drawer-head > div` / `.call-sheet-head > div`, `flex: none` on
  the close buttons, and `overflow-wrap: anywhere` on names, addresses and call-sheet copy.
  The script workspace used a bare `1fr` column, which let the sidebar force 407 px of
  width; it is now `minmax(0, 1fr)` with `min-width: 0` on the sidebar and editor.
- Mobile layout: report filters lay out 2+2+1 at ≤430 px instead of five stacked rows;
  dashboard stats are 2×2 at ≤560 px; the landing mobile menu and auth view were checked
  unchanged.
- Touch targets: script tools 32 px, drawer Save note 40 px, library CSV/JSON and Open
  report ≥32 px, library filters ≥34 px, script footer copy 8 px. Dashboard greeting gains
  `word-spacing: 0.06em` so the negative display tracking stops collapsing its spaces.
- Toasts inside a modal are moved into the topmost `<dialog>` by `syncDialogState()`.
  On phones they now sit above the full-screen action bars: script dialog `+104px`,
  call sheet `+140px` (safe-area aware), clearing the buttons by 10–24 px.
- Verification: Playwright at 390, 360 and 320 px over landing, auth, dashboard, library,
  report, lead drawer, call sheet, script library, save-report and key dialogs plus the
  landing menu. `scrollWidth === clientWidth` everywhere, close buttons inside the
  viewport, no clipped dialogs, no console errors. `node --check public/app.js` and
  `public/supabase-client.js` pass; `npm test` 189 green.
- Cleanup: temporary Supabase fixture report `25f6c682…` (three `mobile-audit-*` leads)
  deleted; repo-root Playwright screenshots/`.playwright-cli` removed. Temporary test
  account `leadatlase1p0wekp@fldubai.com` still exists for later dashboard cleanup.
- Not covered: fresh signup retest is still blocked by Supabase email rate limiting
  (`429 Too many emails sent`); first real account creation remains manual.

## Premium landing, Supabase auth, workspace + saved lead library (2026-11-04)
- Goal: turn the local scanner into a usable product surface — public landing page,
  account sign-in, workspace dashboard, and a lead library that survives a browser reset
  and can be reopened later.
- Server: `src/env.js` reads `.env` once at startup; `src/supabase.js` validates the
  project URL/key, extracts the project ref, and supplies CSP connect sources. `createApp`
  accepts an injected `supabase` config for tests. `/api/config` now returns
  `supabase: {configured, url, anonKey, projectRef}`. The anon key is public by design;
  the service_role key is never used.
- CSP: `buildContentSecurityPolicy(extraConnectSources)` adds only the configured Supabase
  origin to `connect-src`; `script-src` stays `'self'`.
- Schema: `supabase/schema.sql` creates `profiles`, `lead_reports`, `leads`, indexes,
  `updated_at` triggers, the `handle_new_user()` profile bootstrap, and owner-only RLS
  policies. `leads.payload` keeps the full normalized lead; `lead_key` is unique per report.
- Browser client: `public/supabase-client.js` is dependency-free. It implements GoTrue
  signup/signin/OTP/recovery/refresh/logout, PKCE with localStorage verifier, session
  persistence under `leadAtlas.supabaseSession.v1`, redirect handling for hash tokens and
  `?code=`, and PostgREST select/insert/update/delete/count helpers. Session expiry is
  stored once in milliseconds; fresh responses use the relative `expires_in` lifetime so a
  skewed system clock cannot cause an immediate refresh loop. Refresh is single-flight per
  tab and serialized across tabs with the Web Locks API; a losing tab adopts the newer
  stored session instead of signing out, and transient network/5xx failures keep the local
  session for a later retry.
- UI (original single-document layout; split into five pages on 2026-11-05): a landing
  view, auth view, `#appShell`, `#viewDashboard`, `#viewLibrary`, and
  `#saveReportDialog`. `public/workspace.css` (linked after `styles.css`) owns the
  workspace surfaces; existing report/setup/data views and IDs are intact.
- App: the original boot picked landing, auth, or app from the Supabase session. The
  current `app.html` boot is account-only and redirects signed-out visitors to `auth.html`.
  `enterApp()` loads the profile/library, validates the stored Apify key, resumes an active
  run, and checks updates. Dashboard shows report/lead/contacted/DNC/month counts, recent
  reports, key status, scripts, and outreach progress. Library supports search, source
  filters, open, delete (with undo), and CSV/JSON export.
- Save flow: any scan or imported report can be saved with a name and notes. Re-saving
  updates the same `lead_reports` row. Leads are inserted in 250-row batches with a stable
  `lead_key`; reopening reconstructs the report from `payload` and DB outreach fields.
- Outreach: `setOutreachStatus` still mirrors the local ledger, then `syncSavedLead()` writes
  `outreach_status`, `outreach_note`, `contacted_at`, and the updated payload to Supabase
  for saved reports. Failures keep the local mark and show a toast. Report summaries are
  debounced back to `lead_reports.summary`.
- Verification: `npm test` 189 green (new `test/supabase.test.js`, server CSP/config
  assertions, and session persistence/refresh regression tests). Syntax checks pass for
  `app.js` and `supabase-client.js`. Headless Chrome checks at 1440 px and 390 px covered
  landing, auth, dashboard, library, and save dialog; no horizontal overflow, no landing
  console errors. Live auth checks covered confirmation, password sign-in, reload, two-tab
  sign-out, and simultaneous token refresh. Test data cleared.
- Docs: `docs/SUPABASE-SETUP.md` covers project creation, schema, credentials, redirect
  URLs, email confirmation, verification queries, and troubleshooting. README, AGENTS,
  TASKS and MEMORY updated. App version 1.2.0 → 1.3.0.
- Remaining manual: create the user's own account (email confirmation is on), then save one
  report end to end. The project, schema, `.env`, redirect URLs, and server are configured;
  `/api/config` reports `configured: true`. A temporary test account was used for live auth
  checks and can be removed from the Supabase dashboard.

## Cold-call script library + call sheet (2026-11-03)
- Goal: keep the words for a cold call inside Lead Atlas so the user never leaves the
  report to find a script in WhatsApp or a notes app.
- New pure module `public/scripts-core.js` + `test/scripts-core.test.js` (15 tests):
  normalization, limits, store ops, active/default selection, placeholder fill,
  JSON/array/text import, merge, export payload.
- Storage key exactly `leadAtlas.scripts.v1`; store shape
  `{version:1, activeId, scripts:[{id,title,body,createdAt,updatedAt}]}`. Browser-local
  only, like `leadAtlas.outreach.v1`. Limits: 60 scripts, 80-char titles, 12,000-char
  bodies, 2 MB imports.
- UI: header **Scripts** chip, report toolbar **Call sheet**, lead drawer **Read call
  script**; library dialog with search, autosave editor, starter sample, duplicate,
  delete + undo, explicit **Use by default**, JSON export/import, `.txt`/`.md` import;
  call-sheet dialog with placeholders, script switcher, copy, edit, mark reached out.
- Placeholders: `{business}`, `{category}`, `{city}`, `{address}`, `{phone}`, `{email}`,
  `{website}`, `{niche}`, `{location}`. Lead fields win, then report query; missing values
  use natural fallbacks; unknown tokens stay visible.
- Changing the script inside the call sheet only changes that call sheet. The saved
  default changes only via **Use by default** (or when creating a new script).
- Toasts: `syncDialogState()` moves `#toastRegion` into the topmost open `<dialog>` so it
  renders above modal backdrops; close events move it back (lead → call sheet → body).
- Verified in Chromium 2026-11-03: starter creation, autosave + reload persistence,
  duplicate/delete/undo, search, explicit default, lead placeholder fill, call-sheet
  switch without default change, mark reached out (drawer + ledger), corrupt storage boot,
  corrupt/oversized import errors, storage-quota failure, toast placement in stacked
  dialogs. Test data cleared; 170 tests green.
- Docs: `docs/CALL-SCRIPTS.md`, README section + privacy/limitations/troubleshooting,
  TASKS C1–C7. Version bumped 1.1.0 → 1.2.0.

## Rating column click-to-sort (2026-10-31)
- `public/app.js`: new sort value `rating-asc` = lowest rated first, unrated leads last.
  `syncRatingSort()` updates `#ratingHeader[aria-sort]`, the `.is-active`/`.is-asc`
  classes and the Sort select. Clicking `#sortRating` toggles `rating` ↔ `rating-asc`;
  from any other sort the first click lands on high→low.
- `public/index.html`: Rating `<th>` wraps a button with an `i-chevron`; Sort select has
  "Best rated" and "Lowest rated". `public/styles.css`: `.sort-toggle` states + arrow
  rotation (orange when active).
- Verified in the browser on an imported 6-lead CSV: 4.9 → 2.7 with unrated last, second
  click reverses, another sort clears `aria-sort` to `none`. 155 tests green.

## App versioning (V1–V3) — verified 2026-10-27
- Scheme (AGENTS.md house rule): patch uncapped for fixes (`1.1.9 → 1.1.11`), minor for
  features capped at 9 — passing 9 rolls to major (`1.9.4 → 2.0.0`), major resets minor+patch.
- Single source of truth: `package.json` `version`. Bump with `npm run bump:patch|minor|major`
  (`scripts/bump-version.js`), never by hand; commit the bump with the change itself.
- `src/version.js` — pure `parseVersion`/`formatVersion`/`bumpVersion` + `APP_VERSION`
  (readFileSync of package.json at module load; throws if missing/invalid).
- Exposed as: `/api/health` → `version`, `/api/config` + `/api/version` → `appVersion`
  (additive; `/api/version` includes it even when self-update is disabled/not a clone).
- Footer: `#footerVersion` (`.footer-version`) shows `Version 1.1.0` whenever the server
  answers — `renderFooterVersion()` fed by `loadConfig()` and `checkForUpdates()`; the
  existing `#footerBuild` label still needs git. Startup banner prints `Lead Atlas v<ver>`.
- 155 tests green (19 in `test/version.test.js`; new server route assertions).
- Gotcha fixed: a second `createApp` in a route test must close the previous `appServer`
  first, or the leaked listener keeps the `node --test` child process alive forever.

## Resume-scan feature (R1–R5) — verified 2026-10-27
- `public/active-run-core.js` + `test/active-run-core.test.js` (17 tests): parses/purges
  the `leadAtlas.activeRun.v1` pointer, 24 h freshness, http(s)-only console URL.
- `public/app.js`: saves the pointer after the run ID returns; clears it on report,
  failure screen, 404, stale/corrupt read; `resumeActiveRun()` on boot reuses the normal
  poll loop to reconcile running/succeeded/failed/gone. No server changes.
- Browser E2E vs mock Apify (temp file, not in repo): scan started → second tab opened →
  reattached to the same run with "Reconnected" toast and live count → finished to a
  3-lead report → pointer cleared. Stale (25 h), corrupt JSON and keyless records do not
  resume; keyless keeps the pointer for a later key.
- beforeunload guard confirmed working during the test (real dialog on mid-scan reload).

## E2E smoke (T009) — verified 2026-10-27
- All 118 tests green; server started on 127.0.0.1:4317 with `npm start`.
- `/api/version` returned `enabled: true`, `canRestart: true`, real GitHub API tip
  (`via: github`), `updateAvailable: false` while local == origin.
- After pushing marker commit `ec06d6b` and resetting local one commit behind with a
  dirty tracked README: `/api/version` → `updateAvailable: true`, `dirtyFiles: 1`.
- `POST /api/update` → `{status: restarting, beforeSha 6b89480, afterSha ec06d6b,
  stashCreated: true, npmInstalled: false}` with the stash recovery note.
- Old process spawned the updated server (pid printed), child retried port bind
  (attempt 1), bound 4317 and answered the next `/api/version` with `current: ec06d6b`.
- Repo afterwards: local == origin/main, working tree clean, stash dropped
  (scratch edit was disposable; recovery path itself covered by unit tests).

## Active Context
- Current app version: `1.9.0` (instant dashboard boot from an account-scoped cache,
  signed-in home redirect, outreach analytics, stable lead identity and numbering, review
  quality gate, account-backed call scripts, multipage public site, account-only
  workspace/library, deep-linkable workspace routes and the account-bound Apify key).
- Live deployment: `https://lead-atlas-ochre.vercel.app` (Vercel project `lead-atlas`,
  Express preset, one serverless function, `SELF_UPDATE=off`).
- Repo: git clone of https://github.com/Adityasharma-in/Lead-Atlas.git (branch `main`),
  identity `Adityasharma-in` / `Adityasharma-in@users.noreply.github.com`.
- Node ≥ 20 (global fetch), Express 4, zero new dependencies.
- Test harness: `node --test` (`npm test`), mock Apify HTTP server; routes tested via
  real app instances on ephemeral ports. Rate limiters are scoped per `createApp`.
- Server binds 127.0.0.1:PORT (default 4317). Tests must not bind port 4317.
- Frontend: `app.js` is one IIFE for the workspace; `site.js` handles the public pages and
  `auth-page.js` handles auth. Shared patterns: element cache, `showToast`,
  `api(path, {method, body, tokenOverride})`; update polling + reload flow is self-contained
  in the "self-update" section.

## Self-update feature map (where things live)
- `src/selfupdate.js` — pure parsers + `createSelfUpdater` (git/GitHub runners injectable).
- `src/server.js` — `GET /api/version`, `POST /api/update`, `LA_UPDATE_CHILD` bind retry.
- `public/app.js` — `state.update`, chip sync, `checkForUpdates` (5-min interval,
  suppressed during scans), `runUpdate`, `waitForRestart`, `announceUpdatedBuild`.
- `public/index.html` + `styles.css` — `.update-chip` pill in header-actions, footer
  `Build <sha> · <branch>` label, `Version <x.y.z>` label (`.footer-version`).
- Env: `SELF_UPDATE=off` disables; `GITHUB_TOKEN` optional; cached tip TTL 60s.

## Resume-scan map
- `public/active-run-core.js` — pure parsing/freshness for the pointer.
- `public/app.js` — `saveActiveRun`/`clearActiveRun`/`readActiveRun`, `resumeActiveRun`
  (boot, after token exists), `pollRun` 404 branch, clear hooks in `finishRun` and
  `showProgressError`.
- Record shape: `{runId, startedAt, brief{niche,location,maxResults}, target, cap, consoleUrl}`.
- Design record: `RESUME-SCAN.md`.

## Call-scripts map
- `public/scripts-core.js` — pure engine: `SCRIPT_LIMITS`, `SCRIPT_PLACEHOLDERS`,
  `SCRIPT_STORAGE_KEY`, `activeScript`, `createScript`, `emptyScriptStore`,
  `exportScriptsPayload`, `fillScriptTemplate`, `filterScripts`, `findScript`,
  `importScriptsContent`, `isMissingScriptTableError`, `mergeScriptStores`,
  `parseScriptStore`, `removeScript`, `scriptContextFor`, `scriptExcerpt`,
  `scriptLibraryRow`, `scriptStoreFromRow`, `serializeScriptStore`, `setActiveScript`,
  `upsertScript`.
- `public/app.js` — `state.scripts`, `state.scriptUi`, `state.callSheet`;
  `scriptCacheKey`/`readScriptCache`/`writeScriptCache`, `saveScriptsToAccount`,
  `scheduleScriptsCloudSave`, `loadAccountScripts`, `resetScriptState`, autosave,
  `renderScriptLibrary`, `renderScriptList`, `renderScriptEditor`, `createNewScript`,
  `selectScript`, `makeSelectedScriptDefault`, `duplicateSelectedScript`,
  `deleteSelectedScript`, `handleScriptImportFile`, `downloadScriptsBackup`,
  `activeScriptCopy`, `renderReportScript`, `renderDrawerScript`, `openCallSheet`,
  `renderCallSheet`, `markCallSheetContacted`, `syncDialogState`.
- `public/app.html` — `#scriptChip`, `#reportScriptBtn`, `#drawerScriptBtn`,
  `#reportScriptSection`, `#drawerScriptSection`, `#scriptDialog`, `#callSheetDialog`,
  toast region moved between them.
- Storage: account row `public.script_libraries`; browser cache
  `leadAtlas.scripts.v1.<user-id>` plus a `.dirty` marker; legacy `leadAtlas.scripts.v1`
  is migrated once. Export filename `lead-atlas-scripts-YYYY-MM-DD.json`.
- Save badge: **Saved to account** (cloud write succeeded), **Local only** (browser saved,
  cloud failed or table missing), **Saving…**, **Not saved** (browser storage failed).
- Design record: `docs/CALL-SCRIPTS.md`.

## Supabase map
- `supabase/schema.sql` — tables, indexes, triggers, profile bootstrap, owner-only RLS,
  the idempotent `profiles.apify_token` column, and `public.script_libraries`.
- `src/env.js` — minimal `.env` parser/loader (existing env wins, file is optional).
- `src/supabase.js` — `readSupabaseConfig`, `projectRefFromUrl`, `supabaseConnectSources`.
- `src/server.js` — loads `.env` in the main block, builds the per-app CSP, serves
  `/api/config` with `supabase: {configured, url, anonKey, projectRef}`.
- `public/supabase-client.js` — `createClient`, auth API, session refresh, PKCE redirect
  handling, PostgREST CRUD/count. Session key `leadAtlas.supabaseSession.v1`.
- `public/account-core.js` — pure account-token precedence and missing-column rules.
- `public/boot-cache-core.js` — validated dashboard/config snapshots for instant boot.
- `public/session-guard.js` — signed-in home → `app.html#dashboard` redirect.
- `public/site.js` — public nav, mobile menu, reveal motion, active link, version label,
  sign-out notice.
- `public/auth-page.js` — standalone auth controller; owns all auth UI/logic, mode tabs,
  magic link, recovery, `leadAtlas.authNext` handoff.
- `public/app.js` — `state.auth`, `state.library`; workspace hash routing/back-forward,
  `enterApp`, `signOutUser`, `loadAccountProfile`, `applyAccountToken`,
  `saveTokenToAccount`, `clearTokenFromAccount`, `loadLibrary`, `renderDashboard`,
  `renderLibrary`, `openSavedReport`, `deleteSavedReport`, `handleSaveReportSubmit`,
  `syncSavedLead`, `scheduleSavedReportSummary`.
- `public/app.html` — `#appShell`, `#viewDashboard`, `#viewLibrary`, `#saveReportDialog`,
  account menu, sidebar, saved badge, boot screen and phone bottom nav.
- `public/index.html` / `how-it-works.html` / `pricing.html` — public pages; shared nav and
  footer, `#landingMobileMenu` on each.
- `public/auth.html` — full-page `#viewAuth` sign-in/create/recovery shell.
- `public/workspace.css` — public page heroes, auth, workspace, phone bottom nav and
  save-dialog styles; linked after `styles.css`.
- `docs/SUPABASE-SETUP.md` — operator setup and troubleshooting.
- Env: local `.env` (gitignored) with `SUPABASE_URL` and `SUPABASE_ANON_KEY`; restart after
  changes. Vercel has the same two values plus `SELF_UPDATE=off` for Production, Preview,
  and Development.
- Auth redirect URLs: local Site URL `http://127.0.0.1:4317`; allow
  `http://127.0.0.1:4317/auth.html` and `http://127.0.0.1:4317/**` (plus the equivalent
  `localhost` entries, or the matching port). Production Site URL
  `https://lead-atlas-ochre.vercel.app`; allow `https://lead-atlas-ochre.vercel.app/auth.html`
  and `https://lead-atlas-ochre.vercel.app/**`. The production entries are still pending in
  Supabase as of this deployment.

## Vercel map
- `src/server.js` — default `handleRequest` builds one Express app lazily; named
  `createApp` stays for local/test callers.
- `vercel.json` — `/` → `/index.html` rewrite and security/CSP headers for `/`, `*.html`,
  and all responses.
- `.vercelignore` — excludes `.env*`, `.vercel`, tests, docs, and node_modules from uploads.
- Vercel project `lead-atlas` (`prj_uqn2DQRBOEvxbNo0p5BHqA5X60IR`), team
  `adityatek14-4344` (`team_IFoPVyk1VrRHvWFbDoS6a4hr`), Express preset, Node 26.x.
- Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SELF_UPDATE=off` in Production, Preview, and
  Development. No `service_role` key.
- Production alias `https://lead-atlas-ochre.vercel.app`; tested preview
  `https://lead-atlas-grauitu43-adityatek14-4344.vercel.app`; promoted production
  deployment `https://lead-atlas-2atudagdj-adityatek14-4344.vercel.app`.
- Deployment Protection: Vercel Authentication disabled.

## Blockers
- PR #2 is stacked on PR #1. Merge PR #1 first, or let GitHub retarget PR #2 to `main`
  after #1 lands, so the 1.8.0 changes are not duplicated.
- Supabase Auth → URL Configuration still needs the Vercel production origin:
  `https://lead-atlas-ochre.vercel.app/auth.html` and
  `https://lead-atlas-ochre.vercel.app/**`. Without it, confirmation, magic-link, and
  recovery emails fail on the live domain. Password sign-in works.

## Decisions Made This Session
- Vercel uses the zero-config Express preset: `src/server.js` default-exports one lazy
  Express handler, `public/**` is static CDN output, and `/` is rewritten to
  `/index.html`. `SELF_UPDATE=off` because serverless has no git clone or restartable
  process.
- The deployed function is public but stateless: it holds no server-side secrets, API
  routes are rate-limited and same-origin checked, and every scan needs the caller’s
  account-scoped Apify token.
- The Apify token is account data on `profiles.apify_token`, not server config and not
  browser-only. Account row is the source of truth; localStorage is a cache/migration
  source. The key is written only after Apify validation succeeds, and a failed account
  write leaves the dialog open instead of claiming success.
- Detect via GitHub API with `git ls-remote` fallback; apply via stash + fetch + hard
  reset; npm install only when root package files changed.
- Inject the updater into `createApp` so tests stub it (no real git/network in tests).
- Restart = detached respawn with `LA_UPDATE_CHILD=1` + EADDRINUSE retry in child;
  old process exits ~1.2 s after the POST response flushes.
- Flag on success only: `sessionStorage.leadAtlas.updatedTo.v1` is written only after
  the restart is confirmed by a changed sha, then shown once as a toast and cleared.
- Scripts are account data in `public.script_libraries`, not browser-only: one row per
  user holds the whole normalized library plus the default script so each change is one
  atomic write. An account-scoped local cache keeps typing instant and covers a failed or
  missing cloud write; the newest full-library write wins.
- The call sheet's script switcher is scoped to the open call sheet; only **Use by
  default** (or creating a new script) changes the saved default.
- Toasts are moved into the topmost open `<dialog>` because a body-level live region
  renders behind `::backdrop`; close events restore the body parent.
- Supabase uses a dependency-free browser client rather than `@supabase/supabase-js`, to
  preserve the zero-new-dependency rule. It talks to GoTrue/PostgREST directly with PKCE.
- Only the public anon key is exposed. RLS is the security boundary; service_role is never
  used. CSP `connect-src` is generated from the configured project origin.
- The local server still proxies all Apify traffic and stores no lead data. Supabase
  Auth/PostgREST is the one deliberate direct-browser third-party path.
- The library is explicit: a scan/import is not persisted until the user chooses **Save to
  library**. This keeps the Data desk privacy promise and avoids surprise uploads.
- Saved-report outreach writes through to Supabase, with the existing localStorage ledger
  retained as a fallback and for unsaved reports. Call scripts write through to
  `script_libraries` with an account-scoped local cache.
- The site is multipage, not one document: public pages are separate files; `auth.html`
  is the only auth surface; `app.html` is the account-only workspace. Workspace views are
  hash routes so they remain deep-linkable without a router dependency.

## Survey Signal UI redesign + drawer polish (2026-11-14)
- Direction: replaced the lavender "Atlas After Dark" skin with **Survey Signal** — a
  chalk/forest field-instrument system with hi-vis lime, ultramarine links, oxide danger,
  Archivo display/UI type and Spline Sans Mono labels. `public/atlas.css` is the new skin;
  `styles.css` and `workspace.css` stay as layout scaffolding. All five pages load the new
  layer last.
- Surface work: recolored the landing hero map, shared final CTA map, auth mini-map and
  dashboard quick-scan map; compact 2-column mobile report cards; 2x3 mobile report stats;
  restored dialog/toast contrast; enlarged auth/mobile tap targets.
- Slider: replaced the legacy 4px ultramarine range track and rounded-square thumb with a
  thin 12px track and a circular lime handle. The old pseudo-track no longer draws a blue
  line through the fill.
- Drawer: removed the legacy `drawer-facts` table border/background that produced an olive
  empty cell and vertical divider; long lead names now get `<wbr>` break opportunities
  after commas, so "P.G.Dip.Diab" no longer splits as "Dip.D / iab".
- Verification: computed-color audit clean on desktop/mobile pages, report, and all
  dialogs; `npm test` 310/310; `node --check public/app.js`; CSS brace count balanced.
  No functional contracts, schema, API, CSP or dependency changes. Changes remain local
  and uncommitted.
## Search/control polish + dashboard quick card (2026-11-14)
- Search fields: report and library are 40px single-field bars, script search is 34px.
  Their inputs are transparent, borderless, and full-height; a high-specificity reset
  beats the global form-control rule that was drawing a nested 44px input with its own
  border/background. Focus rings stay on the outer label only.
- Controls: app `.btn` is 42px, `.btn-small` 34px, primary icon tiles 22px/18px; setup
  text inputs and selects are 42px with 34px right padding for the chevron. This removes
  the legacy 50-54px control heights while keeping marketing/auth surfaces unchanged.
- Dashboard: the quick-scan card's map is now absolutely full-bleed with a lime gradient
  overlay, and the content stays bottom-aligned. The SVG uses `xMidYMid slice` so the
  decorative map fills the stretched card; no more hard 130px strip or empty lime body.
- Verification: desktop/mobile screenshots of library toolbar, report toolbar, scan form,
  dashboard grid and script dialog; computed heights 42/40/34 as intended; `npm test`
  310/310. Changes remain local and uncommitted.