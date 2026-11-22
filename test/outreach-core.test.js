import test from "node:test";
import assert from "node:assert/strict";

import {
  CALL_MARK,
  OUTREACH,
  OUTREACH_NOTE_LIMIT,
  applyOutreachEntry,
  callMarkForStatus,
  normalizeOutreachDate,
  normalizeOutreachEntry,
  normalizeOutreachNote,
  normalizeOutreachStatus,
  outreachCounts,
  outreachEntryFromLead,
  outreachEntryIsNewer,
  outreachEntryMarkSignature,
  outreachEntryStrictlyNewer,
  outreachKeyForLead,
  outreachStatusLabel,
} from "../public/outreach-core.js";

test("normalizes human and machine outreach values onto four states", () => {
  for (const value of ["Reached out", "contacted", "YES", "called", "already contacted", "true"]) {
    assert.equal(normalizeOutreachStatus(value), OUTREACH.CONTACTED, String(value));
  }
  for (const value of ["Do not contact", "DNC", "opt out", "not interested", "blocked"]) {
    assert.equal(normalizeOutreachStatus(value), OUTREACH.DO_NOT_CONTACT, String(value));
  }
  for (const value of ["To contact", "todo", "pending", "not yet", "false"]) {
    assert.equal(normalizeOutreachStatus(value), OUTREACH.TODO, String(value));
  }
  for (const value of [
    "Follow up",
    "follow-up",
    "Follow UP",
    "followup",
    "needs follow up",
    "Callback",
  ]) {
    assert.equal(normalizeOutreachStatus(value), OUTREACH.FOLLOW_UP, String(value));
  }
  assert.equal(normalizeOutreachStatus(""), null);
  assert.equal(normalizeOutreachStatus("maybe later"), null);
  assert.equal(outreachStatusLabel("reached out"), "Reached out");
  assert.equal(outreachStatusLabel("follow up"), "Follow up");
  assert.equal(outreachStatusLabel("unknown"), "To contact");
});

test("maps outreach status onto the call marker", () => {
  assert.equal(callMarkForStatus("reached out"), CALL_MARK.CALLED);
  assert.equal(callMarkForStatus("contacted"), CALL_MARK.CALLED);
  assert.equal(callMarkForStatus("follow up"), CALL_MARK.FOLLOW_UP);
  assert.equal(callMarkForStatus("follow-up"), CALL_MARK.FOLLOW_UP);
  assert.equal(callMarkForStatus("do not contact"), CALL_MARK.BLOCKED);
  assert.equal(callMarkForStatus("DNC"), CALL_MARK.BLOCKED);
  assert.equal(callMarkForStatus("to contact"), CALL_MARK.OPEN);
  assert.equal(callMarkForStatus(""), CALL_MARK.OPEN);
  assert.equal(callMarkForStatus("maybe later"), CALL_MARK.OPEN);
});

test("normalizes dates and caps notes", () => {
  assert.equal(normalizeOutreachDate("2026-10-20T15:30:00.000Z"), "2026-10-20T15:30:00.000Z");
  assert.equal(
    normalizeOutreachDate("2026-10-20T15:30:00Z"),
    "2026-10-20T15:30:00.000Z",
  );
  assert.equal(normalizeOutreachDate("not a date"), null);
  assert.equal(normalizeOutreachDate(null), null);

  const note = normalizeOutreachNote("  Call Sam on Friday  ");
  assert.equal(note, "Call Sam on Friday");
  assert.equal(normalizeOutreachNote("x".repeat(400)).length, OUTREACH_NOTE_LIMIT);
});

test("builds a stable key in place -> phone -> email -> name order", () => {
  assert.equal(
    outreachKeyForLead({
      placeId: "Place-ABC",
      phone: "512-555-0100",
      emails: ["hello@acme.example"],
      name: "Acme",
      address: "1 Main St",
    }),
    "place:place-abc",
  );
  assert.equal(
    outreachKeyForLead({
      phones: ["512-555-0100"],
      emails: ["hello@acme.example"],
      name: "Acme",
      address: "1 Main St",
    }),
    "phone:5125550100",
  );
  assert.equal(
    outreachKeyForLead({
      phones: [],
      emails: ["Hello@Acme.example"],
      name: "Acme",
      address: "1 Main St",
    }),
    "email:hello@acme.example",
  );
  assert.equal(
    outreachKeyForLead({ name: " Acme ", address: "1 Main St" }),
    "name:acme|1 main st",
  );
});

test("uses the same identity rules as duplicate detection", () => {
  // A country code must not create a second key for the same number.
  assert.equal(
    outreachKeyForLead({ phones: ["+1 (512) 555-0100"], name: "Acme" }),
    "phone:5125550100",
  );
  // A name alone is too collision-prone; the stable id takes over.
  assert.equal(
    outreachKeyForLead({ name: "Acme", id: "lead-abc123" }),
    "id:lead-abc123",
  );
  assert.equal(outreachKeyForLead({}), "id:unknown");
});

test("a timestamp alone is not an outreach mark", () => {
  assert.equal(
    normalizeOutreachEntry({ updatedAt: "2026-11-20T10:00:00.000Z" }),
    null,
  );
  assert.equal(
    normalizeOutreachEntry({ outreachUpdatedAt: "2026-11-20T10:00:00.000Z" }),
    null,
  );
  assert.equal(
    normalizeOutreachEntry({ status: "to contact", updatedAt: "2026-11-20T10:00:00.000Z" })
      .status,
    OUTREACH.TODO,
  );
});

test("resolves equal stamps to the database and only accepts strictly newer marks", () => {
  const saved = {
    status: OUTREACH.CONTACTED,
    contactedAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:05:00.000Z",
    note: null,
  };
  const sameTime = { ...saved, status: OUTREACH.FOLLOW_UP };
  const newer = { ...saved, status: OUTREACH.FOLLOW_UP, updatedAt: "2026-11-20T10:06:00.000Z" };
  const older = { ...saved, status: OUTREACH.TODO, updatedAt: "2026-11-20T10:04:00.000Z" };

  assert.equal(outreachEntryIsNewer(sameTime, saved), false);
  assert.equal(outreachEntryIsNewer(newer, saved), true);
  assert.equal(outreachEntryIsNewer(older, saved), false);
  assert.equal(outreachEntryStrictlyNewer(sameTime, saved), false);
  assert.equal(outreachEntryStrictlyNewer(newer, saved), true);
  assert.equal(outreachEntryStrictlyNewer(older, saved), false);
  assert.equal(
    outreachEntryStrictlyNewer({ status: OUTREACH.CONTACTED }, saved),
    false,
  );
});

test("compares visible marks without their write time", () => {
  assert.equal(
    outreachEntryMarkSignature({
      status: "follow-up",
      contactedAt: "2026-11-20T10:00:00.000Z",
      updatedAt: "2026-11-20T10:05:00.000Z",
      note: "Call Friday",
    }),
    outreachEntryMarkSignature({
      status: "follow up",
      contactedAt: "2026-11-20T10:00:00.000Z",
      updatedAt: "2026-11-20T10:06:00.000Z",
      note: "Call Friday",
    }),
  );
});

test("normalizes, applies and counts outreach entries", () => {
  const lead = {
    name: "Acme",
    outreachStatus: "reached out",
    contactedAt: "2026-10-20T15:30:00Z",
    outreachNote: "Spoke to Sam",
    outreachUpdatedAt: "2026-10-21T09:00:00Z",
  };
  const entry = outreachEntryFromLead(lead);
  assert.deepEqual(entry, {
    status: OUTREACH.CONTACTED,
    contactedAt: "2026-10-20T15:30:00.000Z",
    updatedAt: "2026-10-21T09:00:00.000Z",
    note: "Spoke to Sam",
  });

  const target = { name: "Other" };
  applyOutreachEntry(target, entry);
  assert.equal(target.outreachStatus, OUTREACH.CONTACTED);
  assert.equal(target.outreachNote, "Spoke to Sam");
  assert.equal(target.contactedAt, "2026-10-20T15:30:00.000Z");

  assert.equal(normalizeOutreachEntry({ status: "to contact" }).updatedAt, null);
  assert.equal(normalizeOutreachEntry({}), null);
  assert.equal(normalizeOutreachEntry({ note: "Call back" }).status, OUTREACH.TODO);

  const counts = outreachCounts([
    { outreachStatus: OUTREACH.CONTACTED },
    { outreachStatus: "reached out" },
    { outreachStatus: OUTREACH.DO_NOT_CONTACT },
    {},
    { outreachStatus: "unknown" },
  ]);
  assert.deepEqual(counts, {
    total: 5,
    toContact: 2,
    contacted: 2,
    followUp: 0,
    doNotContact: 1,
    marked: 3,
    rate: 40,
  });

  assert.deepEqual(outreachCounts([]), {
    total: 0,
    toContact: 0,
    contacted: 0,
    followUp: 0,
    doNotContact: 0,
    marked: 0,
    rate: 0,
  });

  const withFollowUp = outreachCounts([
    { outreachStatus: OUTREACH.CONTACTED },
    { outreachStatus: OUTREACH.FOLLOW_UP },
    { outreachStatus: OUTREACH.FOLLOW_UP },
    { outreachStatus: OUTREACH.DO_NOT_CONTACT },
    {},
  ]);
  assert.equal(withFollowUp.followUp, 2);
  assert.equal(withFollowUp.marked, 4);
  assert.equal(withFollowUp.rate, 60);
  assert.equal(outreachStatusLabel(OUTREACH.FOLLOW_UP), "Follow up");
});
