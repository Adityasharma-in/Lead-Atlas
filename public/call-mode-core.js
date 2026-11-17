/**
 * Call mode primitives.
 *
 * Pure functions only — no DOM, no storage, no network. The workspace uses
 * these to turn the current report view into a call session, move through it
 * without wrapping, resolve the keyboard map, and append note presets without
 * ever losing a keystroke or a character.
 */

import {
  OUTREACH,
  OUTREACH_NOTE_LIMIT,
  normalizeOutreachStatus,
} from "./outreach-core.js";

/** Navigation actions that are not outreach states. */
export const CALL_ACTIONS = Object.freeze({
  NEXT: "next",
  PREVIOUS: "previous",
  NOTE: "note",
});

/**
 * One-tap note lines. They are written as sentences so a note stays readable
 * after several presets are appended, and short enough that five fit inside
 * the 280-character limit.
 */
export const CALL_NOTE_PRESETS = Object.freeze([
  Object.freeze({ id: "answered", label: "Answered", text: "Answered the call." }),
  Object.freeze({
    id: "voicemail",
    label: "Voicemail",
    text: "No answer — left a voicemail.",
  }),
  Object.freeze({ id: "call-back", label: "Call back", text: "Asked me to call back." }),
  Object.freeze({
    id: "not-interested",
    label: "Not interested",
    text: "Not interested right now.",
  }),
  Object.freeze({ id: "send-details", label: "Send details", text: "Send details by email." }),
]);

function leadIdOf(lead) {
  return typeof lead?.id === "string" && lead.id.trim() ? lead.id : "";
}

function clampedCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

/**
 * Build the queue for a session.
 *
 * The queue mirrors the report's current order. Leads without an id and
 * duplicate ids are skipped; do-not-contact leads are skipped unless the
 * operator explicitly asks for them. The starting point is the requested lead
 * when it is in the queue, otherwise the first lead that has not been reached
 * out to, otherwise the first lead.
 *
 * @returns {{ ids: string[], startIndex: number }}
 */
export function planCallSession(leads, { leadId = "", includeBlocked = false } = {}) {
  const source = Array.isArray(leads) ? leads : [];
  const requested = typeof leadId === "string" ? leadId.trim() : "";
  const entries = [];
  const seen = new Set();

  for (const lead of source) {
    const id = leadIdOf(lead);
    if (!id || seen.has(id)) continue;
    const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    if (!includeBlocked && status === OUTREACH.DO_NOT_CONTACT) continue;
    seen.add(id);
    entries.push({ id, status });
  }

  const ids = entries.map((entry) => entry.id);
  if (!ids.length) return { ids, startIndex: -1 };

  const requestedIndex = requested ? ids.indexOf(requested) : -1;
  if (requestedIndex >= 0) return { ids, startIndex: requestedIndex };

  const firstOpen = entries.findIndex((entry) => entry.status !== OUTREACH.CONTACTED);
  return { ids, startIndex: firstOpen >= 0 ? firstOpen : 0 };
}

/**
 * Step through the queue.
 *
 * `done` is true only when the operator steps past the final lead, which is
 * the signal to show the session summary. `moved` is false for a clamped step
 * (previous on the first lead). A step never wraps.
 *
 * @returns {{ index: number, done: boolean, moved: boolean }}
 */
export function stepCallQueue(index, total, direction = 1) {
  const size = clampedCount(total);
  if (!size) return { index: 0, done: true, moved: false };

  const current = Math.min(size - 1, Math.max(0, Number.isFinite(index) ? Math.trunc(index) : 0));
  const delta = Number(direction) < 0 ? -1 : 1;
  const next = current + delta;

  if (next < 0) return { index: 0, done: false, moved: false };
  if (next >= size) return { index: size - 1, done: true, moved: false };
  return { index: next, done: false, moved: true };
}

/**
 * Map a keyboard event's key and modifier state onto a call-mode action.
 *
 * Returns a CALL_ACTIONS value, an OUTREACH status, or an empty string when the
 * key is not a shortcut. Typing, modifiers, and held-down repeats always win:
 * a repeated `C` must never mark two leads in a row.
 */
export function resolveCallShortcut({
  key = "",
  typing = false,
  repeat = false,
  meta = false,
  ctrl = false,
  alt = false,
} = {}) {
  if (typing || repeat || meta || ctrl || alt) return "";

  const name = String(key ?? "");
  const lower = name.toLowerCase();

  if (lower === "j" || name === "ArrowRight") return CALL_ACTIONS.NEXT;
  if (lower === "k" || name === "ArrowLeft") return CALL_ACTIONS.PREVIOUS;
  if (lower === "c") return OUTREACH.CONTACTED;
  if (lower === "x") return OUTREACH.DO_NOT_CONTACT;
  if (lower === "u") return OUTREACH.TODO;
  if (lower === "n") return CALL_ACTIONS.NOTE;
  return "";
}

/**
 * Append a preset sentence to a note.
 *
 * The result reports why nothing changed so the UI can explain itself instead
 * of silently swallowing a tap. Empty presets and duplicates are refused, and
 * a preset that would cross the limit leaves the note untouched rather than
 * cutting a word in half.
 *
 * @returns {{ note: string, added: boolean, reason: "added"|"duplicate"|"full"|"empty" }}
 */
export function appendCallNote(note, preset, limit = OUTREACH_NOTE_LIMIT) {
  const max = clampedCount(limit) || OUTREACH_NOTE_LIMIT;
  const base = String(note ?? "")
    .trim()
    .slice(0, max);
  const addition = typeof preset === "string" ? preset.trim() : "";

  if (!addition) return { note: base, added: false, reason: "empty" };
  if (base.toLowerCase().includes(addition.toLowerCase())) {
    return { note: base, added: false, reason: "duplicate" };
  }

  const next = base ? `${base} ${addition}` : addition;
  if (next.length > max) return { note: base, added: false, reason: "full" };
  return { note: next, added: true, reason: "added" };
}

/**
 * Human and machine progress for the session header.
 *
 * @returns {{ position: number, total: number, percent: number, label: string }}
 */
export function callProgress(index, total) {
  const size = clampedCount(total);
  if (!size) {
    return { position: 0, total: 0, percent: 0, label: "No leads in this session" };
  }

  const current = Math.min(
    size - 1,
    Math.max(0, Number.isFinite(index) ? Math.trunc(index) : 0),
  );
  const position = current + 1;

  return {
    position,
    total: size,
    percent: Math.round((position / size) * 100),
    label: `Lead ${position} of ${size}`,
  };
}
