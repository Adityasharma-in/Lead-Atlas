/**
 * Canonical lead identity, duplicate grouping and stable numbering.
 *
 * Pure functions only — no DOM, no storage, no network. The Apify normalizer,
 * the browser import engine and the report table all use the same rules, so a
 * contact keeps the same ID and number wherever it appears.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UNNAMED = new Set(["unnamed", "unnamed place", "unknown", "unknown place"]);

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function stringArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

/** Lowercase, accent-free, punctuation-free text used for matching only. */
export function normalizeIdentityText(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Stable phone key. Country/trunk prefixes are reduced when unambiguous. */
export function phoneIdentity(value) {
  let digits = text(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  // North American numbers are often exported with and without the +1 country
  // code. Treat those as one number instead of creating a duplicate lead.
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  // A leading trunk zero on an otherwise long number is not part of the id.
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  return digits.length >= 6 ? digits : "";
}

/** Stable, lowercase email key. */
export function emailIdentity(value) {
  const email = text(value).replace(/^mailto:/i, "").toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : "";
}

/**
 * Every identity key that can link two rows to the same contact.
 * Order matters: the first key is the preferred display identity.
 */
export function leadIdentityKeys(lead = {}) {
  const keys = [];
  const add = (key) => {
    if (key && !keys.includes(key)) keys.push(key);
  };

  const placeId = normalizeIdentityText(lead.placeId);
  if (placeId) add(`place:${placeId}`);

  for (const phone of [...stringArray(lead.phones), lead.phone]) {
    const key = phoneIdentity(phone);
    if (key) add(`phone:${key}`);
  }

  for (const email of [...stringArray(lead.emails), lead.email]) {
    const key = emailIdentity(email);
    if (key) add(`email:${key}`);
  }

  const name = normalizeIdentityText(lead.name);
  const address = normalizeIdentityText(lead.address);
  // A name alone is not enough: every Starbucks would collapse into one lead.
  // Require the street address too, and let phone/email/place ID connect rows
  // that are missing an address.
  if (name && address && !UNNAMED.has(name)) add(`name:${name}|${address}`);

  if (!keys.length) {
    const id = normalizeIdentityText(lead.id);
    if (id) add(`id:${id}`);
  }

  return keys;
}

/** The preferred identity key for a contact. */
export function leadIdentityKey(lead = {}) {
  return leadIdentityKeys(lead)[0] || "";
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const bytes = new TextEncoder().encode(String(value));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(36).padStart(13, "0");
}

/**
 * A deterministic ID. Place ID wins; otherwise a hash of the canonical
 * contact fields. Unlike the old array-position IDs, this never changes just
 * because a row moved, was sorted, filtered or paged.
 */
export function stableLeadId(lead = {}) {
  // Google place IDs are case-insensitive identifiers. Lowercasing them keeps
  // the ID stable when a dataset or export changes letter case.
  const placeId = normalizeIdentityText(lead.placeId);
  if (placeId) return `place-${placeId}`;

  const signature = [
    normalizeIdentityText(lead.name),
    normalizeIdentityText(lead.address),
    normalizeIdentityText(lead.city),
    normalizeIdentityText(lead.state),
    normalizeIdentityText(lead.postalCode),
    ...stringArray(lead.phones).map(phoneIdentity),
    ...stringArray(lead.emails).map(emailIdentity),
    normalizeIdentityText(lead.website),
    normalizeIdentityText(lead.lat),
    normalizeIdentityText(lead.lng),
    normalizeIdentityText(lead.id),
  ]
    .filter(Boolean)
    .join("|");

  return `lead-${fnv1a64(signature || "lead-atlas")}`;
}

/**
 * Group rows that share any identity key. Union-find handles the case where
 * row A matches row B by phone and row B matches row C by email, so all three
 * become one lead instead of two half-duplicates.
 *
 * @returns {number[][]} groups of original array indexes, in first-seen order.
 */
export function groupDuplicateLeads(leads = [], keysFor = leadIdentityKeys) {
  const parent = leads.map((_, index) => index);

  function find(index) {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let cursor = index;
    while (parent[cursor] !== cursor) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    // Always keep the smallest original index as the root so first-seen order
    // remains the report order.
    const keep = Math.min(rootA, rootB);
    const drop = Math.max(rootA, rootB);
    parent[drop] = keep;
  }

  const owner = new Map();
  leads.forEach((lead, index) => {
    for (const key of new Set(keysFor(lead))) {
      if (owner.has(key)) union(owner.get(key), index);
      else owner.set(key, index);
    }
  });

  const groups = [];
  const byRoot = new Map();
  leads.forEach((_, index) => {
    const root = find(index);
    if (!byRoot.has(root)) {
      byRoot.set(root, []);
      groups.push(byRoot.get(root));
    }
    byRoot.get(root).push(index);
  });
  return groups;
}

/**
 * Merge duplicates through a caller-supplied merge function.
 *
 * Merging can create a new identity key that neither source row had on its own
 * (a phone-linked row with a name, plus another with an address, now matches a
 * third row by name + address). Repeat until no group collapses so bridged
 * duplicates cannot survive as a second pass.
 *
 * @returns {{leads: object[], duplicateCount: number, groups: number[][]}}
 */
export function dedupeLeads(leads = [], mergeLead) {
  const groups = groupDuplicateLeads(leads);
  let current = leads;
  let currentGroups = groups;

  while (currentGroups.length < current.length) {
    const merged = [];
    for (const group of currentGroups) {
      let lead = current[group[0]];
      for (let index = 1; index < group.length; index += 1) {
        lead = mergeLead(lead, current[group[index]]);
      }
      merged.push(lead);
    }
    current = merged;
    currentGroups = groupDuplicateLeads(current);
  }

  return {
    leads: current,
    duplicateCount: Math.max(0, leads.length - current.length),
    groups,
  };
}

/**
 * Give every lead a permanent 1-based report number. Existing valid numbers
 * are preserved; missing numbers fill the first free slots. The returned array
 * holds shallow copies so callers can adopt it atomically.
 */
export function assignLeadIndexes(leads = []) {
  const result = leads.map((lead) => ({ ...lead }));
  const used = new Set();

  for (const lead of result) {
    const value = Number(lead.index ?? lead.leadIndex ?? lead.no);
    if (Number.isInteger(value) && value > 0 && !used.has(value)) {
      lead.index = value;
      used.add(value);
    } else {
      lead.index = 0;
    }
  }

  let next = 1;
  for (const lead of result) {
    if (lead.index > 0) continue;
    while (used.has(next)) next += 1;
    lead.index = next;
    used.add(next);
  }
  return result;
}

/** Display form used by the report table. */
export function formatLeadIndex(lead) {
  const value = Number(lead?.index ?? lead?.leadIndex ?? lead?.no);
  return Number.isInteger(value) && value > 0 ? String(value).padStart(2, "0") : "—";
}
