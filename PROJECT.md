# PROJECT.md — One-click GitHub self-update for Lead Atlas

## Problem Statement
Lead Atlas runs locally from a git clone of `Adityasharma-in/Lead-Atlas`. When new commits
are pushed to GitHub from elsewhere (another machine, an agent session), the running app
keeps serving old code until the user manually runs `git pull` + npm install + restart.
The user wants the running **webpage** to announce that an update exists and apply it in
**one click**.

## Goals (In Scope)
- [ ] `GET /api/version` — report the local build and the latest commit on the GitHub repo
      (with a short-TTL cache so page polling is cheap).
- [ ] `POST /api/update` — apply the update in one click: snapshot local edits to a git
      stash, fetch and fast-forward to `origin/<branch>`, run `npm install` when package
      files changed, restart the server process automatically.
- [ ] A header **"Update available — Update now"** chip in the web UI, appearing only when
      a newer commit exists on GitHub; periodic background re-check while the page is open.
- [ ] After restarting, the page auto-reloads onto the new build and confirms with a toast.
- [ ] Feature degrades safely: hidden when the folder is not a git repo, when the current
      branch is detached, when a scan is running, or when `SELF_UPDATE=off`.

## Non-Goals (Out of Scope)
- No automatic updates without a user click.
- No Windows service / PM2 / systemd integration.
- No rollback UI (the pre-update stash + `git reflog` cover recovery; documented in README).
- No multi-branch picker, release channels, or version pinning.
- No code signing/checksum verification beyond git's own integrity.

## Acceptance Criteria
- [ ] AC1: `/api/version` returns `{ current, latest, updateAvailable }`; current commit
      matches `git rev-parse HEAD`; latest matches the GitHub default branch tip.
- [ ] AC2: With a newer commit pushed to GitHub, the header shows the update chip after a
      page load (or within ≤5 min of the page being open).
- [ ] AC3: Clicking the button: stashes dirty tracked files (note shown), resets to the
      remote tip, runs `npm install --no-audit --no-fund` **only if** `package.json` or
      `package-lock.json` changed, restarts the server, and the page reloads on the new
      build with a "updated" toast.
- [ ] AC4: Not a git repo / `SELF_UPDATE=off` / detached HEAD → chip never shown and
      `/api/update` answers with a clear 409.
- [ ] AC5: `npm test` passes with no regressions; new module logic and routes are covered.
- [ ] AC6: README documents the feature, the new env vars, and recovery steps.

## Tech Stack
- Node.js ≥ 20 (built-in `fetch`, `node:test`), Express 4, vanilla browser JS.
- Update transport: `git` CLI (must be on PATH) + GitHub REST API (public, with optional
  `GITHUB_TOKEN` for authenticated requests).
- Runtime requirement: the app folder must be a git clone with `origin` pointing at GitHub.

## Constraints
- Server binds `127.0.0.1` by default; `POST /api/update` must be `same-origin` only and
  rate-limited, matching the existing `/api/runs/*` protections.
- CSP is strict (`connect-src 'self'`) — all GitHub traffic must be **server-side**; the
  browser only ever calls its own `/api/*` endpoints.
- Zero new npm dependencies.

## Assumptions (user to confirm)
1. "Update" = sync the local working copy to the newest commit on the repo's current
   branch (`main`), then restart the local server. (Not: reinstall Node/npm.)
2. Auto-restart after applying the update is desired (one click end-to-end).
3. The button lives in the site header (discreet pill, same family as the Apify key chip).
4. Local uncommitted edits are stashed (not discarded) before updating, for safety.
