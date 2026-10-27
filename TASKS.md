# TASKS.md — Execution plan

## Phase 1: Planning artifacts
- [ ] T001: Write PROJECT.md, PLANNING.md, TASKS.md, MEMORY.md, AGENTS.md — Done when: files exist and are committed.

## Phase 2: Updater module (server)
- [ ] T002: Pure helpers in `src/selfupdate.js` (repository parsing, ahead/behind compare,
      package-file change detection) + `test/selfupdate.test.js` for them — Done when: unit tests pass.
- [ ] T003: Git/network layer in `src/selfupdate.js` (`localVersion`, `remoteVersion` with
      GitHub API → `ls-remote` fallback, 60s TTL cache, `applyUpdate` stash+reset+npm,
      `scheduleRestart` detached spawn) — Done when: module loads, smoke checks in manual run.
- [ ] T004: Fast version unit tests for injected-runner flows (no real git/network) — Done when: tests pass.

## Phase 3: Server wiring
- [ ] T005: `src/server.js` — optional `{selfUpdate}` injection into `createApp`;
      `GET /api/version` (light limiter), `POST /api/update` (`sameOriginOnly` + limiter,
      mutex/conflict math); main block: `LA_UPDATE_CHILD` bind-retry + restart handoff —
      Done when: `npm test` green including route tests with stub updater.

## Phase 4: Frontend
- [ ] T006: `public/index.html` header update chip + footer build label;
      `public/styles.css` chip styles following `.key-chip` family; responsive hiding.
- [ ] T007: `public/app.js` — `state.update`, version check on boot + 5-min interval
      (suppressed while scan running), chip click → POST → restart-aware polling →
      auto-reload → post-reload toast via `sessionStorage` flag.

## Phase 5: Docs, verify, ship
- [ ] T008: README — feature section, env vars, recovery from a stash, troubleshooting,
      structure/Limitations updates.
- [ ] T009: Full `npm test`; manual smoke: start server, confirm `/api/version` and footer
      build label; E2E: push a commit, see chip, fire `POST /api/update`, watch restart + new sha.
- [ ] T010: Commit + push everything; final planning-file status update; deliver summary.

## Notes
- Tasks ≤ ~100 source lines each; module and its tests are separate tasks (T002/T004).
- The E2E in T009 uses the trick that pushing the *final* commit makes the running
  pre-feature server… run the feature during its own first update flow.
