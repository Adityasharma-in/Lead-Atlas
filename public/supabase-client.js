/* ============================================================
   Lead Atlas — small Supabase client
   ============================================================
   A dependency-free browser client for the two Supabase services
   Lead Atlas needs: GoTrue (auth) and PostgREST (database).

   The anon key is public by design. Every table is protected by
   row level security, so the browser can only read and write the
   signed-in user's own rows.

   Exposes window.LeadAtlasSupabase.
   ============================================================ */
(function (global) {
  "use strict";

  const SESSION_KEY = "leadAtlas.supabaseSession.v1";
  const PKCE_KEY = "leadAtlas.supabasePkce.v1";
  const AUTH_INTENT_KEY = "leadAtlas.supabaseAuthIntent.v1";
  const AUTH_EVENT = "lead-atlas:auth";
  const REFRESH_MARGIN_MS = 90 * 1000;

  let config = { url: null, anonKey: null, configured: false };
  let session = null;
  let refreshTimer = null;
  let refreshPromise = null;
  let initialized = false;

  class SupabaseError extends Error {
    constructor(message, { code = "SUPABASE_ERROR", status = 0, details = null } = {}) {
      super(message);
      this.name = "SupabaseError";
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }

  function isConfigured() {
    return Boolean(config.configured && config.url && config.anonKey);
  }

  function configure(next = {}) {
    const url = String(next.url || "").trim().replace(/\/+$/, "");
    const anonKey = String(next.anonKey || "").trim();
    config = {
      url: url || null,
      anonKey: anonKey || null,
      configured: Boolean(next.configured && url && anonKey),
    };
    if (!config.configured) {
      session = null;
      initialized = false;
      stopRefreshTimer();
      // Keep the stored session. A transient config failure (server restarting,
      // missing env for a moment) must not sign every open tab out.
    } else if (!initialized) {
      initialized = true;
      session = readStoredSession();
      scheduleRefresh();
    }
    emit("CONFIGURED");
    return config;
  }

  function getConfig() {
    return { ...config };
  }

  /* ---------------- storage ---------------- */

  function readStoredSession() {
    try {
      const raw = global.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.access_token || !parsed?.refresh_token) return null;
      return normalizeSession(parsed, { stored: true });
    } catch {
      return null;
    }
  }

  function writeStoredSession(next) {
    try {
      if (!next) global.localStorage.removeItem(SESSION_KEY);
      else global.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      /* private mode / storage disabled */
    }
  }

  function normalizeSession(payload, { stored = false } = {}) {
    if (!payload?.access_token) return null;
    const expiresIn = Number(payload.expires_in) || 3600;
    const rawExpiresAt = Number(payload.expires_at);
    let expiresAt;

    // A fresh GoTrue response gives both `expires_in` and an absolute
    // `expires_at`. Prefer the relative lifetime: a wrong system clock must not
    // make a brand-new token look expired (which would refresh in a loop and
    // briefly flash the workspace before signing the user out).
    if (!stored && Number(payload.expires_in) > 0) {
      expiresAt = Date.now() + expiresIn * 1000;
    } else if (Number.isFinite(rawExpiresAt) && rawExpiresAt > 0) {
      // Stored values are milliseconds. Older builds stored seconds, so treat
      // anything below the millisecond epoch as seconds exactly once.
      expiresAt = rawExpiresAt < 1e12 ? rawExpiresAt * 1000 : rawExpiresAt;
    } else {
      expiresAt = Date.now() + expiresIn * 1000;
    }

    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      token_type: payload.token_type || "bearer",
      expires_in: expiresIn,
      expires_at: expiresAt,
      user: payload.user || null,
    };
  }

  function setSession(next, event = "SIGNED_IN") {
    session = next ? normalizeSession(next) : null;
    writeStoredSession(session);
    scheduleRefresh();
    if (session) emit(event, session);
    else emit("SIGNED_OUT", null);
    return session;
  }

  function emit(event, detail = null) {
    const payload = { event, session: detail?.access_token ? detail : session, user: detail?.user || session?.user || null };
    global.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: payload }));
    for (const listener of listeners) {
      try {
        listener(event, payload.session, payload.user);
      } catch (error) {
        console.warn("[lead-atlas] Auth listener failed.", error);
      }
    }
  }

  const listeners = new Set();
  function onAuthStateChange(callback) {
    if (typeof callback !== "function") return () => {};
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  /* ---------------- session refresh ---------------- */

  function stopRefreshTimer() {
    if (refreshTimer) global.clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function scheduleRefresh() {
    stopRefreshTimer();
    if (!session?.refresh_token) return;
    const remaining = Number(session.expires_at) - Date.now();
    const wait = Number.isFinite(remaining)
      ? Math.min(2_147_000_000, Math.max(5_000, remaining - REFRESH_MARGIN_MS))
      : 60_000;
    refreshTimer = global.setTimeout(() => {
      refreshSession().catch(() => {
        /* refreshSession decides whether this is a real sign-out */
      });
    }, wait);
  }

  function scheduleRefreshRetry() {
    stopRefreshTimer();
    refreshTimer = global.setTimeout(() => {
      refreshSession().catch(() => {
        /* a later attempt can recover */
      });
    }, 30_000);
  }

  // Only one tab should exchange a rotating refresh token at a time. Without
  // this, two tabs can refresh together, the loser gets an invalid-token error
  // and signs every tab out — which looks like the dashboard flashing away.
  function withRefreshLock(task) {
    const locks = global.navigator?.locks;
    if (locks?.request) return locks.request("leadAtlas.supabaseRefresh.v1", task);
    return task();
  }

  function adoptNewerStoredSession(attemptedRefreshToken) {
    const stored = readStoredSession();
    if (stored?.refresh_token && stored.refresh_token !== attemptedRefreshToken) {
      session = stored;
      scheduleRefresh();
      emit("TOKEN_REFRESHED", session);
      return session;
    }
    return null;
  }

  function recoverFromRefreshFailure(error, attemptedRefreshToken) {
    const adopted = adoptNewerStoredSession(attemptedRefreshToken);
    if (adopted) return adopted;

    const status = Number(error?.status) || 0;
    const transient = status === 0 || status === 429 || status >= 500;
    if (transient) {
      // A network blip or rate limit is not a reason to destroy a valid local
      // session. Keep it and retry; the next API call can also refresh.
      scheduleRefreshRetry();
      return session;
    }

    session = null;
    writeStoredSession(null);
    stopRefreshTimer();
    emit("SIGNED_OUT", null);
    throw error;
  }

  async function refreshSession() {
    if (!session?.refresh_token) return null;
    if (refreshPromise) return refreshPromise;
    const attemptedRefreshToken = session.refresh_token;
    refreshPromise = (async () => {
      try {
        return await withRefreshLock(async () => {
          const adopted = adoptNewerStoredSession(attemptedRefreshToken);
          if (adopted) return adopted;
          if (!session) return null;

          const payload = await authRequest(
            "/token?grant_type=refresh_token",
            { refresh_token: attemptedRefreshToken },
            { auth: false },
          );
          return setSession(payload, "TOKEN_REFRESHED");
        });
      } catch (error) {
        return recoverFromRefreshFailure(error, attemptedRefreshToken);
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function getSession({ refresh = true } = {}) {
    if (!isConfigured()) return null;
    if (!session) session = readStoredSession();
    if (!session) return null;
    if (refresh && session.expires_at - Date.now() < REFRESH_MARGIN_MS) {
      try {
        return await refreshSession();
      } catch {
        // recoverFromRefreshFailure clears `session` only for a definitive
        // invalid-token response. Transient failures return the old session.
        return session;
      }
    }
    return session;
  }

  async function getUser() {
    const current = await getSession();
    return current?.user || null;
  }

  /* ---------------- HTTP ---------------- */

  function authHeaders(accessToken) {
    const headers = {
      apikey: config.anonKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json().catch(() => null);
    }
    const text = await response.text().catch(() => "");
    return text || null;
  }

  function errorFromPayload(payload, status) {
    const message =
      payload?.error_description ||
      payload?.msg ||
      payload?.message ||
      payload?.error?.description ||
      payload?.error ||
      `Supabase returned HTTP ${status}.`;
    const code = payload?.error_code || payload?.code || payload?.error?.code || "SUPABASE_ERROR";
    return new SupabaseError(String(message), {
      code: String(code),
      status,
      details: payload,
    });
  }

  async function authRequest(path, body, { auth = false, method = "POST", query = "" } = {}) {
    if (!isConfigured()) {
      throw new SupabaseError(
        "Supabase is not connected yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to the .env file, then restart the app.",
        { code: "NOT_CONFIGURED" },
      );
    }
    const current = auth ? await getSession() : null;
    const response = await fetch(`${config.url}/auth/v1${path}${query}`, {
      method,
      headers: authHeaders(current?.access_token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      if (auth && response.status === 401 && current?.refresh_token) {
        const refreshed = await refreshSession().catch(() => null);
        if (refreshed) return authRequest(path, body, { auth, method, query });
      }
      throw errorFromPayload(payload, response.status);
    }
    return payload;
  }

  async function restRequest(table, {
    method = "GET",
    query = "",
    body,
    prefer,
    range,
    returnHeaders = false,
  } = {}) {
    if (!isConfigured()) {
      throw new SupabaseError(
        "Supabase is not connected yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to the .env file, then restart the app.",
        { code: "NOT_CONFIGURED" },
      );
    }
    const current = await getSession();
    if (!current?.access_token) {
      throw new SupabaseError("Sign in to save and open your lead library.", {
        code: "AUTH_REQUIRED",
        status: 401,
      });
    }

    const headers = authHeaders(current.access_token);
    headers["Accept-Profile"] = "public";
    headers["Content-Profile"] = "public";
    if (prefer) headers.Prefer = prefer;
    if (range) headers.Range = range;

    const response = await fetch(`${config.url}/rest/v1/${table}${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401) {
      const refreshed = await refreshSession().catch(() => null);
      if (refreshed) {
        return restRequest(table, { method, query, body, prefer, range, returnHeaders });
      }
    }

    const payload = await parseResponse(response);
    if (!response.ok) throw errorFromPayload(payload, response.status);
    if (returnHeaders) return { data: payload, headers: response.headers };
    return payload;
  }

  function encodeQuery(params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : "";
  }

  /* ---------------- auth API ---------------- */

  async function signUp({ email, password, fullName = "" }) {
    const pkce = await createPkcePair();
    setAuthIntent("signup");
    const redirectTo = authRedirectUrl();
    const payload = await authRequest(
      "/signup",
      {
        email: String(email || "").trim(),
        password,
        data: fullName ? { full_name: String(fullName).trim() } : {},
        code_challenge: pkce.challenge,
        code_challenge_method: "s256",
      },
      { auth: false, query: `?redirect_to=${encodeURIComponent(redirectTo)}` },
    );

    if (payload?.access_token) {
      setSession(payload, "SIGNED_IN");
      clearAuthIntent();
      return { session, user: session?.user || payload.user, needsConfirmation: false };
    }
    // Keep the PKCE verifier: Supabase's confirmation link returns a code that
    // must be exchanged with the verifier created for this signup attempt.
    return {
      session: null,
      user: payload?.user || payload,
      needsConfirmation: true,
    };
  }

  async function signInWithPassword({ email, password }) {
    const payload = await authRequest(
      "/token?grant_type=password",
      { email: String(email || "").trim(), password },
      { auth: false },
    );
    setSession(payload, "SIGNED_IN");
    clearAuthIntent();
    return session;
  }

  async function signInWithOtp({ email }) {
    const pkce = await createPkcePair();
    setAuthIntent("magiclink");
    const redirectTo = authRedirectUrl();
    await authRequest(
      "/otp",
      {
        email: String(email || "").trim(),
        create_user: true,
        code_challenge: pkce.challenge,
        code_challenge_method: "s256",
      },
      { auth: false, query: `?redirect_to=${encodeURIComponent(redirectTo)}` },
    );
    return { sent: true };
  }

  async function sendRecovery(email) {
    const pkce = await createPkcePair();
    setAuthIntent("recovery");
    const redirectTo = authRedirectUrl();
    try {
      await authRequest(
        "/recover",
        {
          email: String(email || "").trim(),
          code_challenge: pkce.challenge,
          code_challenge_method: "s256",
        },
        { auth: false, query: `?redirect_to=${encodeURIComponent(redirectTo)}` },
      );
    } catch (error) {
      clearAuthIntent();
      throw error;
    }
    return { sent: true };
  }

  async function updatePassword(password) {
    const current = await getSession();
    if (!current?.access_token) {
      throw new SupabaseError("Open the password reset link again, then choose a new password.", {
        code: "AUTH_REQUIRED",
        status: 401,
      });
    }
    const payload = await authRequest("/user", { password }, { auth: true, method: "PUT" });
    if (payload?.id) {
      session = { ...session, user: payload };
      writeStoredSession(session);
      emit("USER_UPDATED", session);
    }
    return payload;
  }

  async function signOut() {
    const current = session || readStoredSession();
    session = null;
    writeStoredSession(null);
    clearAuthIntent();
    stopRefreshTimer();
    emit("SIGNED_OUT", null);
    if (current?.access_token && isConfigured()) {
      try {
        await fetch(`${config.url}/auth/v1/logout`, {
          method: "POST",
          headers: authHeaders(current.access_token),
        });
      } catch {
        /* local sign-out is enough */
      }
    }
    return true;
  }

  async function verifySession() {
    const current = await getSession();
    if (!current?.access_token) return null;
    try {
      const user = await authRequest("/user", undefined, { auth: true, method: "GET" });
      if (user?.id) {
        session = { ...current, user };
        writeStoredSession(session);
      }
      return session;
    } catch {
      return null;
    }
  }

  /* ---------------- PKCE + redirects ---------------- */

  function authRedirectUrl() {
    return `${global.location.origin}${global.location.pathname}`;
  }

  function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return global.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function createPkcePair() {
    const bytes = new Uint8Array(32);
    global.crypto.getRandomValues(bytes);
    const verifier = base64Url(bytes);
    const digest = await global.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const challenge = base64Url(new Uint8Array(digest));
    try {
      // Email links often open in a new tab, so the verifier must be shared
      // across tabs. supabase-js also stores it in localStorage.
      global.localStorage.setItem(PKCE_KEY, verifier);
    } catch {
      /* localStorage may be unavailable */
    }
    return { verifier, challenge };
  }

  function readPkce() {
    try {
      return global.localStorage.getItem(PKCE_KEY) || "";
    } catch {
      return "";
    }
  }

  function clearPkce() {
    try {
      global.localStorage.removeItem(PKCE_KEY);
    } catch {
      /* noop */
    }
  }

  // PKCE callback URLs do not always carry `type=recovery`. Remember why the
  // user left the app so a password-reset link lands on the new-password form.
  // localStorage (not sessionStorage) is deliberate: email links usually open
  // in a new tab, and a new tab must still find the verifier and the intent.
  function readAuthIntent() {
    try {
      return global.localStorage.getItem(AUTH_INTENT_KEY) || "";
    } catch {
      return "";
    }
  }

  function setAuthIntent(intent) {
    try {
      global.localStorage.setItem(AUTH_INTENT_KEY, intent);
    } catch {
      /* localStorage may be unavailable */
    }
  }

  function clearAuthIntent() {
    try {
      global.localStorage.removeItem(AUTH_INTENT_KEY);
    } catch {
      /* noop */
    }
  }

  function parseHash(hash = global.location.hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    return Object.fromEntries(params.entries());
  }

  function cleanAuthUrl() {
    const url = new URL(global.location.href);
    url.hash = "";
    for (const key of [
      "code",
      "error",
      "error_code",
      "error_description",
      "type",
      "access_token",
      "refresh_token",
      "expires_in",
      "expires_at",
      "token_type",
    ]) {
      url.searchParams.delete(key);
    }
    global.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ""));
  }

  /**
   * Handles every redirect Supabase can send back: implicit-flow tokens in
   * the hash, PKCE `?code=` exchanges, email confirmations, magic links and
   * password recovery links. Returns { type, error } for the UI to react to.
   */
  async function handleRedirect() {
    if (!isConfigured()) return { type: null, error: null };
    const url = new URL(global.location.href);
    const hash = parseHash();
    const queryCode = url.searchParams.get("code");
    const error =
      hash.error_description ||
      url.searchParams.get("error_description") ||
      hash.error ||
      url.searchParams.get("error");

    const intent = readAuthIntent();

    if (error) {
      clearAuthIntent();
      cleanAuthUrl();
      return {
        type: hash.type || url.searchParams.get("type") || intent || "error",
        error: String(error).replace(/\+/g, " "),
      };
    }

    if (hash.access_token && hash.refresh_token) {
      const type = hash.type || url.searchParams.get("type") || intent || "magiclink";
      setSession(
        {
          access_token: hash.access_token,
          refresh_token: hash.refresh_token,
          expires_in: hash.expires_in,
          expires_at: hash.expires_at,
          token_type: hash.token_type,
        },
        "SIGNED_IN",
      );
      clearAuthIntent();
      cleanAuthUrl();
      return { type, error: null, session };
    }

    if (queryCode) {
      const type = url.searchParams.get("type") || intent || "magiclink";
      const verifier = readPkce();
      try {
        if (!verifier) {
          throw new SupabaseError(
            "This sign-in link was opened in a different browser. Request a fresh link.",
            { code: "PKCE_MISSING" },
          );
        }
        const payload = await authRequest(
          "/token?grant_type=pkce",
          { auth_code: queryCode, code_verifier: verifier },
          { auth: false },
        );
        clearPkce();
        clearAuthIntent();
        setSession(payload, "SIGNED_IN");
        cleanAuthUrl();
        return { type, error: null, session };
      } catch (exchangeError) {
        clearAuthIntent();
        cleanAuthUrl();
        return { type, error: exchangeError.message };
      }
    }

    return { type: null, error: null };
  }

  /* ---------------- database helpers ---------------- */

  async function select(table, query = "", { single = false } = {}) {
    const data = await restRequest(table, {
      method: "GET",
      query: encodeQuery(query),
      prefer: single ? "return=representation" : undefined,
    });
    if (single) return Array.isArray(data) ? data[0] || null : data;
    return Array.isArray(data) ? data : [];
  }

  async function insert(table, rows, { returning = true } = {}) {
    const data = await restRequest(table, {
      method: "POST",
      query: returning ? "?select=*" : "",
      body: rows,
      prefer: returning ? "return=representation" : "return=minimal",
    });
    return returning ? (Array.isArray(data) ? data : [data]) : null;
  }

  async function update(table, filters, patch, { returning = true } = {}) {
    const data = await restRequest(table, {
      method: "PATCH",
      query: `${encodeQuery(filters)}${returning ? `${encodeQuery(filters) ? "&" : "?"}select=*` : ""}`,
      body: patch,
      prefer: returning ? "return=representation" : "return=minimal",
    });
    return returning ? (Array.isArray(data) ? data : [data]) : null;
  }

  async function remove(table, filters) {
    await restRequest(table, {
      method: "DELETE",
      query: encodeQuery(filters),
      prefer: "return=minimal",
    });
    return true;
  }

  async function count(table, filters = {}) {
    const { headers } = await restRequest(table, {
      method: "GET",
      query: encodeQuery({ ...filters, select: "id", limit: 1 }),
      prefer: "count=exact",
      range: "0-0",
      returnHeaders: true,
    });
    const range = headers.get("content-range") || "";
    const total = Number(range.split("/")[1]);
    return Number.isFinite(total) ? total : 0;
  }

  global.LeadAtlasSupabase = {
    configure,
    getConfig,
    isConfigured,
    onAuthStateChange,
    getSession,
    getUser,
    refreshSession,
    verifySession,
    signUp,
    signInWithPassword,
    signInWithOtp,
    sendRecovery,
    updatePassword,
    signOut,
    handleRedirect,
    select,
    insert,
    update,
    remove,
    count,
    SupabaseError,
  };

  // Keep multiple tabs in sync when one signs in or out.
  global.addEventListener("storage", (event) => {
    if (event.key !== SESSION_KEY) return;
    session = readStoredSession();
    scheduleRefresh();
    emit(session ? "SIGNED_IN" : "SIGNED_OUT", session);
  });
})(window);
