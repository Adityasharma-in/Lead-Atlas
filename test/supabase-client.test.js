import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = await readFile(
  path.join(__dirname, '..', 'public', 'supabase-client.js'),
  'utf8',
);

class MemoryStorage {
  #items = new Map();

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

class FakeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function createClient(fetchImpl, { localStorage: sharedStorage } = {}) {
  const localStorage = sharedStorage || new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const location = {
    origin: 'http://127.0.0.1:4317',
    pathname: '/',
    href: 'http://127.0.0.1:4317/',
    hash: '',
    search: '',
  };

  const window = {
    location,
    localStorage,
    sessionStorage,
    document: { title: 'Lead Atlas' },
    history: { replaceState() {} },
    addEventListener() {},
    dispatchEvent() {},
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    crypto: webcrypto,
    TextEncoder,
    URL,
    URLSearchParams,
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: fetchImpl,
    CustomEvent: FakeCustomEvent,
    console,
  };
  window.window = window;

  const context = vm.createContext(window);
  vm.runInContext(SOURCE, context, { filename: 'supabase-client.js' });

  const client = context.LeadAtlasSupabase;
  client.configure({
    configured: true,
    url: 'https://demo-project.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.public-anon-key',
  });
  return { client, location, localStorage, sessionStorage };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('supabase-client redirect handling', () => {
  it('remembers a recovery request and returns recovery from a bare PKCE callback', async () => {
    const calls = [];
    const { client, location, localStorage } = createClient(async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes('/auth/v1/recover')) return jsonResponse({});
      if (url.includes('/auth/v1/token?grant_type=pkce')) {
        return jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          user: { id: 'user-1', email: 'field@example.com' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await client.sendRecovery('field@example.com');
    assert.ok(localStorage.getItem('leadAtlas.supabasePkce.v1'));
    assert.equal(localStorage.getItem('leadAtlas.supabaseAuthIntent.v1'), 'recovery');

    // Supabase's PKCE callback is often just ?code=... without a type.
    location.href = 'http://127.0.0.1:4317/?code=test-code';
    location.search = '?code=test-code';

    const result = await client.handleRedirect();
    assert.equal(result.type, 'recovery');
    assert.equal(result.error, null);
    assert.equal(result.session?.access_token, 'access-token');
    assert.equal(localStorage.getItem('leadAtlas.supabaseAuthIntent.v1'), null);

    const exchange = calls.find((call) => call.url.includes('grant_type=pkce'));
    assert.ok(exchange);
    const body = JSON.parse(exchange.options.body);
    assert.equal(body.auth_code, 'test-code');
    assert.ok(body.code_verifier);
  });

  it('lets an explicit type in the callback URL win over the stored intent', async () => {
    const { client, location } = createClient(async (url) => {
      if (url.includes('/auth/v1/otp')) return jsonResponse({});
      if (url.includes('/auth/v1/token?grant_type=pkce')) {
        return jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          user: { id: 'user-1' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await client.signInWithOtp({ email: 'field@example.com' });
    location.href = 'http://127.0.0.1:4317/?code=test-code&type=recovery';
    location.search = '?code=test-code&type=recovery';

    const result = await client.handleRedirect();
    assert.equal(result.type, 'recovery');
    assert.equal(result.session?.access_token, 'access-token');
  });

  it('survives the callback opening in a new tab (shared localStorage)', async () => {
    const { client, location, localStorage, sessionStorage } = createClient(async (url) => {
      if (url.includes('/auth/v1/recover')) return jsonResponse({});
      if (url.includes('/auth/v1/token?grant_type=pkce')) {
        return jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          user: { id: 'user-1' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await client.sendRecovery('field@example.com');
    // A new tab gets a fresh sessionStorage but shares localStorage.
    sessionStorage.removeItem('leadAtlas.supabasePkce.v1');
    sessionStorage.removeItem('leadAtlas.supabaseAuthIntent.v1');
    assert.ok(localStorage.getItem('leadAtlas.supabasePkce.v1'));

    location.href = 'http://127.0.0.1:4317/?code=test-code';
    location.search = '?code=test-code';

    const result = await client.handleRedirect();
    assert.equal(result.type, 'recovery');
    assert.equal(result.error, null);
    assert.equal(result.session?.access_token, 'access-token');
  });
});

describe('supabase-client session persistence and refresh', () => {
  const SESSION_KEY = 'leadAtlas.supabaseSession.v1';
  const authPayload = (overrides = {}) => ({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1' },
    ...overrides,
  });

  it('keeps a stored millisecond expiry stable across reloads', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('grant_type=password')) return jsonResponse(authPayload());
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const first = createClient(fetchImpl);
    await first.client.signInWithPassword({
      email: 'field@example.com',
      password: 'secret1',
    });

    const stored = JSON.parse(first.localStorage.getItem(SESSION_KEY));
    assert.ok(stored.expires_at > 1e12, 'stored expiry should be milliseconds');
    assert.ok(Math.abs(stored.expires_at - (Date.now() + 3_600_000)) < 10_000);

    // A reload creates a new client over the same storage. It must not treat
    // the stored milliseconds as seconds and multiply them again.
    const second = createClient(fetchImpl, { localStorage: first.localStorage });
    const reloaded = await second.client.getSession();
    assert.equal(reloaded.expires_at, stored.expires_at);
  });

  it('trusts expires_in for fresh tokens when the absolute expires_at is skewed', async () => {
    const skewedExpiries = [
      // Server clock behind this machine: expires_at looks already past.
      Math.floor(Date.now() / 1000) - 3_600,
      // Server clock ahead: expires_at looks decades away.
      Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3_600,
    ];

    for (const expiresAt of skewedExpiries) {
      let refreshCalls = 0;
      const fetchImpl = async (url) => {
        if (url.includes('grant_type=password')) {
          return jsonResponse(authPayload({ expires_at: expiresAt }));
        }
        if (url.includes('grant_type=refresh_token')) {
          refreshCalls += 1;
          throw new Error('a fresh token must not refresh');
        }
        throw new Error(`Unexpected fetch: ${url}`);
      };
      const { client, localStorage } = createClient(fetchImpl);
      const session = await client.signInWithPassword({
        email: 'field@example.com',
        password: 'secret1',
      });

      // The relative lifetime wins, so the stored expiry stays one hour out.
      assert.ok(
        Math.abs(session.expires_at - (Date.now() + 3_600_000)) < 10_000,
        `expires_at ${expiresAt} should not override expires_in`,
      );
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY));
      assert.equal(stored.expires_at, session.expires_at);

      // A reload must keep that value and must not trigger a refresh loop.
      const reload = createClient(fetchImpl, { localStorage });
      const reloaded = await reload.client.getSession();
      assert.equal(reloaded.expires_at, stored.expires_at);
      assert.equal(refreshCalls, 0);
    }
  });

  it('adopts a newer session from another tab when a refresh fails', async () => {
    const shared = new MemoryStorage();
    let refreshCalls = 0;
    const fetchImpl = async (url) => {
      if (url.includes('grant_type=password')) {
        return jsonResponse(authPayload({ refresh_token: 'old-refresh' }));
      }
      if (url.includes('grant_type=refresh_token')) {
        refreshCalls += 1;
        // Another tab won the race while this request was in flight.
        shared.setItem(
          SESSION_KEY,
          JSON.stringify({
            ...authPayload({
              access_token: 'new-access',
              refresh_token: 'new-refresh',
            }),
            expires_at: Date.now() + 3_600_000,
          }),
        );
        return jsonResponse(
          { error: 'invalid_grant', error_description: 'Invalid Refresh Token' },
          400,
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const { client, localStorage } = createClient(fetchImpl, { localStorage: shared });
    const events = [];
    client.onAuthStateChange((event) => events.push(event));

    await client.signInWithPassword({
      email: 'field@example.com',
      password: 'secret1',
    });
    events.length = 0;

    const refreshed = await client.refreshSession();
    assert.equal(refreshCalls, 1);
    assert.equal(refreshed.refresh_token, 'new-refresh');
    assert.equal(
      JSON.parse(localStorage.getItem(SESSION_KEY)).refresh_token,
      'new-refresh',
    );
    assert.deepEqual(events, ['TOKEN_REFRESHED']);
  });

  it('keeps the session on a transient refresh failure', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('grant_type=password')) return jsonResponse(authPayload());
      if (url.includes('grant_type=refresh_token')) throw new TypeError('fetch failed');
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const { client, localStorage } = createClient(fetchImpl);
    const events = [];
    client.onAuthStateChange((event) => events.push(event));

    await client.signInWithPassword({
      email: 'field@example.com',
      password: 'secret1',
    });
    events.length = 0;

    const refreshed = await client.refreshSession();
    assert.equal(refreshed.refresh_token, 'refresh-token');
    assert.ok(localStorage.getItem(SESSION_KEY));
    assert.ok(!events.includes('SIGNED_OUT'));
  });

  it('clears the session when the refresh token is truly invalid', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('grant_type=password')) return jsonResponse(authPayload());
      if (url.includes('grant_type=refresh_token')) {
        return jsonResponse(
          { error: 'invalid_grant', error_description: 'Invalid Refresh Token' },
          400,
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const { client, localStorage } = createClient(fetchImpl);
    const events = [];
    client.onAuthStateChange((event) => events.push(event));

    await client.signInWithPassword({
      email: 'field@example.com',
      password: 'secret1',
    });
    events.length = 0;

    await assert.rejects(client.refreshSession(), /Invalid Refresh Token/);
    assert.equal(localStorage.getItem(SESSION_KEY), null);
    assert.ok(events.includes('SIGNED_OUT'));
  });
});
