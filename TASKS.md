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

