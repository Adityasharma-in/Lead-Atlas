/* ============================================================
   Lead Atlas — public site behaviour
   ============================================================
   The marketing pages are static. This file only handles the
   small things they need: the mobile menu, the reveal-on-scroll
   pass, the version stamp, and buttons that should travel to the
   sign-in page. No workspace state lives here.
   ============================================================ */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function closeMenu() {
    const menu = $("#landingMobileMenu");
    const button = $("#landingMenuBtn");
    if (!menu || !button) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function bindMenu() {
    const menu = $("#landingMobileMenu");
    const button = $("#landingMenuBtn");
    if (!menu || !button) return;

    button.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) closeMenu();
    });
  }

  function bindHeader() {
    const nav = $("#landingNav");
    if (!nav) return;
    const sync = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
    sync();
    window.addEventListener("scroll", sync, { passive: true });
  }

  function markCurrentPage() {
    const path = window.location.pathname.replace(/\/index\.html$/, "/");
    $$(".landing-links a, .landing-footer-links a").forEach((link) => {
      const raw = link.getAttribute("href") || "";
      if (raw.includes("#")) return;
      let target = "";
      try {
        target = new URL(link.href, window.location.href).pathname.replace(/\/index\.html$/, "/");
      } catch {
        return;
      }
      if (target === path) link.setAttribute("aria-current", "page");
    });
  }

  function showSiteNotice() {
    let message = "";
    try {
      message = window.sessionStorage.getItem("leadAtlas.siteNotice") || "";
      if (message) window.sessionStorage.removeItem("leadAtlas.siteNotice");
    } catch {
      return;
    }
    if (!message) return;

    const node = document.createElement("div");
    node.className = "site-flash";
    node.setAttribute("role", "status");
    const copy = document.createElement("span");
    copy.textContent = message;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => node.remove());
    node.append(copy, dismiss);
    document.body.appendChild(node);
    window.requestAnimationFrame(() => node.classList.add("is-visible"));
    window.setTimeout(() => {
      node.classList.remove("is-visible");
      window.setTimeout(() => node.remove(), 300);
    }, 6000);
  }

  function bindAuthLinks() {
    $$("[data-auth]").forEach((control) => {
      control.addEventListener("click", (event) => {
        event.preventDefault();
        const mode = control.dataset.auth === "signup" ? "signup" : "signin";
        window.location.assign(`/auth.html?mode=${mode}`);
      });
    });
    $$("[data-open-workspace]").forEach((control) => {
      control.addEventListener("click", () => window.location.assign("/app.html"));
    });
  }

  function initReveal() {
    const elements = $$(".reveal");
    if (!elements.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );
    elements.forEach((element) => observer.observe(element));

    window.setTimeout(() => {
      $$(".reveal:not(.is-visible)").forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) element.classList.add("is-visible");
      });
    }, 1800);
  }

  async function loadVersion() {
    try {
      const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const config = await response.json();
      const version = config.appVersion || "";
      $$("[data-app-version], #landingVersion").forEach((node) => {
        node.textContent = version;
      });
    } catch {
      /* the stamped build number is only decoration */
    }
  }

  function init() {
    bindMenu();
    bindHeader();
    bindAuthLinks();
    markCurrentPage();
    initReveal();
    loadVersion();
    showSiteNotice();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
