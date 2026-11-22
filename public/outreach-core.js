/**
 * Outreach tracking primitives.
 *
 * Pure functions only — no DOM, no storage, no network. The report UI uses
 * these to keep a per-lead contact trail, and the import/export engine uses
 * them so marks survive a CSV or JSON round-trip.
 */

import { leadIdentityKeys } from "./lead-identity-core.js";

export const OUTREACH = Object.freeze({
  TODO: "to-contact",
  CONTACTED: "contacted",
  FOLLOW_UP: "follow-up",
  DO_NOT_CONTACT: "do-not-contact",
});

export const OUTREACH_LABELS = Object.freeze({
  [OUTREACH.TODO]: "To contact",
  [OUTREACH.CONTACTED]: "Reached out",
  [OUTREACH.FOLLOW_UP]: "Follow up",
  [OUTREACH.DO_NOT_CONTACT]: "Do not contact",
});

export const OUTREACH_STATUSES = Object.freeze([
  OUTREACH.TODO,
  OUTREACH.CONTACTED,
  OUTREACH.FOLLOW_UP,
  OUTREACH.DO_NOT_CONTACT,
]);

export const OUTREACH_NOTE_LIMIT = 280;

/**
 * The small marker shown beside a phone number. "open" is the green dot
 * (not called yet), "called" is the green tick, "follow-up" is the clock
 * for another touch, and "blocked" keeps a do-not-contact lead from
 * looking callable.
 */
export const CALL_MARK = Object.freeze({
  OPEN: "open",
  CALLED: "called",
  FOLLOW_UP: "follow-up",
  BLOCKED: "blocked",
});

const DNC_PATTERNS = [
  /do\s*not\s*contact/,
  /dont\s*contact/,
  /never\s*contact/,
  /no\s*contact/,
  /opt\s*out/,
  /opted\s*out/,
  /not\s*interested/,
  /unsubscribe/,
  /blocked/,
  /exclude/,
  /skip/,
  /^dnc$/,
];

const TODO_PATTERNS = [
  /^to\s*contact$/,
  /^to\s*be\s*contacted$/,
  /^not\s*yet$/,
  /^not\s*contacted$/,
  /^not\s*reached$/,
  /^uncontacted$/,
  /^pending$/,
  /^queued$/,
  /^open$/,
  /^new$/,
  /^todo$/,
  /^to\s*do$/,
  /^no$/,
  /^n$/,
  /^false$/,
  /^0$/,
];

const CONTACTED_PATTERNS = [
  /^reached\s*out$/,
  /^already\s*reached\s*out$/,
  /^reached$/,
  /^contacted$/,
  /^already\s*contacted$/,
  /^called$/,
  /^emailed$/,
  /^messaged$/,
  /^done$/,
  /^complete$/,
  /^completed$/,
  /^yes$/,
  /^y$/,
  /^true$/,
  /^1$/,
];

const FOLLOW_UP_PATTERNS = [
  /^follow\s*up(?:\s*(?:due|needed|required|scheduled|later|again))?$/,
  /^followup(?:\s*(?:due|needed|required|scheduled|later|again))?$/,
  /^following\s*up$/,
  /^to\s*follow\s*up$/,
  /^needs?\s*follow\s*up$/,
  /^call\s*back$/,
  /^callback$/,
  /^fu$/,
];

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizeStatusKey(value) {
  return text(value)
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Map a human or machine value onto one of the four outreach states.
 * Returns null when the value is empty or not recognised.
 */
export function normalizeOutreachStatus(value) {
  const key = normalizeStatusKey(value);
  if (!key) return null;
  if (DNC_PATTERNS.some((pattern) => pattern.test(key))) return OUTREACH.DO_NOT_CONTACT;
  if (TODO_PATTERNS.some((pattern) => pattern.test(key))) return OUTREACH.TODO;
  if (CONTACTED_PATTERNS.some((pattern) => pattern.test(key))) return OUTREACH.CONTACTED;
  if (FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(key))) return OUTREACH.FOLLOW_UP;
  return null;
}

export function outreachStatusLabel(value) {
  return OUTREACH_LABELS[normalizeOutreachStatus(value)] || OUTREACH_LABELS[OUTREACH.TODO];
}

export function callMarkForStatus(value) {
  const status = normalizeOutreachStatus(value) || OUTREACH.TODO;
  if (status === OUTREACH.CONTACTED) return CALL_MARK.CALLED;
  if (status === OUTREACH.FOLLOW_UP) return CALL_MARK.FOLLOW_UP;
  if (status === OUTREACH.DO_NOT_CONTACT) return CALL_MARK.BLOCKED;
  return CALL_MARK.OPEN;
}

export function normalizeOutreachNote(value) {
  return text(value).slice(0, OUTREACH_NOTE_LIMIT);
}

export function normalizeOutreachDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e12 ? value : value > 1e9 ? value * 1000 : null;
    if (!milliseconds) return null;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Normalize a stored or imported outreach entry.
 * Returns null when there is nothing useful to keep.
 */
export function normalizeOutreachEntry(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const status = normalizeOutreachStatus(
    raw.status ?? raw.outreachStatus ?? raw.contactStatus ?? raw.value,
  );
  const contactedAt = normalizeOutreachDate(
    raw.contactedAt ?? raw.contacted_at ?? raw.lastContacted ?? raw.reachedOutAt,
  );
  const updatedAt = normalizeOutreachDate(
    raw.updatedAt ?? raw.outreachUpdatedAt ?? raw.statusUpdatedAt,
  );
  const note = normalizeOutreachNote(
    raw.note ?? raw.outreachNote ?? raw.contactNote ?? "",
  );

  // A timestamp on its own is not an outreach mark. It must never be allowed
  // to turn a lead back into "To contact" (or into a mark) just because a row
  // carried a write time.
  if (!status && !contactedAt && !note) return null;

  return {
    status: status || (contactedAt ? OUTREACH.CONTACTED : OUTREACH.TODO),
    contactedAt,
    updatedAt: updatedAt || contactedAt || null,
    note: note || null,
  };
}

/**
 * A stable identity for a lead across scans and file imports. Place ID wins,
 * then the canonical phone/email/name identity used by the duplicate engine.
 * A name alone is not enough: requiring the address keeps every branch of the
 * same chain from sharing one outreach ledger entry.
 */
export function outreachKeyForLead(lead = {}) {
  const placeId = text(lead.placeId);
  if (placeId) return `place:${placeId.toLowerCase()}`;

  const key = leadIdentityKeys(lead).find(
    (candidate) => !candidate.startsWith("place:") && !candidate.startsWith("id:"),
  );
  if (key) return key;

  const id = text(lead.id).toLowerCase();
  return id ? `id:${id}` : "id:unknown";
}

export function outreachEntryFromLead(lead = {}) {
  const entry = normalizeOutreachEntry({
    status: lead.outreachStatus,
    contactedAt: lead.contactedAt,
    updatedAt: lead.outreachUpdatedAt,
    note: lead.outreachNote,
  });
  return (
    entry || {
      status: OUTREACH.TODO,
      contactedAt: null,
      updatedAt: null,
      note: null,
    }
  );
}

/** Comparable text for an outreach entry; equal signatures mean no new mark. */
export function outreachEntrySignature(entry) {
  if (!entry) return "";
  return [
    normalizeOutreachStatus(entry.status) || OUTREACH.TODO,
    entry.contactedAt || "",
    entry.updatedAt || "",
    normalizeOutreachNote(entry.note) || "",
  ].join("|");
}

/**
 * The visible mark without its write time. Two entries with the same status,
 * call date and note describe the same state even if one was read from a row's
 * `updated_at` and the other from a payload timestamp.
 */
export function outreachEntryMarkSignature(entry) {
  if (!entry) return "";
  return [
    normalizeOutreachStatus(entry.status) || OUTREACH.TODO,
    entry.contactedAt || "",
    normalizeOutreachNote(entry.note) || "",
  ].join("|");
}

/** The mark time, or 0 when the entry has no usable timestamp. */
export function outreachEntryTime(entry) {
  const time = Date.parse(entry?.updatedAt || "");
  return Number.isFinite(time) ? time : 0;
}

/**
 * True only when `candidate` is strictly newer than `baseline`. Equal stamps
 * resolve in favour of the baseline (the database), never the local copy.
 */
export function outreachEntryIsNewer(candidate, baseline) {
  if (!candidate) return false;
  if (!baseline) return true;
  const candidateTime = outreachEntryTime(candidate);
  const baselineTime = outreachEntryTime(baseline);
  if (!candidateTime) return false;
  if (!baselineTime) return true;
  return candidateTime > baselineTime;
}

/**
 * True only when both entries carry a timestamp and the candidate is later.
 * Use this when a version conflict must be resolved: an untimestamped row is
 * never treated as older than a local mark.
 */
export function outreachEntryStrictlyNewer(candidate, baseline) {
  const candidateTime = outreachEntryTime(candidate);
  const baselineTime = outreachEntryTime(baseline);
  return candidateTime > 0 && baselineTime > 0 && candidateTime > baselineTime;
}

export function applyOutreachEntry(lead, entry) {
  if (!lead || typeof lead !== "object") return lead;
  const normalized = entry ? normalizeOutreachEntry(entry) : null;
  lead.outreachStatus = normalized?.status || OUTREACH.TODO;
  lead.contactedAt = normalized?.contactedAt || null;
  lead.outreachUpdatedAt = normalized?.updatedAt || null;
  lead.outreachNote = normalized?.note || null;
  return lead;
}

export function outreachCounts(leads = []) {
  const counts = {
    total: leads.length,
    toContact: 0,
    contacted: 0,
    followUp: 0,
    doNotContact: 0,
    marked: 0,
    rate: 0,
  };

  for (const lead of leads) {
    const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    if (status === OUTREACH.CONTACTED) counts.contacted += 1;
    else if (status === OUTREACH.FOLLOW_UP) counts.followUp += 1;
    else if (status === OUTREACH.DO_NOT_CONTACT) counts.doNotContact += 1;
    else counts.toContact += 1;
  }

  counts.marked = counts.contacted + counts.followUp + counts.doNotContact;
  // A follow-up is another touch after contact, so it still counts as reached.
  counts.rate = counts.total
    ? Math.round(((counts.contacted + counts.followUp) / counts.total) * 100)
    : 0;
  return counts;
}
