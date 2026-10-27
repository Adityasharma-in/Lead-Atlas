import test from "node:test";
import assert from "node:assert/strict";

import {
  OUTREACH,
  OUTREACH_NOTE_LIMIT,
  applyOutreachEntry,
  normalizeOutreachDate,
  normalizeOutreachEntry,
  normalizeOutreachNote,
  normalizeOutreachStatus,
  outreachCounts,
  outreachEntryFromLead,
  outreachKeyForLead,
  outreachStatusLabel,
} from "../public/outreach-core.js";

test("normalizes human and machine outreach values onto three states", () => {
  for (const value of ["Reached out", "contacted", "YES", "called", "already contacted", "true"]) {
    assert.equal(normalizeOutreachStatus(value), OUTREACH.CONTACTED, String(value));
  }
  for (const value of ["Do not contact", "DNC", "opt out", "not interested", "blocked"]) {
    assert.equal(normalizeOutreachStatus(value), OUTREACH.DO_NOT_CONTACT, String(value));
  }
  for (const value of ["To contact", "todo", "pending", "not yet", "false"]) {
    assert.equal(normalizeOutreachStatus(value), OUTREACH.TODO, String(value));
  }
  assert.equal(normalizeOutreachStatus(""), null);
  assert.equal(normalizeOutreachStatus("maybe later"), null);
  assert.equal(outreachStatusLabel("reached out"), "Reached out");
  assert.equal(outreachStatusLabel("unknown"), "To contact");
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
    doNotContact: 1,
    marked: 3,
    rate: 40,
  });

  assert.deepEqual(outreachCounts([]), {
    total: 0,
    toContact: 0,
    contacted: 0,
    doNotContact: 0,
    marked: 0,
    rate: 0,
  });
});
