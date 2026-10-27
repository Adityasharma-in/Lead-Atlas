// Pointer to the scan currently being watched, persisted in localStorage.
//
// A scan keeps running on Apify even when its tab closes. The app saves a
// small record — run id, a brief snapshot, when it started — so the next page
// load can reattach to the live progress view or open a report that finished
// while the user was away.
//
// This module is pure (no DOM, no storage access) so it can be unit-tested
// with node:test, following the import-core / outreach-core convention.

// A scan older than this is no longer offered for resume. Apify's own run
// timeout is one hour, so a day covers very slow scans and long breaks while
// keeping genuinely stale records from hijacking the app.
export const ACTIVE_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Apify run IDs are alphanumeric; the local server enforces the same pattern.
const RUN_ID_PATTERN = /^[A-Za-z0-9]{8,40}$/;

// Tolerated clock skew for a start time "in the future".
const FUTURE_SKEW_MS = 5 * 60 * 1000;

const NICHE_LIMIT = 120;
const LOCATION_LIMIT = 160;
const CONSOLE_URL_LIMIT = 500;

function trimmedString(value, limit) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeBrief(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const niche = trimmedString(raw.niche, NICHE_LIMIT);
  const location = trimmedString(raw.location, LOCATION_LIMIT);
  if (!niche || !location) return null;

  const maxResults = Number(raw.maxResults);
  return {
    niche,
    location,
    maxResults: Number.isFinite(maxResults)
      ? Math.min(500, Math.max(1, Math.round(maxResults)))
      : 40,
  };
}

/**
 * Parse a raw localStorage value into a normalized active-run record.
 * Returns null for anything malformed so callers can safely clear the slot.
 *
 * @param {string|null} raw
 * @returns {{runId: string, brief: {niche: string, location: string, maxResults: number},
 *   startedAt: number, target: number, cap: number|null, consoleUrl: string|null}|null}
 */
export function parseActiveRun(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const runId = typeof data.runId === 'string' ? data.runId.trim() : '';
  if (!RUN_ID_PATTERN.test(runId)) return null;

  const brief = normalizeBrief(data.brief);
  if (!brief) return null;

  const startedAt = Number(data.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;

  const target = positiveNumber(data.target);
  const cap = positiveNumber(data.cap);
  const consoleUrl =
    typeof data.consoleUrl === 'string' && /^https?:\/\//i.test(data.consoleUrl.trim())
      ? data.consoleUrl.trim().slice(0, CONSOLE_URL_LIMIT)
      : null;

  return {
    runId,
    brief,
    startedAt,
    target: target ? Math.round(target) : brief.maxResults,
    cap,
    consoleUrl,
  };
}

/**
 * True when a parsed record is recent enough to offer for resume.
 * Records from the future beyond a small skew are rejected as bogus.
 */
export function isActiveRunFresh(record, now = Date.now(), maxAgeMs = ACTIVE_RUN_MAX_AGE_MS) {
  if (!record || typeof record !== 'object') return false;
  if (!Number.isFinite(record.startedAt) || !Number.isFinite(now)) return false;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) return false;

  const age = now - record.startedAt;
  if (age < -FUTURE_SKEW_MS) return false;
  return age <= maxAgeMs;
}
