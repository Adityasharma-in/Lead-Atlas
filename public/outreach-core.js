/**
 * Outreach tracking primitives.
 *
 * Pure functions only — no DOM, no storage, no network. The report UI uses
 * these to keep a per-lead contact trail, and the import/export engine uses
 * them so marks survive a CSV or JSON round-trip.
 */

export const OUTREACH = Object.freeze({
  TODO: "to-contact",
  CONTACTED: "contacted",
  DO_NOT_CONTACT: "do-not-contact",
});

export const OUTREACH_LABELS = Object.freeze({
  [OUTREACH.TODO]: "To contact",
  [OUTREACH.CONTACTED]: "Reached out",
  [OUTREACH.DO_NOT_CONTACT]: "Do not contact",
});

export const OUTREACH_STATUSES = Object.freeze([
  OUTREACH.TODO,
  OUTREACH.CONTACTED,
  OUTREACH.DO_NOT_CONTACT,
]);

export const OUTREACH_NOTE_LIMIT = 280;

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

function phoneDigits(value) {
  return text(value).replace(/[^\d]/g, "");
}

function isEmail(value) {
  const email = text(value).replace(/^mailto:/i, "").toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Map a human or machine value onto one of the three outreach states.
 * Returns null when the value is empty or not recognised.
 */
export function normalizeOutreachStatus(value) {
  const key = normalizeStatusKey(value);
  if (!key) return null;
  if (DNC_PATTERNS.some((pattern) => pattern.test(key))) return OUTREACH.DO_NOT_CONTACT;
  if (TODO_PATTERNS.some((pattern) => pattern.test(key))) return OUTREACH.TODO;
  if (CONTACTED_PATTERNS.some((pattern) => pattern.test(key))) return OUTREACH.CONTACTED;
  return null;
}

export function outreachStatusLabel(value) {
  return OUTREACH_LABELS[normalizeOutreachStatus(value)] || OUTREACH_LABELS[OUTREACH.TODO];
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

  if (!status && !contactedAt && !updatedAt && !note) return null;

  return {
    status: status || (contactedAt ? OUTREACH.CONTACTED : OUTREACH.TODO),
    contactedAt,
    updatedAt: updatedAt || contactedAt || null,
    note: note || null,
  };
}

/**
 * A stable identity for a lead across scans and file imports. Place ID wins,
 * then a phone number, then an email, then name + address.
 */
export function outreachKeyForLead(lead = {}) {
  const placeId = text(lead.placeId);
  if (placeId) return `place:${placeId.toLowerCase()}`;

  const phone = [...(Array.isArray(lead.phones) ? lead.phones : []), lead.phone]
    .map(phoneDigits)
    .find((digits) => digits.length >= 6);
  if (phone) return `phone:${phone}`;

  const email = (Array.isArray(lead.emails) ? lead.emails : []).map(isEmail).find(Boolean);
  if (email) return `email:${email}`;

  const name = text(lead.name).toLowerCase();
  const address = text(lead.address).toLowerCase();
  if (name || address) return `name:${name}|${address}`;
  return `id:${text(lead.id) || "unknown"}`;
}

export function outreachEntryFromLead(lead = {}) {
  const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
  return {
    status,
    contactedAt: normalizeOutreachDate(lead.contactedAt),
    updatedAt: normalizeOutreachDate(lead.outreachUpdatedAt),
    note: normalizeOutreachNote(lead.outreachNote) || null,
  };
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
    doNotContact: 0,
    marked: 0,
    rate: 0,
  };

  for (const lead of leads) {
    const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    if (status === OUTREACH.CONTACTED) counts.contacted += 1;
    else if (status === OUTREACH.DO_NOT_CONTACT) counts.doNotContact += 1;
    else counts.toContact += 1;
  }

  counts.marked = counts.contacted + counts.doNotContact;
  counts.rate = counts.total ? Math.round((counts.contacted / counts.total) * 100) : 0;
  return counts;
}
