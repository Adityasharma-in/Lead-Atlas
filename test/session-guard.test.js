import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = await readFile(path.join(__dirname, "..", "public", "session-guard.js"), "utf8");
const SESSION_KEY = "leadAtlas.supabaseSession.v1";
const WORKSPACE_URL = "/app.html#dashboard";

const SESSION = JSON.stringify({
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_at: Date.now() + 3_600_000,
  user: { id: "user-1" },
});

class MemoryStorage {
  #items = new Map();

  constructor(entries = {}) {
    for (const [key, value] of Object.entries(entries)) this.#items.set(key, value);
  }

  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }

  removeItem(key) {
    this.#items.delete(key);
  }
}

function loadGuard({ pathname = "/", stored = null, storage } = {}) {
  const redirects = [];
  const window = {
    location: {
      pathname,
      replace(url) {
        redirects.push(url);
      },
    },
    localStorage: storage || new MemoryStorage(stored === null ? {} : { [SESSION_KEY]: stored }),
  };
  window.window = window;

  vm.runInNewContext(SOURCE, window, { filename: "session-guard.js" });
  return { redirects, window, guard: window.LeadAtlasSessionGuard };
}

describe("session guard redirect", () => {
  it("sends a signed-in home visit straight to the workspace", () => {
    const { redirects } = loadGuard({ pathname: "/", stored: SESSION });
    assert.deepEqual(redirects, [WORKSPACE_URL]);
  });

  it("also handles an explicit /index.html visit", () => {
    const { redirects } = loadGuard({ pathname: "/index.html", stored: SESSION });
    assert.deepEqual(redirects, [WORKSPACE_URL]);
  });

  it("leaves a signed-out visitor on the marketing page", () => {
    const { redirects } = loadGuard({ pathname: "/" });
    assert.deepEqual(redirects, []);
  });

  it("does not redirect any other public page", () => {
    for (const pathname of ["/pricing.html", "/how-it-works.html", "/auth.html", "/app.html"]) {
      const { redirects } = loadGuard({ pathname, stored: SESSION });
      assert.deepEqual(redirects, [], `unexpected redirect from ${pathname}`);
    }
  });

  it("ignores a malformed stored session", () => {
    for (const stored of ["not json", "{}", "null", JSON.stringify({ access_token: "a" })]) {
      const { redirects } = loadGuard({ pathname: "/", stored });
      assert.deepEqual(redirects, [], `unexpected redirect for ${stored}`);
    }
  });

  it("requires both tokens to be non-empty strings", () => {
    const cases = [
      { access_token: "", refresh_token: "r" },
      { access_token: "a", refresh_token: "" },
      { access_token: 7, refresh_token: "r" },
      { access_token: "a", refresh_token: [] },
      { refresh_token: "r" },
    ];
    for (const value of cases) {
      const { redirects } = loadGuard({ pathname: "/", stored: JSON.stringify(value) });
      assert.deepEqual(redirects, [], `unexpected redirect for ${JSON.stringify(value)}`);
    }
  });

  it("stays quiet when storage throws", () => {
    const storage = {
      getItem() {
        throw new Error("storage blocked");
      },
    };
    const { redirects } = loadGuard({ pathname: "/", storage });
    assert.deepEqual(redirects, []);
  });

  it("exposes the key and destination for callers", () => {
    const { guard } = loadGuard({ pathname: "/pricing.html" });
    assert.equal(guard.SESSION_KEY, SESSION_KEY);
    assert.equal(guard.WORKSPACE_URL, WORKSPACE_URL);
    assert.equal(
      guard.readSession(new MemoryStorage({ [SESSION_KEY]: SESSION }))?.user?.id,
      "user-1",
    );
    assert.equal(guard.shouldOpenWorkspace("/", new MemoryStorage({ [SESSION_KEY]: SESSION })), true);
    assert.equal(guard.shouldOpenWorkspace("/pricing.html", new MemoryStorage({ [SESSION_KEY]: SESSION })), false);
    assert.equal(guard.shouldOpenWorkspace("/", new MemoryStorage()), false);
  });
});
