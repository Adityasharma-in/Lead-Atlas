# MEMORY.md — Session state

## Last Updated: 2026-10-27

## E2E smoke marker
- [x] One-click self-update E2E: pushed marker commit → local reset behind origin →
      POST /api/update applied the update behind a running server.

## Current Phase: EXECUTE (T002 next)

## Last Completed Task: T001 — planning artifacts written

## Next Task: T002 — pure helpers in src/selfupdate.js + unit tests

## Active Context
- Repo: git clone of https://github.com/Adityasharma-in/Lead-Atlas.git (branch `main`,
  commit b12f47a5 at planning time). Identity configured locally:
  `Adityasharma-in` / `Adityasharma-in@users.noreply.github.com`.
- Node ≥ 20 (global fetch available), Express 4, no new deps allowed.
- Test harness: `node --test` (`npm test`), mock Apify HTTP server in server.test.js —
  routes are tested via real app instances on ephemeral ports.
- Server binds 127.0.0.1:PORT (default 4317). Tests must not bind port 4317.
- `createApp()` in src/server.js currently takes no options — T005 adds `{selfUpdate}`.
- Frontend is a single IIFE in public/app.js with element cache (`cacheElements` ids list),
  `showView`, `showToast(message, type, options)`, `api()` helper. Boot at bottom in `init()`.

## Blockers
- Awaiting user confirmation of the 4 assumptions in PROJECT.md (auto-restart, header chip,
  stash-before-update, definition of "update") before starting T002.

## Decisions Made This Session
- Detect via GitHub API with `git ls-remote` fallback; apply via stash + fetch + hard reset.
- Inject the updater into `createApp` so tests can stub it (no real git/network in tests).
- Restart = detached respawn with `LA_UPDATE_CHILD=1` + EADDRINUSE retry in child.
- No new npm dependencies; feature is self-contained in src/selfupdate.js.
