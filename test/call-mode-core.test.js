import test from "node:test";
import assert from "node:assert/strict";

import { OUTREACH, OUTREACH_NOTE_LIMIT } from "../public/outreach-core.js";
import {
  CALL_ACTIONS,
  CALL_NOTE_PRESETS,
  appendCallNote,
  callProgress,
  planCallSession,
  resolveCallShortcut,
  stepCallQueue,
} from "../public/call-mode-core.js";

const lead = (id, outreachStatus) => ({ id, name: `Lead ${id}`, outreachStatus });

test("planCallSession keeps report order and starts on the requested lead", () => {
  const leads = [
    lead("a", OUTREACH.TODO),
    lead("b", OUTREACH.CONTACTED),
    lead("c", OUTREACH.TODO),
  ];
  assert.deepEqual(planCallSession(leads, { leadId: "b" }), {
    ids: ["a", "b", "c"],
    startIndex: 1,
  });
});

test("planCallSession starts on the first lead that is not reached out", () => {
  const leads = [
    lead("a", OUTREACH.CONTACTED),
    lead("b", OUTREACH.CONTACTED),
    lead("c", OUTREACH.TODO),
  ];
  assert.deepEqual(planCallSession(leads), { ids: ["a", "b", "c"], startIndex: 2 });
});

test("planCallSession falls back to the first lead when every lead is reached out", () => {
  const leads = [lead("a", OUTREACH.CONTACTED), lead("b", OUTREACH.CONTACTED)];
  assert.deepEqual(planCallSession(leads), { ids: ["a", "b"], startIndex: 0 });
});

test("planCallSession skips do-not-contact leads unless asked for them", () => {
  const leads = [
    lead("a", OUTREACH.TODO),
    lead("b", OUTREACH.DO_NOT_CONTACT),
    lead("c", OUTREACH.CONTACTED),
  ];
  assert.deepEqual(planCallSession(leads), { ids: ["a", "c"], startIndex: 0 });
  assert.deepEqual(planCallSession(leads, { includeBlocked: true }), {
    ids: ["a", "b", "c"],
    startIndex: 0,
  });
});

test("planCallSession skips a requested blocked lead and starts on the first open lead", () => {
  const leads = [
    lead("a", OUTREACH.CONTACTED),
    lead("b", OUTREACH.DO_NOT_CONTACT),
    lead("c", OUTREACH.TODO),
  ];
  assert.deepEqual(planCallSession(leads, { leadId: "b" }), {
    ids: ["a", "c"],
    startIndex: 1,
  });
});

test("planCallSession drops duplicate ids and entries without a usable id", () => {
  const leads = [
    lead("a", OUTREACH.TODO),
    lead("a", OUTREACH.CONTACTED),
    { name: "No id" },
    { id: "   " },
    lead("b", OUTREACH.TODO),
  ];
  assert.deepEqual(planCallSession(leads), { ids: ["a", "b"], startIndex: 0 });
});

test("planCallSession returns an empty plan for missing or empty input", () => {
  assert.deepEqual(planCallSession(), { ids: [], startIndex: -1 });
  assert.deepEqual(planCallSession([]), { ids: [], startIndex: -1 });
  assert.deepEqual(planCallSession([lead("x", OUTREACH.DO_NOT_CONTACT)]), {
    ids: [],
    startIndex: -1,
  });
});

test("planCallSession treats an unknown status as still to contact", () => {
  const leads = [lead("a", "something else"), lead("b", "contacted")];
  assert.deepEqual(planCallSession(leads), { ids: ["a", "b"], startIndex: 0 });
});

test("stepCallQueue walks forward without wrapping", () => {
  assert.deepEqual(stepCallQueue(0, 3), { index: 1, done: false, moved: true });
  assert.deepEqual(stepCallQueue(1, 3), { index: 2, done: false, moved: true });
  assert.deepEqual(stepCallQueue(2, 3), { index: 2, done: true, moved: false });
});

test("stepCallQueue walks backward and clamps at the first lead", () => {
  assert.deepEqual(stepCallQueue(2, 3, -1), { index: 1, done: false, moved: true });
  assert.deepEqual(stepCallQueue(1, 3, -1), { index: 0, done: false, moved: true });
  assert.deepEqual(stepCallQueue(0, 3, -1), { index: 0, done: false, moved: false });
});

test("stepCallQueue handles an empty queue and an out-of-range index", () => {
  assert.deepEqual(stepCallQueue(0, 0), { index: 0, done: true, moved: false });
  assert.deepEqual(stepCallQueue(9, 3), { index: 2, done: true, moved: false });
  assert.deepEqual(stepCallQueue(-4, 3), { index: 1, done: false, moved: true });
  assert.deepEqual(stepCallQueue(Number.NaN, 2), { index: 1, done: false, moved: true });
});

test("resolveCallShortcut maps navigation keys", () => {
  assert.equal(resolveCallShortcut({ key: "j" }), CALL_ACTIONS.NEXT);
  assert.equal(resolveCallShortcut({ key: "J" }), CALL_ACTIONS.NEXT);
  assert.equal(resolveCallShortcut({ key: "ArrowRight" }), CALL_ACTIONS.NEXT);
  assert.equal(resolveCallShortcut({ key: "k" }), CALL_ACTIONS.PREVIOUS);
  assert.equal(resolveCallShortcut({ key: "ArrowLeft" }), CALL_ACTIONS.PREVIOUS);
  assert.equal(resolveCallShortcut({ key: "n" }), CALL_ACTIONS.NOTE);
});

test("resolveCallShortcut maps outcome keys onto the three outreach states", () => {
  assert.equal(resolveCallShortcut({ key: "c" }), OUTREACH.CONTACTED);
  assert.equal(resolveCallShortcut({ key: "C" }), OUTREACH.CONTACTED);
  assert.equal(resolveCallShortcut({ key: "x" }), OUTREACH.DO_NOT_CONTACT);
  assert.equal(resolveCallShortcut({ key: "u" }), OUTREACH.TODO);
});

test("resolveCallShortcut ignores typing, modifiers, repeats, and unknown keys", () => {
  assert.equal(resolveCallShortcut({ key: "c", typing: true }), "");
  assert.equal(resolveCallShortcut({ key: "j", repeat: true }), "");
  assert.equal(resolveCallShortcut({ key: "j", meta: true }), "");
  assert.equal(resolveCallShortcut({ key: "j", ctrl: true }), "");
  assert.equal(resolveCallShortcut({ key: "j", alt: true }), "");
  assert.equal(resolveCallShortcut({ key: "ArrowUp" }), "");
  assert.equal(resolveCallShortcut({ key: "Enter" }), "");
  assert.equal(resolveCallShortcut({ key: "" }), "");
  assert.equal(resolveCallShortcut(), "");
});

test("appendCallNote joins a preset with a single space", () => {
  const result = appendCallNote("Asked about pricing.", "Answered the call.");
  assert.deepEqual(result, {
    note: "Asked about pricing. Answered the call.",
    added: true,
    reason: "added",
  });
});

test("appendCallNote starts an empty note with the preset", () => {
  assert.deepEqual(appendCallNote("   ", "Answered the call."), {
    note: "Answered the call.",
    added: true,
    reason: "added",
  });
  assert.deepEqual(appendCallNote(null, "Answered the call."), {
    note: "Answered the call.",
    added: true,
    reason: "added",
  });
});

test("appendCallNote refuses duplicates case-insensitively", () => {
  const result = appendCallNote("ANSWERED THE CALL.", "Answered the call.");
  assert.deepEqual(result, {
    note: "ANSWERED THE CALL.",
    added: false,
    reason: "duplicate",
  });
});

test("appendCallNote refuses a preset that would cross the limit", () => {
  const note = "x".repeat(OUTREACH_NOTE_LIMIT - 5);
  const result = appendCallNote(note, "Answered the call.");
  assert.equal(result.added, false);
  assert.equal(result.reason, "full");
  assert.equal(result.note, note);
});

test("appendCallNote accepts a preset that fills the limit exactly", () => {
  const preset = "Answered the call.";
  const note = "x".repeat(OUTREACH_NOTE_LIMIT - preset.length - 1);
  const result = appendCallNote(note, preset);
  assert.equal(result.added, true);
  assert.equal(result.note.length, OUTREACH_NOTE_LIMIT);
});

test("appendCallNote ignores an empty preset", () => {
  assert.deepEqual(appendCallNote("Keep this", "   "), {
    note: "Keep this",
    added: false,
    reason: "empty",
  });
});

test("callProgress reports a human position and percent", () => {
  assert.deepEqual(callProgress(0, 4), {
    position: 1,
    total: 4,
    percent: 25,
    label: "Lead 1 of 4",
  });
  assert.deepEqual(callProgress(3, 4), {
    position: 4,
    total: 4,
    percent: 100,
    label: "Lead 4 of 4",
  });
});

test("callProgress clamps out-of-range indexes and handles an empty queue", () => {
  assert.deepEqual(callProgress(-3, 2), {
    position: 1,
    total: 2,
    percent: 50,
    label: "Lead 1 of 2",
  });
  assert.deepEqual(callProgress(99, 2), {
    position: 2,
    total: 2,
    percent: 100,
    label: "Lead 2 of 2",
  });
  assert.deepEqual(callProgress(0, 0), {
    position: 0,
    total: 0,
    percent: 0,
    label: "No leads in this session",
  });
});

test("note presets are unique, short, and safe to append", () => {
  const ids = new Set();
  for (const preset of CALL_NOTE_PRESETS) {
    assert.equal(ids.has(preset.id), false, `duplicate preset id ${preset.id}`);
    ids.add(preset.id);
    assert.ok(preset.label.trim(), `${preset.id} needs a label`);
    assert.ok(preset.text.trim(), `${preset.id} needs text`);
    assert.equal(preset.text, preset.text.trim(), `${preset.id} text is not trimmed`);
    assert.ok(
      preset.text.length <= OUTREACH_NOTE_LIMIT,
      `${preset.id} is longer than the note limit`,
    );
    assert.equal(appendCallNote("", preset.text).added, true, `${preset.id} could not append`);
  }
});
