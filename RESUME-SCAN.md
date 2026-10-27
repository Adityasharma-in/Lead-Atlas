# RESUME-SCAN.md — Reattach to a running scan

## Problem Statement
A scan runs on Apify, not in the browser. When the tab is closed, refreshed, or crashes
mid-scan, the app forgets the run: the user loses the live progress view and — worse — can
finish paying for a run they can no longer watch or open. The run is still recoverable via
Apify Console, but that means leaving the app and knowing the run ID.

## Goal
Reopen Lead Atlas and land back on the scan you were watching: live progress if it is still
running, the finished report if it completed while away.

## Out of Scope
- Watching more than the most recent scan (one pointer is kept).
- Recording progress history while the tab is closed (live counts resume from Apify).
- Migrating runs across browsers or machines (localStorage is per browser profile).

## Design
1. **Record** — when a scan starts, `localStorage["leadAtlas.activeRun.v1"]` stores a small
   JSON pointer: `{ runId, startedAt, brief{niche,location,maxResults}, target, cap, consoleUrl }`.
   Written right after the run ID is known; no other lifecycle hooks needed.
2. **Clear** — the pointer is removed when the report opens, the scan fails, the user aborts,
   the run 404s, or the record is stale/corrupt on read. It survives every page unload,
   which is the point.
3. **Resume on boot** — `init()` calls `resumeActiveRun()` when a token exists. It validates
   the record (`parseActiveRun` + `isActiveRunFresh`, 24 h window), mounts the progress view
   with the stored brief, and hands over to the existing `startPolling` loop. No new polling
   code: the normal `pollRun` reconciliation handles running / succeeded / failed / gone.
4. **Safety** — malformed records are discarded; `consoleUrl` must be http(s); brief text is
   length-capped; a record without a key is kept (not resumed) so re-adding the same account
   key later still works.

## Edge Cases
| Case | Behaviour |
| --- | --- |
| Tab closed mid-scan | Reopen → progress view reattaches, elapsed time includes the gap |
| Finished while away | Reopen → report opens with the normal "Report ready" toast |
| Failed while away | Reopen → the failure screen explains what happened; record clears |
| Run deleted / other account | First poll 404 → "That scan can't be found", record clears |
| Record older than 24 h | Discarded silently, app opens on the brief |
| No Apify key saved | Not resumed; record kept for when the key is restored |
| Two tabs, same run | Both may poll (read-only); the first finish clears the record |

## Tests
- `test/active-run-core.test.js` — record parsing, brief normalization, URL and freshness rules.
- Browser E2E against a mock Apify: start scan → open a second tab → reattaches → finishes to
  the report → record cleared; stale, corrupt, and keyless records do not hijack the app.
