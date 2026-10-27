import {
  IMPORT_LIMITS,
  buildClientJsonExport,
  leadsToCsv,
  parseImportContent,
} from "./import-core.js";
import {
  OUTREACH,
  OUTREACH_NOTE_LIMIT,
  OUTREACH_STATUSES,
  applyOutreachEntry,
  normalizeOutreachEntry,
  normalizeOutreachNote,
  normalizeOutreachStatus,
  outreachCounts,
  outreachEntryFromLead,
  outreachKeyForLead,
  outreachStatusLabel,
} from "./outreach-core.js";

(() => {
  "use strict";

  const STORAGE = {
    token: "leadAtlas.apifyToken.v1",
    brief: "leadAtlas.brief.v1",
    outreach: "leadAtlas.outreach.v1",
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
    view: "setup",
    results: null,
    importDesk: null,
    resultsToken: null,
    filters: {
      q: "",
      website: "all",
      contact: "all",
      outreach: "all",
      rating: "all",
      sort: "rating",
      page: 1,
    },
    pageSize: 12,
    contactPreference: true,
    outreach: { version: 1, entries: {} },
    running: null,
    pendingRunBrief: null,
    keyVisible: false,
    drawerLead: null,
    drawerNoteDirty: false,
    emptyAction: "reset",
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
    if (drawer && state.drawerLead) renderDrawerOutreach(state.drawerLead, { syncNote });
  }

  function setOutreachStatus(lead, status, { note, announce = true } = {}) {
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
    refreshOutreachViews({ drawer: true });

    if (announce) {
      const undo = () => {
        if (previousLedger) state.outreach.entries[key] = previousLedger;
        else delete state.outreach.entries[key];
        writeOutreachLedger();
        applyOutreachEntry(lead, previousLedger || previousEntry);
        lead.outreachSource = previousSource;
        refreshOutreachViews({ drawer: true });
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
    if (els.drawerOutreachStamp) {
      els.drawerOutreachStamp.textContent = `Updated ${formatDate(now, true)}`;
    }
    if (notify) {
      showToast("Outreach note saved.", "success", { duration: 2200 });
    }
    return true;
  }

  /* ---------------- element cache ---------------- */

  function cacheElements() {
    const ids = [
      "siteHeader",
      "keyChip",
      "keyDot",
      "keyChipText",
      "formKeyDot",
      "formKeyText",
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
      "navDataBtn",
      "backToSetup",
      "reportTimestamp",
      "reportRunLabel",
      "reportNiche",
      "reportLocation",
      "reportInWord",
      "reportSub",
      "exportCsvBtn",
      "exportJsonBtn",
      "dataCardBtn",
      "statsStrip",
      "reportToolbar",
      "leadSearch",
      "filterWebsite",
      "filterContact",
      "filterOutreach",
      "filterRating",
      "sortBy",
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
    ];
    for (const id of ids) els[id] = byId(id);
  }

  /* ---------------- view ---------------- */

  function showView(name, { scroll = true, focus = true } = {}) {
    const views = {
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
      button.textContent = addKeyText;
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
      state.token = token;
      state.resultsToken = null;
      state.account = account;
      try {
        window.localStorage.setItem(STORAGE.token, token);
      } catch {
        showToast("Key connected for this session, but the browser blocked saving it.", "error");
      }
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

  function forgetKey() {
    try {
      window.localStorage.removeItem(STORAGE.token);
    } catch {
      /* storage can be unavailable in private mode */
    }
    state.token = "";
    state.resultsToken = null;
    state.account = null;
    state.pendingRunBrief = null;
    setKeyStatus("empty");
    els.apiKeyInput.value = "";
    els.keyError.hidden = true;
    showToast("Apify key removed from this browser.", "success");
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
      skipClosed: els.skipClosed.checked,
    };
  }

  /* ---------------- run lifecycle ---------------- */

  function shortRunId(runId) {
    return String(runId || "").slice(-8).toUpperCase();
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
    state.filters = {
      q: "",
      website: "all",
      contact: "all",
      outreach: "all",
      rating: "all",
      sort: "rating",
      page: 1,
    };
    if (els.leadSearch) els.leadSearch.value = "";
    if (els.filterWebsite) els.filterWebsite.value = "all";
    if (els.filterContact) els.filterContact.value = "all";
    if (els.filterOutreach) els.filterOutreach.value = "all";
    if (els.filterRating) els.filterRating.value = "all";
    if (els.sortBy) els.sortBy.value = "rating";
    if (els.clearFilters) els.clearFilters.hidden = true;
    if (render) {
      renderTable();
      renderOutreachSummary();
    }
  }

  function filtersAreActive() {
    const f = state.filters;
    return Boolean(
      f.q ||
        f.website !== "all" ||
        f.contact !== "all" ||
        f.outreach !== "all" ||
        f.rating !== "all" ||
        f.sort !== "rating",
    );
  }

  function getFilteredLeads() {
    if (!state.results) return [];
    const f = state.filters;
    const query = f.q.trim().toLowerCase();
    const ratingFloor = f.rating === "all" ? null : Number(f.rating);

    const filtered = state.results.leads.filter((lead) => {
      if (f.website === "with" && !lead.hasWebsite) return false;
      if (f.website === "without" && lead.hasWebsite) return false;

      if (f.contact === "email" && !lead.emails?.length) return false;
      if (f.contact === "phone" && !lead.phones?.length) return false;
      if (f.contact === "reachable" && !lead.emails?.length && !lead.phones?.length) return false;
      if (f.contact === "none" && (lead.emails?.length || lead.phones?.length)) return false;

      const outreachStatus = normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO;
      if (f.outreach !== "all" && f.outreach !== outreachStatus) return false;

      if (ratingFloor !== null) {
        if (typeof lead.rating !== "number" || lead.rating < ratingFloor) return false;
      }

      if (query) {
        const haystack = [
          lead.name,
          lead.category,
          ...(lead.categories || []),
          lead.address,
          lead.city,
          lead.state,
          lead.domain,
          ...(lead.emails || []),
          ...(lead.phones || []),
          ...(lead.socials || []).map((social) => `${social.label} ${social.handle || ""}`),
          lead.outreachNote,
          outreachStatusLabel(outreachStatus),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    const outreachRank = {
      [OUTREACH.TODO]: 0,
      [OUTREACH.CONTACTED]: 1,
      [OUTREACH.DO_NOT_CONTACT]: 2,
    };
    sorted.sort((a, b) => {
      if (f.sort === "reviews") {
        return (b.reviewsCount || 0) - (a.reviewsCount || 0) || a.name.localeCompare(b.name);
      }
      if (f.sort === "name") {
        return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
      }
      if (f.sort === "contact") {
        const aContact = (a.phones?.length ? 1 : 0) + (a.emails?.length ? 1 : 0);
        const bContact = (b.phones?.length ? 1 : 0) + (b.emails?.length ? 1 : 0);
        return bContact - aContact || (b.rating ?? -1) - (a.rating ?? -1) || a.name.localeCompare(b.name);
      }
      if (f.sort === "outreach") {
        const aStatus = normalizeOutreachStatus(a.outreachStatus) || OUTREACH.TODO;
        const bStatus = normalizeOutreachStatus(b.outreachStatus) || OUTREACH.TODO;
        return (
          outreachRank[aStatus] - outreachRank[bStatus] ||
          (b.rating ?? -1) - (a.rating ?? -1) ||
          a.name.localeCompare(b.name)
        );
      }
      if (f.sort === "contacted") {
        // Only a real contact date counts here. An updatedAt fallback would
        // promote untouched “to contact” rows above leads actually called.
        const aStamp = Date.parse(a.contactedAt || 0) || 0;
        const bStamp = Date.parse(b.contactedAt || 0) || 0;
        return (
          bStamp - aStamp ||
          (b.rating ?? -1) - (a.rating ?? -1) ||
          a.name.localeCompare(b.name)
        );
      }
      return (
        (b.rating ?? -1) - (a.rating ?? -1) ||
        (b.reviewsCount || 0) - (a.reviewsCount || 0) ||
        a.name.localeCompare(b.name)
      );
    });
    return sorted;
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
    if (els.filterOutreach && els.filterOutreach.value !== active) {
      els.filterOutreach.value = active;
    }
    if (els.outreachStrip) {
      els.outreachStrip.classList.toggle("is-empty", counts.total === 0);
      els.outreachStrip.classList.toggle("has-progress", counts.marked > 0);
    }
  }

  function renderReport() {
    const results = state.results;
    if (!results) return;
    const imported = results.mode === "import";
    const query = results.query || {};
    const niche = imported
      ? query.niche || "Your lead file"
      : query.niche || results.niche || "Your scan";
    const location = imported
      ? query.location || results.sourceName || "your device"
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
      : results.runId
        ? `RUN ${shortRunId(results.runId)}`
        : "FIELD REPORT";
    els.reportTimestamp.textContent = imported
      ? `Imported ${formatDate(results.importedAt, true)}`
      : `Scanned ${formatDate(results.fetchedAt, true)}`;

    let sub;
    if (imported) {
      sub = `${pluralize(leads.length, "lead")} read locally from ${results.sourceName}`;
      if (results.duplicateCount) sub += ` · ${pluralize(results.duplicateCount, "duplicate")} merged`;
      if (results.skippedRows) sub += ` · ${pluralize(results.skippedRows, "row")} skipped`;
      sub += ". Nothing left your browser.";
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
      : "Every lead links back to Google Maps. Contact details can be incomplete or outdated — verify before outreach.";

    updateReportImportLabels(imported);
    renderStats(summary);
    renderOutreachSummary();
    setExportState(leads.length === 0);

    els.filterWebsite.value = state.filters.website;
    els.filterContact.value = state.filters.contact;
    if (els.filterOutreach) els.filterOutreach.value = state.filters.outreach;
    els.filterRating.value = state.filters.rating;
    els.sortBy.value = state.filters.sort;
    els.leadSearch.value = state.filters.q;
    els.clearFilters.hidden = !filtersAreActive();
    renderTable();

    document.title = imported
      ? `${niche} from ${location} · Lead Atlas`
      : `${niche} in ${location} · Lead Atlas`;
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
      contactLines.push(
        `<a class="contact-line" href="tel:${escapeHtml(phoneDigits)}" title="Call ${escapeHtml(phone)}">${icon("i-phone")}${escapeHtml(phone)}</a>`,
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
      <td class="cell-rank">${String(rank).padStart(2, "0")}</td>
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
    const filtered = getFilteredLeads();
    const total = state.results.leads.length;
    const pageSize = state.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (state.filters.page > totalPages) state.filters.page = totalPages;
    if (state.filters.page < 1) state.filters.page = 1;
    const page = state.filters.page;
    const start = (page - 1) * pageSize;
    const pageLeads = filtered.slice(start, start + pageSize);

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
    const end = Math.min(start + pageSize, filtered.length);
    els.leadsBody.innerHTML = pageLeads
      .map((lead, index) => rowHtml(lead, start + index + 1))
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

  function openDataDesk() {
    renderImportDesk();
    showView("data", { scroll: true, focus: true });
  }

  function applyImportedReport(parsed, fileName) {
    const leads = parsed.leads;
    const importedAt = new Date().toISOString();
    const sourceName = parsed.sourceName || fileName || "Imported leads";

    hydrateOutreach(leads);
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

  function contactRowHtml(kind, value, href, iconName) {
    const wrapper = href ? "a" : "div";
    const attrs = href
      ? ` href="${escapeHtml(href)}" ${href.startsWith("http") ? 'target="_blank" rel="noopener noreferrer"' : ""}`
      : "";
    return `<${wrapper} class="contact-row"${attrs}>
      <span class="contact-kind">${icon(iconName)}${escapeHtml(kind)}</span>
      <span class="contact-value">${escapeHtml(value)}</span>
    </${wrapper}>`;
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

    const contactRows = [];
    for (const phone of lead.phones || []) {
      const href = phoneHref(phone);
      contactRows.push(
        contactRowHtml(
          "Phone",
          phone,
          href.replace(/\D/g, "").length >= 6 ? `tel:${href}` : null,
          "i-phone",
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
    document.title = "Lead Atlas — Google Maps field scanner";
    showView("setup", { scroll: false, focus: false });
    window.setTimeout(() => {
      scrollToTarget(byId("scanner"));
      els.niche.focus({ preventScroll: true });
    }, 60);
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    const saveBriefDebounced = debounce(saveBrief, 250);

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
      [els.filterOutreach, "outreach"],
      [els.filterRating, "rating"],
      [els.sortBy, "sort"],
    ]) {
      element?.addEventListener("change", () => {
        state.filters[key] = element.value;
        state.filters.page = 1;
        renderTable();
        renderOutreachSummary();
      });
    }
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
          (activeChip || els.filterOutreach)?.focus({ preventScroll: true });
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

    window.addEventListener(
      "scroll",
      () => {
        if (window.scrollY > 8) els.siteHeader?.classList.add("is-scrolled");
        else els.siteHeader?.classList.remove("is-scrolled");
      },
      { passive: true },
    );

    window.addEventListener("beforeunload", (event) => {
      if (!state.running) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function syncDialogState() {
    const open = Boolean(els.keyDialog?.open || els.leadDialog?.open);
    document.body.classList.toggle("has-dialog", open);
  }

  /* ---------------- init ---------------- */

  async function loadConfig() {
    try {
      const config = await api("/api/config", { tokenOverride: null });
      state.config = {
        ...FALLBACK_CONFIG,
        ...config,
        limits: { ...FALLBACK_CONFIG.limits, ...(config.limits || {}) },
        pricing: { ...FALLBACK_CONFIG.pricing, ...(config.pricing || {}) },
        minStars:
          Array.isArray(config.minStars) && config.minStars.length
            ? config.minStars
            : FALLBACK_CONFIG.minStars,
      };
      populateMinStars();
      setRangeBounds();
      syncRangeVisual();
      updateEstimate();
    } catch (error) {
      console.warn("[lead-atlas] Could not load server config; using fallback pricing.", error);
    }
  }

  function initReveal() {
    const revealElements = $$(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealElements.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );
    revealElements.forEach((element) => observer.observe(element));
  }

  async function init() {
    try {
      cacheElements();
      bindEvents();
      populateMinStars();
      setRangeBounds();
      state.token = readStoredToken();
      state.outreach = readOutreachLedger();
      const savedBrief = readBrief();
      if (savedBrief) applyBrief(savedBrief);
      syncRangeVisual();
      syncWebsiteState();
      updateEstimate();
      updateKeyUI();
      updateHeaderVisibility();
      initReveal();

      await loadConfig();
      if (state.token) {
        setKeyStatus("checking");
        validateStoredKey({ silent: true });
      }
    } catch (error) {
      console.error("[lead-atlas] Boot error:", error);
      if (els.bootError) {
        els.bootErrorText.textContent =
          error?.message || "Reload the page, or check the server terminal.";
        els.bootError.hidden = false;
      }
      $$(".reveal").forEach((element) => element.classList.add("is-visible"));
    }
  }

  function updateHeaderVisibility() {
    els.siteHeader?.classList.toggle("is-scrolled", window.scrollY > 8);
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
