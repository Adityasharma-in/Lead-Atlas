import {
  isActiveRunFresh,
  parseActiveRun,
} from "./active-run-core.js";
import {
  IMPORT_LIMITS,
  buildClientJsonExport,
  leadsToCsv,
  parseImportContent,
} from "./import-core.js";
import {
  CALL_MARK,
  OUTREACH,
  OUTREACH_NOTE_LIMIT,
  OUTREACH_STATUSES,
  applyOutreachEntry,
  callMarkForStatus,
  normalizeOutreachEntry,
  normalizeOutreachNote,
  normalizeOutreachStatus,
  outreachCounts,
  outreachEntryFromLead,
  outreachKeyForLead,
  outreachStatusLabel,
} from "./outreach-core.js";
import {
  SCRIPT_LIMITS,
  SCRIPT_PLACEHOLDERS,
  SCRIPT_STORAGE_KEY,
  activeScript,
  createScript,
  emptyScriptStore,
  exportScriptsPayload,
  fillScriptTemplate,
  filterScripts,
  findScript,
  importScriptsContent,
  isMissingScriptTableError,
  mergeScriptStores,
  parseScriptStore,
  removeScript,
  scriptContextFor,
  scriptExcerpt,
  scriptLibraryRow,
  scriptStoreFromRow,
  serializeScriptStore,
  setActiveScript,
  upsertScript,
} from "./scripts-core.js";
import { isMissingTokenColumnError, resolveAccountToken } from "./account-core.js";
import { assignLeadIndexes, formatLeadIndex } from "./lead-identity-core.js";
import { buildOutreachAnalytics } from "./analytics-core.js";
import {
  CONFIG_CACHE_KEY,
  dashboardCacheKey,
  parseConfigCache,
  parseDashboardCache,
  serializeConfigCache,
  serializeDashboardCache,
} from "./boot-cache-core.js";
import {
  REPORT_CONTACT_FILTERS,
  REPORT_REVIEW_FILTERS,
  REPORT_SORTS,
  filterReportLeads,
  hasActiveFilters,
  normalizeReportFilters,
  paginateReportLeads,
} from "./report-core.js";

(() => {
  "use strict";

  const STORAGE = {
    token: "leadAtlas.apifyToken.v1",
    brief: "leadAtlas.brief.v1",
    outreach: "leadAtlas.outreach.v1",
    scripts: SCRIPT_STORAGE_KEY,
    updated: "leadAtlas.updatedTo.v1",
    activeRun: "leadAtlas.activeRun.v1",
  };

  const FALLBACK_CONFIG = {
    limits: { minResults: 1, maxResults: 500, defaultResults: 40 },
    minStars: [
      { value: "", label: "Any rating" },
      { value: "two", label: "2+ stars" },
      { value: "twoAndHalf", label: "2.5+ stars" },
      { value: "three", label: "3+ stars" },
      { value: "threeAndHalf", label: "3.5+ stars" },
      { value: "four", label: "4+ stars" },
      { value: "fourAndHalf", label: "4.5+ stars" },
    ],
    minReviews: [
      { value: "", label: "Any reviews" },
      { value: "10", label: "10+ reviews", selected: true },
      { value: "25", label: "25+ reviews" },
      { value: "50", label: "50+ reviews" },
      { value: "100", label: "100+ reviews" },
      { value: "250", label: "250+ reviews" },
      { value: "500", label: "500+ reviews" },
    ],
    pricing: {
      place: 0.004,
      placeDetails: 0.002,
      contacts: 0.002,
      filter: 0.001,
      start: 0.007,
      minimumRunCharge: 0.5,
    },
  };

  const state = {
    config: FALLBACK_CONFIG,
    token: "",
    account: null,
    keyStatus: "empty",
    view: "dashboard",
    auth: {
      configured: false,
      session: null,
      user: null,
      profile: null,
      mode: "signin",
      busy: false,
      entering: false,
      signingOut: false,
      recovery: false,
      redirectType: null,
    },
    library: {
      reports: [],
      stats: null,
      analytics: null,
      activity: [],
      loading: false,
      loaded: false,
      error: null,
      search: "",
      source: "all",
      busyReportId: null,
    },
    savedReport: null,
    saveDialog: { open: false },
    dashboard: { loading: false, loaded: false },
    results: null,
    importDesk: null,
    resultsToken: null,
    filters: {
      q: "",
      website: "all",
      contact: "all",
      outreach: "all",
      rating: "all",
      reviews: "all",
      sort: "rating",
      page: 1,
    },
    pageSize: 12,
    contactPreference: true,
    outreach: { version: 1, entries: {} },
    scripts: emptyScriptStore(),
    scriptUi: {
      selectedId: null,
      search: "",
      saveState: "saved",
      savedAt: null,
      saveTimer: null,
      storageErrorShown: false,
      cloudTimer: null,
      cloudState: "idle",
      cloudSavedAt: null,
      cloudErrorShown: false,
      cloudLoaded: false,
    },
    callSheet: {
      lead: null,
      scriptId: null,
      source: "report",
    },
    running: null,
    pendingRunBrief: null,
    keyVisible: false,
    drawerLead: null,
    drawerNoteDirty: false,
    emptyAction: "reset",
    update: {
      available: false,
      info: null,
      applying: false,
      mode: "idle",
    },
  };

  const els = {};
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const numberFormatter = new Intl.NumberFormat("en-US");
  const compactFormatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => (root ? [...root.querySelectorAll(selector)] : []);
  const byId = (id) => document.getElementById(id);

  /* ---------------- utilities ---------------- */

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value), window.location.origin);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(value || "").trim());
  }

  function phoneHref(phone) {
    const raw = String(phone || "").trim();
    const digits = raw.replace(/[^\d+]/g, "");
    return digits.replace(/(?!^)\+/g, "");
  }

  function decimal(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : "—";
  }

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `$${number.toFixed(2)}` : "$0.00";
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? numberFormatter.format(number) : "0";
  }

  function formatCompact(value) {
    const number = Number(value);
    return Number.isFinite(number) ? compactFormatter.format(number) : "0";
  }

  function formatDate(value, withTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const options = { day: "numeric", month: "short", year: "numeric" };
    if (withTime) {
      options.hour = "numeric";
      options.minute = "2-digit";
    }
    return date.toLocaleDateString("en-US", options);
  }

  function formatElapsed(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function pluralize(count, singular, plural = `${singular}s`) {
    return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delay);
    };
  }

  function formatRelative(value) {
    if (!value) return "just now";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "just now";
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
    if (days < 30) return `${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? "" : "s"} ago`;
    return formatDate(value);
  }

  function slugify(value, fallback = "export") {
    const slug = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70);
    return slug || fallback;
  }

  function supabaseClient() {
    return window.LeadAtlasSupabase || null;
  }

  function isAuthed() {
    return Boolean(state.auth.session?.access_token);
  }

  function accountDisplayName(user = state.auth.user) {
    const profile = state.auth.profile || {};
    const metadata = user?.user_metadata || {};
    const name = profile.full_name || metadata.full_name || metadata.name || "";
    if (name.trim()) return name.trim();
    const email = user?.email || profile.email || "";
    if (email) {
      const local = email.split("@")[0].replace(/[._-]+/g, " ");
      return local.replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
    return "Your account";
  }

  function accountInitials(name = accountDisplayName()) {
    const parts = String(name || "")
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "LA";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function greetingForNow() {
    const hour = new Date().getHours();
    if (hour < 12) return "morning";
    if (hour < 18) return "afternoon";
    return "evening";
  }

  /* ---------------- routes + auth handoff ---------------- */

  const WORKSPACE_ROUTES = new Set([
    "dashboard",
    "library",
    "setup",
    "data",
    "report",
    "progress",
  ]);

  function closeSidebar() {
    els.appShell?.classList.remove("is-sidebar-open");
    if (els.sidebarScrim) els.sidebarScrim.hidden = true;
    els.sidebarOpenBtn?.setAttribute("aria-expanded", "false");
  }

  function viewFromHash() {
    const raw = String(window.location.hash || "")
      .replace(/^#\/?/, "")
      .split(/[?&]/)[0];
    return WORKSPACE_ROUTES.has(raw) ? raw : "";
  }

  // The workspace is a separate document now. Anything that needs the account
  // form travels to /auth.html, carrying a return path and a short note.
  function goToSignIn({ notice = "", next = "" } = {}) {
    try {
      if (notice) window.sessionStorage.setItem("leadAtlas.authNotice", notice);
      if (next) window.sessionStorage.setItem("leadAtlas.authNext", next);
    } catch {
      /* the redirect still works when storage is unavailable */
    }
    window.location.replace("/auth.html?mode=signin");
  }

  function leaveWorkspace({ signedOut = false } = {}) {
    try {
      if (signedOut) {
        window.sessionStorage.setItem(
          "leadAtlas.siteNotice",
          "Signed out. Your library is waiting when you return.",
        );
      }
    } catch {
      /* the landing page simply skips the notice */
    }
    window.location.assign("/");
  }

  function syncViewRoute(view, { replace = false } = {}) {
    if (!isAuthed()) return;
    if (window.location.hash === `#${view}`) return;
    try {
      const method = replace ? "replaceState" : "pushState";
      window.history[method](
        { view },
        "",
        `${window.location.pathname}${window.location.search}#${view}`,
      );
    } catch {
      /* history is unavailable in some locked-down browsers */
    }
  }

  async function loadAccountProfile() {
    const sb = supabaseClient();
    const user = state.auth.user;
    if (!sb || !user?.id) return;

    let profile = null;
    let profileAvailable = true;
    let columnMissing = false;

    try {
      profile = await sb.select(
        "profiles",
        {
          id: `eq.${user.id}`,
          select: "full_name,email,company,apify_token",
          limit: 1,
        },
        { single: true },
      );
    } catch (error) {
      if (isMissingTokenColumnError(error)) {
        columnMissing = true;
        try {
          profile = await sb.select(
            "profiles",
            { id: `eq.${user.id}`, select: "full_name,email,company", limit: 1 },
            { single: true },
          );
        } catch (fallbackError) {
          profileAvailable = false;
          console.warn(
            "[lead-atlas] Profile could not be read.",
            fallbackError?.message || fallbackError,
          );
        }
        showToast(
          "Your Supabase profile is missing the Apify-key column. Run supabase/schema.sql in the SQL Editor, then reload.",
          "error",
          { duration: 9000 },
        );
      } else {
        // A paused project or a network blip must not block a scan that could
        // still run with the key cached in this browser.
        profileAvailable = false;
        console.warn("[lead-atlas] Profile could not be read.", error?.message || error);
      }
    }

    if (profile) {
      state.auth.profile = profile;
      renderAccount();
    }

    const resolved = resolveAccountToken({
      profileToken: profile?.apify_token,
      cachedToken: readStoredToken(),
      profileAvailable,
      columnMissing,
    });

    if (resolved.source === "account" || resolved.source === "cached") {
      applyAccountToken(resolved.token);
      return;
    }
    if (resolved.source === "none") {
      applyAccountToken("");
      setKeyStatus("empty");
      return;
    }

    // First run after this feature: claim the key this browser already has and
    // write it to the signed-in account so other devices can use it too.
    try {
      await saveTokenToAccount(resolved.token);
      applyAccountToken(resolved.token);
      showToast("Your saved Apify key is now linked to this account.", "success");
    } catch (error) {
      console.warn("[lead-atlas] Apify key could not be saved to the account.", error);
      applyAccountToken(resolved.token);
      showToast(
        `Your Apify key still works here, but could not be saved to your account. ${friendlySupabaseError(error)}`,
        "error",
        { duration: 8000 },
      );
    }
  }

  function renderAccount() {
    const user = state.auth.user;
    const name = accountDisplayName(user);
    const email = user?.email || state.auth.profile?.email || "—";
    const initials = accountInitials(name);
    const firstName = name.split(/\s+/)[0] || "there";
    const version = state.config?.appVersion || "1.9.0";

    if (els.accountAvatar) els.accountAvatar.textContent = initials;
    if (els.topbarAvatar) els.topbarAvatar.textContent = initials;
    if (els.accountName) els.accountName.textContent = name;
    if (els.accountEmail) els.accountEmail.textContent = email;
    if (els.dashFirstName) els.dashFirstName.textContent = firstName;
    if (els.dashGreetingTime) els.dashGreetingTime.textContent = greetingForNow();
    if (els.sidebarVersion) els.sidebarVersion.textContent = `Version ${version}`;
  }

  async function enterApp({ view = "", historyMode = "replace" } = {}) {
    const sb = supabaseClient();
    if (!sb || state.auth.entering) return;
    state.auth.entering = true;
    try {
      const session = await sb.getSession();
      if (!session?.access_token) {
        state.auth.session = null;
        state.auth.user = null;
        const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        goToSignIn({ notice: "Sign in to open your workspace.", next: here });
        return;
      }
      state.auth.session = session;
      state.auth.user = session.user || state.auth.user;
      state.auth.recovery = false;

      // Paint the last dashboard this account saw before touching the network.
      // A returning operator sees their counts and recent reports immediately;
      // the authoritative refresh below replaces them when it lands.
      hydrateDashboardCache();

      if (els.appShell) els.appShell.hidden = false;
      if (els.appBoot) els.appBoot.hidden = true;
      document.body.classList.add("is-app");
      document.body.classList.remove("is-landing", "is-auth");
      renderAccount();
      renderDashboard();
      renderLibrary();

      // Open the requested view straight away. Only the dashboard is cached, so
      // a report or data view still waits for its own data below.
      const target = view || viewFromHash() || "dashboard";
      const viewOptions = { scroll: false, focus: false, historyMode };
      if (target === "data") {
        openDataDesk(viewOptions);
      } else if (target === "report" && !state.results) {
        showView("library", viewOptions);
      } else if (target === "progress" && !state.running) {
        showView("setup", viewOptions);
      } else {
        showView(target, viewOptions);
      }

      // Profile, scripts and library are independent reads. Run them together
      // so the slowest one no longer adds to the others' wait.
      const [profileResult, scriptsResult, libraryResult] = await Promise.allSettled([
        loadAccountProfile(),
        loadAccountScripts(),
        loadLibrary({ force: true }),
      ]);
      for (const result of [profileResult, scriptsResult, libraryResult]) {
        if (result.status === "rejected") {
          console.warn("[lead-atlas] Workspace refresh failed.", result.reason);
        }
      }

      if (state.token) {
        setKeyStatus("checking");
        validateStoredKey({ silent: true });
        await resumeActiveRun();
      }
      checkForUpdates();
    } finally {
      state.auth.entering = false;
    }
  }

  function resetLibraryState() {
    state.library = {
      ...state.library,
      reports: [],
      stats: null,
      analytics: null,
      activity: [],
      loading: false,
      loaded: false,
      error: null,
      search: "",
      source: "all",
      busyReportId: null,
    };
    state.dashboard = { loading: false, loaded: false };
  }

  async function signOutUser() {
    if (state.running) {
      const confirmed = window.confirm(
        "A scan is still running. Sign out anyway? It will keep running on Apify and you can reconnect after signing in.",
      );
      if (!confirmed) return;
    }
    state.auth.signingOut = true;
    const sb = supabaseClient();
    const userId = state.auth.user?.id;
    if (state.scriptUi.saveTimer) saveScriptStore();
    if (state.auth.user?.id && (state.scriptUi.cloudTimer || hasPendingScripts())) {
      await saveScriptsToAccount({ announceError: false });
    }
    try {
      await sb?.signOut();
    } catch (error) {
      console.warn("[lead-atlas] Sign out failed.", error);
    }
    // The dashboard cache is the signed-in account's data; never leave it on a
    // shared machine after sign-out.
    clearDashboardCache(userId);
    state.auth.session = null;
    state.auth.user = null;
    state.auth.profile = null;
    state.auth.recovery = false;
    clearLocalTokenState();
    setKeyStatus("empty");
    resetScriptState();
    resetLibraryState();
    state.savedReport = null;
    state.results = null;
    state.importDesk = null;
    state.resultsToken = null;
    resetFilters({ render: false });
    renderSaveState();
    leaveWorkspace({ signedOut: true });
  }

  function initAuthListener() {
    const sb = supabaseClient();
    if (!sb) return;
    sb.onAuthStateChange((event, session, user) => {
      if (event === "SIGNED_OUT") {
        clearDashboardCache(state.auth.user?.id);
        state.auth.session = null;
        state.auth.user = null;
        state.auth.profile = null;
        clearLocalTokenState();
        setKeyStatus("empty");
        resetScriptState();
        resetLibraryState();
        if (!state.auth.signingOut) {
          goToSignIn({ notice: "Your session ended. Sign in again to open your workspace." });
        }
        return;
      }
      if (event === "TOKEN_REFRESHED" && session) {
        state.auth.session = session;
        state.auth.user = session.user || state.auth.user;
        renderAccount();
        return;
      }
      if (event === "USER_UPDATED" && session) {
        state.auth.session = session;
        state.auth.user = session.user || user || state.auth.user;
        renderAccount();
        return;
      }
      if (event === "SIGNED_IN" && session && !isAuthed()) {
        window.location.reload();
      }
    });
  }

  function scrollToTarget(target) {
    if (!target) return;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  function icon(name, className = "icon") {
    return `<svg class="${className}" aria-hidden="true"><use href="#${name}"></use></svg>`;
  }

  function showToast(message, type = "info", options = {}) {
    if (!els.toastRegion) return;
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " is-error" : ""}${type === "success" ? " is-success" : ""}`;
    const iconName =
      options.iconName ||
      (type === "error" ? "i-alert" : type === "success" ? "i-check" : "i-compass");
    const action = options.actionLabel
      ? `<button type="button" class="toast-action">${escapeHtml(options.actionLabel)}</button>`
      : "";
    toast.innerHTML = `${icon(iconName)}<span class="toast-message">${escapeHtml(message)}</span>${action}`;
    els.toastRegion.appendChild(toast);
    while (els.toastRegion.children.length > 3) {
      els.toastRegion.firstElementChild.remove();
    }

    let timer = null;
    const dismiss = () => {
      if (!toast.isConnected) return;
      window.clearTimeout(timer);
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 250);
    };
    const actionButton = toast.querySelector(".toast-action");
    actionButton?.addEventListener("click", () => {
      dismiss();
      if (typeof options.onAction === "function") options.onAction();
    });
    timer = window.setTimeout(dismiss, options.duration ?? 4400);
    return toast;
  }

  async function api(path, { method = "GET", body, tokenOverride, signal } = {}) {
    const headers = { Accept: "application/json" };
    const token = tokenOverride !== undefined ? tokenOverride : state.token;
    if (token) headers["x-apify-token"] = token;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });

    const contentType = response.headers.get("content-type") || "";
    let payload = null;
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    } else {
      payload = await response.text().catch(() => "");
    }

    if (!response.ok) {
      const error = new Error(
        payload?.error?.message || `The local server returned HTTP ${response.status}.`,
      );
      error.status = response.status;
      error.code = payload?.error?.code || "REQUEST_FAILED";
      throw error;
    }
    return payload;
  }

  async function copyText(value) {
    const text = String(value || "");
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const copied = document.execCommand("copy");
        area.remove();
        return copied;
      } catch {
        return false;
      }
    }
  }

  function summarize(leads) {
    const summary = {
      total: leads.length,
      withWebsite: 0,
      withoutWebsite: 0,
      withEmail: 0,
      withPhone: 0,
      withContact: 0,
      withSocial: 0,
      closed: 0,
      avgRating: null,
      totalReviews: 0,
      contactRate: 0,
    };
    let ratingSum = 0;
    let rated = 0;
    for (const lead of leads) {
      if (lead.hasWebsite) summary.withWebsite += 1;
      else summary.withoutWebsite += 1;
      if (lead.emails?.length) summary.withEmail += 1;
      if (lead.phones?.length) summary.withPhone += 1;
      if (lead.emails?.length || lead.phones?.length) summary.withContact += 1;
      if (lead.socials?.length) summary.withSocial += 1;
      if (lead.permanentlyClosed || lead.temporarilyClosed) summary.closed += 1;
      if (typeof lead.rating === "number") {
        ratingSum += lead.rating;
        rated += 1;
      }
      summary.totalReviews += lead.reviewsCount || 0;
    }
    if (rated) summary.avgRating = Math.round((ratingSum / rated) * 10) / 10;
    if (leads.length) summary.contactRate = Math.round((summary.withContact / leads.length) * 100);
    summary.outreach = outreachCounts(leads);
    return summary;
  }

  /* ---------------- outreach ledger ---------------- */

  function emptyOutreachLedger() {
    return { version: 1, entries: {} };
  }

  function readOutreachLedger() {
    try {
      const raw = window.localStorage.getItem(STORAGE.outreach);
      if (!raw) return emptyOutreachLedger();
      const parsed = JSON.parse(raw);
      const entries = {};
      for (const [key, value] of Object.entries(parsed?.entries || {})) {
        const entry = normalizeOutreachEntry(value);
        if (key && entry) entries[key] = entry;
      }
      return { version: 1, entries };
    } catch {
      return emptyOutreachLedger();
    }
  }

  function writeOutreachLedger() {
    try {
      window.localStorage.setItem(STORAGE.outreach, JSON.stringify(state.outreach));
    } catch {
      /* storage can be unavailable in private mode */
    }
  }

  function outreachLeadKey(lead) {
    if (!lead) return "";
    if (!lead.outreachKey) lead.outreachKey = outreachKeyForLead(lead);
    return lead.outreachKey;
  }

  function outreachEntrySignature(entry) {
    if (!entry) return "";
    return [entry.status, entry.contactedAt || "", entry.updatedAt || "", entry.note || ""].join("|");
  }

  function hydrateOutreach(leads = []) {
    const entries = state.outreach?.entries || {};
    let changed = false;
    for (const lead of leads) {
      if (!lead) continue;
      const key = outreachLeadKey(lead);
      const localEntry = normalizeOutreachEntry(entries[key]);
      // A file mark is explicit only when it carried a real status, a date, or
      // a note. A bare “To contact” cell is just the default, so the browser
      // ledger is still allowed to fill in a newer local mark.
      const fileEntry = lead.outreachSource === "file" ? outreachEntryFromLead(lead) : null;
      const chosen = fileEntry || localEntry;
      if (chosen) {
        applyOutreachEntry(lead, chosen);
      } else {
        lead.outreachStatus = OUTREACH.TODO;
        lead.contactedAt = null;
        lead.outreachUpdatedAt = null;
        lead.outreachNote = null;
      }
      if (fileEntry && outreachEntrySignature(fileEntry) !== outreachEntrySignature(localEntry)) {
        entries[key] = fileEntry;
        changed = true;
      }
    }
    if (changed) writeOutreachLedger();
    return leads;
  }

  function refreshOutreachViews({ table = true, drawer = false, syncNote = false } = {}) {
    const leads = state.results?.leads || [];
    if (state.results) {
      const summary = state.results.summary || summarize(leads);
      state.results.summary = { ...summary, outreach: outreachCounts(leads) };
    }
    renderOutreachSummary();
    if (table && state.view === "report") renderTable();
    if (drawer && state.drawerLead) {
      renderDrawerOutreach(state.drawerLead, { syncNote });
      renderDrawerContacts(state.drawerLead);
    }
  }

  function setOutreachStatus(lead, status, { note, announce = true, deferRender = false } = {}) {
    if (!lead) return false;
    const nextStatus = normalizeOutreachStatus(status) || OUTREACH.TODO;
    const effectiveNote =
      note === undefined
        ? normalizeOutreachNote(lead.outreachNote)
        : normalizeOutreachNote(note);
    if (
      (normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO) === nextStatus &&
      (normalizeOutreachNote(lead.outreachNote) || "") === effectiveNote
    ) {
      return false;
    }

    const key = outreachLeadKey(lead);
    const previousEntry = outreachEntryFromLead(lead);
    const previousSource = lead.outreachSource || null;
    const previousLedger = state.outreach.entries[key]
      ? { ...state.outreach.entries[key] }
      : null;
    const now = new Date().toISOString();
    const contactedAt =
      nextStatus === OUTREACH.CONTACTED
        ? lead.contactedAt || now
        : nextStatus === OUTREACH.DO_NOT_CONTACT
          ? lead.contactedAt || null
          : null;
    const entry = {
      status: nextStatus,
      contactedAt,
      updatedAt: now,
      note: effectiveNote || null,
    };

    applyOutreachEntry(lead, entry);
    lead.outreachSource = "local";
    state.outreach.entries[key] = entry;
    writeOutreachLedger();
    state.drawerNoteDirty = false;
    if (!deferRender) refreshOutreachViews({ drawer: true });
    syncSavedLead(lead);

    if (announce) {
      const undo = () => {
        if (previousLedger) state.outreach.entries[key] = previousLedger;
        else delete state.outreach.entries[key];
        writeOutreachLedger();
        applyOutreachEntry(lead, previousLedger || previousEntry);
        lead.outreachSource = previousSource;
        refreshOutreachViews({ drawer: true });
        syncSavedLead(lead);
        showToast("Outreach mark undone.", "info", { duration: 2200 });
      };

      if (nextStatus === OUTREACH.CONTACTED) {
        showToast(`${lead.name} marked as reached out.`, "success", {
          actionLabel: "Undo",
          onAction: undo,
          duration: 7000,
        });
      } else if (nextStatus === OUTREACH.DO_NOT_CONTACT) {
        showToast(`${lead.name} marked do not contact.`, "info", {
          iconName: "i-ban",
          actionLabel: "Undo",
          onAction: undo,
          duration: 7000,
        });
      } else {
        showToast(`${lead.name} moved back to the contact list.`, "info", {
          iconName: "i-circle",
          actionLabel: "Undo",
          onAction: undo,
          duration: 7000,
        });
      }
    }
    return true;
  }

  function markLeadCalled(lead) {
    if (!lead) return false;
    const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    // A do-not-contact lead keeps its stop mark, and an already-contacted lead
    // keeps its original call date.
    if (status !== OUTREACH.TODO) return false;
    const changed = setOutreachStatus(lead, OUTREACH.CONTACTED, {
      announce: false,
      deferRender: true,
    });
    if (!changed) return false;

    // The ledger write is synchronous, so the tick is already safe before the
    // dialer opens. Defer the table/drawer swap until the browser has handed
    // the tel: link to the phone app; a later visibility refresh covers the
    // return trip too.
    refreshOutreachViews({ table: false, drawer: false });
    window.setTimeout(() => {
      refreshOutreachViews({ drawer: Boolean(state.drawerLead) });
    }, 120);
    return true;
  }

  function updateDrawerNoteCount() {
    const value = els.drawerOutreachNote?.value || "";
    if (els.drawerOutreachNoteCount) {
      els.drawerOutreachNoteCount.textContent = String(
        Math.min(value.length, OUTREACH_NOTE_LIMIT),
      );
    }
    if (els.drawerOutreachSave) {
      const lead = state.drawerLead;
      const dirty = lead
        ? normalizeOutreachNote(value) !== normalizeOutreachNote(lead.outreachNote)
        : false;
      els.drawerOutreachSave.disabled = !dirty;
    }
  }

  function saveDrawerOutreachNote({ notify = false } = {}) {
    const lead = state.drawerLead;
    if (!lead || !els.drawerOutreachNote) return false;
    const note = normalizeOutreachNote(els.drawerOutreachNote.value);
    const currentNote = normalizeOutreachNote(lead.outreachNote);
    if (note === currentNote) {
      updateDrawerNoteCount();
      state.drawerNoteDirty = false;
      return false;
    }

    const key = outreachLeadKey(lead);
    const now = new Date().toISOString();
    const entry = {
      status: normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO,
      contactedAt: lead.contactedAt || null,
      updatedAt: now,
      note: note || null,
    };
    applyOutreachEntry(lead, entry);
    lead.outreachSource = "local";
    state.outreach.entries[key] = entry;
    writeOutreachLedger();
    state.drawerNoteDirty = false;
    refreshOutreachViews({ drawer: false });
    updateDrawerNoteCount();
    syncSavedLead(lead);
    if (els.drawerOutreachStamp) {
      els.drawerOutreachStamp.textContent = `Updated ${formatDate(now, true)}`;
    }
    if (notify) {
      showToast("Outreach note saved.", "success", { duration: 2200 });
    }
    return true;
  }

  /* ---------------- call scripts ---------------- */

  const STARTER_SCRIPT_BODY = `Hi, this is [your name] from [your company] — is now a bad time?

I was looking at {business} in {city} and noticed [what you noticed — no website, a quiet listing, a busy season]. I help {category} businesses [the single result you deliver], and I’m not calling to sell you anything today.

Would it be worth two minutes this week to see whether [the problem you solve] is on your radar? If not, I’ll leave you to it — thanks for picking up.`;

  function scriptCacheKey(userId = state.auth.user?.id) {
    return userId ? `${STORAGE.scripts}.${userId}` : STORAGE.scripts;
  }

  function scriptDirtyKey(userId = state.auth.user?.id) {
    return userId ? `${scriptCacheKey(userId)}.dirty` : "";
  }

  function readScriptCache(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return { present: false, store: emptyScriptStore() };
      return { present: true, store: parseScriptStore(raw) };
    } catch {
      return { present: false, store: emptyScriptStore() };
    }
  }

  function readScriptStore(key = scriptCacheKey()) {
    return readScriptCache(key).store;
  }

  function writeScriptCache(key, store) {
    try {
      window.localStorage.setItem(key, JSON.stringify(serializeScriptStore(store)));
      return true;
    } catch (error) {
      console.warn("[lead-atlas] Could not save call scripts in this browser.", error);
      return false;
    }
  }

  function markScriptsDirty(userId = state.auth.user?.id) {
    const key = scriptDirtyKey(userId);
    if (!key) return;
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* the cloud write can still succeed */
    }
  }

  function clearScriptsDirty(userId = state.auth.user?.id) {
    const key = scriptDirtyKey(userId);
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing to clear */
    }
  }

  function hasPendingScripts(userId = state.auth.user?.id) {
    const key = scriptDirtyKey(userId);
    if (!key) return false;
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function writeScriptStore() {
    const saved = writeScriptCache(scriptCacheKey(), state.scripts);
    if (state.auth.user?.id) markScriptsDirty(state.auth.user.id);
    return saved;
  }

  function adoptScriptStore(store) {
    state.scripts = serializeScriptStore(store);
    state.scriptUi.selectedId = activeScript(state.scripts)?.id || null;
    renderScriptChip();
    if (els.scriptDialog?.open) renderScriptLibrary({ syncFields: true });
  }

  function resetScriptState() {
    window.clearTimeout(state.scriptUi.saveTimer);
    window.clearTimeout(state.scriptUi.cloudTimer);
    state.scriptUi.saveTimer = null;
    state.scriptUi.cloudTimer = null;
    state.scripts = emptyScriptStore();
    state.scriptUi.selectedId = null;
    state.scriptUi.search = "";
    state.scriptUi.saveState = "saved";
    state.scriptUi.savedAt = null;
    state.scriptUi.storageErrorShown = false;
    state.scriptUi.cloudState = "idle";
    state.scriptUi.cloudSavedAt = null;
    state.scriptUi.cloudErrorShown = false;
    state.scriptUi.cloudLoaded = false;
    try {
      window.localStorage.removeItem(STORAGE.scripts);
    } catch {
      /* storage may be unavailable */
    }
    renderScriptChip();
    if (els.scriptDialog?.open) renderScriptLibrary({ syncFields: true });
  }

  async function saveScriptsToAccount({ announceError = true } = {}) {
    const sb = supabaseClient();
    const user = state.auth.user;
    if (!sb || !user?.id || !isAuthed()) return false;

    window.clearTimeout(state.scriptUi.cloudTimer);
    state.scriptUi.cloudTimer = null;
    state.scriptUi.cloudState = "saving";
    updateScriptSaveState();

    const payload = scriptLibraryRow(state.scripts);
    const payloadSignature = JSON.stringify(payload);
    try {
      const updated = await sb.update(
        "script_libraries",
        { user_id: `eq.${user.id}` },
        { active_id: payload.active_id, scripts: payload.scripts },
        { returning: true },
      );

      if (!Array.isArray(updated) || updated.length === 0) {
        try {
          await sb.insert(
            "script_libraries",
            {
              user_id: user.id,
              active_id: payload.active_id,
              scripts: payload.scripts,
            },
            { returning: false },
          );
        } catch (insertError) {
          const duplicate =
            String(insertError?.code || "") === "23505" ||
            /duplicate key|already exists/i.test(String(insertError?.message || ""));
          if (!duplicate) throw insertError;
          await sb.update(
            "script_libraries",
            { user_id: `eq.${user.id}` },
            { active_id: payload.active_id, scripts: payload.scripts },
            { returning: false },
          );
        }
      }

      // If the library changed while this request was in flight, keep the dirty
      // marker and queue one more write. Otherwise an older response could
      // clear the marker for a newer local edit and a reload would prefer a
      // stale cloud row.
      const currentSignature = JSON.stringify(scriptLibraryRow(state.scripts));
      if (currentSignature !== payloadSignature) {
        state.scriptUi.cloudState = "saving";
        state.scriptUi.cloudSavedAt = new Date().toISOString();
        state.scriptUi.cloudErrorShown = false;
        updateScriptSaveState();
        if (!state.scriptUi.cloudTimer) scheduleScriptsCloudSave();
        return true;
      }

      clearScriptsDirty(user.id);
      state.scriptUi.cloudState = "saved";
      state.scriptUi.cloudSavedAt = new Date().toISOString();
      state.scriptUi.cloudErrorShown = false;
      updateScriptSaveState();
      return true;
    } catch (error) {
      state.scriptUi.cloudState = "error";
      updateScriptSaveState();
      console.warn("[lead-atlas] Call scripts could not be saved to the account.", error);
      if (announceError && !state.scriptUi.cloudErrorShown) {
        state.scriptUi.cloudErrorShown = true;
        showToast(
          `Scripts are saved in this browser but not synced to your account. ${friendlySupabaseError(
            error,
          )}`,
          "error",
          { duration: 9000 },
        );
      }
      return false;
    }
  }

  function scheduleScriptsCloudSave() {
    if (!isAuthed() || !state.auth.user?.id) return;
    window.clearTimeout(state.scriptUi.cloudTimer);
    state.scriptUi.cloudState = "saving";
    updateScriptSaveState();
    state.scriptUi.cloudTimer = window.setTimeout(() => {
      state.scriptUi.cloudTimer = null;
      saveScriptsToAccount();
    }, 900);
  }

  async function loadAccountScripts() {
    const sb = supabaseClient();
    const user = state.auth.user;
    if (!sb || !user?.id) return;

    const cacheKey = scriptCacheKey(user.id);
    const cache = readScriptCache(cacheKey);
    const legacy = readScriptCache(STORAGE.scripts);
    const dirty = hasPendingScripts(user.id);
    state.scriptUi.cloudLoaded = false;

    let row = null;
    let schemaMissing = false;
    try {
      row = await sb.select(
        "script_libraries",
        {
          user_id: `eq.${user.id}`,
          select: "active_id,scripts,updated_at",
          limit: 1,
        },
        { single: true },
      );
    } catch (error) {
      schemaMissing = isMissingScriptTableError(error);
      state.scriptUi.cloudState = schemaMissing ? "missing" : "error";
      const fallback = cache.present ? cache.store : legacy.store;
      adoptScriptStore(fallback);
      writeScriptCache(cacheKey, fallback);
      try {
        window.localStorage.removeItem(STORAGE.scripts);
      } catch {
        /* storage may be unavailable */
      }
      if (schemaMissing) {
        showToast(
          "Call-script sync needs the Supabase schema. Run supabase/schema.sql in the SQL Editor, then reload. Scripts still work in this browser.",
          "error",
          { duration: 9000 },
        );
      } else {
        console.warn("[lead-atlas] Call scripts could not be loaded from the account.", error);
      }
      updateScriptSaveState();
      return;
    }

    let store;
    let needsUpload = false;
    let migratedLegacy = false;

    if (row) {
      const cloudStore = scriptStoreFromRow(row) || emptyScriptStore();
      if (dirty && cache.present) {
        // The local cache is a complete snapshot whose last cloud write failed.
        store = cache.store;
        needsUpload = true;
      } else {
        store = cloudStore;
        clearScriptsDirty(user.id);
      }
      state.scriptUi.cloudState = "saved";
    } else if (cache.present) {
      store = cache.store;
      needsUpload = true;
      state.scriptUi.cloudState = "saving";
    } else if (legacy.present && legacy.store.scripts.length) {
      store = legacy.store;
      needsUpload = true;
      migratedLegacy = true;
      state.scriptUi.cloudState = "saving";
    } else {
      store = emptyScriptStore();
      state.scriptUi.cloudState = "idle";
    }

    adoptScriptStore(store);
    writeScriptCache(cacheKey, store);
    if (legacy.present) {
      try {
        window.localStorage.removeItem(STORAGE.scripts);
      } catch {
        /* storage may be unavailable */
      }
    }
    state.scriptUi.cloudLoaded = true;
    updateScriptSaveState();

    if (needsUpload) {
      const saved = await saveScriptsToAccount({ announceError: true });
      if (saved && migratedLegacy) {
        showToast("Your call scripts are now saved to this account.", "success", {
          duration: 5000,
        });
      }
    }
  }

  function scriptCountLabel(count) {
    return `${formatNumber(count)} ${count === 1 ? "script" : "scripts"}`;
  }

  function selectedScript() {
    return findScript(state.scripts, state.scriptUi.selectedId) || activeScript(state.scripts);
  }

  function currentReportQuery() {
    return state.results?.query || {};
  }

  function activeScriptCopy(lead = null) {
    const script = activeScript(state.scripts);
    const body = script
      ? fillScriptTemplate(script.body, scriptContextFor({ lead, query: currentReportQuery() }))
      : "";
    return { script, body, empty: !body.trim() };
  }

  function renderScriptChip() {
    const count = state.scripts.scripts.length;
    if (els.scriptChipCount) {
      els.scriptChipCount.textContent = String(count);
      els.scriptChipCount.hidden = count === 0;
    }
    els.scriptChip?.classList.toggle("has-scripts", count > 0);
    if (els.scriptChip) {
      els.scriptChip.title = count
        ? `${scriptCountLabel(count)} saved - open the call library`
        : "Save a cold-call script for your next call";
    }
    if (els.dashScriptCount) els.dashScriptCount.textContent = `${formatNumber(count)} saved`;
    if (els.sidebarScriptCount) els.sidebarScriptCount.textContent = formatNumber(count);
    renderDrawerScriptAction();
    renderReportScript();
    renderDrawerScript();
  }

  function renderDrawerScriptAction() {
    if (!els.drawerScriptBtn) return;
    const choice = activeScript(state.scripts);
    if (els.drawerScriptLabel) {
      els.drawerScriptLabel.textContent = choice ? "Read call script" : "Add a call script";
    }
    if (els.drawerScriptDefault) {
      els.drawerScriptDefault.textContent = choice ? choice.title : "Write once";
    }
    els.drawerScriptBtn.title = choice
      ? `Open “${choice.title}” filled for this lead`
      : "Write a cold-call script once and read it beside every lead";
  }

  function renderDrawerScript(lead = state.drawerLead) {
    if (!els.drawerScriptBody) return;
    const { script, body, empty } = activeScriptCopy(lead);

    if (els.drawerScriptTitle) {
      els.drawerScriptTitle.textContent = script ? script.title : "No script saved";
    }
    els.drawerScriptBody.textContent = !script
      ? "No call script saved yet. Add one from Scripts in the top bar."
      : empty
        ? "This script has no words yet. Open the library and write your opening line."
        : body;
    els.drawerScriptBody.classList.toggle("is-empty", !script || empty);
  }

  function updateScriptSaveState() {
    if (!els.scriptSaveState) return;
    const ui = state.scriptUi;
    const cloudSaving = ui.cloudState === "saving";
    const cloudError = ui.cloudState === "error" || ui.cloudState === "missing";
    const saving = ui.saveState === "saving" || cloudSaving;
    const error = ui.saveState === "error";
    els.scriptSaveState.classList.toggle("is-saving", saving);
    els.scriptSaveState.classList.toggle("is-error", error || cloudError);
    if (error) {
      els.scriptSaveState.textContent = "Not saved";
    } else if (saving) {
      els.scriptSaveState.textContent = "Saving…";
    } else if (cloudError) {
      els.scriptSaveState.textContent = "Local only";
    } else if (ui.cloudState === "saved") {
      els.scriptSaveState.textContent = "Saved to account";
    } else if (ui.savedAt) {
      const saved = new Date(ui.savedAt);
      els.scriptSaveState.textContent = Number.isNaN(saved.getTime())
        ? "Saved"
        : `Saved ${saved.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}`;
    } else {
      els.scriptSaveState.textContent = "Saved";
    }
  }

  function saveScriptStore({ announceError = true } = {}) {
    window.clearTimeout(state.scriptUi.saveTimer);
    state.scriptUi.saveTimer = null;
    const saved = writeScriptStore();
    state.scriptUi.saveState = saved ? "saved" : "error";
    state.scriptUi.savedAt = saved ? new Date().toISOString() : null;
    if (!saved && announceError && !state.scriptUi.storageErrorShown) {
      state.scriptUi.storageErrorShown = true;
      showToast(
        "Scripts could not be saved in this browser. Export a backup and check that site storage is available.",
        "error",
        { duration: 8000 },
      );
    }
    if (saved) state.scriptUi.storageErrorShown = false;
    updateScriptSaveState();
    scheduleScriptsCloudSave();
    return saved;
  }

  function scheduleScriptSave() {
    window.clearTimeout(state.scriptUi.saveTimer);
    state.scriptUi.saveState = "saving";
    updateScriptSaveState();
    state.scriptUi.saveTimer = window.setTimeout(() => saveScriptStore(), 450);
  }

  function renderScriptPlaceholders() {
    if (!els.scriptPlaceholders) return;
    els.scriptPlaceholders.innerHTML = SCRIPT_PLACEHOLDERS.map(
      (placeholder) => `<button
        type="button"
        class="script-placeholder"
        data-script-token="${escapeHtml(placeholder.token)}"
        title="${escapeHtml(`Insert ${placeholder.token} — ${placeholder.hint}`)}"
      >${escapeHtml(placeholder.token)}</button>`,
    ).join("");
  }

  function updateScriptEditorMeta() {
    const script = selectedScript();
    if (!script) return;
    const isDefault = state.scripts.activeId === script.id;
    if (els.scriptDefaultLabel) {
      els.scriptDefaultLabel.textContent = isDefault ? "Opens by default" : "Saved script";
    }
    if (els.scriptUpdatedLabel) {
      els.scriptUpdatedLabel.textContent = `Updated ${formatDate(script.updatedAt, true)}`;
    }
    if (els.scriptCharCount) {
      els.scriptCharCount.textContent = `${formatNumber(script.body.length)} / ${formatNumber(
        SCRIPT_LIMITS.bodyLength,
      )}`;
    }
    if (els.makeDefaultScriptBtn) {
      els.makeDefaultScriptBtn.disabled = isDefault;
      els.makeDefaultScriptBtn.textContent = isDefault ? "Opens by default" : "Use by default";
    }
  }

  function renderScriptEditor({ syncFields = false } = {}) {
    const hasScripts = state.scripts.scripts.length > 0;
    const script = selectedScript();

    if (els.scriptEditorEmpty) els.scriptEditorEmpty.hidden = hasScripts;
    if (els.scriptEditorMain) els.scriptEditorMain.hidden = !script;
    if (!script) {
      updateScriptSaveState();
      return;
    }

    state.scriptUi.selectedId = script.id;
    if (syncFields) {
      if (els.scriptTitleInput) {
        els.scriptTitleInput.value = script.title === "Untitled script" ? "" : script.title;
      }
      if (els.scriptBodyInput) els.scriptBodyInput.value = script.body;
    }
    updateScriptEditorMeta();
    updateScriptSaveState();
  }

  function renderScriptList() {
    if (!els.scriptList) return;
    const all = state.scripts.scripts;
    const visible = filterScripts(all, state.scriptUi.search);
    const selected = selectedScript();
    const selectedId = selected?.id || null;

    if (els.scriptSearch && els.scriptSearch.value !== state.scriptUi.search) {
      els.scriptSearch.value = state.scriptUi.search;
    }
    if (els.scriptListLabel) {
      els.scriptListLabel.textContent = state.scriptUi.search ? "Matches" : "Saved scripts";
    }
    if (els.scriptListCount) {
      els.scriptListCount.textContent = formatNumber(visible.length);
    }

    if (!all.length) {
      els.scriptList.innerHTML = `<p class="script-list-empty">No scripts yet. Write your opening line.</p>`;
      return;
    }
    if (!visible.length) {
      els.scriptList.innerHTML = `<p class="script-list-empty">No script matches “${escapeHtml(
        state.scriptUi.search,
      )}”.</p>`;
      return;
    }

    els.scriptList.innerHTML = visible
      .map((script) => {
        const isSelected = script.id === selectedId;
        const isDefault = script.id === state.scripts.activeId;
        return `<button
          type="button"
          class="script-list-item${isSelected ? " is-selected" : ""}"
          data-script-id="${escapeHtml(script.id)}"
          ${isSelected ? 'aria-current="true"' : ""}
        >
          <span class="script-list-title">${escapeHtml(script.title)}</span>
          <span class="script-list-excerpt">${escapeHtml(scriptExcerpt(script.body, 74))}</span>
          <span class="script-list-meta">${
            isDefault
              ? '<span class="script-list-default">Opens by default</span>'
              : escapeHtml(`Updated ${formatDate(script.updatedAt)}`)
          }</span>
        </button>`;
      })
      .join("");
  }

  function renderScriptLibrary({ syncFields = true } = {}) {
    renderScriptList();
    renderScriptEditor({ syncFields });
    renderScriptChip();
  }

  function scriptLimitToast() {
    showToast(
      `You can keep up to ${formatNumber(
        SCRIPT_LIMITS.maxScripts,
      )} scripts. Delete one before adding another.`,
      "error",
      { duration: 6000 },
    );
  }

  function createNewScript({ starter = false, focusTitle = true } = {}) {
    if (state.scripts.scripts.length >= SCRIPT_LIMITS.maxScripts) {
      scriptLimitToast();
      return null;
    }
    if (state.scriptUi.saveTimer) saveScriptStore();
    const created = createScript({
      title: starter ? "Starter call script" : "Untitled script",
      body: starter ? STARTER_SCRIPT_BODY : "",
    });
    state.scripts = upsertScript(state.scripts, created);
    state.scripts = setActiveScript(state.scripts, created.id);
    state.scriptUi.selectedId = created.id;
    state.scriptUi.search = "";
    saveScriptStore();
    renderScriptLibrary({ syncFields: true });
    if (focusTitle) {
      window.setTimeout(() => {
        els.scriptTitleInput?.focus();
        els.scriptTitleInput?.select();
      }, 30);
    }
    if (starter) {
      showToast("Sample script added. Make the words your own.", "success");
    }
    return created;
  }

  function selectScript(id, { focus = false } = {}) {
    const script = findScript(state.scripts, id);
    if (!script) return;
    if (state.scriptUi.saveTimer) saveScriptStore();
    state.scriptUi.selectedId = script.id;
    renderScriptLibrary({ syncFields: true });
    if (focus) els.scriptBodyInput?.focus();
  }

  function handleScriptFormInput() {
    const script = selectedScript();
    if (!script) return;
    state.scripts = upsertScript(state.scripts, {
      ...script,
      title: els.scriptTitleInput?.value || "",
      body: els.scriptBodyInput?.value || "",
      updatedAt: new Date().toISOString(),
    });
    state.scriptUi.selectedId = script.id;
    renderScriptList();
    updateScriptEditorMeta();
    scheduleScriptSave();
    renderScriptChip();
  }

  function insertScriptToken(token) {
    const field = els.scriptBodyInput;
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    field.setRangeText(token, start, end, "end");
    field.focus();
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function makeSelectedScriptDefault() {
    const script = selectedScript();
    if (!script || state.scripts.activeId === script.id) return;
    saveScriptStore();
    state.scripts = setActiveScript(state.scripts, script.id);
    saveScriptStore();
    renderScriptLibrary({ syncFields: false });
    showToast(`“${script.title}” now opens by default.`, "success", { duration: 3000 });
  }

  function duplicateSelectedScript() {
    const script = selectedScript();
    if (!script) return;
    if (state.scripts.scripts.length >= SCRIPT_LIMITS.maxScripts) {
      scriptLimitToast();
      return;
    }
    if (state.scriptUi.saveTimer) saveScriptStore();
    const copy = createScript({
      title: `${script.title} copy`,
      body: script.body,
    });
    state.scripts = upsertScript(state.scripts, copy);
    state.scriptUi.selectedId = copy.id;
    saveScriptStore();
    renderScriptLibrary({ syncFields: true });
    showToast(`“${script.title}” duplicated.`, "success", { duration: 2600 });
  }

  function deleteSelectedScript() {
    const script = selectedScript();
    if (!script) return;
    if (state.scriptUi.saveTimer) saveScriptStore();
    const wasActive = state.scripts.activeId === script.id;
    const index = state.scripts.scripts.findIndex((entry) => entry.id === script.id);
    state.scripts = removeScript(state.scripts, script.id);
    const next = state.scripts.scripts[Math.min(index, state.scripts.scripts.length - 1)] || null;
    state.scriptUi.selectedId = next?.id || null;
    saveScriptStore();
    renderScriptLibrary({ syncFields: true });
    showToast(`“${script.title}” deleted.`, "info", {
      actionLabel: "Undo",
      duration: 8000,
      onAction: () => {
        const restored = upsertScript(state.scripts, script);
        state.scripts = wasActive ? setActiveScript(restored, script.id) : restored;
        state.scriptUi.selectedId = script.id;
        saveScriptStore();
        renderScriptLibrary({ syncFields: true });
      },
    });
  }

  function openScriptLibrary({ selectId = null, createIfEmpty = false, focusTitle = false } = {}) {
    if (createIfEmpty && !state.scripts.scripts.length) {
      createNewScript({ focusTitle });
    }
    state.scriptUi.search = "";
    if (selectId) {
      const match = findScript(state.scripts, selectId);
      if (match) state.scriptUi.selectedId = match.id;
    }
    if (!selectedScript()) {
      state.scriptUi.selectedId = state.scripts.scripts[0]?.id || null;
    }
    renderScriptLibrary({ syncFields: true });
    if (!els.scriptDialog.open) els.scriptDialog.showModal();
    document.body.classList.add("has-dialog");
    syncDialogState();
    window.setTimeout(() => {
      if (focusTitle && state.scripts.scripts.length) {
        els.scriptTitleInput?.focus();
        els.scriptTitleInput?.select();
        return;
      }
      const selected = $$(".script-list-item", els.scriptList).find(
        (item) => item.dataset.scriptId === state.scriptUi.selectedId,
      );
      (selected || els.newScriptBtn)?.focus({ preventScroll: true });
    }, 40);
  }

  function closeScriptLibrary() {
    if (state.scriptUi.saveTimer) saveScriptStore();
    if (state.scriptUi.cloudTimer) {
      window.clearTimeout(state.scriptUi.cloudTimer);
      state.scriptUi.cloudTimer = null;
      saveScriptsToAccount();
    }
    if (els.scriptDialog?.open) els.scriptDialog.close();
    syncDialogState();
  }

  function handleScriptImportFile(file) {
    if (!file) return;
    if (file.size > SCRIPT_LIMITS.importBytes) {
      const limitMb = Math.round(SCRIPT_LIMITS.importBytes / (1024 * 1024));
      showToast(
        `That file is too large. Keep script imports under ${limitMb} MB.`,
        "error",
        { duration: 6000 },
      );
      return;
    }

    if (els.importScriptsBtn) els.importScriptsBtn.disabled = true;
    file
      .text()
      .then((source) => {
        const imported = importScriptsContent({ name: file.name, text: source });
        const merged = mergeScriptStores(state.scripts, imported.store);
        state.scripts = merged.store;
        state.scriptUi.selectedId =
          activeScript(merged.store)?.id || state.scriptUi.selectedId;
        saveScriptStore();
        renderScriptLibrary({ syncFields: true });
        const parts = [];
        if (merged.added) parts.push(`${pluralize(merged.added, "script")} added`);
        if (merged.updated) parts.push(`${pluralize(merged.updated, "script")} updated`);
        if (merged.skipped) parts.push(`${pluralize(merged.skipped, "script")} already here`);
        showToast(`Imported ${file.name}: ${parts.join(" · ")}.`, "success", {
          duration: 6500,
        });
      })
      .catch((error) => {
        showToast(
          error?.message || "That file could not be read as a script or backup.",
          "error",
          { duration: 8000 },
        );
      })
      .finally(() => {
        if (els.importScriptsBtn) els.importScriptsBtn.disabled = false;
        if (els.scriptImportInput) els.scriptImportInput.value = "";
      });
  }

  function downloadScriptsBackup() {
    if (!state.scripts.scripts.length) {
      showToast("Write a script before exporting a backup.", "info", { duration: 3200 });
      return;
    }
    if (state.scriptUi.saveTimer) saveScriptStore();
    const payload = exportScriptsPayload(state.scripts);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlobFile(
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
      `lead-atlas-scripts-${stamp}.json`,
    );
    showToast(
      `Exported ${pluralize(payload.scripts.length, "script")} as a JSON backup.`,
      "success",
    );
  }

  function callSheetScript() {
    return (
      findScript(state.scripts, state.callSheet.scriptId) ||
      activeScript(state.scripts) ||
      state.scripts.scripts[0] ||
      null
    );
  }

  function refreshCallSheetOutreach() {
    const lead = state.callSheet.lead;
    if (!lead) {
      if (els.markCallSheetContactedBtn) els.markCallSheetContactedBtn.hidden = true;
      return;
    }
    const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    const contacted = status === OUTREACH.CONTACTED;
    const blocked = status === OUTREACH.DO_NOT_CONTACT;
    if (els.markCallSheetContactedBtn) {
      els.markCallSheetContactedBtn.hidden = false;
      els.markCallSheetContactedBtn.disabled = contacted || blocked;
      els.markCallSheetContactedBtn.classList.toggle("is-done", contacted);
      els.markCallSheetContactedBtn.classList.toggle("is-blocked", blocked);
    }
    if (els.markCallSheetContactedLabel) {
      if (contacted) {
        els.markCallSheetContactedLabel.textContent = lead.contactedAt
          ? `Reached out · ${formatDate(lead.contactedAt)}`
          : "Reached out";
      } else if (blocked) {
        els.markCallSheetContactedLabel.textContent = "Marked do not contact";
      } else {
        els.markCallSheetContactedLabel.textContent = "Mark reached out";
      }
    }
  }

  function renderCallSheet() {
    const script = callSheetScript();
    const lead = state.callSheet.lead;
    const hasScripts = Boolean(script);

    if (els.callSheetEmpty) els.callSheetEmpty.hidden = hasScripts;
    if (els.callSheetContent) els.callSheetContent.hidden = !hasScripts;
    if (!script) {
      if (els.callSheetKicker) els.callSheetKicker.textContent = "Call sheet / No script";
      if (els.callSheetTitle) els.callSheetTitle.textContent = "Cold-call script";
      if (els.callSheetSub) {
        els.callSheetSub.textContent = "A script written once, ready beside every lead.";
      }
      return;
    }

    state.callSheet.scriptId = script.id;
    const query = currentReportQuery();
    const context = scriptContextFor({ lead, query });
    const filled = fillScriptTemplate(script.body, context);
    const empty = !filled.trim();
    const leadPhone = lead ? lead.phones?.[0] || lead.phone || "" : "";

    if (els.callSheetKicker) {
      els.callSheetKicker.textContent = `Call sheet / ${script.title}`;
    }
    if (els.callSheetTitle) {
      els.callSheetTitle.textContent = lead?.name || "Cold-call script";
    }
    if (els.callSheetSub) {
      if (lead) {
        els.callSheetSub.textContent =
          [lead.category, leadPhone, lead.city].filter(Boolean).join(" · ") ||
          "Read it once, then dial.";
      } else {
        const brief = [query.niche, query.location].filter(Boolean).join(" in ");
        els.callSheetSub.textContent = brief
          ? `Preview filled for ${brief}.`
          : "A generic read-through before you start dialing.";
      }
    }

    if (els.callSheetBody) {
      els.callSheetBody.textContent = empty
        ? "This script has no words yet. Open the library and write your opening line."
        : filled;
      els.callSheetBody.classList.toggle("is-empty", empty);
    }
    if (els.callSheetContext) {
      els.callSheetContext.textContent = lead
        ? "Using this lead’s details for the placeholders. Missing fields are replaced with plain fallbacks."
        : "Using this report’s search details. Open a lead to fill the business-specific placeholders.";
    }

    if (els.callSheetScriptSelect) {
      els.callSheetScriptSelect.innerHTML = "";
      for (const entry of state.scripts.scripts) {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.title;
        option.selected = entry.id === script.id;
        els.callSheetScriptSelect.appendChild(option);
      }
    }

    if (els.copyCallSheetBtn) {
      els.copyCallSheetBtn.disabled = empty;
      els.copyCallSheetBtn.title = empty ? "Add some words to this script first" : "Copy the filled script";
    }
    refreshCallSheetOutreach();
  }

  function openCallSheet(lead = null, { source = "report", scriptId = null } = {}) {
    state.callSheet.lead = lead || null;
    state.callSheet.source = source;
    const script =
      findScript(state.scripts, scriptId) ||
      activeScript(state.scripts) ||
      state.scripts.scripts[0] ||
      null;
    state.callSheet.scriptId = script?.id || null;
    renderCallSheet();
    if (!els.callSheetDialog.open) els.callSheetDialog.showModal();
    document.body.classList.add("has-dialog");
    syncDialogState();
    window.setTimeout(() => els.callSheetBody?.focus({ preventScroll: true }), 40);
  }

  function closeCallSheet() {
    if (els.callSheetDialog?.open) els.callSheetDialog.close();
    syncDialogState();
  }

  function markCallSheetContacted() {
    const lead = state.callSheet.lead;
    if (!lead) return;
    const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    if (status === OUTREACH.CONTACTED || status === OUTREACH.DO_NOT_CONTACT) return;
    setOutreachStatus(lead, OUTREACH.CONTACTED);
    refreshCallSheetOutreach();
  }

  /* ---------------- element cache ---------------- */

  function cacheElements() {
    const ids = [
      "appShell",
      "appBoot",
      "appBottomNav",
      "bottomMoreBtn",
      "bottomLibraryCount",
      "appSidebar",
      "sidebarScrim",
      "sidebarOpenBtn",
      "sidebarClose",
      "sidebarLibraryCount",
      "sidebarScriptCount",
      "sidebarScriptsBtn",
      "sidebarKeyBtn",
      "sidebarKeyDot",
      "sidebarVersion",
      "signOutBtn",
      "accountAvatar",
      "accountName",
      "accountEmail",
      "topbarAvatar",
      "topbarAccountBtn",
      "topbarKicker",
      "topbarTitle",
      "dashGreetingTime",
      "dashFirstName",
      "dashStats",
      "dashReportCount",
      "dashMonthCount",
      "dashLeadCount",
      "dashContactedCount",
      "dashContactedRate",
      "dashDncCount",
      "dashAnalyticsAccount",
      "dashTodayReached",
      "dashTodayDelta",
      "dashBestDay",
      "dashBestDayLabel",
      "dashMonthReached",
      "dashMonthLeads",
      "dashMonthTotalLeads",
      "dashMonthScans",
      "dashMonthImports",
      "dashDayChart",
      "dashSourceScanLeads",
      "dashSourceScanReached",
      "dashSourceScanTodo",
      "dashSourceImportLeads",
      "dashSourceImportReached",
      "dashSourceImportTodo",
      "dashSourceUnknownLeads",
      "dashSourceUnknownReached",
      "dashSourceUnknownTodo",
      "dashRecentReports",
      "dashEmpty",
      "dashKeyStatus",
      "dashKeyCopy",
      "dashKeyAction",
      "dashScriptCount",
      "dashOpenScriptsBtn",
      "dashOutreachCopy",
      "dashOutreachRate",
      "dashOutreachTrack",
      "dashOutreachFill",
      "dashOutreachContacted",
      "dashOutreachToContact",
      "librarySearch",
      "libraryCount",
      "libraryGrid",
      "libraryEmpty",
      "libraryEmptyTitle",
      "libraryEmptyText",
      "reportSavedBadge",
      "reportSavedBadgeText",
      "saveReportBtn",
      "saveReportLabel",
      "saveReportDialog",
      "closeSaveReportDialog",
      "saveReportForm",
      "saveReportName",
      "saveReportNameError",
      "saveReportNotes",
      "saveReportSummary",
      "saveReportSummaryTitle",
      "saveReportSummaryMeta",
      "saveReportError",
      "saveReportNotice",
      "cancelSaveReport",
      "confirmSaveReport",
      "confirmSaveReportLabel",
      "updateChip",
      "updateChipText",
      "updateChipVer",
      "scriptChip",
      "scriptChipCount",
      "keyChip",
      "keyDot",
      "keyChipText",
      "formKeyDot",
      "formKeyText",
      "viewDashboard",
      "viewLibrary",
      "viewSetup",
      "viewProgress",
      "viewReport",
      "viewData",
      "scanForm",
      "niche",
      "location",
      "nicheError",
      "locationError",
      "maxResults",
      "resultsOutput",
      "minStars",
      "minReviews",
      "includeContacts",
      "contactsSuppressed",
      "skipClosed",
      "formAlert",
      "briefStamp",
      "estimateInline",
      "estimateMain",
      "estimateBasis",
      "estimatePlaces",
      "estimatePerPlace",
      "estimateStart",
      "estimateCap",
      "runBtn",
      "keyDialog",
      "closeKeyDialog",
      "keyStatusBox",
      "keyStatusText",
      "apiKeyInput",
      "toggleKeyVisibility",
      "keyError",
      "keyForm",
      "saveKeyBtn",
      "forgetKeyBtn",
      "progressRunId",
      "progressTitle",
      "progressSub",
      "progressCount",
      "progressLive",
      "progressStamp",
      "runStatus",
      "runElapsed",
      "runTarget",
      "runCap",
      "progressPhase",
      "progressPercent",
      "progressTrack",
      "progressFill",
      "runSteps",
      "abortBtn",
      "consoleLink",
      "progressError",
      "progressErrorTitle",
      "progressErrorText",
      "progressRetryBtn",
      "backToSetup",
      "reportTimestamp",
      "reportRunLabel",
      "reportNiche",
      "reportLocation",
      "reportInWord",
      "reportSub",
      "reportScriptBtn",
      "exportCsvBtn",
      "exportJsonBtn",
      "dataCardBtn",
      "statsStrip",
      "reportToolbar",
      "leadSearch",
      "filterWebsite",
      "filterContact",
      "filterRating",
      "filterReviews",
      "sortBy",
      "sortRating",
      "ratingHeader",
      "clearFilters",
      "resultCount",
      "outreachStrip",
      "outreachRate",
      "outreachProgress",
      "outreachProgressContacted",
      "outreachProgressDnc",
      "tableWrap",
      "leadsTable",
      "leadsBody",
      "emptyState",
      "emptyTitle",
      "emptyText",
      "emptyResetBtn",
      "reportFootnote",
      "pagination",
      "reportScriptSection",
      "reportScriptTitle",
      "reportScriptNote",
      "reportScriptBody",
      "dataBackToReport",
      "dataNewScan",
      "dataTimestamp",
      "dataRunLabel",
      "dataSub",
      "dataLeadCount",
      "dataFieldCount",
      "dataSource",
      "dataFileName",
      "dataFormat",
      "dataReadStat",
      "dataDropZone",
      "dataFileInput",
      "dataPickBtn",
      "dataPickLabel",
      "dataImportStatus",
      "dataImportError",
      "dataCurrent",
      "dataCurrentName",
      "dataCurrentMeta",
      "dataCurrentStats",
      "dataMappedWrap",
      "dataMappedFields",
      "dataWarningsWrap",
      "dataWarnings",
      "dataOpenReport",
      "dataReplaceBtn",
      "reportDataLabel",
      "reportNavDataLabel",
      "leadDialog",
      "closeLeadDialog",
      "drawerCategory",
      "drawerName",
      "drawerAddress",
      "drawerRating",
      "drawerMapLink",
      "drawerScriptBtn",
      "drawerScriptLabel",
      "drawerScriptDefault",
      "drawerScriptSection",
      "drawerScriptTitle",
      "drawerScriptBody",
      "drawerContactCount",
      "drawerContacts",
      "drawerWebStatus",
      "drawerWeb",
      "drawerFacts",
      "drawerOutreachChoices",
      "drawerOutreachStamp",
      "drawerOutreachNote",
      "drawerOutreachNoteCount",
      "drawerOutreachSave",
      "copyLeadBtn",
      "toastRegion",
      "bootError",
      "bootErrorText",
      "footerBuild",
      "footerVersion",
      "scriptDialog",
      "closeScriptDialog",
      "scriptSearch",
      "scriptListLabel",
      "scriptListCount",
      "scriptList",
      "newScriptBtn",
      "importScriptsBtn",
      "exportScriptsBtn",
      "scriptImportInput",
      "scriptEditorEmpty",
      "scriptEditorMain",
      "emptyNewScriptBtn",
      "starterScriptBtn",
      "scriptTitleInput",
      "scriptSaveState",
      "scriptDefaultLabel",
      "scriptUpdatedLabel",
      "scriptPlaceholders",
      "scriptBodyInput",
      "makeDefaultScriptBtn",
      "duplicateScriptBtn",
      "deleteScriptBtn",
      "scriptCharCount",
      "doneScriptBtn",
      "callSheetDialog",
      "closeCallSheet",
      "callSheetKicker",
      "callSheetTitle",
      "callSheetSub",
      "callSheetEmpty",
      "writeFirstScriptBtn",
      "callSheetContent",
      "callSheetScriptSelect",
      "editCallSheetScript",
      "callSheetBody",
      "callSheetContext",
      "copyCallSheetBtn",
      "markCallSheetContactedBtn",
      "markCallSheetContactedLabel",
      "closeCallSheetBtn",
    ];
    for (const id of ids) els[id] = byId(id);
  }

  /* ---------------- self-update ---------------- */

  function syncUpdateChip() {
    const chip = els.updateChip;
    if (!chip || !els.updateChipText) return;
    const update = state.update;
    if (!update.available && update.mode !== "restarting") {
      chip.hidden = true;
      chip.classList.remove("is-busy", "is-restarting");
      return;
    }

    chip.hidden = !state.running ? false : true;
    chip.classList.toggle("is-busy", update.mode !== "idle");
    chip.classList.toggle("is-restarting", update.mode === "restarting");
    els.updateChipText.textContent =
      update.mode === "restarting"
        ? "Restarting…"
        : update.mode === "applying"
          ? "Updating…"
          : "Update available";

    const latest = update.info?.latest;
    const short = update.mode === "restarting" ? latest?.short : (latest?.short || "");
    if (els.updateChipVer) {
      els.updateChipVer.textContent = update.mode === "idle" && short ? `to ${short}` : "";
    }
    chip.title = latest?.subject
      ? `${latest.short}${latest.committedAt ? ` · ${formatDate(latest.committedAt)}` : ""} — ${latest.subject}`
      : "Update Lead Atlas from the GitHub repository";
  }

  function renderFooterBuild(status) {
    if (!els.footerBuild) return;
    const current = status?.enabled ? status.current : null;
    if (!current?.short) {
      els.footerBuild.hidden = true;
      return;
    }
    const when = current.committedAt ? ` · ${formatDate(current.committedAt)}` : "";
    const dirty = current.dirtyFiles ? ` · ${current.dirtyFiles} uncommitted` : "";
    els.footerBuild.textContent = `Build ${current.short}${when}${dirty} · ${current.branch || "main"}`;
    els.footerBuild.hidden = false;
  }

  // The app version comes from package.json via the server, so the footer shows
  // it on every install — git state and self-update settings don't matter.
  function renderFooterVersion(version) {
    if (!els.footerVersion || !version) return;
    els.footerVersion.textContent = `Version ${version}`;
    els.footerVersion.hidden = false;
  }

  async function checkForUpdates(force = false) {
    const update = state.update;
    if (state.running || update.applying) return null;
    try {
      const status = await api("/api/version", { tokenOverride: null });
      if (status?.enabled) {
        update.info = status;
        update.available = Boolean(status.updateAvailable);
        renderFooterBuild(status);
      } else {
        update.info = null;
        update.available = false;
        renderFooterBuild(null);
      }
      renderFooterVersion(status?.appVersion);
      syncUpdateChip();
      return status;
    } catch (error) {
      // Offline, restarting, or rate-limited: stay quiet; the interval retries.
      console.warn("[lead-atlas] Update check skipped:", error?.message || error);
      return null;
    }
  }

  async function runUpdate() {
    const update = state.update;
    if (!update.available || update.applying || state.running) return;
    update.applying = true;
    update.mode = "applying";
    syncUpdateChip();

    try {
      const result = await api("/api/update", { method: "POST", tokenOverride: null, body: {} });
      const nextShort = result?.short || update.info?.latest?.short || "";

      if (result?.restarting) {
        update.mode = "restarting";
        showToast("Update applied — restarting the local server…", "info");
        const confirmed = await waitForRestart();
        if (confirmed) {
          try {
            window.sessionStorage.setItem(STORAGE.updated, nextShort);
          } catch {
            /* storage can be unavailable in private mode */
          }
        }
        window.location.reload();
        return;
      }

      showToast(
        "Update applied. Restart the local server once to load the new build.",
        "success",
        { duration: 9000 },
      );
      update.applying = false;
      update.mode = "idle";
      update.available = false;
      syncUpdateChip();
      checkForUpdates(true);
    } catch (error) {
      showToast(error?.message || "The update could not be applied.", "error");
      update.applying = false;
      update.mode = "idle";
      syncUpdateChip();
      checkForUpdates(true);
    }
  }

  async function waitForRestart() {
    const beforeSha = state.update.info?.current?.sha || "";
    const deadline = Date.now() + 20_000;
    let gap = 800;
    while (Date.now() < deadline) {
      await delay(gap);
      try {
        const status = await api("/api/version", { tokenOverride: null });
        const currentSha = status?.current?.sha || "";
        if (status?.enabled && currentSha && currentSha !== beforeSha) return true;
      } catch {
        // The server is down while the old process exits and the new one binds.
      }
      gap = Math.min(1_500, gap + 200);
    }
    return false;
  }

  function startUpdatePolling() {
    // Quiet background heartbeat while any tab is open; the server caches the
    // GitHub check for a minute, so several tabs stay cheap.
    window.setInterval(() => {
      checkForUpdates();
    }, 5 * 60 * 1000);
  }

  // Reload landing after a successful one-click update: announce the new build
  // once, then clear the flag so a later refresh stays quiet.
  function announceUpdatedBuild() {
    let updatedTo = null;
    try {
      updatedTo = window.sessionStorage.getItem(STORAGE.updated);
      window.sessionStorage.removeItem(STORAGE.updated);
    } catch {
      return;
    }
    if (!updatedTo) return;
    showToast(`Updated to build ${updatedTo}. You are on the newest code.`, "success", {
      duration: 9000,
    });
  }

  /* ---------------- view ---------------- */

  const VIEW_META = {
    dashboard: { kicker: "Workspace", title: "Overview" },
    library: { kicker: "Workspace", title: "Lead library" },
    setup: { kicker: "Scanner", title: "New scan" },
    progress: { kicker: "Scanner", title: "Scan in progress" },
    report: { kicker: "Report", title: "Field report" },
    data: { kicker: "Data desk", title: "Import leads" },
  };

  function documentTitleForView(name) {
    if (name === "report" || name === "data") {
      // renderReport() and renderImportDesk() know the specific territory.
      return document.title;
    }
    const meta = VIEW_META[name] || VIEW_META.dashboard;
    return `${meta.title} — Lead Atlas`;
  }

  function showView(name, { scroll = true, focus = true, historyMode = "push" } = {}) {
    const views = {
      dashboard: els.viewDashboard,
      library: els.viewLibrary,
      setup: els.viewSetup,
      progress: els.viewProgress,
      report: els.viewReport,
      data: els.viewData,
    };
    if (!views[name]) return;
    for (const [key, element] of Object.entries(views)) {
      if (!element) continue;
      element.hidden = key !== name;
      element.classList.toggle("is-entering", key === name);
      if (key === name) {
        window.setTimeout(() => element.classList.remove("is-entering"), 700);
      }
    }
    state.view = name;

    const meta = VIEW_META[name] || VIEW_META.dashboard;
    if (els.topbarKicker) els.topbarKicker.textContent = meta.kicker;
    if (els.topbarTitle) els.topbarTitle.textContent = meta.title;
    document.title = documentTitleForView(name);
    if (historyMode !== "none") {
      syncViewRoute(name, { replace: historyMode === "replace" });
    }
    $$("[data-app-view]").forEach((button) => {
      const active = button.dataset.appView === name;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    closeSidebar();

    if (scroll) {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    }

    if (focus) {
      const view = views[name];
      const heading = view?.querySelector("h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        window.setTimeout(() => heading.focus({ preventScroll: true }), reduceMotion ? 0 : 280);
      }
    }
  }

  // Back/forward and hand-edited hashes reopen the matching workspace section.
  function handleRouteChange() {
    if (!isAuthed() || state.auth.entering) return;
    const view = viewFromHash();
    if (!view || view === state.view) return;
    const options = { scroll: true, focus: true, historyMode: "none" };
    if (view === "data") {
      renderImportDesk();
      showView("data", options);
      return;
    }
    if (view === "report") {
      showView(state.results ? "report" : "library", options);
      return;
    }
    if (view === "progress" && !state.running) {
      showView("setup", options);
      return;
    }
    if (view === "library" && !state.library.loaded) loadLibrary();
    if (view === "dashboard") renderDashboard();
    showView(view, options);
  }

  /* ---------------- key state ---------------- */

  function updateKeyUI() {
    if (!els.keyChip) return;
    const status = state.keyStatus;
    const account = state.account;
    const connected = status === "connected";

    const chipClasses = ["key-chip"];
    if (connected) chipClasses.push("is-connected");
    if (status === "invalid") chipClasses.push("is-invalid");
    els.keyChip.className = chipClasses.join(" ");

    let chipText = "Connect Apify key";
    if (status === "checking") chipText = "Checking key…";
    if (status === "invalid") chipText = "Key needs attention";
    if (status === "unverified") chipText = "Key not verified";
    if (connected) {
      chipText = account?.username ? `Apify · @${account.username}` : "Apify key connected";
    }
    els.keyChipText.textContent = chipText;
    els.keyChip.title = connected
      ? `Connected to Apify${account?.plan ? ` · ${account.plan}` : ""}. Click to manage.`
      : "Manage your Apify API key";

    let formText = "Apify key not connected";
    if (status === "checking") formText = "Checking Apify key…";
    if (status === "invalid") formText = "Apify key needs attention";
    if (status === "unverified") formText = "Apify key not verified";
    if (connected) {
      formText = account?.username
        ? `Apify connected · @${account.username}`
        : "Apify key connected";
    }
    els.formKeyText.textContent = formText;

    const connection = els.formKeyText.closest(".brief-connection");
    if (connection) {
      connection.classList.toggle("is-connected", connected);
      connection.classList.toggle("is-invalid", status === "invalid");
    }

    const addKeyText = connected ? "Change" : status === "invalid" ? "Replace" : "Add key";
    $$("[data-open-key]").forEach((button) => {
      const label = button.querySelector("#dashKeyAction");
      if (label) label.textContent = addKeyText;
      else button.textContent = addKeyText;
    });

    const statusClasses = ["key-status"];
    if (connected) statusClasses.push("is-connected");
    if (status === "invalid") statusClasses.push("is-invalid");
    if (els.keyStatusBox) els.keyStatusBox.className = statusClasses.join(" ");

    let dialogStatus = "Not connected";
    if (status === "checking") dialogStatus = "Checking with Apify…";
    if (status === "unverified") dialogStatus = "Saved key could not be verified";
    if (status === "invalid") dialogStatus = "Saved key needs attention";
    if (connected) {
      dialogStatus = `Connected${account?.username ? ` as @${account.username}` : ""}${
        account?.plan ? ` · ${account.plan}` : ""
      }`;
    }
    if (els.keyStatusText) els.keyStatusText.textContent = dialogStatus;
    if (els.forgetKeyBtn) els.forgetKeyBtn.hidden = !state.token;
    if (els.apiKeyInput) {
      els.apiKeyInput.placeholder = state.token
        ? "Saved — paste a new token to replace"
        : "apify_api_…";
    }
    renderDashboardKey();
  }

  function setKeyStatus(status) {
    state.keyStatus = status;
    updateKeyUI();
  }

  function readStoredToken() {
    try {
      const token = window.localStorage.getItem(STORAGE.token);
      return token && token.trim() ? token.trim() : "";
    } catch {
      return "";
    }
  }

  function writeStoredToken(token) {
    try {
      if (token) window.localStorage.setItem(STORAGE.token, token);
      else window.localStorage.removeItem(STORAGE.token);
    } catch {
      /* the account copy is authoritative; a blocked cache is survivable */
    }
  }

  function applyAccountToken(token) {
    const next = String(token || "").trim();
    if (state.token !== next) {
      state.resultsToken = null;
      state.account = null;
    }
    state.token = next;
    writeStoredToken(next);
  }

  function clearLocalTokenState() {
    state.token = "";
    state.resultsToken = null;
    state.account = null;
    state.pendingRunBrief = null;
    writeStoredToken("");
  }

  async function saveTokenToAccount(token) {
    const sb = supabaseClient();
    const user = state.auth.user;
    if (!sb || !user?.id) {
      throw new Error("Sign in before saving an Apify key to your account.");
    }
    const updated = await sb.update(
      "profiles",
      { id: `eq.${user.id}` },
      { apify_token: token },
    );
    if (Array.isArray(updated) && updated.length) return updated[0];
    const inserted = await sb.insert("profiles", {
      id: user.id,
      email: user.email || null,
      apify_token: token,
    });
    return Array.isArray(inserted) ? inserted[0] : inserted;
  }

  async function clearTokenFromAccount() {
    const sb = supabaseClient();
    const user = state.auth.user;
    if (!sb || !user?.id) return;
    await sb.update(
      "profiles",
      { id: `eq.${user.id}` },
      { apify_token: null },
      { returning: false },
    );
  }

  async function validateStoredKey({ silent = true } = {}) {
    if (!state.token) {
      setKeyStatus("empty");
      return false;
    }
    setKeyStatus("checking");
    try {
      const account = await api("/api/key/validate", {
        method: "POST",
        tokenOverride: state.token,
        body: {},
      });
      state.account = account;
      setKeyStatus("connected");
      if (!silent) showToast(`Apify key connected as @${account.username}.`, "success");
      return true;
    } catch (error) {
      state.account = null;
      const isAuth = error.status === 401 || error.status === 403;
      setKeyStatus(isAuth ? "invalid" : "unverified");
      if (!silent) showToast(error.message, "error");
      return false;
    }
  }

  function openKeyDialog() {
    if (!els.keyDialog) return;
    els.keyError.hidden = true;
    els.apiKeyInput.value = "";
    els.apiKeyInput.type = "password";
    els.toggleKeyVisibility.textContent = "Show";
    els.toggleKeyVisibility.setAttribute("aria-label", "Show key");
    state.keyVisible = false;
    updateKeyUI();
    if (!els.keyDialog.open) els.keyDialog.showModal();
    document.body.classList.add("has-dialog");
    syncDialogState();
    window.setTimeout(() => els.apiKeyInput?.focus(), 50);
  }

  function closeKeyDialog() {
    if (els.keyDialog?.open) els.keyDialog.close();
  }

  async function handleKeySubmit(event) {
    event.preventDefault();
    const token = els.apiKeyInput.value.trim();
    els.keyError.hidden = true;

    if (!token) {
      els.keyError.textContent = "Paste your Apify API token first.";
      els.keyError.hidden = false;
      els.apiKeyInput.focus();
      return;
    }
    if (token.length < 20 || /\s/.test(token)) {
      els.keyError.textContent =
        "That token looks incomplete. Copy the full token from Apify Console.";
      els.keyError.hidden = false;
      els.apiKeyInput.focus();
      return;
    }
    if (!isAuthed()) {
      els.keyError.textContent = "Sign in before saving an Apify key to your account.";
      els.keyError.hidden = false;
      els.apiKeyInput.focus();
      return;
    }

    const previousStatus = state.keyStatus;
    const previousAccount = state.account;
    const originalLabel = els.saveKeyBtn.innerHTML;
    els.saveKeyBtn.disabled = true;
    els.saveKeyBtn.classList.add("is-loading");
    els.saveKeyBtn.innerHTML = `${icon("i-key")} Checking key…`;
    setKeyStatus("checking");

    try {
      const account = await api("/api/key/validate", {
        method: "POST",
        tokenOverride: token,
        body: {},
      });
      try {
        await saveTokenToAccount(token);
      } catch (saveError) {
        throw new Error(
          `The key is valid, but it could not be saved to your account. ${friendlySupabaseError(saveError)}`,
        );
      }
      state.token = token;
      state.resultsToken = null;
      state.account = account;
      writeStoredToken(token);
      setKeyStatus("connected");
      els.apiKeyInput.value = "";

      const pendingBrief = state.pendingRunBrief;
      state.pendingRunBrief = null;
      closeKeyDialog();
      showToast(`Connected to Apify as @${account.username}.`, "success");
      if (pendingBrief) startScan(pendingBrief);
    } catch (error) {
      state.account = previousAccount;
      setKeyStatus(previousStatus === "checking" ? (state.token ? "unverified" : "empty") : previousStatus);
      els.keyError.textContent = error.message;
      els.keyError.hidden = false;
      els.apiKeyInput.focus();
    } finally {
      els.saveKeyBtn.disabled = false;
      els.saveKeyBtn.classList.remove("is-loading");
      els.saveKeyBtn.innerHTML = originalLabel;
      updateKeyUI();
    }
  }

  async function forgetKey() {
    if (els.forgetKeyBtn) els.forgetKeyBtn.disabled = true;
    let accountCopyCleared = false;
    try {
      if (isAuthed() && supabaseClient()) {
        try {
          await clearTokenFromAccount();
          accountCopyCleared = true;
        } catch (error) {
          if (!isMissingTokenColumnError(error)) {
            showToast(
              `The key could not be removed from your account. ${friendlySupabaseError(error)}`,
              "error",
              { duration: 8000 },
            );
            return;
          }
          // No apify_token column means there is no account copy to remove;
          // clearing the browser cache is still the right action.
        }
      }
      clearLocalTokenState();
      setKeyStatus("empty");
      els.apiKeyInput.value = "";
      els.keyError.hidden = true;
      showToast(
        accountCopyCleared
          ? "Apify key removed from this browser and your account."
          : "Apify key removed from this browser.",
        "success",
      );
    } finally {
      if (els.forgetKeyBtn) els.forgetKeyBtn.disabled = false;
    }
  }

  /* ---------------- brief ---------------- */

  function selectedWebsite() {
    return $('input[name="websiteFilter"]:checked')?.value || "allPlaces";
  }

  function readBrief() {
    try {
      const raw = window.localStorage.getItem(STORAGE.brief);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveBrief() {
    const brief = {
      niche: els.niche.value.trim(),
      location: els.location.value.trim(),
      websiteFilter: selectedWebsite(),
      maxResults: Number(els.maxResults.value),
      minStars: els.minStars.value,
      minReviews: els.minReviews?.value ?? "",
      skipClosed: els.skipClosed.checked,
      contactPreference: state.contactPreference,
    };
    try {
      window.localStorage.setItem(STORAGE.brief, JSON.stringify(brief));
    } catch {
      /* non-critical */
    }
  }

  function applyBrief(brief) {
    if (!brief || typeof brief !== "object") return;
    if (typeof brief.niche === "string") els.niche.value = brief.niche.slice(0, 120);
    if (typeof brief.location === "string") els.location.value = brief.location.slice(0, 160);

    const website = ["allPlaces", "withWebsite", "withoutWebsite"].includes(brief.websiteFilter)
      ? brief.websiteFilter
      : "allPlaces";
    const radio = $(`input[name="websiteFilter"][value="${website}"]`);
    if (radio) radio.checked = true;

    const max = Number(brief.maxResults);
    if (Number.isFinite(max)) {
      const min = Number(els.maxResults.min || 5);
      const maxAllowed = Number(els.maxResults.max || 500);
      els.maxResults.value = String(Math.min(maxAllowed, Math.max(min, max)));
    }

    if (typeof brief.minStars === "string") {
      const hasOption = $$("option", els.minStars).some((option) => option.value === brief.minStars);
      if (hasOption) els.minStars.value = brief.minStars;
    }
    if (typeof brief.minReviews === "string" && els.minReviews) {
      const hasOption = $$("option", els.minReviews).some(
        (option) => option.value === brief.minReviews,
      );
      if (hasOption) els.minReviews.value = brief.minReviews;
    }
    els.skipClosed.checked = brief.skipClosed !== false;
    state.contactPreference = brief.contactPreference !== false;
    els.includeContacts.checked = state.contactPreference;
  }

  function syncRangeVisual() {
    const input = els.maxResults;
    const value = Number(input.value);
    const min = Number(input.min || 5);
    const max = Number(input.max || 500);
    const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty("--range-progress", `${percent}%`);
    els.resultsOutput.textContent = String(value);
    els.resultsOutput.setAttribute("aria-label", `${value} places`);
  }

  function syncWebsiteState() {
    const noWebsite = selectedWebsite() === "withoutWebsite";
    if (noWebsite) {
      if (!els.includeContacts.disabled) {
        state.contactPreference = els.includeContacts.checked;
      }
      els.includeContacts.disabled = true;
      els.includeContacts.checked = false;
      els.contactsSuppressed.hidden = false;
    } else {
      els.includeContacts.disabled = false;
      els.includeContacts.checked = state.contactPreference;
      els.contactsSuppressed.hidden = true;
    }
    updateEstimate();
  }

  function estimateFromForm() {
    const pricing = { ...FALLBACK_CONFIG.pricing, ...(state.config.pricing || {}) };
    const maxResults = Number(els.maxResults.value) || 40;
    const website = selectedWebsite();
    const includeContacts = website !== "withoutWebsite" && els.includeContacts.checked;
    const filtersApplied =
      (website !== "allPlaces" ? 1 : 0) +
      (els.skipClosed.checked ? 1 : 0) +
      (els.minStars.value ? 1 : 0);
    const perPlace =
      Number(pricing.place) +
      Number(pricing.placeDetails) +
      (includeContacts ? Number(pricing.contacts) : 0) +
      filtersApplied * Number(pricing.filter);
    const estimate = Math.round((maxResults * perPlace + Number(pricing.start)) * 10000) / 10000;
    const cap = Math.max(
      Number(pricing.minimumRunCharge) || 0.5,
      Math.ceil(estimate * 1.5 * 100) / 100,
    );
    const start = Number(pricing.start) || 0;
    return { maxResults, perPlace, estimate, cap, includeContacts, filtersApplied, start };
  }

  function updateEstimate() {
    const cost = estimateFromForm();
    els.estimateMain.textContent = cost.estimate.toFixed(2);
    els.estimateInline.textContent = money(cost.estimate);
    els.estimateBasis.textContent = `${formatNumber(cost.maxResults)} places × $${cost.perPlace.toFixed(
      3,
    )} + $${cost.start.toFixed(3)} run fee`;
    els.estimatePlaces.textContent = formatNumber(cost.maxResults);
    els.estimatePerPlace.textContent = `$${cost.perPlace.toFixed(3)}`;
    if (els.estimateStart) els.estimateStart.textContent = `$${cost.start.toFixed(3)}`;
    els.estimateCap.textContent = money(cost.cap);
  }

  function populateMinStars() {
    const current = els.minStars.value;
    const options = state.config.minStars || FALLBACK_CONFIG.minStars;
    els.minStars.innerHTML = options
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`,
      )
      .join("");
    if (options.some((option) => option.value === current)) els.minStars.value = current;
  }

  function populateMinReviews() {
    if (!els.minReviews) return;
    const current = els.minReviews.value;
    const options = state.config.minReviews || FALLBACK_CONFIG.minReviews;
    els.minReviews.innerHTML = options
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`,
      )
      .join("");
    const values = new Set(options.map((option) => String(option.value)));
    if (values.has(current)) {
      els.minReviews.value = current;
      return;
    }
    const preferred = options.find((option) => option.selected)?.value ?? options[0]?.value ?? "";
    els.minReviews.value = String(preferred);
  }

  function setRangeBounds() {
    const limits = state.config.limits || FALLBACK_CONFIG.limits;
    const max = Math.max(5, Number(limits.maxResults) || 500);
    const min = Math.min(5, max);
    els.maxResults.max = String(max);
    els.maxResults.min = String(min);
    if (Number(els.maxResults.value) > max) els.maxResults.value = String(max);
    if (Number(els.maxResults.value) < min) els.maxResults.value = String(min);
  }

  /* ---------------- form validation ---------------- */

  function setFieldError(input, errorEl, message) {
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearFieldError(input, errorEl) {
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  function clearFormAlert() {
    els.formAlert.hidden = true;
    els.formAlert.textContent = "";
  }

  function showFormAlert(message) {
    els.formAlert.textContent = message;
    els.formAlert.hidden = false;
  }

  function validateBrief() {
    clearFieldError(els.niche, els.nicheError);
    clearFieldError(els.location, els.locationError);
    clearFormAlert();

    const niche = els.niche.value.replace(/\s+/g, " ").trim();
    const location = els.location.value.replace(/\s+/g, " ").trim();
    let firstInvalid = null;

    if (niche.length < 2) {
      setFieldError(
        els.niche,
        els.nicheError,
        "Enter a business type, niche, or business name (at least 2 characters).",
      );
      firstInvalid = firstInvalid || els.niche;
    }
    if (location.length < 2) {
      setFieldError(
        els.location,
        els.locationError,
        "Enter a city, region, country, or full address (at least 2 characters).",
      );
      firstInvalid = firstInvalid || els.location;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      return null;
    }

    return {
      niche,
      location,
      websiteFilter: selectedWebsite(),
      includeContacts: els.includeContacts.checked && !els.includeContacts.disabled,
      maxResults: Number(els.maxResults.value),
      minStars: els.minStars.value,
      minReviews: els.minReviews?.value ?? "",
      skipClosed: els.skipClosed.checked,
    };
  }

  /* ---------------- run lifecycle ---------------- */

  function shortRunId(runId) {
    return String(runId || "").slice(-8).toUpperCase();
  }

  // The scan keeps running on Apify when the tab closes, so a small pointer to
  // it survives in localStorage until the run finishes or the user aborts.
  function saveActiveRun(run) {
    const record = {
      runId: run.runId,
      startedAt: run.startedAt,
      brief: {
        niche: run.brief.niche,
        location: run.brief.location,
        maxResults: run.brief.maxResults,
      },
      target: run.target,
      cap: run.cap,
      consoleUrl: els.consoleLink?.href || null,
    };
    try {
      window.localStorage.setItem(STORAGE.activeRun, JSON.stringify(record));
    } catch {
      /* storage can be unavailable in private mode */
    }
  }

  function clearActiveRun() {
    try {
      window.localStorage.removeItem(STORAGE.activeRun);
    } catch {
      /* non-critical */
    }
  }

  function readActiveRun() {
    try {
      const record = parseActiveRun(window.localStorage.getItem(STORAGE.activeRun));
      if (!record || !isActiveRunFresh(record)) {
        clearActiveRun();
        return null;
      }
      return record;
    } catch {
      return null;
    }
  }

  // Boot-time reattach: mount the progress view for the run saved before the
  // tab closed, then let the normal poll loop reconcile (still running, done,
  // failed, or gone).
  async function resumeActiveRun() {
    if (state.running) return false;
    const record = readActiveRun();
    if (!record || !state.token) return false;

    const run = {
      token: state.token,
      brief: record.brief,
      startedAt: record.startedAt,
      finishedAt: null,
      runId: record.runId,
      target: record.target,
      cap: record.cap,
      cost: null,
      status: "RUNNING",
      itemCount: 0,
      pollTimer: null,
      tickTimer: null,
      polling: false,
      pollFailures: 0,
      stopped: false,
      lastPercent: 3,
    };

    state.running = run;
    state.results = null;
    state.savedReport = null;
    state.importDesk = null;
    state.resultsToken = null;
    resetProgressUI(run);
    els.progressSub.textContent =
      "Reconnected to the scan you started earlier. It kept running while this tab was away — progress checks happen right here in your browser.";
    els.progressRunId.textContent = `RUN ${shortRunId(run.runId)}`;
    if (record.consoleUrl) els.consoleLink.href = record.consoleUrl;
    els.abortBtn.disabled = false;
    showView("progress", { scroll: false, focus: false });
    startProgressTimers(run);
    showToast("Reconnected to your last scan. Catching up…", "info");
    startPolling(run);
    return true;
  }

  function setRunButtonLoading(loading, label = "Sending brief…") {
    if (!els.runBtn) return;
    els.runBtn.disabled = loading;
    els.runBtn.classList.toggle("is-loading", loading);
    const labelNode = els.runBtn.querySelector(".btn-run-label");
    if (labelNode) {
      if (!labelNode.dataset.original) labelNode.dataset.original = labelNode.textContent;
      labelNode.textContent = loading ? label : labelNode.dataset.original;
    }
  }

  function resetProgressUI(run) {
    els.progressError.hidden = true;
    els.progressTitle.innerHTML = "Charting the<br /><em>territory.</em>";
    els.progressSub.textContent =
      "Apify is reading Google Maps. Keep this tab open — progress checks happen right here in your browser.";
    els.progressRunId.textContent = "PREPARING";
    els.progressCount.textContent = "0";
    if (els.progressLive) els.progressLive.textContent = "";
    els.progressStamp.textContent = "Locating…";
    els.runStatus.textContent = "Sending";
    els.runElapsed.textContent = "00:00";
    els.runTarget.textContent = `${formatNumber(run.brief.maxResults)} places`;
    els.runCap.textContent = money(run.cap);
    els.progressPhase.textContent = "Sending the brief";
    els.progressPercent.textContent = "0%";
    els.progressTrack.setAttribute("aria-valuenow", "0");
    els.progressFill.style.width = "0%";
    els.abortBtn.disabled = true;
    els.abortBtn.innerHTML = `${icon("i-x")} Abort scan`;
    els.consoleLink.href = "https://console.apify.com/actors/runs";
    $$("li", els.runSteps).forEach((item) => {
      item.classList.remove("is-active", "is-done");
    });
    els.runSteps.querySelector('[data-step="queued"]')?.classList.add("is-active");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function updateElapsed(run) {
    if (state.running !== run) return;
    const elapsed = ((run.finishedAt || Date.now()) - run.startedAt) / 1000;
    els.runElapsed.textContent = formatElapsed(elapsed);
    if (!run.finishedAt && run.status === "RUNNING") {
      updateProgressMeter(run);
    }
  }

  function statusLabel(status) {
    const labels = {
      READY: "Queued",
      RUNNING: "Reading map",
      SUCCEEDED: "Run complete",
      FAILED: "Failed",
      "TIMED-OUT": "Timed out",
      ABORTING: "Aborting",
      ABORTED: "Aborted",
    };
    return labels[status] || status || "Working";
  }

  function computeProgressPercent(run) {
    if (run.status === "SUCCEEDED" || run.status === "ABORTING") return 96;
    if (["FAILED", "TIMED-OUT", "ABORTED"].includes(run.status)) return run.lastPercent || 90;
    if (run.status === "RUNNING") {
      const elapsed = ((run.finishedAt || Date.now()) - run.startedAt) / 1000;
      const countRatio =
        run.itemCount > 0 && run.target > 0
          ? Math.min(0.76, (run.itemCount / run.target) * 0.76)
          : 0;
      const timeRatio = Math.min(0.6, (elapsed / 240) * 0.6);
      return Math.min(90, Math.round(6 + Math.max(countRatio, timeRatio) * 100));
    }
    return run.runId ? 5 : 3;
  }

  function updateProgressMeter(run) {
    const percent = computeProgressPercent(run);
    run.lastPercent = percent;
    els.progressFill.style.width = `${percent}%`;
    els.progressPercent.textContent = `${percent}%`;
    els.progressTrack.setAttribute("aria-valuenow", String(percent));
  }

  function setStep(name, stateName) {
    const item = els.runSteps.querySelector(`[data-step="${name}"]`);
    if (!item) return;
    item.classList.toggle("is-active", stateName === "active");
    item.classList.toggle("is-done", stateName === "done");
  }

  function updateProgressFromRun(apiRun) {
    const run = state.running;
    if (!run) return;
    const status = String(apiRun?.status || run.status || "RUNNING");
    const previousCount = run.itemCount || 0;
    run.status = status;
    if (Number.isFinite(apiRun?.itemCount)) run.itemCount = apiRun.itemCount;
    if (Number.isFinite(apiRun?.targetCount) && apiRun.targetCount > 0) run.target = apiRun.targetCount;
    if (apiRun?.cost?.safetyCapUsd) run.cap = apiRun.cost.safetyCapUsd;

    els.runStatus.textContent = statusLabel(status);
    els.runTarget.textContent = `${formatNumber(run.target)} places`;
    els.runCap.textContent = money(run.cap);
    els.progressCount.textContent = formatNumber(run.itemCount || 0);
    if (els.progressLive && (run.itemCount || 0) !== previousCount) {
      els.progressLive.textContent = `${pluralize(run.itemCount || 0, "place")} found so far.`;
    }

    const location = run.brief.location;
    els.progressStamp.textContent = `${location} · ${formatNumber(run.itemCount || 0)} found`;
    if (apiRun?.runId) {
      els.progressRunId.textContent = `RUN ${shortRunId(apiRun.runId)}`;
      els.consoleLink.href = apiRun.consoleUrl || `https://console.apify.com/actors/runs/${apiRun.runId}`;
    }

    if (status === "READY") {
      els.progressPhase.textContent = "Queued with Apify";
      setStep("queued", "active");
      setStep("scrape", "pending");
      setStep("collect", "pending");
      setStep("ready", "pending");
    } else if (status === "RUNNING") {
      els.progressPhase.textContent = run.itemCount
        ? `Reading the map — ${formatNumber(run.itemCount)} found`
        : "Reading Google Maps";
      setStep("queued", "done");
      setStep("scrape", "active");
      setStep("collect", "pending");
      setStep("ready", "pending");
    } else if (status === "SUCCEEDED") {
      els.progressPhase.textContent = "Pulling the field notes";
      setStep("queued", "done");
      setStep("scrape", "done");
      setStep("collect", "active");
      setStep("ready", "pending");
    } else if (status === "ABORTING") {
      els.progressPhase.textContent = "Sending the abort signal";
      setStep("scrape", "active");
    } else {
      els.progressPhase.textContent = statusLabel(status);
      setStep("queued", "done");
    }

    updateProgressMeter(run);
    if (status === "SUCCEEDED") {
      els.progressPercent.textContent = "96%";
    }
  }

  function stopProgressTimers(run) {
    if (!run) return;
    if (run.pollTimer) window.clearInterval(run.pollTimer);
    if (run.tickTimer) window.clearInterval(run.tickTimer);
    run.pollTimer = null;
    run.tickTimer = null;
  }

  function showProgressError(title, message) {
    const run = state.running;
    if (run) {
      run.finishedAt = run.finishedAt || Date.now();
      stopProgressTimers(run);
      updateElapsed(run);
    }
    // Release the run slot so a failed or partial run never locks the scanner.
    state.running = null;
    clearActiveRun();
    els.progressErrorTitle.textContent = title;
    els.progressErrorText.textContent = message;
    els.progressError.hidden = false;
    els.abortBtn.disabled = true;
    setRunButtonLoading(false);
    window.setTimeout(() => {
      els.progressError.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    }, 80);
  }

  function showRunFailure(title, message) {
    const run = state.running;
    if (run) {
      run.finishedAt = run.finishedAt || Date.now();
      stopProgressTimers(run);
      updateElapsed(run);
    }
    els.progressTitle.innerHTML = "The trail<br /><em>went cold.</em>";
    els.progressSub.textContent =
      "The run did not finish cleanly. No credits beyond the work already completed should be used.";
    if (els.runStatus) els.runStatus.textContent = statusLabel(run?.status || "FAILED");
    els.progressPhase.textContent = "Run stopped";
    setStep("queued", "done");
    setStep("scrape", "done");
    state.running = null;
    showProgressError(title, message);
  }

  function startProgressTimers(run) {
    run.tickTimer = window.setInterval(() => updateElapsed(run), 1000);
    updateElapsed(run);
  }

  async function startScan(brief) {
    if (state.running) return;
    const formCost = estimateFromForm();
    const run = {
      token: state.token,
      brief,
      startedAt: Date.now(),
      finishedAt: null,
      runId: null,
      target: brief.maxResults,
      cap: formCost.cap,
      cost: null,
      status: "SUBMITTING",
      itemCount: 0,
      pollTimer: null,
      tickTimer: null,
      polling: false,
      pollFailures: 0,
      stopped: false,
      lastPercent: 3,
    };

    state.running = run;
    state.results = null;
    state.importDesk = null;
    state.resultsToken = null;
    resetProgressUI(run);
    showView("progress", { scroll: true, focus: true });
    setRunButtonLoading(true);
    startProgressTimers(run);

    try {
      const data = await api("/api/runs", {
        method: "POST",
        body: brief,
        tokenOverride: run.token,
      });
      if (state.running !== run) return;

      run.runId = data.run?.runId || null;
      if (!run.runId) throw new Error("Apify accepted the request without returning a run ID.");
      run.cost = data.cost || data.run?.cost || null;
      if (data.run?.targetCount) run.target = data.run.targetCount;
      if (run.cost?.safetyCapUsd) run.cap = run.cost.safetyCapUsd;
      if (data.run?.consoleUrl) els.consoleLink.href = data.run.consoleUrl;
      els.progressRunId.textContent = `RUN ${shortRunId(run.runId)}`;
      els.abortBtn.disabled = false;
      updateProgressFromRun(data.run);
      saveActiveRun(run);
      startPolling(run);
    } catch (error) {
      if (state.running !== run) return;
      stopProgressTimers(run);
      setRunButtonLoading(false);

      if (error.status === 400) {
        state.running = null;
        showView("setup");
        showFormAlert(error.message);
        els.formAlert.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        return;
      }
      if (error.status === 401) {
        state.running = null;
        state.account = null;
        setKeyStatus("invalid");
        showView("setup");
        openKeyDialog();
        els.keyError.textContent = error.message;
        els.keyError.hidden = false;
        els.apiKeyInput.focus();
        return;
      }

      state.running = null;
      showProgressError(
        "The scan could not start.",
        `${error.message} Return to the brief and try again, or check your Apify account.`,
      );
    }
  }

  function startPolling(run) {
    if (!run.runId) return;
    run.pollTimer = window.setInterval(() => pollRun(run), 2600);
    pollRun(run);
  }

  async function pollRun(run) {
    if (state.running !== run || run.polling || run.stopped) return;
    run.polling = true;
    try {
      const data = await api(`/api/runs/${encodeURIComponent(run.runId)}`, {
        tokenOverride: run.token,
      });
      if (state.running !== run) return;

      run.pollFailures = 0;
      const apiRun = data.run;
      updateProgressFromRun(apiRun);
      if (activeStatusIsTerminal(apiRun.status)) {
        stopProgressTimers(run);
        run.finishedAt = run.finishedAt || Date.now();
        updateElapsed(run);

        const count = Number(apiRun.itemCount) || run.itemCount || 0;
        const partial = apiRun.status !== "SUCCEEDED";
        if (count > 0 || apiRun.status === "SUCCEEDED") {
          await finishRun(run, apiRun, { partial });
        } else {
          const status = apiRun.status;
          const title =
            status === "ABORTED"
              ? "The scan was aborted."
              : status === "TIMED-OUT"
                ? "The scan timed out."
                : "The scan failed before returning places.";
          showRunFailure(
            title,
            apiRun.statusMessage ||
              "Apify did not return any places. Try a broader niche or a larger location, then run again.",
          );
        }
      }
    } catch (error) {
      if (state.running !== run) return;
      if (error.status === 404) {
        clearActiveRun();
        showRunFailure(
          "That scan can't be found.",
          "Apify has no record of this run — it may have been deleted or belong to a different account. Start a fresh scan.",
        );
        return;
      }
      if (error.status === 401 || error.status === 403) {
        state.account = null;
        setKeyStatus("invalid");
        showRunFailure(
          "Apify rejected the key.",
          "Your saved Apify key stopped working. Replace it in the key dialog, then start a new scan.",
        );
        return;
      }
      run.pollFailures += 1;
      if (run.pollFailures >= 4) {
        showRunFailure(
          "Lost contact with the run.",
          `${error.message} The scan may still be running in Apify — open Apify Console to check before starting another.`,
        );
        return;
      }
      els.runStatus.textContent = "Reconnecting…";
    } finally {
      run.polling = false;
    }
  }

  function activeStatusIsTerminal(status) {
    return ["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(status);
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function finishRun(run, apiRun, { partial = false } = {}) {
    if (state.running !== run) return;
    els.progressPhase.textContent = "Pulling the field notes";
    els.progressPercent.textContent = "96%";
    els.progressTrack.setAttribute("aria-valuenow", "96");
    els.progressFill.style.width = "96%";
    setStep("queued", "done");
    setStep("scrape", "done");
    setStep("collect", "active");
    setStep("ready", "pending");
    els.abortBtn.disabled = true;

    const params = new URLSearchParams({
      niche: run.brief.niche,
      location: run.brief.location,
    });

    let data = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        data = await api(
          `/api/runs/${encodeURIComponent(run.runId)}/results?${params.toString()}`,
          { tokenOverride: run.token },
        );
        break;
      } catch (error) {
        lastError = error;
        if (error.status === 409 && attempt < 2) {
          await delay(1600);
          if (state.running !== run) return;
          continue;
        }
        break;
      }
    }

    if (state.running !== run) return;

    if (!data) {
      showProgressError(
        "The report could not be pulled.",
        lastError?.message ||
          "Apify finished the run but the dataset could not be read. Open Apify Console to inspect the run.",
      );
      return;
    }

    state.importDesk = null;
    state.savedReport = null;
    state.resultsToken = run.token;
    state.results = {
      ...data,
      requested: run.target,
      mode: "live",
      runStatus: data.runStatus || apiRun.status,
      cost: run.cost,
    };
    hydrateOutreach(state.results.leads || []);
    state.results.summary = {
      ...(state.results.summary || summarize(state.results.leads || [])),
      outreach: outreachCounts(state.results.leads || []),
    };
    resetFilters({ render: false });
    renderReport();
    setStep("ready", "done");
    els.progressPercent.textContent = "100%";
    els.progressTrack.setAttribute("aria-valuenow", "100");
    els.progressFill.style.width = "100%";
    setRunButtonLoading(false);
    stopProgressTimers(run);
    state.running = null;
    clearActiveRun();
    showView("report", { scroll: true, focus: true });

    if (partial) {
      showToast(
        `Run ${String(apiRun.status).toLowerCase()} — showing ${pluralize(data.total, "recovered lead")}.`,
        "error",
      );
    } else {
      showToast(`Report ready: ${pluralize(data.total, "lead")}.`, "success");
    }
  }

  async function abortRun() {
    const run = state.running;
    if (!run?.runId) return;
    const confirmed = window.confirm(
      "Abort this scan? Apify may still charge for work completed before the abort.",
    );
    if (!confirmed) return;

    els.abortBtn.disabled = true;
    try {
      const data = await api(`/api/runs/${encodeURIComponent(run.runId)}/abort`, {
        method: "POST",
        tokenOverride: run.token,
      });
      els.runStatus.textContent = "Aborting…";
      showToast("Abort signal sent to Apify.", "info");
      if (data.run) updateProgressFromRun(data.run);
    } catch (error) {
      els.abortBtn.disabled = false;
      showToast(error.message, "error");
    }
  }

  /* ---------------- filters & report ---------------- */

  function resetFilters({ render = false } = {}) {
    state.filters = normalizeReportFilters({});
    if (els.leadSearch) els.leadSearch.value = "";
    if (els.filterWebsite) els.filterWebsite.value = "all";
    if (els.filterContact) els.filterContact.value = "all";
    if (els.filterRating) els.filterRating.value = "all";
    if (els.filterReviews) els.filterReviews.value = "all";
    if (els.sortBy) els.sortBy.value = "rating";
    if (els.clearFilters) els.clearFilters.hidden = true;
    if (render) {
      renderTable();
      renderOutreachSummary();
    }
  }

  function filtersAreActive() {
    return hasActiveFilters(state.filters);
  }

  function syncRatingSort() {
    const sort = state.filters.sort;
    const active = sort === "rating" || sort === "rating-asc";
    if (els.ratingHeader) {
      els.ratingHeader.setAttribute(
        "aria-sort",
        active ? (sort === "rating" ? "descending" : "ascending") : "none",
      );
    }
    if (!els.sortRating) return;
    els.sortRating.classList.toggle("is-active", active);
    els.sortRating.classList.toggle("is-asc", sort === "rating-asc");
    els.sortRating.title =
      sort === "rating"
        ? "Sorted highest to lowest — click for lowest to highest"
        : sort === "rating-asc"
          ? "Sorted lowest to highest — click for highest to lowest"
          : "Sort by rating, highest first";
  }

  function getFilteredLeads() {
    if (!state.results) return [];
    return filterReportLeads(state.results.leads, state.filters);
  }

  function animateMetric(element, value, formatter, { decimals = 0 } = {}) {
    if (!element) return;
    if (value === null || value === undefined) {
      element.textContent = "—";
      return;
    }
    if (reduceMotion) {
      element.textContent = formatter(value);
      return;
    }
    if (element._metricFrame) cancelAnimationFrame(element._metricFrame);
    const target = Number(value);
    const start = performance.now();
    const duration = 650;
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;
      element.textContent =
        progress >= 1 ? formatter(target) : formatter(Number(current.toFixed(decimals)));
      if (progress < 1) element._metricFrame = requestAnimationFrame(step);
    };
    element._metricFrame = requestAnimationFrame(step);
  }

  function renderStats(summary) {
    const get = (name) => $(`[data-stat="${name}"]`, els.statsStrip);
    animateMetric(get("total"), summary.total, (v) => formatNumber(Math.round(v)));
    animateMetric(get("reachable"), summary.withContact, (v) => formatNumber(Math.round(v)));
    animateMetric(
      get("withoutWebsite"),
      summary.withoutWebsite,
      (v) => formatNumber(Math.round(v)),
    );
    animateMetric(
      get("avgRating"),
      summary.avgRating,
      (v) => (v === null ? "—" : Number(v).toFixed(1)),
      { decimals: 1 },
    );
    animateMetric(get("withSocial"), summary.withSocial, (v) => formatNumber(Math.round(v)));
    animateMetric(
      get("totalReviews"),
      summary.totalReviews,
      (v) => formatCompact(Math.round(v)),
    );

    const reachable = get("reachable");
    if (reachable) {
      reachable.title = `${summary.contactRate}% of leads have a phone or email`;
    }
  }

  function renderOutreachSummary() {
    const leads = state.results?.leads || [];
    const counts = outreachCounts(leads);
    const active = state.filters.outreach || "all";

    if (els.outreachRate) {
      els.outreachRate.textContent = `${counts.rate}%`;
    }
    if (els.outreachProgressContacted) {
      els.outreachProgressContacted.style.width = counts.total
        ? `${(counts.contacted / counts.total) * 100}%`
        : "0%";
    }
    if (els.outreachProgressDnc) {
      els.outreachProgressDnc.style.width = counts.total
        ? `${(counts.doNotContact / counts.total) * 100}%`
        : "0%";
    }
    if (els.outreachProgress) {
      els.outreachProgress.setAttribute("aria-valuenow", String(counts.rate));
      els.outreachProgress.setAttribute(
        "aria-valuetext",
        `${pluralize(counts.contacted, "lead")} reached out, ${pluralize(
          counts.doNotContact,
          "lead",
        )} marked do not contact, out of ${pluralize(counts.total, "lead")}.`,
      );
    }

    const countValues = {
      total: counts.total,
      toContact: counts.toContact,
      contacted: counts.contacted,
      doNotContact: counts.doNotContact,
      marked: counts.marked,
    };
    for (const element of $$("[data-outreach-count]", els.outreachStrip)) {
      const key = element.dataset.outreachCount;
      element.textContent = formatNumber(countValues[key] ?? 0);
    }
    for (const chip of $$("[data-outreach-filter]", els.outreachStrip)) {
      chip.setAttribute("aria-pressed", chip.dataset.outreachFilter === active ? "true" : "false");
    }
    if (els.outreachStrip) {
      els.outreachStrip.classList.toggle("is-empty", counts.total === 0);
      els.outreachStrip.classList.toggle("has-progress", counts.marked > 0);
    }
  }

  function renderReportScript() {
    if (!els.reportScriptBody) return;
    const { script, body, empty } = activeScriptCopy();
    const hasReport = Boolean(state.results);

    if (els.reportScriptTitle) {
      els.reportScriptTitle.textContent = script ? script.title : "No script saved yet";
    }
    if (els.reportScriptNote) {
      els.reportScriptNote.textContent = !script
        ? "Add one from Scripts in the top bar and it will appear here."
        : hasReport
          ? "Filled from this report’s search. Open a lead for its details."
          : "Your default script. It will appear here after a scan.";
    }
    els.reportScriptBody.textContent = !script
      ? "Nothing saved yet. Write your opening line once, then every report will end with it."
      : empty
        ? "This script has no words yet. Open the library and write your opening line."
        : body;
    els.reportScriptBody.classList.toggle("is-empty", !script || empty);
    els.reportScriptSection?.classList.toggle("is-empty", !script || empty);
  }

  function renderReport() {
    const results = state.results;
    if (!results) return;
    // Legacy saved reports and reordered data may not carry an index yet. Assign
    // once from existing values, filling only missing numbers, so the same
    // contact keeps the same report number across visits.
    if (Array.isArray(results.leads)) results.leads = assignLeadIndexes(results.leads);
    const imported = results.mode === "import";
    const saved = results.mode === "saved";
    const query = results.query || {};
    const niche = imported
      ? query.niche || "Your lead file"
      : saved
        ? query.niche || results.sourceName || "Saved report"
        : query.niche || results.niche || "Your scan";
    const location = imported
      ? query.location || results.sourceName || "your device"
      : saved
        ? query.location || "your library"
        : query.location || results.location || "the selected area";
    const leads = results.leads || [];
    const summary = results.summary || summarize(leads);
    summary.outreach = outreachCounts(leads);
    results.summary = summary;

    els.reportNiche.textContent = niche;
    els.reportLocation.textContent = location;
    if (els.reportInWord) els.reportInWord.textContent = imported ? "from" : "in";
    els.reportRunLabel.textContent = imported
      ? `IMPORT · ${String(results.format || "file").toUpperCase()}`
      : saved
        ? `LIBRARY · ${formatDate(results.fetchedAt)}`
        : results.runId
          ? `RUN ${shortRunId(results.runId)}`
          : "FIELD REPORT";
    els.reportTimestamp.textContent = imported
      ? `Imported ${formatDate(results.importedAt, true)}`
      : saved
        ? `Saved ${formatDate(results.fetchedAt, true)}`
        : `Scanned ${formatDate(results.fetchedAt, true)}`;

    let sub;
    if (imported) {
      sub = `${pluralize(leads.length, "lead")} read locally from ${results.sourceName}`;
      if (results.duplicateCount) sub += ` · ${pluralize(results.duplicateCount, "duplicate")} merged`;
      if (results.skippedRows) sub += ` · ${pluralize(results.skippedRows, "row")} skipped`;
      sub += ". Nothing left your browser.";
    } else if (saved) {
      sub = `${pluralize(leads.length, "lead")} restored from your library · saved ${formatDate(results.fetchedAt, true)}`;
    } else {
      const requested = Number(results.requested) || null;
      sub = `${pluralize(leads.length, "place")} returned`;
      if (requested && leads.length < requested) sub += ` from ${formatNumber(requested)} requested`;
      if (results.runStatus && results.runStatus !== "SUCCEEDED") {
        sub += `. The run ended with status “${results.runStatus}”, so this report may be incomplete.`;
      }
    }
    els.reportSub.textContent = sub;

    els.reportFootnote.textContent = imported
      ? "Imported from your own file. Detail comes from that file — verify before outreach. Nothing was uploaded."
      : saved
        ? "Saved in your Supabase library. Outreach marks and notes update the saved copy — export any time."
        : "Every lead links back to Google Maps. Contact details can be incomplete or outdated — verify before outreach.";

    updateReportImportLabels(imported);
    renderStats(summary);
    renderOutreachSummary();
    setExportState(leads.length === 0);
    renderSaveState();

    els.filterWebsite.value = state.filters.website;
    els.filterContact.value = state.filters.contact;
    els.filterRating.value = state.filters.rating;
    if (els.filterReviews) els.filterReviews.value = state.filters.reviews;
    els.sortBy.value = state.filters.sort;
    els.leadSearch.value = state.filters.q;
    els.clearFilters.hidden = !filtersAreActive();
    renderTable();

    document.title = imported
      ? `${niche} from ${location} · Lead Atlas`
      : saved
        ? `${niche} — saved report · Lead Atlas`
        : `${niche} in ${location} · Lead Atlas`;

    renderReportScript();
  }

  function setExportState(disabled) {
    for (const button of [els.exportCsvBtn, els.exportJsonBtn]) {
      if (!button) continue;
      button.disabled = disabled;
      button.classList.toggle("is-disabled", disabled);
      button.title = disabled ? "This report has no leads to export." : "Download this report";
    }
  }

  function mapsFallback(lead) {
    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", [lead.name, lead.address].filter(Boolean).join(" "));
    if (lead.placeId) url.searchParams.set("query_place_id", lead.placeId);
    return url.href;
  }

  const OUTREACH_ICONS = {
    [OUTREACH.TODO]: "i-circle",
    [OUTREACH.CONTACTED]: "i-check",
    [OUTREACH.DO_NOT_CONTACT]: "i-ban",
  };

  function callStateLabel(lead) {
    const mark = callMarkForStatus(lead?.outreachStatus);
    if (mark === CALL_MARK.CALLED) {
      return lead?.contactedAt ? `Called ${formatDate(lead.contactedAt, true)}` : "Called";
    }
    if (mark === CALL_MARK.BLOCKED) return "Do not contact";
    return "Not called yet";
  }

  function callMarkHtml(lead) {
    const mark = callMarkForStatus(lead?.outreachStatus);
    const label = callStateLabel(lead);
    if (mark === CALL_MARK.CALLED) {
      return `<span class="call-mark is-called" data-call-mark role="img" aria-label="${escapeHtml(
        label,
      )}" title="${escapeHtml(label)}">${icon("i-check")}</span>`;
    }
    if (mark === CALL_MARK.BLOCKED) {
      return `<span class="call-mark is-blocked" data-call-mark role="img" aria-label="${escapeHtml(
        label,
      )}" title="${escapeHtml(label)}">${icon("i-ban")}</span>`;
    }
    return `<span class="call-mark is-open" data-call-mark role="img" aria-label="${escapeHtml(
      label,
    )}" title="${escapeHtml(label)}"><span class="call-mark-dot" aria-hidden="true"></span></span>`;
  }

  function outreachCellHtml(lead) {
    const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    const label = outreachStatusLabel(status);
    const note = normalizeOutreachNote(lead.outreachNote);
    const meta =
      note ||
      (status === OUTREACH.CONTACTED && lead.contactedAt
        ? formatDate(lead.contactedAt)
        : "");
    const buttons = OUTREACH_STATUSES.map((option) => {
      const optionLabel = outreachStatusLabel(option);
      return `<button
        type="button"
        class="outreach-mini-btn is-${option}"
        data-outreach-status="${option}"
        aria-pressed="${option === status ? "true" : "false"}"
        aria-label="${escapeHtml(`${optionLabel} — ${lead.name}`)}"
        title="${escapeHtml(option === status ? `Current status: ${optionLabel}` : `Mark as ${optionLabel.toLowerCase()}`)}"
      >${icon(OUTREACH_ICONS[option])}</button>`;
    }).join("");

    return `<td class="cell-outreach">
      <div class="outreach-mini" role="group" aria-label="Outreach status">${buttons}</div>
      <span class="outreach-row-state is-${status}">${escapeHtml(label)}</span>
      ${meta ? `<span class="outreach-row-meta" title="${escapeHtml(note || meta)}">${escapeHtml(meta)}</span>` : ""}
    </td>`;
  }

  function rowHtml(lead, rank) {
    const closed = lead.permanentlyClosed || lead.temporarilyClosed;
    const closedLabel = lead.permanentlyClosed ? "Closed" : lead.temporarilyClosed ? "Temp. closed" : "";
    const category = lead.category || "Business";
    const price = lead.priceLevel ? String(lead.priceLevel) : "";

    const websites = safeUrl(lead.website);
    const websiteDomain =
      lead.domain ||
      (websites ? new URL(websites).hostname.replace(/^www\./, "") : "website");

    const contactLines = [];
    const phone = lead.phones?.[0] || lead.phone;
    const phoneDigits = phone ? phoneHref(phone) : "";
    if (phone && phoneDigits.replace(/\D/g, "").length >= 6) {
      const callLabel = callStateLabel(lead);
      contactLines.push(
        `<a class="contact-line is-phone" href="tel:${escapeHtml(phoneDigits)}" title="Call ${escapeHtml(
          phone,
        )} — ${escapeHtml(callLabel)}">${icon("i-phone")}<span class="contact-line-text">${escapeHtml(
          phone,
        )}</span>${callMarkHtml(lead)}</a>`,
      );
    }
    const email = (lead.emails || []).find((value) => isEmail(value));
    if (email) {
      contactLines.push(
        `<a class="contact-line" href="mailto:${escapeHtml(email)}" title="Email ${escapeHtml(email)}">${icon("i-mail")}${escapeHtml(email)}</a>`,
      );
    }
    const extraCount = Math.max(0, (lead.phones?.length || 0) + (lead.emails?.length || 0) - contactLines.length);
    if (extraCount > 0) {
      contactLines.push(`<span class="contact-more">+${extraCount} more</span>`);
    }
    const contactHtml = contactLines.length
      ? `<div class="contact-stack">${contactLines.join("")}</div>`
      : `<span class="contact-none">No contact data</span>`;

    const webHtml = websites
      ? `<a class="web-link" href="${escapeHtml(websites)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(
          websites,
        )}">${icon("i-globe")}${escapeHtml(websiteDomain)}</a>
         ${
           lead.socials?.length
             ? `<span class="social-count">${lead.socials.length} social profile${
                 lead.socials.length === 1 ? "" : "s"
               }</span>`
             : ""
         }`
      : `<span class="no-site">No website</span>
         ${
           lead.socials?.length
             ? `<span class="social-count">${lead.socials.length} social profile${
                 lead.socials.length === 1 ? "" : "s"
               }</span>`
             : ""
         }`;

    const ratingHtml =
      typeof lead.rating === "number"
        ? `<span class="rating-line" aria-label="${lead.rating} out of 5 stars">${icon(
            "i-star",
          )}${decimal(lead.rating)}</span>
           <span class="rating-reviews">${formatNumber(lead.reviewsCount || 0)} reviews</span>`
        : `<span class="rating-line is-empty">No rating</span>
           <span class="rating-reviews">${formatNumber(lead.reviewsCount || 0)} reviews</span>`;

    const mapsUrl = safeUrl(lead.mapsUrl) || mapsFallback(lead);

    return `<tr data-lead-key="${escapeHtml(lead.id)}" aria-label="${escapeHtml(lead.name)}">
      <td class="cell-rank">${escapeHtml(String(rank))}</td>
      <td class="cell-business">
        <button type="button" class="lead-name-button" title="Open ${escapeHtml(lead.name)} details">${escapeHtml(lead.name)}</button>
        <div class="lead-business-meta">
          <span class="lead-category">${escapeHtml(category)}</span>
          ${price ? `<span class="meta-separator">/</span><span>${escapeHtml(price)}</span>` : ""}
          ${closed ? `<span class="closed-badge">${closedLabel}</span>` : ""}
        </div>
        ${lead.address ? `<p class="lead-address" title="${escapeHtml(lead.address)}">${escapeHtml(lead.address)}</p>` : ""}
      </td>
      <td class="cell-contact">${contactHtml}</td>
      ${outreachCellHtml(lead)}
      <td class="cell-web">${webHtml}</td>
      <td class="cell-rating">${ratingHtml}</td>
      <td class="cell-map">
        <a class="map-link" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Verify ${escapeHtml(
          lead.name,
        )} on Google Maps" title="Open this lead on Google Maps">${icon("i-map")} Map</a>
      </td>
    </tr>`;
  }

  function renderTable() {
    if (!state.results) return;
    syncRatingSort();
    const paged = paginateReportLeads(
      state.results.leads || [],
      state.filters,
      state.pageSize,
    );
    const filtered = paged.filtered;
    const total = state.results.leads.length;
    const totalPages = paged.totalPages;
    const page = paged.page;
    const start = paged.start;
    const pageLeads = paged.pageLeads;
    state.filters.page = page;

    els.clearFilters.hidden = !filtersAreActive();

    if (total === 0) {
      els.leadsTable.hidden = true;
      els.emptyState.hidden = false;
      els.emptyTitle.textContent = "No places came back with that brief.";
      els.emptyText.textContent =
        "Try a broader niche, a wider location, or remove some filters. Google Maps sometimes returns fewer places than requested.";
      els.emptyResetBtn.textContent = "Revise the brief";
      state.emptyAction = "setup";
      els.resultCount.textContent = "No leads";
      els.pagination.hidden = true;
      els.pagination.innerHTML = "";
      return;
    }

    if (filtered.length === 0) {
      els.leadsTable.hidden = true;
      els.emptyState.hidden = false;
      els.emptyTitle.textContent = "No rows match that filter.";
      els.emptyText.textContent =
        "Loosen a filter or clear the search to see the rest of the report.";
      els.emptyResetBtn.textContent = "Clear filters";
      state.emptyAction = "reset";
      els.resultCount.textContent = `0 of ${formatNumber(total)} leads`;
      els.pagination.hidden = true;
      els.pagination.innerHTML = "";
      return;
    }

    els.leadsTable.hidden = false;
    els.emptyState.hidden = true;
    const end = paged.end;
    els.leadsBody.innerHTML = pageLeads
      .map((lead) => rowHtml(lead, formatLeadIndex(lead)))
      .join("");
    els.resultCount.textContent =
      filtered.length === total
        ? `Showing ${formatNumber(start + 1)}–${formatNumber(end)} of ${pluralize(total, "lead")}`
        : `Showing ${formatNumber(start + 1)}–${formatNumber(end)} of ${formatNumber(
            filtered.length,
          )} · ${formatNumber(total)} total`;
    renderPagination(totalPages, page);
  }

  function pageNumberList(current, total) {
    const pages = new Set([1, total, current, current - 1, current + 1]);
    if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
    if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((page) => pages.add(page));
    return [...pages]
      .filter((page) => page >= 1 && page <= total)
      .sort((a, b) => a - b);
  }

  function renderPagination(totalPages, current) {
    if (totalPages <= 1) {
      els.pagination.hidden = true;
      els.pagination.innerHTML = "";
      return;
    }
    els.pagination.hidden = false;
    const pages = pageNumberList(current, totalPages);
    let html = `<button type="button" data-page="${current - 1}" ${
      current === 1 ? "disabled" : ""
    } aria-label="Previous page">←</button>`;
    let last = 0;
    for (const page of pages) {
      if (last && page - last > 1) html += `<span class="page-gap" aria-hidden="true">…</span>`;
      html += `<button type="button" data-page="${page}" ${
        page === current ? 'aria-current="page" aria-label="Page ' + page + ', current page"' : `aria-label="Page ${page}"`
      }>${page}</button>`;
      last = page;
    }
    html += `<button type="button" data-page="${current + 1}" ${
      current === totalPages ? "disabled" : ""
    } aria-label="Next page">→</button>`;
    els.pagination.innerHTML = html;
  }

  /* ---------------- data desk / import ---------------- */

  const IMPORT_FIELD_LABELS = {
    name: "Business name",
    category: "Category",
    categories: "All categories",
    phones: "Phone numbers",
    emails: "Emails",
    website: "Website",
    address: "Address",
    city: "City",
    state: "State / region",
    postalCode: "Postal code",
    countryCode: "Country code",
    rating: "Rating",
    reviewsCount: "Reviews",
    priceLevel: "Price level",
    socials: "Social profiles",
    placeId: "Place ID",
    coordinates: "Coordinates",
    closed: "Closed status",
    searchNiche: "Search niche",
    searchLocation: "Search location",
    scrapedAt: "Scraped at",
    runId: "Run ID",
    claimed: "Claimed",
    outreach: "Outreach status, notes & dates",
  };

  function fileSizeLabel(bytes) {
    const size = Number(bytes) || 0;
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  function importedResults() {
    return state.results?.mode === "import" ? state.results : null;
  }

  function importFieldLabel(field) {
    return IMPORT_FIELD_LABELS[field] || String(field || "");
  }

  function updateReportImportLabels(imported) {
    const label = imported ? "Import another" : "Data desk";
    if (els.reportDataLabel) els.reportDataLabel.textContent = label;
    if (els.reportNavDataLabel) els.reportNavDataLabel.textContent = label;
  }

  function renderImportDesk() {
    const imported = importedResults();
    const desk = state.importDesk || {};
    const reading = desk.status === "reading";

    if (els.dataBackToReport) els.dataBackToReport.hidden = !state.results;
    if (els.dataTimestamp) {
      els.dataTimestamp.textContent = imported
        ? `Imported ${formatDate(imported.importedAt, true)}`
        : "Browser-local import";
    }
    if (els.dataRunLabel) {
      els.dataRunLabel.textContent = imported ? "IMPORTED FILE" : "NEW IMPORT";
    }
    if (els.dataSub) {
      els.dataSub.textContent = imported
        ? `${pluralize(
            imported.leads.length,
            "lead",
          )} read from ${imported.sourceName}. It was parsed on this device and is ready in the full report view.`
        : "Drop a CSV or JSON lead file. It is read here in your browser and opened in the same report view as a live scan — filters, drawer, stats, map links and exports included.";
    }
    if (els.dataLeadCount) {
      els.dataLeadCount.textContent = imported ? formatNumber(imported.leads.length) : "—";
    }
    if (els.dataFieldCount) {
      els.dataFieldCount.textContent = imported
        ? formatNumber(imported.mappedFields?.length || 0)
        : "—";
    }
    if (els.dataFileName) els.dataFileName.textContent = imported?.sourceName || "No file loaded";
    if (els.dataFormat) {
      els.dataFormat.textContent = imported
        ? String(imported.format || "file").toUpperCase()
        : "CSV / JSON / JSONL";
    }
    if (els.dataReadStat) {
      els.dataReadStat.textContent = imported
        ? `${pluralize(imported.rowsRead || imported.leads.length, "row")} read`
        : "Waiting for a file";
    }

    if (els.dataPickBtn) {
      els.dataPickBtn.disabled = reading;
      els.dataPickBtn.setAttribute("aria-busy", String(reading));
    }
    if (els.dataPickLabel) els.dataPickLabel.textContent = reading ? "Reading file…" : "Choose a file";
    if (els.dataDropZone) {
      els.dataDropZone.classList.toggle("is-reading", reading);
      if (!reading) els.dataDropZone.classList.remove("is-dragging");
    }
    if (els.dataReplaceBtn) els.dataReplaceBtn.disabled = reading;

    if (els.dataImportStatus) els.dataImportStatus.hidden = !desk.error;
    if (els.dataImportError) els.dataImportError.textContent = desk.error || "";

    if (els.dataCurrent) els.dataCurrent.hidden = !imported;
    if (imported) {
      if (els.dataCurrentName) els.dataCurrentName.textContent = imported.sourceName;
      if (els.dataCurrentMeta) {
        els.dataCurrentMeta.textContent = `${String(imported.format || "file").toUpperCase()} file · imported ${formatDate(
          imported.importedAt,
          true,
        )} · ${pluralize(imported.rowsRead || imported.leads.length, "row")} read`;
      }
      if (els.dataCurrentStats) {
        const chips = [`${pluralize(imported.leads.length, "lead")} ready`];
        if (imported.duplicateCount) {
          chips.push(`${pluralize(imported.duplicateCount, "duplicate")} merged`);
        }
        if (imported.skippedRows) {
          chips.push(`${pluralize(imported.skippedRows, "row")} skipped`);
        }
        if (imported.extraFieldNames?.length) {
          chips.push(`${pluralize(imported.extraFieldNames.length, "extra column")}`);
        }
        const outreach = outreachCounts(imported.leads || []);
        if (outreach.marked) {
          chips.push(`${pluralize(outreach.marked, "outreach mark")} restored`);
        }
        els.dataCurrentStats.innerHTML = chips
          .map((chip) => `<span>${escapeHtml(chip)}</span>`)
          .join("");
      }

      const fields = (imported.mappedFields || []).map(importFieldLabel).filter(Boolean);
      if (els.dataMappedWrap) els.dataMappedWrap.hidden = fields.length === 0;
      if (els.dataMappedFields) {
        els.dataMappedFields.innerHTML = fields
          .map((field) => `<span class="import-chip">${escapeHtml(field)}</span>`)
          .join("");
      }

      const warnings = imported.warnings || [];
      if (els.dataWarningsWrap) els.dataWarningsWrap.hidden = warnings.length === 0;
      if (els.dataWarnings) {
        els.dataWarnings.innerHTML = warnings
          .map((warning) => `<li>${escapeHtml(warning)}</li>`)
          .join("");
      }
    }
    if (els.dataOpenReport) els.dataOpenReport.disabled = !imported || reading;

    document.title = imported
      ? `${imported.sourceName} · Data desk · Lead Atlas`
      : "Import leads · Data desk · Lead Atlas";
  }

  function openDataDesk({ scroll = true, focus = true, historyMode = "push" } = {}) {
    renderImportDesk();
    showView("data", { scroll, focus, historyMode });
  }

  function applyImportedReport(parsed, fileName) {
    const leads = parsed.leads;
    const importedAt = new Date().toISOString();
    const sourceName = parsed.sourceName || fileName || "Imported leads";

    hydrateOutreach(leads);
    state.savedReport = null;
    state.results = {
      mode: "import",
      leads,
      summary: summarize(leads),
      query: parsed.query,
      sourceName,
      format: parsed.format,
      importedAt,
      fetchedAt: importedAt,
      rowsRead: parsed.rowsRead,
      skippedRows: parsed.skippedRows,
      duplicateCount: parsed.duplicateCount,
      unnamedCount: parsed.unnamedCount,
      warnings: parsed.warnings,
      mappedFields: parsed.mappedFields,
      extraFieldNames: parsed.extraFieldNames,
      runId: null,
      datasetId: null,
      requested: null,
      runStatus: null,
    };
    state.resultsToken = null;
    state.importDesk = { status: "loaded", error: null, fileName: sourceName };

    resetFilters({ render: false });
    renderReport();
    showView("report", { scroll: true, focus: true });

    const notes = [];
    if (parsed.duplicateCount) {
      notes.push(`${pluralize(parsed.duplicateCount, "duplicate")} merged`);
    }
    if (parsed.skippedRows) {
      notes.push(`${pluralize(parsed.skippedRows, "row")} skipped`);
    }
    const outreach = outreachCounts(leads);
    if (outreach.marked) {
      notes.push(`${pluralize(outreach.marked, "outreach mark")} restored`);
    }
    showToast(
      `Imported ${pluralize(leads.length, "lead")} from ${sourceName}${
        notes.length ? ` · ${notes.join(" · ")}` : ""
      }.`,
      "success",
    );
  }

  async function handleImportFile(file) {
    if (!file) return;
    if (state.importDesk?.status === "reading") return;

    if (state.running) {
      state.importDesk = {
        status: "error",
        error: "A scan is still running. Stop it or wait for it to finish before importing a file.",
        fileName: file.name || null,
      };
      renderImportDesk();
      showToast(state.importDesk.error, "error");
      return;
    }

    const fileName = String(file.name || "lead file");
    state.importDesk = { status: "reading", error: null, fileName };
    renderImportDesk();

    try {
      if (file.size > IMPORT_LIMITS.maxBytes) {
        throw new Error(
          `That file is ${fileSizeLabel(file.size)}. The import limit is ${fileSizeLabel(
            IMPORT_LIMITS.maxBytes,
          )}.`,
        );
      }
      const source = await file.text();
      const parsed = parseImportContent({ name: fileName, text: source });
      applyImportedReport(parsed, fileName);
    } catch (error) {
      state.importDesk = {
        status: "error",
        error: error?.message || "That file could not be read.",
        fileName,
      };
      renderImportDesk();
      showToast(state.importDesk.error, "error");
    }
  }

  /* ---------------- lead drawer ---------------- */

  function contactRowHtml(kind, value, href, iconName, markHtml = "") {
    const wrapper = href ? "a" : "div";
    const attrs = href
      ? ` href="${escapeHtml(href)}" ${href.startsWith("http") ? 'target="_blank" rel="noopener noreferrer"' : ""}`
      : "";
    return `<${wrapper} class="contact-row"${attrs}>
      <span class="contact-kind">${icon(iconName)}${escapeHtml(kind)}</span>
      <span class="contact-value-line">
        <span class="contact-value">${escapeHtml(value)}</span>
        ${markHtml}
      </span>
    </${wrapper}>`;
  }

  function renderDrawerContacts(lead) {
    if (!lead) return;
    const contactRows = [];
    for (const phone of lead.phones || []) {
      const href = phoneHref(phone);
      contactRows.push(
        contactRowHtml(
          "Phone",
          phone,
          href.replace(/\D/g, "").length >= 6 ? `tel:${href}` : null,
          "i-phone",
          callMarkHtml(lead),
        ),
      );
    }
    for (const email of lead.emails || []) {
      contactRows.push(
        contactRowHtml("Email", email, isEmail(email) ? `mailto:${email}` : null, "i-mail"),
      );
    }
    els.drawerContacts.innerHTML = contactRows.length
      ? contactRows.join("")
      : `<div class="drawer-empty">No phone number or email found for this listing.</div>`;
    els.drawerContactCount.textContent = contactRows.length
      ? `${contactRows.length} detail${contactRows.length === 1 ? "" : "s"}`
      : "None found";
  }

  function factHtml(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }

  function renderDrawerOutreach(lead, { syncNote = false } = {}) {
    if (!lead) return;
    const status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    for (const button of $$("[data-outreach-status]", els.drawerOutreachChoices)) {
      const isActive = button.dataset.outreachStatus === status;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.classList.toggle("is-active", isActive);
    }

    if (els.drawerOutreachStamp) {
      const stamp = lead.outreachUpdatedAt || lead.contactedAt;
      if (stamp) {
        els.drawerOutreachStamp.textContent = `Updated ${formatDate(stamp, true)}`;
      } else {
        els.drawerOutreachStamp.textContent = "Not marked";
      }
    }

    if (syncNote && els.drawerOutreachNote) {
      els.drawerOutreachNote.value = lead.outreachNote || "";
      state.drawerNoteDirty = false;
    }
    updateDrawerNoteCount();
  }

  function openLead(leadKey) {
    const lead = state.results?.leads?.find((entry) => entry.id === leadKey);
    if (!lead || !els.leadDialog) return;
    state.drawerLead = lead;
    renderDrawerScriptAction();
    renderDrawerScript(lead);

    els.drawerCategory.textContent = [lead.category || "Business", lead.priceLevel]
      .filter(Boolean)
      .join(" · ");
    els.drawerName.textContent = lead.name;
    els.drawerAddress.textContent = lead.address || "Address not listed on Google Maps";

    const closedLabel = lead.permanentlyClosed
      ? "Permanently closed"
      : lead.temporarilyClosed
        ? "Temporarily closed"
        : "";
    els.drawerRating.innerHTML = `
      ${
        typeof lead.rating === "number"
          ? `<span class="rating-line">${icon("i-star")}${decimal(lead.rating)}</span>
             <span class="rating-reviews">${pluralize(lead.reviewsCount || 0, "review")}</span>`
          : `<span class="rating-line is-empty">No rating yet</span>`
      }
      ${closedLabel ? `<span class="closed-badge">${escapeHtml(closedLabel)}</span>` : ""}
    `;

    const mapsUrl = safeUrl(lead.mapsUrl) || mapsFallback(lead);
    els.drawerMapLink.href = mapsUrl;

    renderDrawerContacts(lead);

    const website = safeUrl(lead.website);
    const socials = (lead.socials || [])
      .map((social) => {
        const url = safeUrl(social.url);
        if (!url) return "";
        return `<a class="social-chip" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${icon(
          "i-external",
        )}${escapeHtml(social.label)}${social.handle ? ` · ${escapeHtml(social.handle)}` : ""}</a>`;
      })
      .filter(Boolean);

    const webParts = [];
    if (website) {
      webParts.push(
        `<a class="drawer-web-link" href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">
          <span>${escapeHtml(lead.domain || new URL(website).hostname.replace(/^www\./, ""))}</span>
          ${icon("i-external")}
        </a>`,
      );
    }
    if (socials.length) {
      webParts.push(`<div class="social-chips">${socials.join("")}</div>`);
    }
    els.drawerWeb.innerHTML = webParts.length
      ? webParts.join("")
      : `<div class="drawer-empty">No website or social profiles were listed for this business.</div>`;
    els.drawerWebStatus.textContent = website
      ? "Website found"
      : socials.length
        ? "Social only"
        : "None found";

    const coordinates =
      typeof lead.lat === "number" && typeof lead.lng === "number"
        ? `${lead.lat.toFixed(5)}, ${lead.lng.toFixed(5)}`
        : null;
    const categories = (lead.categories || []).join(", ");
    const facts = [
      factHtml("Category", lead.category),
      factHtml("All categories", categories),
      factHtml("Price level", lead.priceLevel),
      factHtml("Rating", typeof lead.rating === "number" ? `${decimal(lead.rating)} / 5` : "Not rated"),
      factHtml("Reviews", formatNumber(lead.reviewsCount || 0)),
      factHtml("Place ID", lead.placeId),
      factHtml("Coordinates", coordinates),
      factHtml("Status", closedLabel || "Open / not marked closed"),
      factHtml("Search niche", lead.searchNiche),
      factHtml("Search location", lead.searchLocation),
      factHtml("Scraped at", lead.scrapedAt ? formatDate(lead.scrapedAt, true) : null),
      factHtml("Apify run ID", lead.runId),
      ...(lead.extraFields || []).map((entry) => factHtml(entry.label, entry.value)),
    ];
    els.drawerFacts.innerHTML = facts.filter(Boolean).join("");
    renderDrawerOutreach(lead, { syncNote: true });

    if (!els.leadDialog.open) els.leadDialog.showModal();
    document.body.classList.add("has-dialog");
    syncDialogState();
    els.leadDialog.querySelector(".drawer-inner")?.scrollTo({ top: 0 });
  }

  async function copyLeadDetails() {
    const lead = state.drawerLead;
    if (!lead) return;
    const lines = [
      lead.name,
      [lead.category, lead.priceLevel].filter(Boolean).join(" · "),
      lead.address || "",
      typeof lead.rating === "number"
        ? `Rating: ${decimal(lead.rating)} / 5 (${formatNumber(lead.reviewsCount || 0)} reviews)`
        : "",
      lead.phones?.length ? `Phone: ${lead.phones.join(", ")}` : "",
      lead.emails?.length ? `Email: ${lead.emails.join(", ")}` : "",
      lead.website ? `Website: ${lead.website}` : "Website: none listed",
      ...(lead.socials || []).map((social) => `${social.label}: ${social.url}`),
      `Outreach: ${outreachStatusLabel(lead.outreachStatus)}`,
      lead.contactedAt ? `Contacted: ${formatDate(lead.contactedAt, true)}` : "",
      lead.outreachNote ? `Outreach note: ${lead.outreachNote}` : "",
      `Google Maps: ${safeUrl(lead.mapsUrl) || mapsFallback(lead)}`,
      lead.placeId ? `Place ID: ${lead.placeId}` : "",
      lead.runId ? `Apify run: ${lead.runId}` : "",
      ...(lead.extraFields || []).map((entry) => `${entry.label}: ${entry.value}`),
    ].filter(Boolean);
    const copied = await copyText(lines.join("\n"));
    showToast(
      copied ? "Lead details copied to the clipboard." : "Could not access the clipboard.",
      copied ? "success" : "error",
    );
  }

  /* ---------------- exports ---------------- */

  function exportFilenameFallback(format) {
    const query = state.results?.query || {};
    const slug = [query.niche, query.location]
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70);
    return `lead-atlas-${slug || "export"}-${new Date().toISOString().slice(0, 10)}.${format}`;
  }

  function importedExportFilename(format) {
    const results = state.results || {};
    const base = String(results.sourceName || "imported-leads")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return `${base || "imported-leads"}-lead-atlas-${new Date().toISOString().slice(0, 10)}.${format}`;
  }

  function downloadBlobFile(text, mime, filename) {
    const blob = new Blob([text], { type: mime });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }

  function downloadReportExport(format) {
    const results = state.results;
    if (!results?.leads?.length) {
      showToast("This report has no leads to export.", "error");
      return;
    }
    try {
      const imported = results.mode === "import";
      const text =
        format === "csv"
          ? leadsToCsv(results.leads)
          : JSON.stringify(
              buildClientJsonExport(results.leads, {
                fileName: results.sourceName,
                query: results.query,
                summary: results.summary,
                runId: results.runId,
                reportName: imported
                  ? "Lead Atlas imported field report"
                  : "Lead Atlas field report",
              }),
              null,
              2,
            );
      downloadBlobFile(
        text,
        format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
        imported ? importedExportFilename(format) : exportFilenameFallback(format),
      );
      const counts = outreachCounts(results.leads);
      const markSummary = counts.marked
        ? ` · ${pluralize(counts.contacted, "reached out")}, ${pluralize(
            counts.doNotContact,
            "do not contact",
          )}`
        : "";
      showToast(
        `${format.toUpperCase()} downloaded${markSummary}. Outreach marks included.`,
        "success",
      );
    } catch (error) {
      showToast(error?.message || "The export could not be built.", "error");
    }
  }

  function downloadExport(format) {
    downloadReportExport(format);
  }

  /* ---------------- report actions ---------------- */

  function returnToBrief() {
    showView("setup", { scroll: false, focus: false });
    window.setTimeout(() => {
      scrollToTarget(byId("scanner"));
      els.niche.focus({ preventScroll: true });
    }, 60);
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    const saveBriefDebounced = debounce(saveBrief, 250);

    els.sidebarOpenBtn?.addEventListener("click", () => {
      els.appShell?.classList.add("is-sidebar-open");
      if (els.sidebarScrim) els.sidebarScrim.hidden = false;
      els.sidebarOpenBtn.setAttribute("aria-expanded", "true");
    });
    els.sidebarClose?.addEventListener("click", closeSidebar);
    els.sidebarScrim?.addEventListener("click", closeSidebar);

    $$("[data-app-view]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const view = button.dataset.appView || "dashboard";
        if (view === "data") {
          openDataDesk();
          return;
        }
        if (view === "library") {
          showView("library", { scroll: true, focus: true });
          if (!state.library.loaded) loadLibrary();
          else renderLibrary();
          return;
        }
        showView(view, { scroll: true, focus: true });
        if (view === "dashboard") renderDashboard();
      });
    });

    els.bottomMoreBtn?.addEventListener("click", () => {
      els.appShell?.classList.add("is-sidebar-open");
      if (els.sidebarScrim) els.sidebarScrim.hidden = false;
      els.sidebarOpenBtn?.setAttribute("aria-expanded", "true");
      window.setTimeout(() => els.sidebarClose?.focus({ preventScroll: true }), 60);
    });
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);

    els.signOutBtn?.addEventListener("click", signOutUser);
    els.topbarAccountBtn?.addEventListener("click", () => {
      els.appShell?.classList.add("is-sidebar-open");
      if (els.sidebarScrim) els.sidebarScrim.hidden = false;
      els.sidebarOpenBtn?.setAttribute("aria-expanded", "true");
      window.setTimeout(() => els.signOutBtn?.focus({ preventScroll: true }), 60);
    });
    els.sidebarScriptsBtn?.addEventListener("click", () => openScriptLibrary());
    els.sidebarKeyBtn?.addEventListener("click", openKeyDialog);
    els.dashOpenScriptsBtn?.addEventListener("click", () => openScriptLibrary());

    els.dashRecentReports?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-open-report]");
      if (button) openSavedReport(button.dataset.openReport);
    });
    els.librarySearch?.addEventListener(
      "input",
      debounce(() => {
        state.library.search = els.librarySearch.value || "";
        renderLibrary();
      }, 140),
    );
    $$("[data-library-source]").forEach((button) => {
      button.addEventListener("click", () => {
        state.library.source = button.dataset.librarySource || "all";
        $$("[data-library-source]").forEach((chip) => {
          chip.classList.toggle("is-active", chip === button);
        });
        renderLibrary();
      });
    });
    els.libraryGrid?.addEventListener("click", (event) => {
      const retry = event.target.closest("[data-retry-library]");
      if (retry) {
        loadLibrary({ force: true });
        return;
      }
      const open = event.target.closest("[data-open-report]");
      if (open) {
        openSavedReport(open.dataset.openReport);
        return;
      }
      const exportButton = event.target.closest("[data-export-report]");
      if (exportButton) {
        exportSavedReport(
          exportButton.dataset.exportReport,
          exportButton.dataset.exportFormat || "csv",
        );
        return;
      }
      const removeButton = event.target.closest("[data-delete-report]");
      if (removeButton) deleteSavedReport(removeButton.dataset.deleteReport);
    });

    els.saveReportBtn?.addEventListener("click", openSaveReportDialog);
    els.closeSaveReportDialog?.addEventListener("click", closeSaveReportDialog);
    els.cancelSaveReport?.addEventListener("click", closeSaveReportDialog);
    els.saveReportDialog?.addEventListener("click", (event) => {
      if (event.target === els.saveReportDialog) closeSaveReportDialog();
    });
    els.saveReportDialog?.addEventListener("close", () => {
      state.saveDialog.open = false;
      syncDialogState();
    });
    els.saveReportForm?.addEventListener("submit", handleSaveReportSubmit);
    els.saveReportName?.addEventListener("input", () => {
      if (els.saveReportNameError) els.saveReportNameError.hidden = true;
      if (els.saveReportError) els.saveReportError.hidden = true;
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n" && isAuthed()) {
        event.preventDefault();
        showView("setup", { scroll: true, focus: true });
      }
    });

    els.updateChip?.addEventListener("click", runUpdate);
    els.keyChip?.addEventListener("click", openKeyDialog);
    els.closeKeyDialog?.addEventListener("click", closeKeyDialog);
    els.keyForm?.addEventListener("submit", handleKeySubmit);
    els.forgetKeyBtn?.addEventListener("click", forgetKey);
    els.toggleKeyVisibility?.addEventListener("click", () => {
      state.keyVisible = !state.keyVisible;
      els.apiKeyInput.type = state.keyVisible ? "text" : "password";
      els.toggleKeyVisibility.textContent = state.keyVisible ? "Hide" : "Show";
      els.toggleKeyVisibility.setAttribute(
        "aria-label",
        state.keyVisible ? "Hide key" : "Show key",
      );
      els.apiKeyInput.focus();
    });
    els.apiKeyInput?.addEventListener("input", () => {
      els.keyError.hidden = true;
    });
    $$("[data-open-key]").forEach((button) => button.addEventListener("click", openKeyDialog));
    $$("[data-open-data]").forEach((button) =>
      button.addEventListener("click", openDataDesk),
    );
    els.dataCardBtn?.addEventListener("click", openDataDesk);

    els.scriptChip?.addEventListener("click", () => openScriptLibrary());
    els.reportScriptBtn?.addEventListener("click", () =>
      openCallSheet(null, { source: "report" }),
    );
    els.drawerScriptBtn?.addEventListener("click", () => {
      if (!state.scripts.scripts.length) {
        openScriptLibrary({ createIfEmpty: true, focusTitle: true });
        return;
      }
      openCallSheet(state.drawerLead, { source: "drawer" });
    });

    els.closeScriptDialog?.addEventListener("click", closeScriptLibrary);
    els.scriptDialog?.addEventListener("click", (event) => {
      if (event.target === els.scriptDialog) closeScriptLibrary();
    });
    els.scriptDialog?.addEventListener("close", () => {
      if (state.scriptUi.saveTimer) saveScriptStore();
      syncDialogState();
    });
    els.scriptSearch?.addEventListener("input", () => {
      state.scriptUi.search = els.scriptSearch.value;
      renderScriptList();
    });
    els.scriptList?.addEventListener("click", (event) => {
      const item = event.target.closest("button[data-script-id]");
      if (item) selectScript(item.dataset.scriptId);
    });
    els.newScriptBtn?.addEventListener("click", () => createNewScript());
    els.emptyNewScriptBtn?.addEventListener("click", () => createNewScript());
    els.starterScriptBtn?.addEventListener("click", () => createNewScript({ starter: true }));
    els.scriptTitleInput?.addEventListener("input", handleScriptFormInput);
    els.scriptBodyInput?.addEventListener("input", handleScriptFormInput);
    for (const input of [els.scriptTitleInput, els.scriptBodyInput]) {
      input?.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          saveScriptStore();
        }
      });
    }
    els.scriptPlaceholders?.addEventListener("click", (event) => {
      const chip = event.target.closest("button[data-script-token]");
      if (chip) insertScriptToken(chip.dataset.scriptToken);
    });
    els.makeDefaultScriptBtn?.addEventListener("click", makeSelectedScriptDefault);
    els.duplicateScriptBtn?.addEventListener("click", duplicateSelectedScript);
    els.deleteScriptBtn?.addEventListener("click", deleteSelectedScript);
    els.doneScriptBtn?.addEventListener("click", closeScriptLibrary);
    els.importScriptsBtn?.addEventListener("click", () => els.scriptImportInput?.click());
    els.exportScriptsBtn?.addEventListener("click", downloadScriptsBackup);
    els.scriptImportInput?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) handleScriptImportFile(file);
    });

    els.closeCallSheet?.addEventListener("click", closeCallSheet);
    els.closeCallSheetBtn?.addEventListener("click", closeCallSheet);
    els.callSheetDialog?.addEventListener("click", (event) => {
      if (event.target === els.callSheetDialog) closeCallSheet();
    });
    els.callSheetDialog?.addEventListener("close", () => {
      state.callSheet.lead = null;
      state.callSheet.scriptId = null;
      syncDialogState();
    });
    els.callSheetScriptSelect?.addEventListener("change", () => {
      const id = els.callSheetScriptSelect.value;
      if (!findScript(state.scripts, id)) return;
      state.callSheet.scriptId = id;
      renderCallSheet();
    });
    els.editCallSheetScript?.addEventListener("click", () => {
      const scriptId = state.callSheet.scriptId;
      closeCallSheet();
      openScriptLibrary({ selectId: scriptId, focusTitle: true });
    });
    els.writeFirstScriptBtn?.addEventListener("click", () => {
      closeCallSheet();
      openScriptLibrary({ createIfEmpty: true, focusTitle: true });
    });
    els.copyCallSheetBtn?.addEventListener("click", async () => {
      const script = els.callSheetBody?.textContent || "";
      if (!script.trim()) return;
      const copied = await copyText(script);
      showToast(
        copied ? "Call script copied to the clipboard." : "Could not access the clipboard.",
        copied ? "success" : "error",
      );
    });
    els.markCallSheetContactedBtn?.addEventListener("click", markCallSheetContacted);

    els.keyDialog?.addEventListener("click", (event) => {
      if (event.target === els.keyDialog) closeKeyDialog();
    });
    els.keyDialog?.addEventListener("close", () => {
      state.pendingRunBrief = null;
      syncDialogState();
    });

    els.scanForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const brief = validateBrief();
      if (!brief) return;
      saveBrief();
      if (!state.token || state.keyStatus === "invalid") {
        state.pendingRunBrief = brief;
        openKeyDialog();
        if (state.keyStatus === "invalid") {
          els.keyError.textContent =
            "Your saved key was rejected. Paste a working Apify token to continue.";
          els.keyError.hidden = false;
        }
        return;
      }
      startScan(brief);
    });

    els.niche?.addEventListener("input", () => {
      clearFieldError(els.niche, els.nicheError);
      saveBriefDebounced();
    });
    els.location?.addEventListener("input", () => {
      clearFieldError(els.location, els.locationError);
      saveBriefDebounced();
    });
    $$('input[name="websiteFilter"]').forEach((radio) =>
      radio.addEventListener("change", () => {
        syncWebsiteState();
        saveBrief();
      }),
    );
    els.includeContacts?.addEventListener("change", () => {
      if (!els.includeContacts.disabled) state.contactPreference = els.includeContacts.checked;
      updateEstimate();
      saveBrief();
    });
    els.maxResults?.addEventListener("input", () => {
      syncRangeVisual();
      updateEstimate();
      saveBriefDebounced();
    });
    els.minStars?.addEventListener("change", () => {
      updateEstimate();
      saveBrief();
    });
    els.minReviews?.addEventListener("change", () => {
      saveBrief();
    });
    els.skipClosed?.addEventListener("change", () => {
      updateEstimate();
      saveBrief();
    });

    els.abortBtn?.addEventListener("click", abortRun);
    els.progressRetryBtn?.addEventListener("click", () => {
      if (state.running) stopProgressTimers(state.running);
      state.running = null;
      state.resultsToken = null;
      returnToBrief();
    });

    els.backToSetup?.addEventListener("click", returnToBrief);
    els.dataBackToReport?.addEventListener("click", () => {
      if (!state.results) {
        returnToBrief();
        return;
      }
      renderReport();
      showView("report", { scroll: true, focus: true });
    });
    els.dataNewScan?.addEventListener("click", returnToBrief);
    els.dataPickBtn?.addEventListener("click", () => els.dataFileInput?.click());
    els.dataReplaceBtn?.addEventListener("click", () => els.dataFileInput?.click());
    els.dataFileInput?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) handleImportFile(file);
    });
    els.dataOpenReport?.addEventListener("click", () => {
      if (!state.results) return;
      renderReport();
      showView("report", { scroll: true, focus: true });
    });

    const dropZone = els.dataDropZone;
    if (dropZone) {
      let dragDepth = 0;
      const acceptsFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
      dropZone.addEventListener("dragenter", (event) => {
        if (!acceptsFiles(event)) return;
        event.preventDefault();
        dragDepth += 1;
        dropZone.classList.add("is-dragging");
      });
      dropZone.addEventListener("dragover", (event) => {
        if (!acceptsFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      });
      dropZone.addEventListener("dragleave", (event) => {
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) dropZone.classList.remove("is-dragging");
      });
      dropZone.addEventListener("drop", (event) => {
        event.preventDefault();
        dragDepth = 0;
        dropZone.classList.remove("is-dragging");
        const file = event.dataTransfer?.files?.[0];
        if (file) handleImportFile(file);
      });
    }

    els.leadSearch?.addEventListener(
      "input",
      debounce(() => {
        state.filters.q = els.leadSearch.value;
        state.filters.page = 1;
        renderTable();
      }, 180),
    );
    for (const [element, key] of [
      [els.filterWebsite, "website"],
      [els.filterContact, "contact"],
      [els.filterRating, "rating"],
      [els.filterReviews, "reviews"],
      [els.sortBy, "sort"],
    ]) {
      element?.addEventListener("change", () => {
        state.filters[key] = element.value;
        state.filters.page = 1;
        renderTable();
        renderOutreachSummary();
      });
    }
    els.sortRating?.addEventListener("click", () => {
      // First click: highest rated first. Second click: lowest rated first.
      state.filters.sort = state.filters.sort === "rating" ? "rating-asc" : "rating";
      state.filters.page = 1;
      if (els.sortBy) els.sortBy.value = state.filters.sort;
      renderTable();
    });
    els.outreachStrip?.addEventListener("click", (event) => {
      const chip = event.target.closest("button[data-outreach-filter]");
      if (!chip) return;
      state.filters.outreach = chip.dataset.outreachFilter || "all";
      state.filters.page = 1;
      renderTable();
      renderOutreachSummary();
    });
    els.clearFilters?.addEventListener("click", () => resetFilters({ render: true }));
    els.emptyResetBtn?.addEventListener("click", () => {
      if (state.emptyAction === "setup") {
        returnToBrief();
      } else {
        resetFilters({ render: true });
      }
    });
    els.pagination?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-page]");
      if (!button || button.disabled) return;
      const page = Number(button.dataset.page);
      if (!Number.isFinite(page)) return;
      state.filters.page = page;
      renderTable();
      scrollToTarget(els.reportToolbar);
    });
    els.leadsBody?.addEventListener("click", (event) => {
      const callLink = event.target.closest('a[href^="tel:"]');
      if (callLink) {
        const row = callLink.closest("tr[data-lead-key]");
        const lead = row
          ? state.results?.leads?.find((entry) => entry.id === row.dataset.leadKey)
          : null;
        if (lead) markLeadCalled(lead);
        return;
      }
      const statusButton = event.target.closest("button[data-outreach-status]");
      if (statusButton) {
        const row = statusButton.closest("tr[data-lead-key]");
        if (!row) return;
        const lead = state.results?.leads?.find((entry) => entry.id === row.dataset.leadKey);
        if (!lead) return;
        const status = statusButton.dataset.outreachStatus;
        if (!setOutreachStatus(lead, status)) return;
        const nextButton = $$("tr[data-lead-key]", els.leadsBody)
          .find((entry) => entry.dataset.leadKey === lead.id)
          ?.querySelector(`button[data-outreach-status="${status}"]`);
        if (nextButton) {
          nextButton.focus({ preventScroll: true });
        } else {
          // The active filter excludes the new state, so the row is gone.
          // Keep keyboard users anchored to the filter that hid it.
          const activeChip = $(".outreach-tally[aria-pressed=\"true\"]", els.outreachStrip);
          (activeChip || els.clearFilters)?.focus({ preventScroll: true });
        }
        return;
      }
      if (event.target.closest("a, input, select, textarea, label")) return;
      if (event.target.closest("button") && !event.target.closest(".lead-name-button")) return;
      const row = event.target.closest("tr[data-lead-key]");
      if (!row) return;
      openLead(row.dataset.leadKey);
    });
    els.exportCsvBtn?.addEventListener("click", () => downloadExport("csv"));
    els.exportJsonBtn?.addEventListener("click", () => downloadExport("json"));

    els.closeLeadDialog?.addEventListener("click", () => els.leadDialog.close());
    els.drawerContacts?.addEventListener("click", (event) => {
      const callLink = event.target.closest('a[href^="tel:"]');
      if (!callLink || !state.drawerLead) return;
      markLeadCalled(state.drawerLead);
    });
    els.leadDialog?.addEventListener("click", (event) => {
      if (event.target === els.leadDialog) els.leadDialog.close();
    });
    els.leadDialog?.addEventListener("close", () => {
      if (state.drawerLead && state.drawerNoteDirty) saveDrawerOutreachNote();
      state.drawerLead = null;
      syncDialogState();
    });

    els.drawerOutreachChoices?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-outreach-status]");
      if (!button || !state.drawerLead) return;
      setOutreachStatus(state.drawerLead, button.dataset.outreachStatus, {
        note: els.drawerOutreachNote?.value,
      });
    });
    els.drawerOutreachNote?.addEventListener("input", () => {
      state.drawerNoteDirty =
        normalizeOutreachNote(els.drawerOutreachNote.value) !==
        normalizeOutreachNote(state.drawerLead?.outreachNote);
      updateDrawerNoteCount();
    });
    els.drawerOutreachNote?.addEventListener("blur", () => {
      if (state.drawerNoteDirty) saveDrawerOutreachNote();
    });
    els.drawerOutreachNote?.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (saveDrawerOutreachNote({ notify: true })) {
          els.drawerOutreachNote.blur();
        }
      }
    });
    els.drawerOutreachSave?.addEventListener("click", () => {
      saveDrawerOutreachNote({ notify: true });
      els.drawerOutreachNote?.focus();
    });

    els.copyLeadBtn?.addEventListener("click", copyLeadDetails);

    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      if (state.view !== "setup" && target.closest("#viewSetup")) {
        event.preventDefault();
        showView("setup", { scroll: false, focus: false });
        window.setTimeout(() => scrollToTarget(target), 60);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !state.results) return;
      refreshOutreachViews({ drawer: Boolean(state.drawerLead) });
    });
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted || !state.results) return;
      refreshOutreachViews({ drawer: Boolean(state.drawerLead) });
    });

    window.addEventListener("beforeunload", (event) => {
      if (!state.running) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function syncDialogState() {
    const openDialogs = $$("dialog[open]");
    const topDialog = openDialogs[openDialogs.length - 1] || null;
    document.body.classList.toggle("has-dialog", Boolean(topDialog));

    // A toast outside an open modal dialog sits behind its top-layer backdrop.
    // Move the live region into the topmost dialog while one is open.
    if (els.toastRegion) {
      const host = topDialog || document.body;
      if (els.toastRegion.parentElement !== host) host.appendChild(els.toastRegion);
    }
  }

  /* ---------------- library, dashboard & saved reports ---------------- */

  function friendlySupabaseError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").trim();
    if (code === "AUTH_REQUIRED" || error?.status === 401) {
      return "Your session expired. Sign in again to open your library.";
    }
    if (code === "NOT_CONFIGURED") {
      return "Supabase is not connected. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env, then restart.";
    }
    if (error?.status === 404 || /does not exist|schema cache|relation .* not found/i.test(message)) {
      return "The Supabase schema is missing. Run supabase/schema.sql in the Supabase SQL editor, then try again.";
    }
    if (/row-level security|permission denied/i.test(message)) {
      return "Supabase blocked that request. Check the RLS policies in supabase/schema.sql.";
    }
    return message || "The library request failed. Check your connection and try again.";
  }

  function reportOutreach(report) {
    const summary = report?.summary || {};
    const outreach = summary.outreach || {};
    return {
      contacted: Number(outreach.contacted) || 0,
      doNotContact: Number(outreach.doNotContact) || 0,
      marked: Number(outreach.marked) || 0,
    };
  }

  function reportLeadCount(report) {
    return Number(report?.lead_count) || Number(report?.summary?.total) || 0;
  }

  function reportSourceLabel(source) {
    return source === "import" ? "Import" : "Scan";
  }

  const ANALYTICS_PAGE_SIZE = 1000;
  const ANALYTICS_ROW_LIMIT = 5000;

  function readDashboardCache() {
    const key = dashboardCacheKey(state.auth.user?.id);
    if (!key) return null;
    try {
      return parseDashboardCache(window.localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  function writeDashboardCache() {
    const key = dashboardCacheKey(state.auth.user?.id);
    if (!key || !state.library.loaded) return;
    try {
      const raw = serializeDashboardCache({
        reports: state.library.reports,
        stats: state.library.stats,
        activity: state.library.activity,
      });
      if (raw && window.localStorage.getItem(key) !== raw) {
        window.localStorage.setItem(key, raw);
      }
    } catch (error) {
      console.warn("[lead-atlas] Dashboard cache could not be saved.", error);
    }
  }

  function clearDashboardCache(userId = state.auth.user?.id) {
    const key = dashboardCacheKey(userId);
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing to clear */
    }
  }

  function rebuildOutreachAnalytics() {
    state.library.analytics = buildOutreachAnalytics({
      leads: state.library.activity,
      reports: state.library.reports,
      account: accountAnalyticsLabel(),
    });
    return state.library.analytics;
  }

  function hydrateDashboardCache() {
    const snapshot = readDashboardCache();
    if (!snapshot) return false;
    state.library.reports = snapshot.reports;
    state.library.stats = snapshot.stats;
    state.library.activity = snapshot.activity;
    state.library.loaded = true;
    state.library.loading = false;
    state.library.error = null;
    rebuildOutreachAnalytics();
    return true;
  }

  async function fetchLeadActivity(sb) {
    const rows = [];
    for (let offset = 0; offset < ANALYTICS_ROW_LIMIT; offset += ANALYTICS_PAGE_SIZE) {
      const page = await sb.select("leads", {
        select: "report_id,lead_key,outreach_status,contacted_at,created_at",
        order: "created_at.asc",
        limit: ANALYTICS_PAGE_SIZE,
        offset,
      });
      if (!Array.isArray(page) || !page.length) break;
      rows.push(...page);
      if (page.length < ANALYTICS_PAGE_SIZE) break;
    }
    return rows;
  }

  function accountAnalyticsLabel() {
    const profile = state.auth.profile || {};
    const user = state.auth.user || {};
    return (
      profile.full_name ||
      profile.company ||
      accountDisplayName() ||
      user.email ||
      "This account"
    );
  }

  function monthReportCount(reports) {
    const now = new Date();
    return reports.filter((report) => {
      const date = new Date(report.created_at);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }).length;
  }

  function setLibraryStat(id, value) {
    if (els[id]) els[id].textContent = formatNumber(value);
  }

  function setAnalyticsText(id, value) {
    if (els[id]) els[id].textContent = value;
  }

  function renderDashboardAnalytics() {
    const analytics = state.library.analytics;
    const available = Boolean(analytics);
    const today = analytics?.today || {};
    const month = analytics?.month || {};
    const yesterday = analytics?.yesterday || {};
    const sources = month.bySource || {};

    setAnalyticsText("dashAnalyticsAccount", analytics?.account || accountAnalyticsLabel());
    setAnalyticsText("dashTodayReached", available ? formatNumber(today.reached || 0) : "—");
    setAnalyticsText("dashMonthReached", available ? formatNumber(month.reached || 0) : "—");
    setAnalyticsText("dashMonthLeads", available ? formatNumber(month.leads || 0) : "—");
    setAnalyticsText("dashMonthTotalLeads", available ? formatNumber(month.leads || 0) : "—");
    setAnalyticsText("dashMonthScans", available ? formatNumber(month.scans || 0) : "—");
    setAnalyticsText("dashMonthImports", available ? formatNumber(month.imports || 0) : "—");

    if (els.dashTodayDelta) {
      if (!available) {
        els.dashTodayDelta.textContent = "Sign in to see today’s activity.";
      } else if (!today.reached && !yesterday.reached) {
        els.dashTodayDelta.textContent = "No calls logged yet today.";
      } else if (analytics.delta > 0) {
        els.dashTodayDelta.textContent = `${pluralize(analytics.delta, "more call")} than yesterday (${formatNumber(yesterday.reached || 0)}).`;
      } else if (analytics.delta < 0) {
        els.dashTodayDelta.textContent = `${pluralize(Math.abs(analytics.delta), "fewer call")} than yesterday (${formatNumber(yesterday.reached || 0)}).`;
      } else {
        els.dashTodayDelta.textContent = `Same as yesterday (${formatNumber(yesterday.reached || 0)}).`;
      }
    }

    if (els.dashBestDay) {
      const best = analytics?.best || {};
      els.dashBestDay.textContent = best.reached ? formatNumber(best.reached) : "—";
      if (els.dashBestDayLabel) {
        els.dashBestDayLabel.textContent = best.reached
          ? `${best.weekday}, ${best.label}`
          : "No calls logged yet.";
      }
    }

    for (const source of ["scan", "import", "unknown"]) {
      const data = sources[source] || { leads: 0, reached: 0, toContact: 0 };
      const prefix = source.charAt(0).toUpperCase() + source.slice(1);
      setAnalyticsText(`dashSource${prefix}Leads`, available ? formatNumber(data.leads || 0) : "—");
      setAnalyticsText(
        `dashSource${prefix}Reached`,
        available ? formatNumber(data.reached || 0) : "—",
      );
      setAnalyticsText(
        `dashSource${prefix}Todo`,
        available ? formatNumber(data.toContact || 0) : "—",
      );
    }

    if (!els.dashDayChart) return;
    if (!available) {
      els.dashDayChart.innerHTML =
        '<p class="dash-day-empty">Day-by-day activity will appear after your library loads.</p>';
      return;
    }
    const max = Math.max(1, analytics.maxReached || 1);
    els.dashDayChart.innerHTML = analytics.days
      .map((day) => {
        const height = day.reached ? Math.max(8, Math.round((day.reached / max) * 100)) : 2;
        const label = `${day.weekday} ${day.label}: ${pluralize(day.reached, "lead")} reached, ${pluralize(day.leads, "lead")} added`;
        return `<div class="dash-day ${day.isToday ? "is-today" : ""}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
          <span class="dash-day-value">${day.reached ? formatNumber(day.reached) : ""}</span>
          <span class="dash-day-track"><i style="height: ${height}%"></i></span>
          <span class="dash-day-label">${escapeHtml(day.isToday ? "Today" : day.weekday)}</span>
          <span class="dash-day-date">${escapeHtml(day.label)}</span>
        </div>`;
      })
      .join("");
  }

  async function loadLibrary({ force = false } = {}) {
    const sb = supabaseClient();
    if (!isAuthed() || !state.auth.configured || !sb) {
      if (!state.library.loaded) {
        state.library.loaded = true;
        state.library.reports = [];
        state.library.stats = null;
      }
      renderLibrary();
      renderDashboard();
      return;
    }
    if (state.library.loading && !force) return;
    state.library.loading = true;
    state.library.error = null;
    renderDashboard();
    renderLibrary();

    try {
      // All five reads are independent. Fetching them together keeps a slow
      // activity page from delaying the report cards and counts.
      const [reportsResult, leadsResult, contactedResult, dncResult, activityResult] =
        await Promise.allSettled([
          sb.select("lead_reports", {
            select: "id,name,niche,location,source,run_id,lead_count,summary,created_at,updated_at",
            order: "created_at.desc",
            limit: 200,
          }),
          sb.count("leads"),
          sb.count("leads", { outreach_status: "eq.contacted" }),
          sb.count("leads", { outreach_status: "eq.do-not-contact" }),
          fetchLeadActivity(sb),
        ]);

      const reportsFresh = reportsResult.status === "fulfilled";
      if (reportsFresh) {
        state.library.reports = Array.isArray(reportsResult.value) ? reportsResult.value : [];
        state.library.loaded = true;
        state.library.error = null;
      } else if (!state.library.loaded) {
        state.library.error = friendlySupabaseError(reportsResult.reason);
        console.warn("[lead-atlas] Library could not load.", reportsResult.reason);
      } else {
        console.warn(
          "[lead-atlas] Saved reports could not refresh; keeping the cached copy.",
          reportsResult.reason,
        );
      }

      if (reportsFresh) {
        const previous = state.library.stats || {};
        const totalFromReports = state.library.reports.reduce(
          (total, report) => total + reportLeadCount(report),
          0,
        );
        state.library.stats = {
          reports: state.library.reports.length,
          leads:
            leadsResult.status === "fulfilled"
              ? leadsResult.value
              : Number(previous.leads) || totalFromReports,
          contacted:
            contactedResult.status === "fulfilled"
              ? contactedResult.value
              : Number(previous.contacted) || 0,
          doNotContact:
            dncResult.status === "fulfilled"
              ? dncResult.value
              : Number(previous.doNotContact) || 0,
        };
      }

      if (activityResult.status === "fulfilled") {
        state.library.activity = Array.isArray(activityResult.value) ? activityResult.value : [];
        rebuildOutreachAnalytics();
      } else {
        // Keep the cached activity (and its analytics) rather than blanking the
        // dashboard because one refresh failed.
        console.warn(
          "[lead-atlas] Outreach activity could not refresh; keeping the cached copy.",
          activityResult.reason,
        );
        if (!state.library.analytics) rebuildOutreachAnalytics();
      }

      if (reportsFresh) writeDashboardCache();
    } catch (error) {
      if (!state.library.loaded) {
        state.library.error = friendlySupabaseError(error);
      }
      console.warn("[lead-atlas] Library could not load.", error);
    } finally {
      state.library.loading = false;
      renderDashboard();
      renderLibrary();
    }
  }

  function renderDashboard() {
    const library = state.library;
    const stats = library.stats || {};
    const reports = library.reports || [];
    const totalLeads = Number(stats.leads) || reports.reduce((total, report) => total + reportLeadCount(report), 0);
    const contacted = Number(stats.contacted) || 0;
    const doNotContact = Number(stats.doNotContact) || 0;
    const rate = totalLeads ? Math.round((contacted / totalLeads) * 100) : 0;

    if (els.dashStats) els.dashStats.setAttribute("aria-busy", library.loading ? "true" : "false");
    setLibraryStat("dashReportCount", stats.reports ?? reports.length);
    setLibraryStat("dashLeadCount", totalLeads);
    setLibraryStat("dashContactedCount", contacted);
    setLibraryStat("dashDncCount", doNotContact);
    setLibraryStat("dashMonthCount", monthReportCount(reports));
    if (els.dashContactedRate) els.dashContactedRate.textContent = `${rate}%`;
    const reportTotal = Number(stats.reports ?? reports.length) || 0;
    if (els.sidebarLibraryCount) {
      els.sidebarLibraryCount.textContent = formatNumber(reportTotal);
    }
    if (els.bottomLibraryCount) {
      els.bottomLibraryCount.textContent = formatNumber(reportTotal);
      els.bottomLibraryCount.hidden = reportTotal === 0;
    }

    if (els.dashRecentReports) {
      if (library.loading && !library.loaded) {
        els.dashRecentReports.innerHTML =
          '<div class="dash-skeleton"><span></span><span></span><span></span></div>';
      } else if (library.error) {
        els.dashRecentReports.innerHTML = `<div class="dash-inline-error">${icon("i-alert")}<span>${escapeHtml(library.error)}</span></div>`;
      } else if (!reports.length) {
        els.dashRecentReports.innerHTML = "";
      } else {
        els.dashRecentReports.innerHTML = reports
          .slice(0, 4)
          .map((report) => {
            const outreach = reportOutreach(report);
            const leads = reportLeadCount(report);
            const sourceIcon = report.source === "import" ? "i-table" : "i-library";
            const place = [report.niche, report.location].filter(Boolean).join(" · ") || "Saved field report";
            return `<button type="button" class="dash-report-row" data-open-report="${escapeHtml(report.id)}">
              <span class="dash-report-icon is-${report.source === "import" ? "import" : "scan"}">${icon(sourceIcon)}</span>
              <span class="dash-report-copy">
                <strong>${escapeHtml(report.name)}</strong>
                <span>${escapeHtml(place)} · ${pluralize(leads, "lead")}</span>
              </span>
              <span class="dash-report-side">
                <em>${escapeHtml(formatRelative(report.created_at))}</em>
                <span class="dash-report-pill">${outreach.contacted ? `${formatNumber(outreach.contacted)} reached` : reportSourceLabel(report.source)}</span>
              </span>
            </button>`;
          })
          .join("");
      }
    }
    if (els.dashEmpty) {
      els.dashEmpty.hidden = library.loading || Boolean(library.error) || reports.length > 0;
    }

    if (els.dashOutreachRate) els.dashOutreachRate.textContent = `${rate}%`;
    if (els.dashOutreachContacted) els.dashOutreachContacted.textContent = formatNumber(contacted);
    if (els.dashOutreachToContact) {
      els.dashOutreachToContact.textContent = formatNumber(Math.max(0, totalLeads - contacted - doNotContact));
    }
    if (els.dashOutreachFill) els.dashOutreachFill.style.width = `${Math.min(100, rate)}%`;
    if (els.dashOutreachTrack) els.dashOutreachTrack.setAttribute("aria-valuenow", String(rate));
    if (els.dashOutreachCopy) {
      els.dashOutreachCopy.textContent = totalLeads
        ? `${formatNumber(contacted)} of ${formatNumber(totalLeads)} saved leads have been reached. ${formatNumber(doNotContact)} are kept off the call list.`
        : "Save a report and start marking calls. Your progress will show here.";
    }
    renderDashboardAnalytics();

    if (els.dashScriptCount) {
      const count = state.scripts.scripts.length;
      els.dashScriptCount.textContent = `${formatNumber(count)} saved`;
    }
    if (els.sidebarScriptCount) {
      els.sidebarScriptCount.textContent = formatNumber(state.scripts.scripts.length);
    }
    renderDashboardKey();
    state.dashboard.loaded = true;
  }

  function renderDashboardKey() {
    const status = state.keyStatus;
    const connected = status === "connected";
    const checking = status === "checking";
    if (els.dashKeyStatus) {
      els.dashKeyStatus.textContent = connected
        ? "Connected"
        : checking
          ? "Checking…"
          : status === "invalid"
            ? "Needs attention"
            : "Not connected";
      els.dashKeyStatus.classList.toggle("is-ok", connected);
      els.dashKeyStatus.classList.toggle("is-warn", status === "invalid");
    }
    if (els.dashKeyCopy) {
      els.dashKeyCopy.textContent = connected
        ? `Connected to Apify${state.account?.username ? ` as @${state.account.username}` : ""}. Your token is saved to your account.`
        : checking
          ? "Checking your saved Apify token with Apify…"
          : status === "invalid"
            ? "Your saved key was rejected. Paste a working token to run scans again."
            : "Connect your own Apify token to run Google Maps scans. It is saved to your account.";
    }
    if (els.dashKeyAction) {
      els.dashKeyAction.textContent = connected ? "Manage connection" : "Connect key";
    }
    if (els.sidebarKeyDot) {
      els.sidebarKeyDot.classList.toggle("is-connected", connected);
      els.sidebarKeyDot.classList.toggle("is-invalid", status === "invalid");
    }
  }

  function filteredLibraryReports() {
    const query = state.library.search.trim().toLowerCase();
    return state.library.reports.filter((report) => {
      if (state.library.source !== "all" && report.source !== state.library.source) return false;
      if (!query) return true;
      return [report.name, report.niche, report.location, report.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }

  function renderLibrary() {
    if (!els.libraryGrid) return;
    const reports = filteredLibraryReports();
    const total = state.library.reports.length;
    if (els.libraryGrid) {
      els.libraryGrid.setAttribute("aria-busy", state.library.loading ? "true" : "false");
    }
    if (els.libraryCount) {
      els.libraryCount.textContent =
        state.library.loading && !state.library.loaded
          ? "Loading…"
          : `${formatNumber(reports.length)} of ${formatNumber(total)} report${total === 1 ? "" : "s"}`;
    }

    if (state.library.loading && !state.library.loaded) {
      els.libraryGrid.innerHTML =
        '<div class="library-skeleton"><span></span><span></span><span></span><span></span></div>';
      if (els.libraryEmpty) els.libraryEmpty.hidden = true;
      return;
    }

    if (state.library.error) {
      els.libraryGrid.innerHTML = `<div class="library-error">${icon("i-alert")}<h2>Library could not load.</h2><p>${escapeHtml(state.library.error)}</p><button type="button" class="btn btn-outline" data-retry-library>Try again</button></div>`;
      if (els.libraryEmpty) els.libraryEmpty.hidden = true;
      return;
    }

    if (!reports.length) {
      els.libraryGrid.innerHTML = "";
      if (els.libraryEmpty) {
        els.libraryEmpty.hidden = false;
        const searching = Boolean(state.library.search.trim()) || state.library.source !== "all";
        if (els.libraryEmptyTitle) {
          els.libraryEmptyTitle.textContent = searching
            ? "No reports match that search."
            : "Your library is empty.";
        }
        if (els.libraryEmptyText) {
          els.libraryEmptyText.innerHTML = searching
            ? "Try a different name, niche or place — or clear the filter to see everything."
            : "Run a scan or import a lead file, then choose <strong>Save to library</strong> in the report. Everything you save lands here.";
        }
      }
      return;
    }

    if (els.libraryEmpty) els.libraryEmpty.hidden = true;
    els.libraryGrid.innerHTML = reports.map((report) => renderLibraryCard(report)).join("");
  }

  function renderLibraryCard(report) {
    const outreach = reportOutreach(report);
    const leads = reportLeadCount(report);
    const rate = leads ? Math.min(100, Math.round((outreach.contacted / leads) * 100)) : 0;
    const place = [report.niche, report.location].filter(Boolean).join(" · ") || "Saved field report";
    const avg = Number(report.summary?.avgRating);
    const busy = state.library.busyReportId === report.id;
    return `<article class="library-card" data-report-card="${escapeHtml(report.id)}">
      <div class="library-card-top">
        <span class="library-card-icon is-${report.source === "import" ? "import" : "scan"}">${icon(report.source === "import" ? "i-table" : "i-library")}</span>
        <span class="library-card-source">${reportSourceLabel(report.source)}</span>
        <button type="button" class="library-card-delete" data-delete-report="${escapeHtml(report.id)}" aria-label="Delete ${escapeHtml(report.name)}" title="Delete report">${icon("i-trash")}</button>
      </div>
      <h2>${escapeHtml(report.name)}</h2>
      <p class="library-card-place">${escapeHtml(place)}</p>
      <div class="library-card-stats">
        <span><strong>${formatNumber(leads)}</strong> leads</span>
        <span><strong>${formatNumber(outreach.contacted)}</strong> reached</span>
        <span><strong>${avg ? avg.toFixed(1) : "—"}</strong> avg ★</span>
      </div>
      <div class="library-card-progress"><span style="width: ${rate}%"></span></div>
      <div class="library-card-foot">
        <span>${escapeHtml(formatRelative(report.updated_at || report.created_at))}</span>
        <div class="library-card-actions">
          <button type="button" class="library-open-btn" data-open-report="${escapeHtml(report.id)}" ${busy ? "disabled" : ""}>
            ${busy ? "Opening…" : "Open report"}
            ${icon("i-arrow-right")}
          </button>
          <button type="button" class="library-export-btn" data-export-report="${escapeHtml(report.id)}" data-export-format="csv" title="Export CSV">CSV</button>
          <button type="button" class="library-export-btn" data-export-report="${escapeHtml(report.id)}" data-export-format="json" title="Export JSON">JSON</button>
        </div>
      </div>
    </article>`;
  }

  function mapSavedLeadRow(row) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const lead = {
      ...payload,
      id: payload.id || row.lead_key || row.id,
      name: payload.name || row.business_name || "Unnamed business",
      category: payload.category || row.category || "",
      address: payload.address || row.address || "",
      city: payload.city || row.city || "",
      phone: payload.phone || row.phone || "",
      website: payload.website || row.website || "",
      outreachStatus: row.outreach_status,
      outreachNote: row.outreach_note,
      contactedAt: row.contacted_at,
      outreachSource: "file",
      outreachKey: row.lead_key,
    };
    if (!lead.emails?.length && row.email) lead.emails = [row.email];
    if (!lead.phones?.length && row.phone) lead.phones = [row.phone];
    return lead;
  }

  async function fetchSavedReportLeads(reportId) {
    const sb = supabaseClient();
    const rows = await sb.select("leads", {
      report_id: `eq.${reportId}`,
      select: "*",
      order: "created_at.asc",
      limit: 5000,
    });
    return (Array.isArray(rows) ? rows : []).map(mapSavedLeadRow);
  }

  async function openSavedReport(reportId, { scroll = true } = {}) {
    const sb = supabaseClient();
    if (!sb || !reportId) return;
    if (state.library.busyReportId) return;
    state.library.busyReportId = reportId;
    renderLibrary();
    try {
      const [report, leads] = await Promise.all([
        sb.select(
          "lead_reports",
          { id: `eq.${reportId}`, select: "*", limit: 1 },
          { single: true },
        ),
        fetchSavedReportLeads(reportId),
      ]);
      if (!report) throw new Error("That saved report no longer exists.");

      hydrateOutreach(leads);
      const summary = {
        ...(report.summary || summarize(leads)),
        outreach: outreachCounts(leads),
      };
      state.results = {
        mode: "saved",
        savedReportId: report.id,
        leads,
        summary,
        query: { niche: report.niche, location: report.location },
        sourceName: report.name,
        format: "saved",
        importedAt: report.created_at,
        fetchedAt: report.updated_at || report.created_at,
        rowsRead: leads.length,
        skippedRows: 0,
        duplicateCount: 0,
        unnamedCount: 0,
        warnings: [],
        mappedFields: [],
        extraFieldNames: [],
        runId: report.run_id || null,
        datasetId: null,
        requested: null,
        runStatus: null,
      };
      state.savedReport = {
        id: report.id,
        name: report.name,
        notes: summary.notes || "",
        createdAt: report.created_at,
        updatedAt: report.updated_at || report.created_at,
      };
      state.resultsToken = null;
      state.importDesk = null;
      resetFilters({ render: false });
      renderReport();
      renderSaveState();
      showView("report", { scroll, focus: true });
    } catch (error) {
      showToast(friendlySupabaseError(error), "error");
    } finally {
      state.library.busyReportId = null;
      renderLibrary();
    }
  }

  async function deleteSavedReport(reportId) {
    const report = state.library.reports.find((entry) => entry.id === reportId);
    if (!report) return;
    const confirmed = window.confirm(
      `Delete “${report.name}” and every lead inside it? This cannot be undone.`,
    );
    if (!confirmed) return;
    const sb = supabaseClient();
    try {
      await sb.remove("lead_reports", { id: `eq.${reportId}` });
      if (state.results?.savedReportId === reportId) {
        state.results = null;
        state.savedReport = null;
        renderSaveState();
      }
      state.library.reports = state.library.reports.filter((entry) => entry.id !== reportId);
      renderLibrary();
      renderDashboard();
      showToast(`Deleted “${report.name}”.`, "success");
      loadLibrary({ force: true });
    } catch (error) {
      showToast(friendlySupabaseError(error), "error");
    }
  }

  async function exportSavedReport(reportId, format) {
    const report = state.library.reports.find((entry) => entry.id === reportId);
    if (!report) return;
    try {
      let leads;
      if (state.results?.savedReportId === reportId && state.results.leads?.length) {
        leads = state.results.leads;
      } else {
        leads = await fetchSavedReportLeads(reportId);
      }
      if (!leads.length) {
        showToast("That report has no leads to export.", "error");
        return;
      }
      const text =
        format === "csv"
          ? leadsToCsv(leads)
          : JSON.stringify(
              buildClientJsonExport(leads, {
                fileName: report.name,
                query: { niche: report.niche, location: report.location },
                summary: report.summary || summarize(leads),
                runId: report.run_id,
                reportName: report.name,
              }),
              null,
              2,
            );
      downloadBlobFile(
        text,
        format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
        `${slugify(report.name, "lead-atlas-report")}-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
      showToast(`${format.toUpperCase()} exported from “${report.name}”.`, "success");
    } catch (error) {
      showToast(friendlySupabaseError(error), "error");
    }
  }

  function suggestedReportName() {
    const results = state.results;
    if (!results) return "Untitled field report";
    if (results.mode === "import") {
      return String(results.sourceName || "Imported leads").replace(/\.[a-z0-9]+$/i, "").slice(0, 120);
    }
    const niche = results.query?.niche || results.niche || "Field report";
    const location = results.query?.location || results.location || "";
    const name = location ? `${niche} — ${location}` : niche;
    return name.slice(0, 120);
  }

  function renderSaveState() {
    const leads = state.results?.leads || [];
    const savedId = state.results?.savedReportId;
    const saved = Boolean(savedId);
    if (els.saveReportBtn) {
      els.saveReportBtn.disabled = leads.length === 0;
      els.saveReportBtn.classList.toggle("is-saved", saved);
      els.saveReportBtn.title = leads.length
        ? saved
          ? "Update this saved report"
          : "Save this report to your private library"
        : "This report has no leads to save.";
    }
    if (els.saveReportLabel) {
      els.saveReportLabel.textContent = saved ? "Update saved report" : "Save to library";
    }
    if (els.reportSavedBadge) {
      els.reportSavedBadge.hidden = !saved;
      if (saved) {
        els.reportSavedBadgeText.textContent = `Saved ${formatRelative(state.savedReport?.updatedAt || new Date())}`;
      }
    }
  }

  function renderSaveDialogSummary() {
    const leads = state.results?.leads || [];
    const summary = state.results?.summary || summarize(leads);
    const reachable = Number(summary.withContact) || 0;
    if (els.saveReportSummaryTitle) {
      els.saveReportSummaryTitle.textContent = state.results?.savedReportId
        ? "Updating a saved report"
        : "Ready for your library";
    }
    if (els.saveReportSummaryMeta) {
      els.saveReportSummaryMeta.textContent = `${pluralize(leads.length, "lead")} · ${formatNumber(reachable)} reachable · ${pluralize(outreachCounts(leads).marked, "outreach mark")}`;
    }
    if (els.confirmSaveReportLabel) {
      els.confirmSaveReportLabel.textContent = state.results?.savedReportId
        ? "Update saved report"
        : "Save to library";
    }
  }

  function openSaveReportDialog() {
    if (!state.results?.leads?.length) {
      showToast("This report has no leads to save.", "error");
      return;
    }
    if (!isAuthed()) {
      goToSignIn({ notice: "Sign in to save this report to your library." });
      return;
    }
    state.saveDialog.open = true;
    if (els.saveReportName) {
      els.saveReportName.value = state.savedReport?.name || suggestedReportName();
    }
    if (els.saveReportNotes) {
      els.saveReportNotes.value =
        state.savedReport?.notes || state.results.summary?.notes || "";
    }
    if (els.saveReportError) els.saveReportError.hidden = true;
    if (els.saveReportNotice) els.saveReportNotice.hidden = true;
    if (els.saveReportNameError) els.saveReportNameError.hidden = true;
    renderSaveDialogSummary();
    if (!els.saveReportDialog.open) els.saveReportDialog.showModal();
    document.body.classList.add("has-dialog");
    syncDialogState();
    window.setTimeout(() => {
      els.saveReportName?.focus();
      els.saveReportName?.select();
    }, 50);
  }

  function closeSaveReportDialog() {
    if (els.saveReportDialog?.open) els.saveReportDialog.close();
    state.saveDialog.open = false;
    syncDialogState();
  }

  function leadRowsForReport(reportId, userId, leads) {
    const seen = new Set();
    return leads.map((lead, index) => {
      let key = lead.outreachKey || outreachKeyForLead(lead);
      if (!key) key = `lead-${index + 1}`;
      if (seen.has(key)) key = `${key}-${index + 1}`;
      seen.add(key);
      const phone = lead.phone || lead.phones?.[0] || null;
      const email = lead.email || lead.emails?.[0] || null;
      const rating = Number(lead.rating);
      const reviews = Number(lead.reviewCount);
      return {
        report_id: reportId,
        user_id: userId,
        lead_key: key,
        business_name: lead.name || null,
        category: lead.category || null,
        address: lead.address || null,
        city: lead.city || null,
        phone: phone ? String(phone) : null,
        email: email ? String(email) : null,
        website: lead.website || null,
        rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : null,
        review_count: Number.isFinite(reviews) ? Math.round(reviews) : null,
        outreach_status: normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO,
        outreach_note: normalizeOutreachNote(lead.outreachNote) || null,
        contacted_at: lead.contactedAt || null,
        payload: lead,
      };
    });
  }

  async function handleSaveReportSubmit(event) {
    event.preventDefault();
    const sb = supabaseClient();
    const user = state.auth.user;
    const leads = state.results?.leads || [];
    if (!sb || !user?.id || !leads.length) {
      if (els.saveReportError) {
        els.saveReportError.textContent = "Sign in again, then reopen this report to save it.";
        els.saveReportError.hidden = false;
      }
      return;
    }

    const name = String(els.saveReportName?.value || "").trim();
    if (!name) {
      if (els.saveReportNameError) {
        els.saveReportNameError.textContent = "Give this report a name first.";
        els.saveReportNameError.hidden = false;
      }
      els.saveReportName?.focus();
      return;
    }
    if (name.length > 120) {
      if (els.saveReportNameError) {
        els.saveReportNameError.textContent = "Keep the report name under 120 characters.";
        els.saveReportNameError.hidden = false;
      }
      return;
    }

    if (els.saveReportNameError) els.saveReportNameError.hidden = true;
    if (els.saveReportError) els.saveReportError.hidden = true;
    if (els.saveReportNotice) els.saveReportNotice.hidden = true;
    if (els.confirmSaveReport) els.confirmSaveReport.disabled = true;
    if (els.confirmSaveReportLabel) {
      els.confirmSaveReportLabel.textContent = state.results.savedReportId ? "Updating…" : "Saving…";
    }

    const results = state.results;
    const notes = String(els.saveReportNotes?.value || "").trim();
    const summary = {
      ...(results.summary || summarize(leads)),
      outreach: outreachCounts(leads),
      notes: notes || null,
    };
    const savedId = results.savedReportId;
    const niche = results.query?.niche || results.niche || null;
    const location = results.query?.location || results.location || null;

    try {
      if (savedId) {
        const updated = await sb.update(
          "lead_reports",
          { id: `eq.${savedId}` },
          {
            name,
            niche,
            location,
            lead_count: leads.length,
            summary,
          },
        );
        const row = Array.isArray(updated) ? updated[0] : updated;
        state.savedReport = {
          id: savedId,
          name,
          notes,
          createdAt: state.savedReport?.createdAt || row?.created_at || new Date().toISOString(),
          updatedAt: row?.updated_at || new Date().toISOString(),
        };
        state.results.summary = summary;
        showToast(`Updated “${name}”.`, "success");
      } else {
        const source = results.mode === "import" ? "import" : "scan";
        const inserted = await sb.insert("lead_reports", {
          user_id: user.id,
          name,
          niche,
          location,
          source,
          run_id: results.runId || null,
          lead_count: leads.length,
          summary,
        });
        const report = Array.isArray(inserted) ? inserted[0] : inserted;
        if (!report?.id) throw new Error("Supabase did not return the saved report.");

        const rows = leadRowsForReport(report.id, user.id, leads);
        for (let index = 0; index < rows.length; index += 250) {
          await sb.insert("leads", rows.slice(index, index + 250), { returning: false });
        }
        state.results.savedReportId = report.id;
        state.savedReport = {
          id: report.id,
          name,
          notes,
          createdAt: report.created_at,
          updatedAt: report.updated_at || report.created_at,
        };
        state.results.summary = summary;
        showToast(
          `Saved “${name}” — ${pluralize(leads.length, "lead")} in your library.`,
          "success",
        );
      }

      renderSaveState();
      closeSaveReportDialog();
      await loadLibrary({ force: true });
    } catch (error) {
      if (els.saveReportError) {
        els.saveReportError.textContent = friendlySupabaseError(error);
        els.saveReportError.hidden = false;
      }
    } finally {
      if (els.confirmSaveReport) els.confirmSaveReport.disabled = false;
      renderSaveDialogSummary();
    }
  }

  let savedSummaryTimer = null;

  function scheduleSavedReportSummary() {
    const reportId = state.results?.savedReportId;
    if (!reportId || !isAuthed()) return;
    window.clearTimeout(savedSummaryTimer);
    savedSummaryTimer = window.setTimeout(async () => {
      const sb = supabaseClient();
      if (!sb || state.results?.savedReportId !== reportId) return;
      const summary = {
        ...(state.results.summary || {}),
        outreach: outreachCounts(state.results.leads || []),
      };
      try {
        const updated = await sb.update(
          "lead_reports",
          { id: `eq.${reportId}` },
          { summary },
        );
        const row = Array.isArray(updated) ? updated[0] : updated;
        const local = state.library.reports.find((report) => report.id === reportId);
        if (local) {
          local.summary = summary;
          local.updated_at = row?.updated_at || new Date().toISOString();
        }
        if (state.savedReport?.id === reportId) {
          state.savedReport.updatedAt = row?.updated_at || new Date().toISOString();
          renderSaveState();
        }
        renderLibrary();
        renderDashboard();
      } catch (error) {
        console.warn("[lead-atlas] Saved report summary could not sync.", error);
      }
    }, 900);
  }

  function recordSavedLeadActivity(lead) {
    const reportId = state.results?.savedReportId;
    if (!reportId || !lead) return;
    const key = lead.outreachKey || outreachKeyForLead(lead);
    if (!key) return;
    const row = state.library.activity.find(
      (entry) => entry.report_id === reportId && entry.lead_key === key,
    );
    if (!row) return;
    row.outreach_status = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
    row.contacted_at = lead.contactedAt || null;
    state.library.analytics = buildOutreachAnalytics({
      leads: state.library.activity,
      reports: state.library.reports,
      account: accountAnalyticsLabel(),
    });
    renderDashboard();
    writeDashboardCache();
  }

  function syncSavedLead(lead) {
    const reportId = state.results?.savedReportId;
    const sb = supabaseClient();
    if (!reportId || !lead || !isAuthed() || !sb) return;
    const key = lead.outreachKey || outreachKeyForLead(lead);
    if (!key) return;
    recordSavedLeadActivity(lead);
    const patch = {
      outreach_status: normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO,
      outreach_note: normalizeOutreachNote(lead.outreachNote) || null,
      contacted_at: lead.contactedAt || null,
      payload: lead,
    };
    sb.update(
      "leads",
      { report_id: `eq.${reportId}`, lead_key: `eq.${key}` },
      patch,
      { returning: false },
    ).catch((error) => {
      console.warn("[lead-atlas] Outreach mark could not sync.", error);
      showToast(
        "That outreach mark saved in this browser but could not sync to your library.",
        "error",
        { duration: 7000 },
      );
    });
    scheduleSavedReportSummary();
  }

  /* ---------------- init ---------------- */

  function applyServerConfig(config) {
    state.config = {
      ...FALLBACK_CONFIG,
      ...config,
      limits: { ...FALLBACK_CONFIG.limits, ...(config.limits || {}) },
      pricing: { ...FALLBACK_CONFIG.pricing, ...(config.pricing || {}) },
      minStars:
        Array.isArray(config.minStars) && config.minStars.length
          ? config.minStars
          : FALLBACK_CONFIG.minStars,
      minReviews:
        Array.isArray(config.minReviews) && config.minReviews.length
          ? config.minReviews
          : FALLBACK_CONFIG.minReviews,
    };
    const supabase = config.supabase || {};
    state.config.supabase = supabase;
    const sb = supabaseClient();
    if (sb) {
      sb.configure(supabase);
      state.auth.configured = Boolean(
        supabase.configured && supabase.url && supabase.anonKey && sb.isConfigured(),
      );
    } else {
      state.auth.configured = false;
    }
    renderFooterVersion(config.appVersion);
    if (els.sidebarVersion) {
      els.sidebarVersion.textContent = `Version ${config.appVersion || "1.9.0"}`;
    }
    populateMinStars();
    populateMinReviews();
    setRangeBounds();
    syncRangeVisual();
    updateEstimate();
  }

  function readCachedConfig() {
    try {
      return parseConfigCache(window.localStorage.getItem(CONFIG_CACHE_KEY));
    } catch {
      return null;
    }
  }

  function writeCachedConfig(config) {
    try {
      const raw = serializeConfigCache(config);
      if (raw && window.localStorage.getItem(CONFIG_CACHE_KEY) !== raw) {
        window.localStorage.setItem(CONFIG_CACHE_KEY, raw);
      }
    } catch (error) {
      console.warn("[lead-atlas] Server config could not be cached.", error);
    }
  }

  async function loadConfig() {
    try {
      const config = await api("/api/config", { tokenOverride: null });
      applyServerConfig(config);
      writeCachedConfig(config);
    } catch (error) {
      // Keep the cached configuration (including Supabase) when the refresh
      // fails; a first visit simply continues with the fallback pricing.
      console.warn("[lead-atlas] Could not load server config; using fallback pricing.", error);
    }
  }

  async function init() {
    try {
      cacheElements();
      bindEvents();
      announceUpdatedBuild();
      // The account copy loads after sign-in; localStorage is only a cache and
      // migration source, never the token's home.
      state.token = "";
      state.outreach = readOutreachLedger();
      state.scripts = readScriptStore();
      state.scriptUi.selectedId = activeScript(state.scripts)?.id || null;
      renderScriptPlaceholders();
      renderScriptChip();
      // Paint from the last config immediately; refresh it in the background.
      // Without a cache (first visit), wait for the server as before.
      const cachedConfig = readCachedConfig();
      if (cachedConfig) applyServerConfig(cachedConfig);
      const configTask = loadConfig();
      if (!state.auth.configured) await configTask;

      // Apply the saved brief after config has filled both minimum selects.
      const savedBrief = readBrief();
      populateMinStars();
      populateMinReviews();
      setRangeBounds();
      syncRangeVisual();
      if (savedBrief) applyBrief(savedBrief);
      syncRangeVisual();
      syncWebsiteState();
      updateEstimate();
      updateKeyUI();
      startUpdatePolling();

      const sb = supabaseClient();
      if (!state.auth.configured || !sb) {
        if (els.appBoot) els.appBoot.hidden = true;
        if (els.bootError) {
          els.bootErrorText.textContent =
            "Supabase is not connected. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env, run supabase/schema.sql, then restart.";
          els.bootError.hidden = false;
        }
        return;
      }

      initAuthListener();
      // The workspace is account-only. A signed-out visit goes straight to the
      // sign-in page with a note and a path back to this section.
      await enterApp();
    } catch (error) {
      console.error("[lead-atlas] Boot error:", error);
      if (els.appBoot) els.appBoot.hidden = true;
      if (els.bootError) {
        els.bootErrorText.textContent =
          error?.message || "Reload the page, or check the server terminal.";
        els.bootError.hidden = false;
      }
    }
  }

  // A safety net for the reveal animation if the observer never fires.
  window.setTimeout(() => {
    $$(".reveal:not(.is-visible)").forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        element.classList.add("is-visible");
      }
    });
  }, 1800);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
