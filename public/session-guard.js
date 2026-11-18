/* ============================================================
   Lead Atlas — signed-in home guard
   ============================================================
   A returning operator should never land on the marketing page
   while their workspace session is still valid. This tiny script
   runs in the <head> and replaces the home page before it paints.

   It is deliberately classic JavaScript so it can block parsing,
   and it never runs on pricing, how-it-works or auth pages.
   ============================================================ */
(function (global) {
  "use strict";

  const SESSION_KEY = "leadAtlas.supabaseSession.v1";
  const WORKSPACE_URL = "/app.html#dashboard";

  function readSession(storage) {
    try {
      const raw = storage?.getItem?.(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.access_token !== "string" || !parsed.access_token.trim()) return null;
      if (typeof parsed?.refresh_token !== "string" || !parsed.refresh_token.trim()) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function shouldOpenWorkspace(pathname, storage) {
    const path = String(pathname || "");
    if (path !== "/" && path !== "/index.html") return false;
    return Boolean(readSession(storage));
  }

  function run() {
    try {
      const location = global.location;
      if (!location) return;
      if (!shouldOpenWorkspace(location.pathname, global.localStorage)) return;
      location.replace(WORKSPACE_URL);
    } catch {
      /* the marketing page stays usable if storage or navigation is blocked */
    }
  }

  global.LeadAtlasSessionGuard = {
    SESSION_KEY,
    WORKSPACE_URL,
    readSession,
    shouldOpenWorkspace,
  };

  run();
})(window);
