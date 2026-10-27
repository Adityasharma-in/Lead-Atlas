# MEMORY.md — Session state

## Last Updated: 2026-10-27

## Current Phase: SHIP — complete

## Last Completed Task: T010 — all tasks done, pushed to GitHub

## Next Task: none (feature shipped)

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
  `Build <sha> · <branch>` label.
- Env: `SELF_UPDATE=off` disables; `GITHUB_TOKEN` optional; cached tip TTL 60s.

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
