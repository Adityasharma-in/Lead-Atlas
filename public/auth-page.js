/* ============================================================
   Lead Atlas — sign-in page
   ============================================================
   Accounts live in Supabase Auth. This page owns the whole
   sign-in surface: password sign-in, account creation, magic
   links, password recovery and the "choose a new password" step
   after an email link. A successful sign-in hands off to
   /app.html; the workspace never renders a signed-out state.
   ============================================================ */
(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const AUTH_COPY = {
    signin: {
      kicker: "Account / Sign in",
      title: "Welcome back.",
      sub: "Sign in to open your lead library.",
      submit: "Sign in",
      passwordLabel: "Password",
      autocomplete: "current-password",
    },
    signup: {
      kicker: "Account / Create",
      title: "Build your workspace.",
      sub: "One account keeps every saved report and outreach mark in reach.",
      submit: "Create account",
      passwordLabel: "Password",
      autocomplete: "new-password",
    },
    magic: {
      kicker: "Account / Email link",
      title: "Skip the password.",
      sub: "We will email you a secure link that signs you in.",
      submit: "Email me a sign-in link",
      passwordLabel: "Password",
      autocomplete: "current-password",
    },
    forgot: {
      kicker: "Account / Recovery",
      title: "Reset your password.",
      sub: "Enter your email and we will send a recovery link.",
      submit: "Send reset link",
      passwordLabel: "Password",
      autocomplete: "current-password",
    },
    recovery: {
      kicker: "Account / New password",
      title: "Choose a new password.",
      sub: "Pick something you have not used on another site.",
      submit: "Update password",
      passwordLabel: "New password",
      autocomplete: "new-password",
    },
  };

  const state = {
    mode: "signin",
    configured: false,
    busy: false,
    recovering: false,
    redirectError: "",
  };

  const AUTH_NOTICE_KEY = "leadAtlas.authNotice";
  const AUTH_NEXT_KEY = "leadAtlas.authNext";

  const els = {};

  function cacheElements() {
    const ids = [
      "authKicker",
      "authTitle",
      "authSub",
      "authTabs",
      "authConfigNotice",
      "authForm",
      "authNameField",
      "authName",
      "authEmailField",
      "authEmail",
      "authPasswordField",
      "authPasswordLabel",
      "authPassword",
      "authConfirmField",
      "authConfirm",
      "authShowPassword",
      "authError",
      "authNotice",
      "authSubmit",
      "authSubmitLabel",
      "authLinks",
      "authForgotBtn",
      "authMagicBtn",
    ];
    for (const id of ids) els[id] = document.getElementById(id);
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
  }

  function friendlyAuthError(error) {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").trim();
    const lower = message.toLowerCase();
    if (code === "invalid_credentials" || lower.includes("invalid login credentials")) {
      return "Email or password is incorrect. Try again, or use “Email me a sign-in link”.";
    }
    if (code === "email_not_confirmed" || lower.includes("email not confirmed")) {
      return "Confirm your email first — open the link Supabase sent you, then sign in.";
    }
    if (code === "user_already_exists" || lower.includes("already registered")) {
      return "An account with this email already exists. Sign in instead.";
    }
    if (code === "over_email_send_rate_limit" || lower.includes("rate limit")) {
      return "Too many emails sent. Wait a minute, then try again.";
    }
    if (code === "weak_password" || lower.includes("password should be")) {
      return "That password is too weak. Use at least 6 characters.";
    }
    if (code === "not_configured") {
      return "Supabase is not connected yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env, run supabase/schema.sql, then restart.";
    }
    if (code === "pkce_missing") {
      return "Open the email link in the same browser where you requested it, or request a fresh link.";
    }
    return message || "That did not work. Check your details and try again.";
  }

  function feedback({ error = "", notice = "" } = {}) {
    if (els.authError) {
      els.authError.textContent = error;
      els.authError.hidden = !error;
    }
    if (els.authNotice) {
      els.authNotice.textContent = notice;
      els.authNotice.hidden = !notice;
    }
  }

  function render() {
    const mode = state.mode;
    const copy = AUTH_COPY[mode] || AUTH_COPY.signin;
    const recovery = mode === "recovery";
    const emailOnly = mode === "magic" || mode === "forgot";
    const showName = mode === "signup";
    const showEmail = !recovery;
    const showPassword = !emailOnly;
    const showConfirm = recovery;

    if (els.authKicker) els.authKicker.textContent = copy.kicker;
    if (els.authTitle) els.authTitle.textContent = copy.title;
    if (els.authSub) els.authSub.textContent = copy.sub;
    if (els.authPasswordLabel) els.authPasswordLabel.textContent = copy.passwordLabel;

    if (els.authNameField) els.authNameField.hidden = !showName;
    if (els.authEmailField) els.authEmailField.hidden = !showEmail;
    if (els.authPasswordField) els.authPasswordField.hidden = !showPassword;
    if (els.authConfirmField) els.authConfirmField.hidden = !showConfirm;

    if (els.authName) els.authName.required = showName;
    if (els.authEmail) els.authEmail.required = showEmail;
    if (els.authPassword) {
      els.authPassword.required = showPassword;
      els.authPassword.autocomplete = copy.autocomplete;
      els.authPassword.value = "";
    }
    if (els.authConfirm) {
      els.authConfirm.required = showConfirm;
      els.authConfirm.autocomplete = "new-password";
      els.authConfirm.value = "";
    }

    $$("[data-auth-tab]").forEach((tab) => {
      const active = tab.dataset.authTab === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (els.authTabs) els.authTabs.hidden = mode !== "signin" && mode !== "signup";
    if (els.authLinks) els.authLinks.hidden = recovery || mode === "forgot";
    if (els.authConfigNotice) els.authConfigNotice.hidden = state.configured;
    if (els.authSubmit) {
      els.authSubmit.disabled = state.busy || !state.configured;
      els.authSubmit.title = state.configured
        ? ""
        : "Add Supabase credentials to .env, then restart the app.";
    }
    if (els.authSubmitLabel) els.authSubmitLabel.textContent = state.busy ? "Working…" : copy.submit;
    if (els.authForm) {
      els.authForm.dataset.mode = mode;
      els.authForm.classList.toggle("is-busy", state.busy);
    }
    if (els.authShowPassword) {
      els.authShowPassword.textContent = els.authPassword?.type === "text" ? "Hide" : "Show";
    }

    document.title =
      mode === "signup"
        ? "Create your account — Lead Atlas"
        : mode === "recovery"
          ? "Choose a new password — Lead Atlas"
          : "Sign in — Lead Atlas";
  }

  function setMode(mode, { notice = "", error = "" } = {}) {
    state.mode = AUTH_COPY[mode] ? mode : "signin";
    state.recovering = state.mode === "recovery";
    render();
    feedback({ error, notice });
  }

  function setBusy(busy, label = "") {
    state.busy = busy;
    if (els.authSubmitLabel) {
      els.authSubmitLabel.textContent = busy ? label || "Working…" : AUTH_COPY[state.mode]?.submit || "Continue";
    }
    render();
  }

  function storedValue(key) {
    try {
      const value = window.sessionStorage.getItem(key);
      if (value) window.sessionStorage.removeItem(key);
      return value || "";
    } catch {
      return "";
    }
  }

  function goToApp() {
    let next = "";
    try {
      next = window.sessionStorage.getItem(AUTH_NEXT_KEY) || "";
      window.sessionStorage.removeItem(AUTH_NEXT_KEY);
    } catch {
      /* fall back to the workspace home */
    }
    if (!/^\/app\.html(?:[?#].*)?$/.test(next)) next = "/app.html";
    window.location.replace(next);
  }

  function readModeFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get("mode");
      if (mode === "signup" || mode === "signin") return mode;
    } catch {
      /* ignore malformed URLs */
    }
    return "signin";
  }

  function bindEvents() {
    els.authForm?.addEventListener("submit", handleSubmit);
    els.authTabs?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-auth-tab]");
      if (!tab) return;
      setMode(tab.dataset.authTab);
    });
    els.authShowPassword?.addEventListener("click", () => {
      if (!els.authPassword) return;
      const show = els.authPassword.type === "password";
      els.authPassword.type = show ? "text" : "password";
      els.authShowPassword.textContent = show ? "Hide" : "Show";
      els.authShowPassword.setAttribute("aria-label", show ? "Hide password" : "Show password");
      els.authPassword.focus();
    });
    els.authForgotBtn?.addEventListener("click", () => setMode("forgot"));
    els.authMagicBtn?.addEventListener("click", () => setMode("magic"));
    for (const input of [els.authName, els.authEmail, els.authPassword, els.authConfirm]) {
      input?.addEventListener("input", () => feedback());
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const sb = window.LeadAtlasSupabase;
    if (!state.configured || !sb) {
      feedback({
        error: "Supabase is not connected yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env, then restart the app.",
      });
      return;
    }

    const mode = state.mode;
    const email = String(els.authEmail?.value || "").trim();
    const password = String(els.authPassword?.value || "");
    const confirm = String(els.authConfirm?.value || "");
    const name = String(els.authName?.value || "").trim();

    if (mode !== "recovery" && !isEmail(email)) {
      feedback({ error: "Enter a valid email address." });
      els.authEmail?.focus();
      return;
    }
    if ((mode === "signin" || mode === "signup") && password.length < 6) {
      feedback({ error: "Passwords need at least 6 characters." });
      els.authPassword?.focus();
      return;
    }
    if (mode === "recovery") {
      if (password.length < 6) {
        feedback({ error: "Choose a password with at least 6 characters." });
        els.authPassword?.focus();
        return;
      }
      if (password !== confirm) {
        feedback({ error: "The two passwords do not match." });
        els.authConfirm?.focus();
        return;
      }
    }

    feedback();
    setBusy(true, mode === "signup" ? "Creating account…" : "Working…");

    try {
      if (mode === "signin") {
        await sb.signInWithPassword({ email, password });
        goToApp();
        return;
      }
      if (mode === "signup") {
        const result = await sb.signUp({ email, password, fullName: name });
        if (result.needsConfirmation) {
          setMode("signin", {
            notice: "Account created. Check your inbox for the confirmation link, then sign in.",
          });
          if (els.authEmail) els.authEmail.value = email;
          return;
        }
        goToApp();
        return;
      }
      if (mode === "magic") {
        await sb.signInWithOtp({ email });
        feedback({
          notice: "Sign-in link sent. Open it in this browser to enter your workspace.",
        });
        return;
      }
      if (mode === "forgot") {
        await sb.sendRecovery(email);
        feedback({
          notice: "Recovery link sent. Open it in this browser and choose a new password.",
        });
        return;
      }
      if (mode === "recovery") {
        await sb.updatePassword(password);
        state.recovering = false;
        feedback({ notice: "Password updated. Opening your workspace…" });
        goToApp();
        return;
      }
    } catch (error) {
      feedback({ error: friendlyAuthError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function loadConfig() {
    const sb = window.LeadAtlasSupabase;
    try {
      const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Config request failed");
      const config = await response.json();
      const supabaseConfig = config.supabase || {};
      if (sb) sb.configure(supabaseConfig);
      state.configured = Boolean(
        supabaseConfig.configured &&
          supabaseConfig.url &&
          supabaseConfig.anonKey &&
          sb &&
          sb.isConfigured(),
      );
      const version = config.appVersion || "";
      $$("[data-app-version]").forEach((node) => {
        node.textContent = version;
      });
    } catch {
      state.configured = false;
    }
  }

  async function start() {
    cacheElements();
    bindEvents();
    setMode(readModeFromUrl());
    await loadConfig();

    const sb = window.LeadAtlasSupabase;
    if (state.configured && sb) {
      const redirect = await sb.handleRedirect();
      if (redirect?.error) {
        state.redirectError = friendlyAuthError({ message: redirect.error });
        feedback({ error: state.redirectError });
      }
      if (redirect?.type === "recovery") {
        state.mode = "recovery";
        state.recovering = true;
        setMode("recovery", { notice: "Choose a new password to finish resetting your account." });
      } else if (redirect?.session || redirect?.type) {
        goToApp();
        return;
      }

      if (!state.recovering) {
        const session = await sb.getSession();
        if (session?.access_token) {
          goToApp();
          return;
        }
      }
    }

    render();
    const notice = state.redirectError ? "" : storedValue(AUTH_NOTICE_KEY);
    feedback({ error: state.redirectError, notice });
    window.setTimeout(() => {
      const target = state.mode === "recovery" ? els.authPassword : els.authEmail;
      target?.focus({ preventScroll: true });
    }, 80);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
