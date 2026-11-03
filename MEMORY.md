# MEMORY.md — Session state

## Last Updated: 2026-10-31

## Current Phase: SHIP — complete

## Last Completed Task: Rating column click-to-sort (2026-10-31)

## Next Task: none (features shipped)

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
- Repo: git clone of https://github.com/Adityasharma-in/Lead-Atlas.git (branch `main`),
  identity `Adityasharma-in` / `Adityasharma-in@users.noreply.github.com`.
- Node ≥ 20 (global fetch), Express 4, zero new dependencies.
- Test harness: `node --test` (`npm test`), mock Apify HTTP server; routes tested via
  real app instances on ephemeral ports. Rate limiters are scoped per `createApp`.
- Server binds 127.0.0.1:PORT (default 4317). Tests must not bind port 4317.
- Frontend: single IIFE in public/app.js, element-cache ids list, `showToast`,
  `api(path, {method, body, tokenOverride})`; update polling + reload flow self-contained
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

## Blockers
- none

## Decisions Made This Session
- Detect via GitHub API with `git ls-remote` fallback; apply via stash + fetch + hard
  reset; npm install only when root package files changed.
- Inject the updater into `createApp` so tests stub it (no real git/network in tests).
- Restart = detached respawn with `LA_UPDATE_CHILD=1` + EADDRINUSE retry in child;
  old process exits ~1.2 s after the POST response flushes.
- Flag on success only: `sessionStorage.leadAtlas.updatedTo.v1` is written only after
  the restart is confirmed by a changed sha, then shown once as a toast and cleared.
