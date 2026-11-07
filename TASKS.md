# TASKS.md — Execution plan

## Phase 1: Planning artifacts
- [x] T001: Write PROJECT.md, PLANNING.md, TASKS.md, MEMORY.md, AGENTS.md — Done when: files exist and are committed.

## Phase 2: Updater module (server)
- [x] T002: Pure helpers in `src/selfupdate.js` (repository parsing, ahead/behind compare,
      package-file change detection) + `test/selfupdate.test.js` for them — Done when: unit tests pass.
- [x] T003: Git/network layer in `src/selfupdate.js` (`localVersion`, `remoteVersion` with
      GitHub API → `ls-remote` fallback, 60s TTL cache, `applyUpdate` stash+reset+npm,
      `scheduleRestart` detached spawn) — Done when: module loads, smoke checks in manual run.
- [x] T004: Fast version unit tests for injected-runner flows (no real git/network) — Done when: tests pass.

## Phase 3: Server wiring
- [x] T005: `src/server.js` — optional `{selfUpdate}` injection into `createApp`;
      `GET /api/version` (light limiter), `POST /api/update` (`sameOriginOnly` + limiter,
      mutex/conflict math); main block: `LA_UPDATE_CHILD` bind-retry + restart handoff —
      Done when: `npm test` green including route tests with stub updater.

## Phase 4: Frontend
- [x] T006: `public/index.html` header update chip + footer build label;
      `public/styles.css` chip styles following `.key-chip` family; responsive hiding.
- [x] T007: `public/app.js` — `state.update`, version check on boot + 5-min interval
      (suppressed while scan running), chip click → POST → restart-aware polling →
      auto-reload → post-reload toast via `sessionStorage` flag.

## Phase 5: Docs, verify, ship
- [x] T008: README — feature section, env vars, recovery from a stash, troubleshooting,
      structure/Limitations updates.
- [x] T009: Full `npm test`; manual smoke: start server, confirm `/api/version` and footer
      build label; E2E: push a commit, see chip, fire `POST /api/update`, watch restart + new sha.
- [x] T010: Commit + push everything; final planning-file status update; deliver summary.

## Notes
- Tasks ≤ ~100 source lines each; module and its tests are separate tasks (T002/T004).
- The E2E in T009 uses the trick that pushing the *final* commit makes the running
  pre-feature server… run the feature during its own first update flow.

## Follow-up feature: reattach to a running scan (see RESUME-SCAN.md)
- [x] R1: `public/active-run-core.js` — record parsing, brief normalization, freshness
      window + `test/active-run-core.test.js`.
- [x] R2: `public/app.js` — save the active-run pointer on start; clear it on report,
      failure, abort, 404 and stale reads.
- [x] R3: `public/app.js` — `resumeActiveRun()` on boot; reuse the normal poll loop to
      reconcile running/succeeded/failed/gone; beforeunload guard already covers it.
- [x] R4: README — "Scans survive a closed tab", limitations, structure, troubleshooting.
- [x] R5: E2E against a mock Apify: scan → second tab reattaches → report opens → record
      cleared; stale/corrupt/keyless records stay on the brief.

## Notes — resume feature
- These tasks touch only the browser bundle and docs; no server-side changes.
- The record is read with `parseActiveRun`/`isActiveRunFresh` before use; never trust raw
  localStorage.

## Feature: app versioning + footer version label (2026-10-27)
- [x] V1: `src/version.js` — parse/format/bump rules (patch uncapped, minor capped at 9
      with rollover to major, major resets) + `APP_VERSION` read from package.json;
      `scripts/bump-version.js` CLI + `bumpPackageVersion()`; npm run `bump:patch` /
      `bump:minor` / `bump:major` — Done when: `test/version.test.js` green.
- [x] V2: server exposes the version — `/api/health` `version`, `/api/config` and
      `/api/version` `appVersion` (additive fields; version answers even when self-update
      is disabled or the folder is not a clone), startup banner shows `v<version>`;
      route assertions in `test/server.test.js` — Done when: `npm test` green.
- [x] V3: footer version label — `index.html` `#footerVersion`, `.footer-version` styles
      in `styles.css`, `renderFooterVersion()` in `app.js` fed by `/api/config` and
      `/api/version`; README "Versioning" section; app bumped 1.0.0 → 1.1.0 with the new
      tool — Done when: footer renders the version with no git repo required.

## Feature: click-to-sort Rating column (2026-10-31)
- [x] S1: `public/index.html` — Rating `<th>` is now a button with `aria-sort` and a
      chevron; the Sort select gains a "Lowest rated" option (`rating-asc`).
- [x] S2: `public/app.js` — `rating-asc` sorts low→high with unrated leads last;
      `syncRatingSort()` keeps `aria-sort`, the active arrow and the Sort select in sync;
      clicking the header toggles high→low ↔ low→high, starting high→low from any other sort.
- [x] S3: `public/styles.css` — `.sort-toggle` hover, focus-visible, active and rotating
      arrow styles, reusing the mono header type and orange accent.
- [x] S4: `npm test` (155 green) + browser check on an imported 6-lead CSV: 4.9 → 2.7,
      unrated last; second click reverses; choosing another sort clears the header state.

## Feature: cold-call script library + call sheet (2026-11-03)
- [x] C1: `docs/CALL-SCRIPTS.md` — problem, scope, acceptance criteria, data model,
      placeholder list, privacy and verification plan.
- [x] C2: `public/scripts-core.js` — pure script normalization, store operations,
      default selection, placeholder filling, JSON/text import, merge/export helpers;
      `test/scripts-core.test.js` (15 tests). Done when: `npm test` green.
- [x] C3: `public/index.html` — Scripts chip in the header, Call sheet action in the
      report toolbar and lead drawer, library dialog (search, list, editor, import/export)
      and call-sheet dialog, plus new icons.
- [x] C4: `public/app.js` — storage and autosave, create/duplicate/delete with undo,
      explicit default selection, search, import/export, call-sheet placeholder fill,
      script switching without changing the default, copy, mark reached out, and toasts
      that move into the topmost open dialog.
- [x] C5: `public/styles.css` — header chip, drawer action, library workspace/editor,
      call-sheet reading surface, dialog toast safety, tablet/mobile breakpoints, reusing
      the existing paper/ink/orange tokens.
- [x] C6: Verified in Chromium — starter creation, autosave + reload persistence,
      duplicate/delete/undo, search, explicit default, placeholder insertion and fill from
      a lead, copy, mark reached out, JSON/plain-text import, JSON export shape, corrupt
      storage boot, corrupt/oversized imports, and storage-quota failure. Test data cleared
      afterwards.
- [x] C7: README, docs, TASKS and MEMORY updated; app bumped 1.1.0 → 1.2.0; `npm test`
      (170 green) and syntax checks pass.

## Feature: premium landing, Supabase auth, workspace + saved lead library (2026-11-04)
- [x] L1: `src/env.js` — dependency-free `.env` reader; `src/supabase.js` — URL/key
      validation, project-ref extraction, and CSP connect sources; `.env.example`.
- [x] L2: `src/config.js` + `src/server.js` — CSP builder accepts extra connect sources;
      `/api/config` exposes the public Supabase settings; `.env` loaded at startup.
- [x] L3: `supabase/schema.sql` — `profiles`, `lead_reports`, `leads`, indexes, updated-at
      triggers, profile bootstrap trigger, and owner-only RLS policies.
- [x] L4: `public/supabase-client.js` — dependency-free GoTrue + PostgREST client with
      PKCE, session storage/refresh, magic links, recovery, and CRUD helpers.
- [x] L5: `public/index.html` — public landing page, auth view, gated app shell, dashboard,
      lead library, save-report dialog, saved badge, and new icons.
- [x] L6: `public/app.js` — auth boot/redirect/session handling, account menu, sign-out,
      dashboard stats, library search/filter/open/delete/export, save/update report, and
      write-through outreach sync for saved leads.
- [x] L7: `public/workspace.css` — landing, auth, app shell, dashboard, library, save
      dialog, responsive breakpoints, reduced-motion fallbacks; linked after `styles.css`.
- [x] L8: `test/supabase.test.js` + `test/server.test.js` — config validation, project-ref
      extraction, CSP wiring, and public `/api/config` shape; `npm test` 181 green.
- [x] L9: Visual checks in headless Chrome at 1440 px and 390 px for landing, auth,
      dashboard, library, and save dialog; no horizontal overflow or console errors.
- [x] L10: README, `docs/SUPABASE-SETUP.md`, TASKS, MEMORY and AGENTS updated; app bumped
      1.2.0 → 1.3.0.
- [x] L11: Supabase project connected; `/api/config` reports `configured: true`, all three
      tables respond, and an anonymous insert is rejected by RLS. PKCE verifier and auth
      intent moved to `localStorage` so confirmation/recovery links work from a new tab.
- [x] L12: Fixed the dashboard flash/disappear after auth. Session expiry is no longer
      multiplied twice on reload; refresh is single-flight per tab and locked across tabs,
      a losing tab adopts the newer session instead of signing out, transient refresh
      failures keep the session, and a misconfigured tab no longer wipes every tab's
      session. The landing header now shows **Dashboard** instead of Sign in / Start free
      when a session exists. `npm test` 189 green; live two-tab sign-in, reload, sign-out,
      and simultaneous refresh checks pass. First account creation remains for the user.

## Feature: phone responsiveness + touch polish (2026-11-04)
- [x] M1: Reproduced the call-sheet and drawer overflow at 390 px — long unbreakable lead
      names pushed the close buttons past the viewport; the script dialog grid also
      overflowed to 407 px.
- [x] M2: `public/styles.css` — `min-width: 0` on drawer/call-sheet header copies,
      `flex: none` on their close buttons, `overflow-wrap: anywhere` on names/addresses;
      script workspace collapsed to `minmax(0, 1fr)` with `min-width: 0` on sidebar/editor;
      report filters 2-per-row at ≤430 px; larger script-tool, drawer Save note, and script
      footer targets; toasts lifted above the full-screen script/call-sheet action bars.
- [x] M3: `public/workspace.css` — dashboard stats 2×2 at ≤560 px, library CSV/JSON and
      Open report targets ≥32 px, library filters ≥34 px, dashboard greeting word spacing.
- [x] M4: Verified with Playwright at 390, 360 and 320 px across landing, auth, dashboard,
      library, report, drawer, call sheet, script, save-report, key dialogs and the landing
      menu. No horizontal overflow (`scrollWidth === clientWidth`), close buttons visible,
      report filters 2+2+1, dashboard stats 2×2, toasts clear action rows by 10–24 px.
      `node --check` passes; `npm test` 189 green. Temporary fixture report and audit
      artifacts removed.

## Feature: account-bound Apify key (2026-11-05)
- [x] K1: `supabase/schema.sql` — idempotent `profiles.apify_token` column plus a column
      comment; the existing owner-only `profiles` RLS policies already protect it.
- [x] K2: `public/account-core.js` + `test/account-core.test.js` — normalize tokens,
      detect missing-column errors, and decide precedence (account row → migrate legacy
      browser cache once → cached fallback when Supabase is unavailable).
- [x] K3: `public/app.js` — load the account token after sign-in, migrate an existing
      browser key once, write newly validated keys to `profiles`, null the account copy on
      **Forget key**, clear the browser cache on sign-out, and keep the account copy across
      devices.
- [x] K4: `public/index.html` — key dialog, privacy note, dashboard card, FAQ and key note
      now describe account storage instead of browser-only storage.
- [x] K5: README, `docs/SUPABASE-SETUP.md`, AGENTS and MEMORY updated with schema rerun,
      cross-device behavior, privacy trade-off and troubleshooting.
- [x] K6: `npm test` 196 green; `node --check` on `app.js`, `account-core.js` and
      `supabase-client.js`; version bumped 1.3.0 → 1.4.0.
- [ ] K7: Manual: run `supabase/schema.sql` in the SQL Editor, save a key, then sign in on
      another browser/profile and confirm the key loads from `profiles.apify_token`.

## Feature: multipage site + account-only workspace (2026-11-05)
- [x] P1: Split the single document into `index.html` (home), `how-it-works.html`,
      `pricing.html` (+ FAQ), `auth.html` (sign in/create/recovery), and `app.html`
      (account-only workspace). Shared marketing nav/footer plus page-specific titles,
      descriptions and skip links.
- [x] P2: `public/app.js` — signed-out visitors to `app.html` go to
      `auth.html?mode=signin` with the intended workspace URL in `leadAtlas.authNext`;
      sign-in returns to that URL. Owns the `#dashboard`, `#library`, `#setup`, `#report`,
      `#data` and `#progress` hash routes with popstate/hashchange/title sync.
- [x] P3: `public/auth-page.js` — standalone auth controller for password, magic link and
      recovery. It owns all auth UI/logic and clears `leadAtlas.authNext` after use.
- [x] P4: `public/site.js` — marketing mobile menu, reveal motion, active nav link, shared
      version label, and the dismissible sign-out notice on the public home.
- [x] P5: Phone workspace — five-item bottom nav (Overview, Scan, Library, Data, More),
      scrim close, safe-area padding, hidden desktop-only controls; verified at 390, 360
      and 320 px with no horizontal overflow.
- [x] P6: Fixed the stale `#viewAuth hidden` wrapper that blanked `auth.html`, restored the
      `viewDashboard`/`viewLibrary` element-cache entries, and hid
      `#bottomLibraryCount` at zero.
- [x] P7: README, `TASKS.md`, `MEMORY.md` and `docs/SUPABASE-SETUP.md` — page map, auth
      handoff, deep links, phone nav, `/auth.html` redirect URLs and 1.5.0 examples.
- [x] P8: `node --check` on browser scripts; `npm test` green; version bumped
      1.4.0 → 1.5.0.
- [ ] P9: Manual: add `http://127.0.0.1:4317/auth.html` (or the local `/**` wildcard) to
      Supabase redirect URLs, then exercise a real confirmation/magic/recovery email
      round-trip.

## Feature: account-backed call scripts (2026-11-05)
- [x] S1: `supabase/schema.sql` — idempotent `public.script_libraries` table
      (`user_id` primary key, `active_id`, `scripts` JSON array, timestamps), array/length
      checks, `updated_at` trigger, and owner-only select/insert/update/delete RLS.
- [x] S2: `public/scripts-core.js` + `test/scripts-core.test.js` — `scriptStoreFromRow`,
      `scriptLibraryRow`, and `isMissingScriptTableError`; row-shape round-trip and
      missing-table tests.
- [x] S3: `public/app.js` — account-scoped cache key
      `leadAtlas.scripts.v1.<user-id>`, dirty marker, debounced full-library write-through,
      load on `enterApp`, legacy-key migration, flush on close/sign-out, sign-out reset, and
      **Saved to account** / **Local only** save states.
- [x] S4: `public/app.html` — script dialog copy now describes account storage.
- [x] S5: README and `docs/CALL-SCRIPTS.md` — account sync, cross-device behavior,
      privacy boundary, and troubleshooting.
- [x] S6: `docs/SUPABASE-SETUP.md`, TASKS and MEMORY — table list, verification queries,
      failure modes, and the manual schema run.
- [x] S7: Browser harness with a fake Supabase API — verified legacy migration, create/edit/
      default sync, flush on close and sign-out, reload from the account row, a fresh browser
      loading the cloud library, **Saved to account** at 390 px with no dialog overflow, and
      the missing-table fallback to **Local only** with the legacy library intact.
- [x] S8: Live Supabase: ran `supabase/schema.sql` in the SQL Editor, then created a
      temporary script in one browser session, saw it in an independent sign-in, deleted it,
      and saw the deletion in the second session. The temporary script was removed; the test
      account’s library is empty again.
- [ ] S9: Manual (optional): restart the local dev server so it serves 1.6.1, then re-run
      the script flow and the account/local-only badge checks on desktop and 390 px.

## Refinement: inline call script at the bottom of reports and leads (2026-11-07)
- [x] R1: `public/app.html` — added `#reportScriptSection` after the report pager and
      `#drawerScriptSection` after **At a glance**; both are plain reading surfaces with no
      reveal button.
- [x] R2: `public/app.js` — `renderReportScript()` fills the active/default script with the
      report query; `renderDrawerScript(lead)` fills it with the open lead’s details. Both
      refresh from `renderScriptChip()`, `renderReport()`, and `openLead()` so edits, default
      changes, and new scans update live.
- [x] R3: `public/styles.css` — editorial two-column report panel (stacked at ≤820 px) and
      drawer reading card, reusing the serif body, orange rule, and paper/white tokens.
- [x] R4: README, `docs/CALL-SCRIPTS.md`, TASKS and MEMORY updated; `node --check` and
      `npm test` (198/198) green; version bumped 1.6.0 → 1.6.1.

## Deployment: Vercel production (2026-11-05)
- [x] D1: `src/server.js` — default export is a lazy Express request handler built on the
      first request with `canRestart: false`; named `createApp` remains for local use and
      tests. This fixed the 300s function timeouts caused by exporting the factory itself.
- [x] D2: `vercel.json` — `/` → `/index.html` rewrite, security headers, and CSP for static
      HTML and function responses.
- [x] D3: `.vercelignore` excludes `.env*`, `.vercel`, tests, docs and node_modules;
      `.gitignore` ignores `.vercel/`.
- [x] D4: Linked the existing `lead-atlas` project in team `adityatek14-4344`; kept the
      Express preset, root `.`, no build/output, Node 26.x.
- [x] D5: Added `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SELF_UPDATE=off` for Production,
      Preview, and Development. No service-role key.
- [x] D6: Disabled Deployment Protection (Vercel Authentication) so the site is public.
- [x] D7: Preview deployment passed public pages, CSS/JS, `/api/health`, `/api/config`,
      `/api/version`, the `/api/runs` missing-token 401, CSP/security headers, a real
      password sign-in, workspace 1.6.0, **Saved to account**, and a 390 px phone pass with
      no console errors or overflow.
- [x] D8: Promoted the tested deployment to Production; alias
      `https://lead-atlas-ochre.vercel.app` serves the same build.
- [x] D9: Live Supabase `script_libraries` verified and cross-device create/see/delete/see
      passed; temporary script cleaned up. No paid Apify scan was run.
- [x] D10: README, MEMORY, TASKS, AGENTS, and `docs/SUPABASE-SETUP.md` updated with the
      production URL, project settings, env vars, serverless adapter, deployment protection,
      and redirect-url caveat.
- [ ] D11: Manual: add `https://lead-atlas-ochre.vercel.app/auth.html` and
      `https://lead-atlas-ochre.vercel.app/**` to Supabase **Redirect URLs**, set the Site
      URL, then test confirmation, magic-link, and password-recovery emails.
- [ ] D12: Commit and push the working tree. The live deployment came from the local working
      tree; the GitHub-connected project still points at `df898b2`, which has the old server
      default export.

