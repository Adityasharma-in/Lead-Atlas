import test from "node:test";
import assert from "node:assert/strict";

import {
  SCRIPT_LIMITS,
  SCRIPT_STORAGE_VERSION,
  activeScript,
  createScript,
  emptyScriptStore,
  exportScriptsPayload,
  fillScriptTemplate,
  filterScripts,
  findScript,
  importScriptsContent,
  mergeScriptStores,
  newScriptId,
  normalizeScript,
  normalizeScriptBody,
  normalizeScriptTitle,
  parseScriptStore,
  removeScript,
  scriptContextFor,
  scriptExcerpt,
  scriptFromText,
  serializeScriptStore,
  setActiveScript,
  upsertScript,
} from "../public/scripts-core.js";

const NOW = "2026-11-03T10:00:00.000Z";
const LATER = "2026-11-03T11:00:00.000Z";

function script(id, title, body, updatedAt = NOW) {
  return { id, title, body, createdAt: NOW, updatedAt };
}

test("normalizes script titles and bodies", () => {
  assert.equal(normalizeScriptTitle("  Dentist   intro  "), "Dentist intro");
  assert.equal(normalizeScriptTitle(""), "Untitled script");
  assert.equal(normalizeScriptTitle("x".repeat(200)).length, SCRIPT_LIMITS.titleLength);

  assert.equal(
    normalizeScriptBody("  First line\r\nSecond line  \r\n\r\n  Third  "),
    "First line\nSecond line\n\n  Third",
  );
  assert.equal(normalizeScriptBody(null), "");
  assert.equal(normalizeScriptBody("x".repeat(SCRIPT_LIMITS.bodyLength + 100)).length, SCRIPT_LIMITS.bodyLength);
  assert.equal(normalizeScriptBody("bad\u0000control"), "badcontrol");
});

test("normalizes a script, dates and ids", () => {
  const normalized = normalizeScript(
    {
      id: "scr_one",
      name: "  Follow-up call ",
      text: "Hi {business}",
      created_at: LATER,
    },
    { now: NOW },
  );

  assert.deepEqual(normalized, {
    id: "scr_one",
    title: "Follow-up call",
    body: "Hi {business}",
    createdAt: LATER,
    updatedAt: LATER,
  });

  const generated = normalizeScript({ title: "No id" }, { now: NOW });
  assert.equal(generated, null);

  const recovered = normalizeScript(
    { title: "Recovered" },
    { now: NOW, fallbackId: "scr_007" },
  );
  assert.equal(recovered.id, "scr_007");
  assert.equal(recovered.createdAt, NOW);
  assert.match(newScriptId(), /^scr_[a-z0-9]+$/i);
});

test("creates and reads an empty store safely", () => {
  assert.deepEqual(emptyScriptStore(), {
    version: SCRIPT_STORAGE_VERSION,
    activeId: null,
    scripts: [],
  });

  for (const corrupt of [null, "", "{nope", 42, { scripts: "nope" }]) {
    assert.deepEqual(parseScriptStore(corrupt), emptyScriptStore());
  }
});

test("parses a store, de-duplicates ids, and repairs the active script", () => {
  const parsed = parseScriptStore({
    version: 1,
    activeId: "scr_missing",
    scripts: [
      script("scr_one", "First", "One"),
      script("scr_one", "Duplicate", "Two"),
      { title: "No id", body: "Recovered body" },
      null,
      script("scr_two", "Second", "Three"),
    ],
  });

  assert.equal(parsed.scripts.length, 3);
  assert.deepEqual(
    parsed.scripts.map((entry) => entry.id),
    ["scr_one", "scr_003", "scr_two"],
  );
  assert.equal(parsed.activeId, "scr_one");

  const explicit = parseScriptStore({
    activeId: "scr_two",
    scripts: [script("scr_one", "First", "One"), script("scr_two", "Second", "Two")],
  });
  assert.equal(explicit.activeId, "scr_two");
});

test("caps a stored library at the limit", () => {
  const scripts = Array.from({ length: SCRIPT_LIMITS.maxScripts + 5 }, (_, index) =>
    script(`scr_${index}`, `Script ${index}`, `Body ${index}`),
  );
  const parsed = parseScriptStore({ scripts });
  assert.equal(parsed.scripts.length, SCRIPT_LIMITS.maxScripts);
  assert.equal(parsed.scripts[0].title, "Script 0");
});

test("creates, upserts, removes and activates scripts", () => {
  const created = createScript({ id: "scr_one", title: "First", body: "Hello", now: NOW });
  assert.equal(created.createdAt, NOW);

  let store = upsertScript(emptyScriptStore(), created);
  assert.equal(store.activeId, "scr_one");
  assert.equal(store.scripts.length, 1);

  store = upsertScript(
    store,
    createScript({ id: "scr_two", title: "Second", body: "Later", now: LATER }),
  );
  assert.deepEqual(
    store.scripts.map((entry) => entry.id),
    ["scr_two", "scr_one"],
  );

  const replaced = upsertScript(store, {
    ...created,
    title: "First, edited",
    updatedAt: LATER,
  });
  assert.equal(replaced.scripts.length, 2);
  assert.equal(findScript(replaced, "scr_one").title, "First, edited");

  const activated = setActiveScript(replaced, "scr_one");
  assert.equal(activeScript(activated).id, "scr_one");

  const removed = removeScript(activated, "scr_one");
  assert.equal(removed.scripts.length, 1);
  assert.equal(removed.activeId, "scr_two");
  assert.equal(activeScript(removed).id, "scr_two");

  assert.deepEqual(serializeScriptStore(removed), {
    version: SCRIPT_STORAGE_VERSION,
    activeId: "scr_two",
    scripts: removed.scripts,
  });
});

test("caps additions and ignores unknown activation ids", () => {
  let store = emptyScriptStore();
  for (let index = 0; index < SCRIPT_LIMITS.maxScripts + 3; index += 1) {
    store = upsertScript(
      store,
      createScript({ id: `scr_${index}`, title: `Script ${index}`, body: "Body", now: NOW }),
    );
  }
  assert.equal(store.scripts.length, SCRIPT_LIMITS.maxScripts);

  const untouched = setActiveScript(store, "scr_missing");
  assert.equal(untouched.activeId, store.activeId);
});

test("merges imported libraries by id and signature", () => {
  const base = parseScriptStore({
    activeId: "scr_one",
    scripts: [script("scr_one", "First", "One"), script("scr_two", "Second", "Two")],
  });

  const incoming = parseScriptStore({
    activeId: "scr_three",
    scripts: [
      script("scr_one", "First", "One", NOW),
      script("scr_two", "Second, newer", "Two", LATER),
      script("scr_three", "Third", "Three"),
      script("scr_four", "Second, newer", "Two"),
    ],
  });

  const merged = mergeScriptStores(base, incoming);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.skipped, 2);
  assert.equal(merged.store.scripts.length, 3);
  assert.equal(findScript(merged.store, "scr_two").title, "Second, newer");
  assert.equal(merged.store.activeId, "scr_one");
});

test("uses the lead first and the scan brief second for placeholders", () => {
  const lead = {
    name: "Acme Plumbing",
    category: "Plumber",
    city: "Austin",
    address: "123 Main St, Austin, TX",
    phones: ["(512) 555-0100"],
    emails: ["hello@acme.example"],
    website: "https://www.acme.example/about",
    searchNiche: "emergency plumbers",
    searchLocation: "Austin, TX",
  };
  const context = scriptContextFor({ lead, query: { niche: "plumbers", location: "Texas" } });
  assert.deepEqual(context, {
    business: "Acme Plumbing",
    category: "Plumber",
    city: "Austin",
    address: "123 Main St, Austin, TX",
    phone: "(512) 555-0100",
    email: "hello@acme.example",
    website: "acme.example",
    niche: "emergency plumbers",
    location: "Austin, TX",
  });

  assert.equal(
    fillScriptTemplate(
      "Hi {business}, I saw {website}. Is {phone} the best number for {city}?",
      context,
    ),
    "Hi Acme Plumbing, I saw acme.example. Is (512) 555-0100 the best number for Austin?",
  );
});

test("fills missing and generic values, and leaves unknown tokens visible", () => {
  const generic = scriptContextFor({ query: { niche: "dentists", location: "Lisbon" } });
  assert.equal(generic.business, "there");
  assert.equal(generic.category, "dentists");
  assert.equal(generic.city, "your area");
  assert.equal(generic.location, "Lisbon");

  assert.equal(
    fillScriptTemplate(
      "Hi {business} in {city} — {phone}, {email}, {website}. {my_name} says { business }.",
      generic,
    ),
    "Hi there in your area — this number, your email, your website. {my_name} says there.",
  );

  assert.equal(fillScriptTemplate("No tokens", null), "No tokens");
  assert.equal(fillScriptTemplate(null, generic), "");
});

test("filters scripts and builds readable excerpts", () => {
  const scripts = [
    script("scr_one", "Dentist intro", "Hi there, this is a dental script."),
    script("scr_two", "Plumber follow-up", "Checking in about the website."),
  ];
  assert.deepEqual(
    filterScripts(scripts, "dental").map((entry) => entry.id),
    ["scr_one"],
  );
  assert.deepEqual(
    filterScripts(scripts, "PLUMBER").map((entry) => entry.id),
    ["scr_two"],
  );
  assert.equal(filterScripts(scripts, "").length, 2);
  assert.deepEqual(filterScripts(null, "x"), []);

  assert.equal(scriptExcerpt("  First line\n\nsecond line  "), "First line second line");
  assert.equal(scriptExcerpt(""), "No words yet.");
  assert.equal(scriptExcerpt("x".repeat(120), 20).length, 20);
});

test("imports a JSON library, a string array, and plain text", () => {
  const exported = exportScriptsPayload(
    parseScriptStore({
      activeId: "scr_one",
      scripts: [script("scr_one", "First", "One"), script("scr_two", "Second", "Two")],
    }),
    { now: NOW },
  );

  const jsonImport = importScriptsContent({
    name: "backup.json",
    text: JSON.stringify(exported),
    now: NOW,
  });
  assert.equal(jsonImport.source, "json");
  assert.equal(jsonImport.store.scripts.length, 2);
  assert.equal(jsonImport.store.activeId, "scr_one");

  const stringArray = importScriptsContent({
    name: "scripts.json",
    text: JSON.stringify(["First script", "Second script"]),
    now: NOW,
  });
  assert.equal(stringArray.store.scripts.length, 2);
  assert.equal(stringArray.store.scripts[0].title, "Imported script 1");

  const textImport = importScriptsContent({
    name: "Dentist follow-up.txt",
    text: "Hi {business}, this is a plain text script.",
    now: NOW,
  });
  assert.equal(textImport.source, "text");
  assert.equal(textImport.store.scripts[0].title, "Dentist follow up");
  assert.equal(textImport.store.scripts[0].body, "Hi {business}, this is a plain text script.");
  assert.equal(textImport.store.activeId, textImport.store.scripts[0].id);
});

test("import failures explain what to fix", () => {
  assert.throws(() => importScriptsContent({ name: "empty.txt", text: "   " }), /file is empty/);
  assert.throws(
    () => importScriptsContent({ name: "bad.json", text: "{not json" }),
    /JSON could not be read/,
  );
  assert.throws(
    () => importScriptsContent({ name: "leads.json", text: JSON.stringify({ leads: [] }) }),
    /no scripts/,
  );
  assert.throws(
    () => importScriptsContent({ name: "none.json", text: JSON.stringify({ scripts: [null] }) }),
    /no readable scripts/,
  );
});

test("builds an export payload and imports it back without loss", () => {
  const store = parseScriptStore({
    activeId: "scr_two",
    scripts: [script("scr_one", "First", "One"), script("scr_two", "Second", "Two")],
  });
  const payload = exportScriptsPayload(store, { now: NOW });
  assert.equal(payload.app, "Lead Atlas");
  assert.equal(payload.kind, "lead-atlas-call-scripts");
  assert.equal(payload.version, SCRIPT_STORAGE_VERSION);
  assert.equal(payload.exportedAt, NOW);
  assert.equal(payload.activeId, "scr_two");
  assert.equal(payload.scripts.length, 2);

  const roundTrip = importScriptsContent({
    name: "backup.json",
    text: JSON.stringify(payload),
    now: LATER,
  });
  assert.deepEqual(roundTrip.store.scripts, store.scripts);
});

test("titles a text import from its filename and trims separators", () => {
  const imported = scriptFromText({
    name: "plumber-first_call.md",
    text: "Hello",
    now: NOW,
    id: "scr_text",
  });
  assert.equal(imported.title, "plumber first call");
  assert.equal(imported.id, "scr_text");
  assert.equal(scriptFromText({ name: "empty.txt", text: "" }), null);
});
