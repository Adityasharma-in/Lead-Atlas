import test from "node:test";
import assert from "node:assert/strict";

import {
  OUTREACH_QUEUE_LIMIT,
  OUTREACH_RETRY_BASE_MS,
  OUTREACH_RETRY_MAX_MS,
  coalesceOutreachQueueEntry,
  isOutreachConstraintError,
  isUuid,
  legacyOutreachPatch,
  nextOutreachRetryDelay,
  outreachEntryFromPatch,
  outreachEntryFromSavedRow,
  outreachPatchFromLead,
  outreachPayloadFromLead,
  outreachStatusForStorage,
  outreachSyncEntryFromLead,
  outreachSyncKey,
  parseOutreachSyncQueue,
  promoteLegacyOutreachPatch,
  sameOutreachVersion,
  serializeOutreachSyncQueue,
} from "../public/outreach-sync-core.js";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";

function lead(overrides = {}) {
  return {
    name: "Acme Roofing",
    outreachKey: "place:acme-1",
    outreachStatus: "follow-up",
    contactedAt: "2026-11-20T10:00:00Z",
    outreachUpdatedAt: "2026-11-20T10:05:00Z",
    outreachNote: "Call back Friday",
    outreachSource: "local",
    savedRowId: ROW_ID,
    outreachSyncState: "pending",
    ...overrides,
  };
}

test("recognizes Supabase UUIDs and rejects other identifiers", () => {
  assert.equal(isUuid(ROW_ID), true);
  assert.equal(isUuid(ROW_ID.toUpperCase()), true);
  assert.equal(isUuid("lead-1"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid(null), false);
});

test("row versions compare by instant, not string format", () => {
  assert.equal(
    sameOutreachVersion("2026-11-20T10:06:00+00:00", "2026-11-20T10:06:00.000Z"),
    true,
  );
  assert.equal(
    sameOutreachVersion("2026-11-20T10:06:00.100Z", "2026-11-20T10:06:00.000Z"),
    false,
  );
  assert.equal(sameOutreachVersion(null, "2026-11-20T10:06:00.000Z"), false);
  assert.equal(sameOutreachVersion("not a date", "2026-11-20T10:06:00.000Z"), false);
});

test("maps follow-up to contacted only for a legacy schema", () => {
  assert.equal(outreachStatusForStorage("follow-up"), "follow-up");
  assert.equal(outreachStatusForStorage("follow-up", { legacy: true }), "contacted");
  assert.equal(outreachStatusForStorage("do not contact"), "do-not-contact");
  assert.equal(outreachStatusForStorage("follow-up", { legacy: true }), "contacted");
  assert.equal(outreachStatusForStorage("unknown"), "to-contact");
});

test("builds a precise payload without sync-only fields", () => {
  const payload = outreachPayloadFromLead(lead());
  assert.equal(payload.outreachStatus, "follow-up");
  assert.equal(payload.contactedAt, "2026-11-20T10:00:00.000Z");
  assert.equal(payload.outreachUpdatedAt, "2026-11-20T10:05:00.000Z");
  assert.equal(payload.outreachNote, "Call back Friday");
  assert.equal(payload.outreachSource, undefined);
  assert.equal(payload.savedRowId, undefined);
  assert.equal(payload.outreachSyncState, undefined);
  assert.equal(payload.name, "Acme Roofing");
});

test("writes the native column precisely, or downgrades it for a legacy schema", () => {
  const native = outreachPatchFromLead(lead());
  assert.equal(native.outreach_status, "follow-up");
  assert.equal(native.outreach_note, "Call back Friday");
  assert.equal(native.contacted_at, "2026-11-20T10:00:00.000Z");
  assert.equal(native.payload.outreachStatus, "follow-up");

  const legacy = outreachPatchFromLead(lead(), { legacy: true });
  assert.equal(legacy.outreach_status, "contacted");
  assert.equal(legacy.payload.outreachStatus, "follow-up");
  assert.equal(legacy.outreach_note, "Call back Friday");
});

test("reconstructs a follow-up from a legacy saved row", () => {
  const entry = outreachEntryFromSavedRow({
    outreach_status: "contacted",
    outreach_note: "Call back Friday",
    contacted_at: "2026-11-20T10:00:00+00:00",
    updated_at: "2026-11-20T10:06:00+00:00",
    payload: {
      outreachStatus: "follow-up",
      outreachUpdatedAt: "2026-11-20T10:05:00.000Z",
    },
  });
  assert.equal(entry.status, "follow-up");
  assert.equal(entry.contactedAt, "2026-11-20T10:00:00.000Z");
  assert.equal(entry.updatedAt, "2026-11-20T10:05:00.000Z");
  assert.equal(entry.note, "Call back Friday");
});

test("lets the native column win outside the legacy follow-up case", () => {
  const contacted = outreachEntryFromSavedRow({
    outreach_status: "contacted",
    payload: { outreachStatus: "contacted" },
  });
  assert.equal(contacted.status, "contacted");

  const blocked = outreachEntryFromSavedRow({
    outreach_status: "do-not-contact",
    payload: { outreachStatus: "follow-up" },
  });
  assert.equal(blocked.status, "do-not-contact");

  const precise = outreachEntryFromSavedRow({
    outreach_status: "follow-up",
    payload: { outreachStatus: "follow-up" },
  });
  assert.equal(precise.status, "follow-up");
});

test("does not let an untouched row's updated_at outrank a local mark", () => {
  const untouched = outreachEntryFromSavedRow({
    outreach_status: "to-contact",
    updated_at: "2026-11-20T12:00:00.000Z",
    payload: {},
  });
  assert.equal(untouched.status, "to-contact");
  assert.equal(untouched.updatedAt, null);

  const marked = outreachEntryFromSavedRow({
    outreach_status: "contacted",
    updated_at: "2026-11-20T12:00:00.000Z",
    payload: {},
  });
  assert.equal(marked.updatedAt, "2026-11-20T12:00:00.000Z");
});

test("rebuilds the precise entry from a queued patch", () => {
  const entry = outreachEntryFromPatch({
    outreach_status: "contacted",
    outreach_note: "Call back Friday",
    contacted_at: "2026-11-20T10:00:00.000Z",
    payload: {
      outreachStatus: "follow-up",
      outreachUpdatedAt: "2026-11-20T10:05:00.000Z",
    },
  });
  assert.equal(entry.status, "follow-up");
  assert.equal(entry.note, "Call back Friday");
});

test("recognizes only the outreach-status check violation", () => {
  assert.equal(
    isOutreachConstraintError({
      code: "23514",
      message:
        'new row for relation "leads" violates check constraint "leads_outreach_status_check"',
    }),
    true,
  );
  assert.equal(
    isOutreachConstraintError({
      code: "23514",
      message: 'new row for relation "leads" violates check constraint "leads_outreach_note_check"',
    }),
    false,
  );
  assert.equal(
    isOutreachConstraintError({
      code: "23503",
      message: "insert or update violates foreign key constraint",
    }),
    false,
  );
  assert.equal(isOutreachConstraintError(new TypeError("fetch failed")), false);
});

test("keys queued writes by row id first, then report and lead key", () => {
  assert.equal(
    outreachSyncKey({ reportId: REPORT_ID, rowId: ROW_ID, leadKey: "place:acme-1" }),
    `${REPORT_ID}:row:${ROW_ID}`,
  );
  assert.equal(
    outreachSyncKey({ reportId: REPORT_ID, rowId: "not-a-uuid", leadKey: "place:acme-1" }),
    `${REPORT_ID}:key:place:acme-1`,
  );
  assert.equal(outreachSyncKey({ reportId: "", leadKey: "place:acme-1" }), "");
  assert.equal(outreachSyncKey({ reportId: REPORT_ID }), "");
});

test("backs retries off exponentially up to a ceiling", () => {
  assert.equal(nextOutreachRetryDelay(0), OUTREACH_RETRY_BASE_MS);
  assert.equal(nextOutreachRetryDelay(1), OUTREACH_RETRY_BASE_MS * 2);
  assert.equal(nextOutreachRetryDelay(2), OUTREACH_RETRY_BASE_MS * 4);
  assert.equal(nextOutreachRetryDelay(99), OUTREACH_RETRY_MAX_MS);
  assert.equal(nextOutreachRetryDelay("junk"), OUTREACH_RETRY_BASE_MS);
});

test("parses, coalesces and serializes a persisted queue", () => {
  const raw = JSON.stringify({
    version: 1,
    entries: [
      {
        reportId: REPORT_ID,
        rowId: ROW_ID,
        leadKey: "place:acme-1",
        userId: "user-1",
        patch: { outreach_status: "follow-up" },
        queuedAt: "2026-11-20T10:00:00.000Z",
        attempts: 2,
        nextAttemptAt: 1234,
        lastError: "offline",
      },
      {
        reportId: REPORT_ID,
        rowId: ROW_ID,
        leadKey: "place:acme-1",
        patch: { outreach_status: "contacted" },
        queuedAt: "2026-11-20T10:01:00.000Z",
      },
      {
        reportId: REPORT_ID,
        leadKey: "place:beta-2",
        patch: { outreach_status: "do-not-contact" },
        queuedAt: "2026-11-20T09:00:00.000Z",
      },
      { reportId: REPORT_ID, patch: {} },
    ],
  });

  const parsed = parseOutreachSyncQueue(raw);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].leadKey, "place:beta-2");
  assert.equal(parsed.entries[1].patch.outreach_status, "contacted");
  assert.equal(parsed.entries[1].key, `${REPORT_ID}:row:${ROW_ID}`);

  const serialized = serializeOutreachSyncQueue(parsed.entries);
  assert.deepEqual(parseOutreachSyncQueue(serialized).entries, parsed.entries);
  assert.equal(serializeOutreachSyncQueue([]), "");
  assert.deepEqual(parseOutreachSyncQueue("not json"), { version: 1, entries: [] });
  assert.deepEqual(parseOutreachSyncQueue(null), { version: 1, entries: [] });
});

test("caps a runaway queue at the newest entries", () => {
  const entries = Array.from({ length: OUTREACH_QUEUE_LIMIT + 5 }, (_, index) => ({
    reportId: REPORT_ID,
    leadKey: `place:lead-${index}`,
    patch: { outreach_status: "contacted" },
    queuedAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
  }));

  const parsed = parseOutreachSyncQueue({ entries });
  assert.equal(parsed.entries.length, OUTREACH_QUEUE_LIMIT);
  assert.equal(parsed.entries[0].leadKey, "place:lead-5");
  assert.equal(parsed.entries.at(-1).leadKey, `place:lead-${OUTREACH_QUEUE_LIMIT + 4}`);
});

test("a new mark replaces an older queued write and resets its retry budget", () => {
  const first = outreachSyncEntryFromLead(lead(), {
    reportId: REPORT_ID,
    userId: "user-1",
    now: 1_700_000_000_000,
  });
  const failed = {
    ...first,
    attempts: 3,
    nextAttemptAt: 1_700_000_060_000,
    lastError: "offline",
  };

  const updated = outreachSyncEntryFromLead(
    lead({ outreachStatus: "contacted", outreachUpdatedAt: "2026-11-20T10:10:00.000Z" }),
    { reportId: REPORT_ID, userId: "user-1", now: 1_700_000_100_000 },
  );
  const queue = coalesceOutreachQueueEntry([failed], updated);

  assert.equal(queue.length, 1);
  assert.equal(queue[0].patch.outreach_status, "contacted");
  assert.equal(queue[0].attempts, 0);
  assert.equal(queue[0].nextAttemptAt, 0);
  assert.equal(queue[0].lastError, null);
  assert.equal(queue[0].queuedAt, first.queuedAt);
});

test("a known row id supersedes the older key-only write for the same lead", () => {
  const keyOnly = outreachSyncEntryFromLead(lead({ savedRowId: null }), {
    reportId: REPORT_ID,
    now: 1_700_000_000_000,
  });
  const withRow = outreachSyncEntryFromLead(lead(), {
    reportId: REPORT_ID,
    now: 1_700_000_050_000,
  });
  assert.equal(keyOnly.key, `${REPORT_ID}:key:place:acme-1`);

  const queue = coalesceOutreachQueueEntry([keyOnly], withRow);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].key, `${REPORT_ID}:row:${ROW_ID}`);
  assert.equal(queue[0].leadKey, "place:acme-1");
});

test("a changed lead key cannot leave a stale write for the same row", () => {
  const oldKey = outreachSyncEntryFromLead(lead(), {
    reportId: REPORT_ID,
    now: 1_700_000_000_000,
  });
  const renamed = outreachSyncEntryFromLead(lead({ outreachKey: "place:acme-renamed" }), {
    reportId: REPORT_ID,
    now: 1_700_000_050_000,
  });
  const other = outreachSyncEntryFromLead(
    lead({
      outreachKey: "place:other",
      savedRowId: "33333333-3333-4333-8333-333333333333",
    }),
    { reportId: REPORT_ID, now: 1_700_000_075_000 },
  );

  const queue = coalesceOutreachQueueEntry([oldKey, other], renamed);
  assert.equal(queue.length, 2);
  assert.equal(queue.some((item) => item.leadKey === "place:acme-1"), false);
  assert.deepEqual(
    queue.map((item) => item.leadKey).sort(),
    ["place:acme-renamed", "place:other"],
  );
});

test("builds a queue entry from a lead and prefers its saved row id", () => {
  const entry = outreachSyncEntryFromLead(
    lead({ outreachSyncedAt: "2026-11-20T10:06:00+00:00" }),
    {
      reportId: REPORT_ID,
      userId: "user-1",
      now: 1_700_000_000_000,
    },
  );
  assert.equal(entry.key, `${REPORT_ID}:row:${ROW_ID}`);
  assert.equal(entry.rowId, ROW_ID);
  assert.equal(entry.leadKey, "place:acme-1");
  assert.equal(entry.userId, "user-1");
  assert.equal(entry.baseUpdatedAt, "2026-11-20T10:06:00.000Z");
  assert.equal(entry.patch.outreach_status, "follow-up");
  assert.equal(entry.queuedAt, "2023-11-14T22:13:20.000Z");

  const fallback = outreachSyncEntryFromLead(lead({ savedRowId: "lead-1" }), {
    reportId: REPORT_ID,
  });
  assert.equal(fallback.key, `${REPORT_ID}:key:place:acme-1`);
  assert.equal(fallback.rowId, null);

  assert.equal(outreachSyncEntryFromLead(lead(), { reportId: "" }), null);
  assert.equal(outreachSyncEntryFromLead(null, { reportId: REPORT_ID }), null);
});

test("downgrades a precise patch for the legacy schema without losing the mark", () => {
  const patch = outreachPatchFromLead(lead());
  const legacy = legacyOutreachPatch(patch);

  assert.equal(legacy.outreach_status, "contacted");
  assert.equal(legacy.outreach_note, "Call back Friday");
  assert.equal(legacy.contacted_at, "2026-11-20T10:00:00.000Z");
  assert.equal(legacy.payload.outreachStatus, "follow-up");
  assert.equal(legacy.payload.outreachUpdatedAt, "2026-11-20T10:05:00.000Z");
});

test("promotes a legacy queued patch once the schema is migrated", () => {
  const patch = outreachPatchFromLead(lead());
  const legacy = legacyOutreachPatch(patch);
  const promoted = promoteLegacyOutreachPatch(legacy);

  assert.equal(promoted.outreach_status, "follow-up");
  assert.equal(promoted.outreach_note, "Call back Friday");
  assert.equal(promoted.contacted_at, "2026-11-20T10:00:00.000Z");
  assert.equal(promoted.payload.outreachStatus, "follow-up");
  assert.equal(promoted.payload.outreachUpdatedAt, "2026-11-20T10:05:00.000Z");

  // Idempotent: promoting an already precise patch changes nothing.
  assert.deepEqual(promoteLegacyOutreachPatch(promoted), promoted);
});

test("a native state that disagrees with its payload uses the row write time", () => {
  const reset = outreachEntryFromSavedRow({
    outreach_status: "to-contact",
    contacted_at: null,
    updated_at: "2026-11-20T12:00:00.000Z",
    payload: {
      outreachStatus: "contacted",
      contactedAt: "2026-11-20T09:00:00.000Z",
      outreachUpdatedAt: "2026-11-20T09:00:00.000Z",
    },
  });
  assert.equal(reset.status, "to-contact");
  assert.equal(reset.contactedAt, null);
  assert.equal(reset.updatedAt, "2026-11-20T12:00:00.000Z");

  const blocked = outreachEntryFromSavedRow({
    outreach_status: "do-not-contact",
    contacted_at: "2026-11-20T09:00:00.000Z",
    updated_at: "2026-11-20T12:00:00.000Z",
    payload: {
      outreachStatus: "contacted",
      contactedAt: "2026-11-20T09:00:00.000Z",
      outreachUpdatedAt: "2026-11-20T09:00:00.000Z",
    },
  });
  assert.equal(blocked.status, "do-not-contact");
  assert.equal(blocked.updatedAt, "2026-11-20T12:00:00.000Z");
});

test("a 'To contact' row never keeps a stale call date", () => {
  const reset = outreachEntryFromPatch({
    outreach_status: "to-contact",
    contacted_at: "2026-11-20T09:00:00.000Z",
    updated_at: "2026-11-20T12:00:00.000Z",
    payload: { outreachStatus: "contacted", contactedAt: "2026-11-20T09:00:00.000Z" },
  });
  assert.equal(reset.status, "to-contact");
  assert.equal(reset.contactedAt, null);

  // A note-only row is still a real mark; only the impossible date is dropped.
  const noted = outreachEntryFromPatch({
    outreach_status: "to-contact",
    contacted_at: "2026-11-20T09:00:00.000Z",
    outreach_note: "Call after lunch",
    payload: { outreachStatus: "to-contact" },
  });
  assert.equal(noted.status, "to-contact");
  assert.equal(noted.contactedAt, null);
  assert.equal(noted.note, "Call after lunch");
});

test("a parsed queue keeps the row version each mark was based on", () => {
  const parsed = parseOutreachSyncQueue({
    entries: [
      {
        reportId: REPORT_ID,
        rowId: ROW_ID,
        leadKey: "place:acme-1",
        baseUpdatedAt: "2026-11-20T10:06:00+00:00",
        patch: { outreach_status: "contacted" },
        queuedAt: "2026-11-20T10:07:00.000Z",
      },
    ],
  });
  assert.equal(parsed.entries[0].baseUpdatedAt, "2026-11-20T10:06:00.000Z");

  const roundTrip = parseOutreachSyncQueue(serializeOutreachSyncQueue(parsed.entries));
  assert.equal(roundTrip.entries[0].baseUpdatedAt, "2026-11-20T10:06:00.000Z");
});
