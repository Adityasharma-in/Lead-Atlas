# PLANNING.md — Architecture: one-click self-update

## System Overview
A small updater module (`src/selfupdate.js`) compares the local git HEAD against the
GitHub-hosted tip of the same branch. The web UI polls `/api/version` (page load + every
5 min) and shows an "Update available" chip when they differ. Clicking it POSTs
`/api/update`; the server stashes local edits, `git fetch` + `git reset --hard` to the
remote tip, optionally `npm install`, then respawns itself as a detached child process and
exits. The child retries binding the port while the old process releases it. The page
polls version/status until the new process answers, verifies the sha changed, and reloads.

## Directory Structure
```
lead-atlas/
├── src/
│   ├── selfupdate.js    NEW: update check + apply + restart (spawnable, injectable)
│   └── server.js        EDIT: /api/version + /api/update routes, child-bind retry
├── public/
│   ├── index.html       EDIT: header update chip, footer build label
│   ├── app.js           EDIT: version polling, chip logic, update flow, reload
│   └── styles.css       EDIT: .update-chip and footer build styles
├── test/
│   └── selfupdate.test.js  NEW: pure helpers + route behaviour with stub updater
└── docs planning files (PROJECT/PLANNING/TASKS/MEMORY/AGENTS).md
```

## Data Flow
```
page load / 5-min interval → GET /api/version
  server: cache(60s) → git rev-parse/log (local) + GitHub API branches/<b> (or git ls-remote fallback)
  → { enabled, current{sha,short,branch,committedAt,subject,dirtyFiles}, latest{...}, updateAvailable, checkError }
click chip → POST /api/update (sameOriginOnly + limiter)
  server: assert update still available → git stash (if dirty) → git fetch origin
  → git reset --hard origin/<branch> → git diff names → npm install (if package files changed)
  → spawn detached node src/server.js (LA_UPDATE_CHILD=1) → res.json{status:'restarting', version}
  → old process exits after response flush (~1.2s)
page: poll /api/version every 700ms (≤20s) → sees new sha after restart → location.reload()
reload: boot sees sessionStorage flag → toast "Updated to build <short>" → clears flag
```

## Key Interfaces
| Interface | Input | Output | Owner |
|---|---|---|---|
| `GET /api/version` | — | version info (always 200; errors as `checkError`) | selfupdate + server |
| `POST /api/update` | none | `{status, version, stashCreated, npmInstalled, notes[]}` or 409/429 | server |
| `createSelfUpdater({projectRoot, canRestart})` | — | `{enabled, version(), apply()}` | selfupdate.js |
| `createApp({selfUpdate})` | injectable updater | Express app | server.js |

## Data Models
- **BuildInfo**: `{ sha, short, subject, committedAt, branch, dirtyFiles }`
- **UpdateStatus**: `{ enabled, selfUpdate?reason, current: BuildInfo|null, latest|null,
  updateAvailable, lastCheckedAt, checkError }`
- **ApplyResult**: `{ beforeSha, afterSha, stashed, npmInstalled, restarted, notes[] }`

## State Management
- Server: 60s memoized check (TTL), module-level `applying` mutex for POST, nothing on disk.
- Browser: `state.update` object; `sessionStorage.leadAtlas.updatedTo` for the post-reload
  toast; poll interval id tracked to avoid leaks.
- Git itself is the source of truth for versions (no version file to maintain).

## External Dependencies
- GitHub REST API `https://api.github.com/repos/{owner}/{repo}/branches/{branch}` (60 req/h
  unauthenticated; falls back to `git ls-remote` on 403/429/network error).
- `git` on PATH; `npm` for installs (skipped unless package files changed).
- Optional `GITHUB_TOKEN` env → `Authorization: Bearer` (for private repos / rate limits).
- `SELF_UPDATE=off` disables all endpoints (409 `SELF_UPDATE_DISABLED`) and hides UI.

## Critical Design Decisions
| Decision | Options considered | Choice | Reason |
|---|---|---|---|
| Detect remote tip | GitHub API / `git fetch` / `ls-remote` | API primary, ls-remote fallback | API gives commit metadata for the UI; zero-history `fetch` not needed just to compare |
| Apply strategy | `pull --ff-only` / `reset --hard` | stash + `fetch` + `reset --hard origin/<b>` | Agent sessions may force-push/rebase; deterministic, always lands on remote tip; stash protects user edits |
| Dependency install | always / on package change | on package change only (`git diff --name-only <old> <new>`) | npm install on every click would be slow; safe otherwise |
| Restart | manual / auto respawn | spawn detached child w/ `LA_UPDATE_CHILD=1` + bind-retry | "one click" must include the server restart; retry solves port handover race |
| Update check free | poll from server timer | check on `/api/version` request w/ TTL cache | no persistent server-side timer to leak; cheap API quota |

## Known Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Port race old↔new process | Medium | child bind-retries EADDRINUSE up to 20s; old exits ≤1.2s after response |
| Clicking update mid-scan | Low | UI hides chip + suppresses checks while `state.running`; README caveat |
| GitHub API down/rate-limited | Low | `ls-remote` fallback; `checkError` surfaced, update still possible |
| Warnings on `npm` failures | Low | update continues after reset; error note attached to response |
