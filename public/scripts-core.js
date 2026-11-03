/**
 * Call-script library primitives.
 *
 * Pure functions only — no DOM, no storage, no network. `public/app.js` owns
 * persistence and rendering so the editor, the call sheet and the tests all
 * agree on one normalized shape.
 */

export const SCRIPT_LIMITS = Object.freeze({
  maxScripts: 60,
  titleLength: 80,
  bodyLength: 12000,
  importBytes: 2 * 1024 * 1024,
});

export const SCRIPT_STORAGE_VERSION = 1;
export const SCRIPT_STORAGE_KEY = "leadAtlas.scripts.v1";
export const SCRIPT_EXPORT_KIND = "lead-atlas-call-scripts";

export const SCRIPT_PLACEHOLDERS = Object.freeze([
  { key: "business", token: "{business}", label: "Business", hint: "Acme Plumbing" },
  { key: "category", token: "{category}", label: "Category", hint: "Plumber" },
  { key: "city", token: "{city}", label: "City", hint: "Austin" },
  { key: "address", token: "{address}", label: "Address", hint: "123 Main St" },
  { key: "phone", token: "{phone}", label: "Phone", hint: "(512) 555-0100" },
  { key: "email", token: "{email}", label: "Email", hint: "hello@acme.example" },
  { key: "website", token: "{website}", label: "Website", hint: "acme.example" },
  { key: "niche", token: "{niche}", label: "Niche", hint: "plumbers" },
  { key: "location", token: "{location}", label: "Location", hint: "Austin, TX" },
]);

const PLACEHOLDER_KEYS = new Set(SCRIPT_PLACEHOLDERS.map((entry) => entry.key));

const PLACEHOLDER_FALLBACKS = Object.freeze({
  business: "there",
  category: "business",
  city: "your area",
  address: "your location",
  phone: "this number",
  email: "your email",
  website: "your website",
  niche: "your industry",
  location: "your area",
});

const TITLE_FALLBACK = "Untitled script";
const ID_PATTERN = /^[a-z0-9_-]{1,80}$/i;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstText(...values) {
  for (const value of values) {
    const clean = text(value);
    if (clean) return clean;
  }
  return "";
}

function firstFrom(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const clean = text(entry);
      if (clean) return clean;
    }
  }
  return text(value);
}

function isoDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeId(value) {
  const id = text(value);
  return ID_PATTERN.test(id) ? id : null;
}

export function newScriptId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `scr_${cryptoApi.randomUUID().replace(/-/g, "")}`;
  }
  return `scr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeScriptTitle(value, fallback = TITLE_FALLBACK) {
  const clean = String(value ?? "")
    .replace(CONTROL_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SCRIPT_LIMITS.titleLength);
  return clean || fallback;
}

export function normalizeScriptBody(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_PATTERN, "")
    .replace(/[ \t]+$/gm, "")
    .trim()
    .slice(0, SCRIPT_LIMITS.bodyLength);
}

export function normalizeScript(raw, { now = new Date().toISOString(), fallbackId } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const id = normalizeId(raw.id) || normalizeId(fallbackId);
  if (!id) return null;

  const createdAt =
    isoDate(raw.createdAt ?? raw.created_at ?? raw.created) || isoDate(now) || new Date().toISOString();
  const updatedAt =
    isoDate(raw.updatedAt ?? raw.updated_at ?? raw.updated) || createdAt;

  return {
    id,
    title: normalizeScriptTitle(raw.title ?? raw.name ?? raw.subject),
    body: normalizeScriptBody(raw.body ?? raw.text ?? raw.script ?? raw.content),
    createdAt,
    updatedAt,
  };
}

export function createScript({ id, title, body, now = new Date().toISOString() } = {}) {
  return normalizeScript(
    {
      id: id || newScriptId(),
      title: title || TITLE_FALLBACK,
      body: body || "",
      createdAt: now,
      updatedAt: now,
    },
    { now },
  );
}

export function emptyScriptStore() {
  return { version: SCRIPT_STORAGE_VERSION, activeId: null, scripts: [] };
}

function rawScriptEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.scripts)) return raw.scripts;
  if (Array.isArray(raw?.items)) return raw.items;
  return null;
}

/**
 * Normalize anything read from storage or a file. Never throws: a corrupt
 * value becomes an empty library so boot is never blocked by a bad key.
 */
export function parseScriptStore(raw) {
  let payload = raw;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return emptyScriptStore();
    }
  }
  const entries = rawScriptEntries(payload);
  if (!entries) return emptyScriptStore();

  const scripts = [];
  const seen = new Set();
  for (let index = 0; index < entries.length && scripts.length < SCRIPT_LIMITS.maxScripts; index += 1) {
    const script = normalizeScript(entries[index], {
      fallbackId: `scr_${String(index + 1).padStart(3, "0")}`,
    });
    if (!script || seen.has(script.id)) continue;
    seen.add(script.id);
    scripts.push(script);
  }

  const requestedActive = normalizeId(payload?.activeId ?? payload?.active);
  const activeId = seen.has(requestedActive)
    ? requestedActive
    : scripts[0]?.id || null;

  return { version: SCRIPT_STORAGE_VERSION, activeId, scripts };
}

export function serializeScriptStore(store) {
  const parsed = parseScriptStore(store);
  return {
    version: SCRIPT_STORAGE_VERSION,
    activeId: parsed.activeId,
    scripts: parsed.scripts,
  };
}

export function findScript(store, id) {
  const wanted = normalizeId(id);
  if (!wanted) return null;
  return parseScriptStore(store).scripts.find((script) => script.id === wanted) || null;
}

export function activeScript(store) {
  const parsed = parseScriptStore(store);
  return parsed.scripts.find((script) => script.id === parsed.activeId) || parsed.scripts[0] || null;
}

export function upsertScript(store, script) {
  const parsed = parseScriptStore(store);
  const normalized = normalizeScript(script);
  if (!normalized) return parsed;

  const scripts = [...parsed.scripts];
  const index = scripts.findIndex((entry) => entry.id === normalized.id);
  if (index >= 0) {
    scripts[index] = normalized;
  } else {
    scripts.unshift(normalized);
    if (scripts.length > SCRIPT_LIMITS.maxScripts) scripts.length = SCRIPT_LIMITS.maxScripts;
  }

  return parseScriptStore({
    version: SCRIPT_STORAGE_VERSION,
    activeId: parsed.activeId || normalized.id,
    scripts,
  });
}

export function removeScript(store, id) {
  const parsed = parseScriptStore(store);
  const wanted = normalizeId(id);
  if (!wanted) return parsed;
  const scripts = parsed.scripts.filter((script) => script.id !== wanted);
  const activeId = parsed.activeId === wanted ? scripts[0]?.id || null : parsed.activeId;
  return parseScriptStore({ version: SCRIPT_STORAGE_VERSION, activeId, scripts });
}

export function setActiveScript(store, id) {
  const parsed = parseScriptStore(store);
  const wanted = normalizeId(id);
  if (!wanted || !parsed.scripts.some((script) => script.id === wanted)) return parsed;
  return { ...parsed, activeId: wanted };
}

function signatureFor(script) {
  return `${normalizeScriptTitle(script.title).toLowerCase()}\n${normalizeScriptBody(script.body)}`;
}

/**
 * Merge an imported library into the local one. Same id refreshes the newer
 * copy; an identical title + body is skipped so a repeated import is quiet.
 */
export function mergeScriptStores(base, incoming) {
  const target = parseScriptStore(base);
  const source = parseScriptStore(incoming);
  const scripts = [...target.scripts];
  const ids = new Set(scripts.map((script) => script.id));
  const signatures = new Set(scripts.map(signatureFor));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const script of source.scripts) {
    if (ids.has(script.id)) {
      const index = scripts.findIndex((entry) => entry.id === script.id);
      const previous = scripts[index];
      if (previous.updatedAt < script.updatedAt) {
        signatures.delete(signatureFor(previous));
        scripts[index] = script;
        signatures.add(signatureFor(script));
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const signature = signatureFor(script);
    if (signatures.has(signature)) {
      skipped += 1;
      continue;
    }

    scripts.push(script);
    ids.add(script.id);
    signatures.add(signature);
    added += 1;
  }

  const trimmed = scripts.slice(0, SCRIPT_LIMITS.maxScripts);
  const activeId =
    trimmed.some((script) => script.id === target.activeId)
      ? target.activeId
      : trimmed.some((script) => script.id === source.activeId)
        ? source.activeId
        : trimmed[0]?.id || null;

  return {
    store: parseScriptStore({ version: SCRIPT_STORAGE_VERSION, activeId, scripts: trimmed }),
    added,
    updated,
    skipped,
  };
}

export function filterScripts(scripts, query) {
  const needle = text(query).toLowerCase();
  const list = Array.isArray(scripts) ? scripts : [];
  if (!needle) return [...list];
  return list.filter((script) =>
    `${script?.title || ""}\n${script?.body || ""}`.toLowerCase().includes(needle),
  );
}

export function scriptExcerpt(body, length = 96) {
  const flat = String(body ?? "")
    .replace(CONTROL_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "No words yet.";
  const limit = Math.max(12, Number(length) || 96);
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

function siteLabel(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return raw;
  }
}

/**
 * Values offered to a script for one lead. The lead wins; the scan brief is
 * the fallback for a generic read before any row is opened.
 */
export function scriptContextFor({ lead = null, query = null } = {}) {
  const source = lead && typeof lead === "object" ? lead : {};
  const brief = query && typeof query === "object" ? query : {};
  const city = firstText(source.city);
  const address = firstText(source.address);
  const category = firstText(source.category, brief.niche);

  return {
    business: firstText(source.name) || "there",
    category: category || PLACEHOLDER_FALLBACKS.category,
    city: city || PLACEHOLDER_FALLBACKS.city,
    address: address || PLACEHOLDER_FALLBACKS.address,
    phone: firstFrom(source.phones) || firstText(source.phone) || PLACEHOLDER_FALLBACKS.phone,
    email: firstFrom(source.emails) || firstText(source.email) || PLACEHOLDER_FALLBACKS.email,
    website: siteLabel(firstText(source.domain, source.website)) || PLACEHOLDER_FALLBACKS.website,
    niche: firstText(source.searchNiche, brief.niche) || PLACEHOLDER_FALLBACKS.niche,
    location:
      firstText(source.searchLocation, brief.location, city) || PLACEHOLDER_FALLBACKS.location,
  };
}

export function fillScriptTemplate(body, context = {}) {
  const source = typeof body === "string" ? body : "";
  return source.replace(/\{\s*([a-z][a-z0-9_]*)\s*\}/gi, (match, key) => {
    const normalized = String(key).toLowerCase();
    if (!PLACEHOLDER_KEYS.has(normalized)) return match;
    return text(context[normalized]) || PLACEHOLDER_FALLBACKS[normalized] || match;
  });
}

export function scriptFromText({ name, text: source, now = new Date().toISOString(), id } = {}) {
  const body = normalizeScriptBody(source);
  if (!body) return null;
  const title =
    String(name || "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Imported script";
  return createScript({ id: id || newScriptId(), title, body, now });
}

function jsonScriptEntries(payload) {
  const entries = rawScriptEntries(payload);
  if (!entries) return null;
  return entries.map((entry, index) =>
    typeof entry === "string"
      ? { id: `scr_import_${index + 1}`, title: `Imported script ${index + 1}`, body: entry }
      : entry,
  );
}

/**
 * Parse a user-selected file. JSON can hold an exported library; any other
 * text becomes one script titled after the file.
 */
export function importScriptsContent({ name = "", text: source = "", now = new Date().toISOString() } = {}) {
  const content = String(source ?? "").trim();
  if (!content) {
    throw new Error("That file is empty. Add a script, then import it again.");
  }

  if (content.startsWith("{") || content.startsWith("[")) {
    let payload;
    try {
      payload = JSON.parse(content);
    } catch {
      throw new Error("That JSON could not be read. Export the scripts from Lead Atlas and try again.");
    }
    const entries = jsonScriptEntries(payload);
    if (!entries) {
      throw new Error("That JSON has no scripts. Export from Lead Atlas or paste a script as plain text.");
    }
    const store = parseScriptStore({
      ...(Array.isArray(payload) ? {} : payload),
      scripts: entries,
      activeId: Array.isArray(payload) ? undefined : payload.activeId,
    });
    if (!store.scripts.length) {
      throw new Error("That JSON has no readable scripts. Check the file, then try again.");
    }
    return { store, source: "json" };
  }

  const script = scriptFromText({ name, text: content, now });
  if (!script) {
    throw new Error("That file is empty. Add a script, then import it again.");
  }
  return {
    store: parseScriptStore({ scripts: [script], activeId: script.id }),
    source: "text",
  };
}

export function exportScriptsPayload(store, { now = new Date().toISOString() } = {}) {
  const parsed = parseScriptStore(store);
  return {
    app: "Lead Atlas",
    kind: SCRIPT_EXPORT_KIND,
    version: SCRIPT_STORAGE_VERSION,
    exportedAt: now,
    activeId: parsed.activeId,
    scripts: parsed.scripts,
  };
}
