/**
 * Durable outreach sync primitives.
 *
 * The browser owns the fast local mark; this module decides how that mark is
 * shaped for Supabase, how an unsynced write is queued, and how a saved row is
 * read back. Everything here is pure so the retry rules and the legacy-schema
 * fallback can be tested without a DOM, storage or network.
 */

import {
  OUTREACH,
  normalizeOutreachDate,
  normalizeOutreachNote,
  normalizeOutreachStatus,
  outreachEntryFromLead,
  outreachKeyForLead,
} from "./outreach-core.js";

export const OUTREACH_SYNC_VERSION = 1;
export const OUTREACH_QUEUE_LIMIT = 500;
export const OUTREACH_RETRY_BASE_MS = 2000;
export const OUTREACH_RETRY_MAX_MS = 60000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function queueOrder(entry) {
  const time = Date.parse(entry?.queuedAt || "");
  return Number.isFinite(time) ? time : 0;
}

/** True for a Postgres UUID (the shape Supabase returns for `leads.id`). */
export function isUuid(value) {
  return UUID_PATTERN.test(text(value));
}

/**
 * The value written to the native `outreach_status` column.
 *
 * Projects created before the follow-up state only allow three values. The
 * caller can keep the precise state in `payload` and write `contacted` natively
 * until the schema is upgraded.
 */
export function outreachStatusForStorage(status, { legacy = false } = {}) {
  const normalized = normalizeOutreachStatus(status) || OUTREACH.TODO;
  if (legacy && normalized === OUTREACH.FOLLOW_UP) return OUTREACH.CONTACTED;
  return normalized;
}

/**
 * A JSON-safe copy of a lead for the `payload` column. Sync-only bookkeeping is
 * removed so a saved payload never carries stale UI state from another device.
 */
export function outreachPayloadFromLead(lead = {}) {
  const payload = { ...lead };
  delete payload.outreachSource;
  delete payload.savedRowId;
  delete payload.outreachSyncedAt;
  delete payload.outreachSyncState;

  const entry = outreachEntryFromLead(lead);
  payload.outreachStatus = entry.status;
  payload.contactedAt = entry.contactedAt;
  payload.outreachUpdatedAt = entry.updatedAt;
  payload.outreachNote = entry.note;
  return payload;
}

/**
 * The exact columns written by an outreach mark. The native column may be
 * downgraded for a legacy schema, while `payload` keeps the precise state.
 */
export function outreachPatchFromLead(lead = {}, { legacy = false } = {}) {
  const entry = outreachEntryFromLead(lead);
  return {
    outreach_status: outreachStatusForStorage(entry.status, { legacy }),
    outreach_note: entry.note || null,
    contacted_at: entry.contactedAt,
    payload: outreachPayloadFromLead(lead),
  };
}

/**
 * Rebuild a precise entry from a patch or a saved row. A legacy row stores
 * `contacted` natively but keeps `follow-up` in its payload, so the payload is
 * allowed to refine that one case. In every other case the native column wins.
 */
export function outreachEntryFromPatch(patch = {}) {
  const payload = objectOrEmpty(patch.payload);
  const nativeStatus = normalizeOutreachStatus(patch.outreach_status);
  const preciseStatus = normalizeOutreachStatus(
    payload.outreachStatus ?? payload.outreach_status,
  );
  let status = nativeStatus || preciseStatus || OUTREACH.TODO;
  if (nativeStatus === OUTREACH.CONTACTED && preciseStatus === OUTREACH.FOLLOW_UP) {
    status = OUTREACH.FOLLOW_UP;
  }

  const contactedAt = normalizeOutreachDate(patch.contacted_at ?? payload.contactedAt);
  const note = normalizeOutreachNote(patch.outreach_note ?? payload.outreachNote) || null;
  const hasMark = status !== OUTREACH.TODO || Boolean(contactedAt) || Boolean(note);
  return {
    status,
    contactedAt,
    updatedAt:
      normalizeOutreachDate(payload.outreachUpdatedAt) ||
      (hasMark ? normalizeOutreachDate(patch.updated_at) : null),
    note,
  };
}

export function outreachEntryFromSavedRow(row = {}) {
  return outreachEntryFromPatch(row);
}

/**
 * A follow-up write against the old three-value check fails with a check
 * violation on `leads_outreach_status_check`. Note-length and other checks must
 * not be mistaken for it.
 */
export function isOutreachConstraintError(error) {
  const code = String(error?.code || "");
  let detail = "";
  try {
    detail = JSON.stringify(error?.details || "");
  } catch {
    detail = "";
  }
  const message = `${error?.message || ""} ${detail}`;
  return (
    /outreach_status/i.test(message) &&
    (code === "23514" || /check constraint|violates/i.test(message))
  );
}

/** Coalescing identity for a queued write: row id first, then report + key. */
export function outreachSyncKey({ reportId, rowId, leadKey } = {}) {
  const report = text(reportId);
  if (!report) return "";
  if (isUuid(rowId)) return `${report}:row:${text(rowId).toLowerCase()}`;
  const key = text(leadKey);
  return key ? `${report}:key:${key}` : "";
}

/** Exponential backoff with a hard ceiling; no timers, no jitter. */
export function nextOutreachRetryDelay(attempts = 0) {
  const count = Math.max(0, Math.floor(Number(attempts) || 0));
  return Math.min(OUTREACH_RETRY_MAX_MS, OUTREACH_RETRY_BASE_MS * 2 ** Math.min(count, 6));
}

export function normalizeOutreachQueueEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const reportId = text(raw.reportId);
  const leadKey = text(raw.leadKey);
  const rowId = isUuid(raw.rowId) ? text(raw.rowId).toLowerCase() : null;
  const patch = raw.patch && typeof raw.patch === "object" ? raw.patch : null;
  if (!reportId || (!leadKey && !rowId) || !patch) return null;

  return {
    key: outreachSyncKey({ reportId, rowId, leadKey }),
    reportId,
    userId: text(raw.userId) || null,
    rowId,
    leadKey,
    patch,
    queuedAt: normalizeOutreachDate(raw.queuedAt),
    attempts: Math.max(0, Math.floor(Number(raw.attempts) || 0)),
    nextAttemptAt: Math.max(0, Number(raw.nextAttemptAt) || 0),
    lastError: text(raw.lastError) || null,
  };
}

/**
 * Parse a persisted queue defensively. Duplicate entries coalesce (the newest
 * wins), and the oldest entries are dropped only if the queue is over the cap.
 */
export function parseOutreachSyncQueue(raw) {
  const empty = { version: OUTREACH_SYNC_VERSION, entries: [] };
  if (!raw) return empty;

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return empty;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;

  const byKey = new Map();
  const list = Array.isArray(parsed.entries) ? parsed.entries : [];
  for (const item of list) {
    const entry = normalizeOutreachQueueEntry(item);
    if (!entry) continue;
    const existing = byKey.get(entry.key);
    if (!existing || queueOrder(entry) >= queueOrder(existing)) {
      byKey.set(entry.key, entry);
    }
  }

  const entries = [...byKey.values()]
    .sort((left, right) => queueOrder(left) - queueOrder(right))
    .slice(-OUTREACH_QUEUE_LIMIT);
  return { version: OUTREACH_SYNC_VERSION, entries };
}

/** Serialize a queue, or return "" when there is nothing left to persist. */
export function serializeOutreachSyncQueue(queue) {
  const entries = Array.isArray(queue) ? queue : queue?.entries;
  const parsed = parseOutreachSyncQueue({ version: OUTREACH_SYNC_VERSION, entries });
  if (!parsed.entries.length) return "";
  return JSON.stringify(parsed);
}

/** Insert or replace one lead's pending write, resetting its retry budget. */
export function coalesceOutreachQueueEntry(queue, entry) {
  const normalized = normalizeOutreachQueueEntry(entry);
  if (!normalized) return parseOutreachSyncQueue({ entries: queue }).entries;

  const entries = parseOutreachSyncQueue({ entries: queue }).entries;
  // A lead's identity can move from `report:key:...` to `report:row:...` once
  // its database id is known. Drop every other queued write for the same lead
  // so a slow retry can never land after (and overwrite) the newer mark.
  const sameLead = (item) =>
    item.reportId === normalized.reportId &&
    ((item.rowId && normalized.rowId && item.rowId === normalized.rowId) ||
      (item.leadKey && normalized.leadKey && item.leadKey === normalized.leadKey));
  const previous = entries.find((item) => item.key === normalized.key);
  const kept = entries.filter((item) => !sameLead(item) || item.key === normalized.key);
  const index = kept.findIndex((item) => item.key === normalized.key);
  if (index >= 0) {
    kept[index] = {
      ...normalized,
      queuedAt: previous?.queuedAt || normalized.queuedAt,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    };
  } else {
    kept.push(normalized);
  }
  return parseOutreachSyncQueue({ entries: kept }).entries;
}

/**
 * Convert a precise patch into one the old three-value schema accepts. The
 * payload keeps `follow-up`, so the mark can be reconstructed immediately.
 */
export function legacyOutreachPatch(patch = {}) {
  const entry = outreachEntryFromPatch(patch);
  const payload = objectOrEmpty(patch.payload);
  return {
    ...patch,
    outreach_status: outreachStatusForStorage(entry.status, { legacy: true }),
    outreach_note: entry.note || null,
    contacted_at: entry.contactedAt,
    payload: {
      ...payload,
      outreachStatus: entry.status,
      contactedAt: entry.contactedAt,
      outreachUpdatedAt: entry.updatedAt,
      outreachNote: entry.note,
    },
  };
}

/** Build the durable queue entry for one lead in one saved report. */
export function outreachSyncEntryFromLead(
  lead,
  { reportId, userId, legacy = false, now = Date.now() } = {},
) {
  if (!lead) return null;
  const report = text(reportId);
  if (!report) return null;

  const leadKey = text(lead.outreachKey) || outreachKeyForLead(lead);
  const rowId = isUuid(lead.savedRowId) ? text(lead.savedRowId).toLowerCase() : null;
  const key = outreachSyncKey({ reportId: report, rowId, leadKey });
  if (!key) return null;

  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return {
    key,
    reportId: report,
    userId: text(userId) || null,
    rowId,
    leadKey,
    patch: outreachPatchFromLead(lead, { legacy }),
    queuedAt: new Date(timestamp).toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  };
}
