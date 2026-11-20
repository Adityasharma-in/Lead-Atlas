/* ============================================================
   LEAD ATLAS — OVERVIEW REDESIGN
   Standalone interactions for dashboard-redesign.html.
   No dependencies, no network calls.
   ============================================================ */

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const html = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobileQuery = window.matchMedia("(max-width: 1180px)");

  const readStore = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const writeStore = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode or file storage restrictions */
    }
  };

  const compact = (value) => {
    if (value >= 1000) {
      const digits = value % 1000 === 0 ? 0 : 1;
      return `${(value / 1000).toFixed(digits).replace(/\.0$/, "")}K`;
    }
    return String(value);
  };

  const number = new Intl.NumberFormat("en-US");

  /* ------------------------------------------------------------------
     THEME
     ------------------------------------------------------------------ */

  const themeToggle = $("#themeToggle");
  const themeIcon = $("#themeIcon");
  const themeMeta = $('meta[name="theme-color"]');

  function applyTheme(theme) {
    const dark = theme === "dark";
    html.dataset.theme = dark ? "dark" : "light";
    if (themeIcon) themeIcon.setAttribute("href", dark ? "#i-sun" : "#i-moon");
    if (themeToggle) {
      themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      themeToggle.setAttribute("title", dark ? "Switch to light theme" : "Switch to dark theme");
    }
    if (themeMeta) themeMeta.setAttribute("content", dark ? "#040705" : "#0c1611");
  }

  applyTheme(readStore("leadAtlas.overview.theme") === "dark" ? "dark" : "light");

  themeToggle?.addEventListener("click", () => {
    const next = html.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    writeStore("leadAtlas.overview.theme", next);
  });

  /* ------------------------------------------------------------------
     TOAST
     ------------------------------------------------------------------ */

  const toast = $("#toast");
  const toastText = $("#toastText");
  let toastTimer = 0;

  function showToast(message) {
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-on"), 2600);
  }

  /* ------------------------------------------------------------------
     SIDEBAR
     ------------------------------------------------------------------ */

  const app = $("#app");
  const sidebar = $("#sidebar");
  const sidebarToggle = $("#sidebarToggle");
  const menuBtn = $("#menuBtn");
  const navScrim = $("#navScrim");

  const isMobile = () => mobileQuery.matches;

  function syncSidebarLabels() {
    const collapsed = app?.classList.contains("is-collapsed") || false;
    if (isMobile()) {
      if (sidebarToggle) {
        sidebarToggle.setAttribute("aria-label", "Close navigation");
        sidebarToggle.setAttribute("aria-expanded", app?.classList.contains("nav-open") ? "true" : "false");
      }
      if (menuBtn) {
        menuBtn.setAttribute("aria-expanded", app?.classList.contains("nav-open") ? "true" : "false");
      }
      return;
    }

    if (sidebarToggle) {
      sidebarToggle.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
      sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
  }

  function setNav(open) {
    if (!app) return;
    app.classList.toggle("nav-open", open);
    if (navScrim) navScrim.hidden = !open;
    document.body.classList.toggle("nav-locked", open);
    syncSidebarLabels();

    if (open) {
      window.setTimeout(() => $(".nav-link", sidebar)?.focus(), 180);
    } else if (isMobile()) {
      menuBtn?.focus();
    }
  }

  function setCollapsed(collapsed) {
    if (!app) return;
    app.classList.toggle("is-collapsed", collapsed);
    writeStore("leadAtlas.overview.collapsed", collapsed ? "1" : "0");
    syncSidebarLabels();
  }

  if (readStore("leadAtlas.overview.collapsed") === "1") {
    app?.classList.add("is-collapsed");
  }
  syncSidebarLabels();

  menuBtn?.addEventListener("click", () => setNav(true));
  navScrim?.addEventListener("click", () => setNav(false));

  sidebarToggle?.addEventListener("click", () => {
    if (isMobile()) {
      setNav(false);
    } else {
      setCollapsed(!app?.classList.contains("is-collapsed"));
    }
  });

  mobileQuery.addEventListener?.("change", () => {
    setNav(false);
    syncSidebarLabels();
  });

  /* ------------------------------------------------------------------
     NOTIFICATIONS + MENUS
     ------------------------------------------------------------------ */

  const notificationsBtn = $("#notificationsBtn");
  const notifications = $("#notifications");
  const markRead = $("#markRead");

  const menuPairs = [
    { button: $("#sourceMenuBtn"), menu: $("#sourceMenu") },
    { button: $("#agendaMenuBtn"), menu: $("#agendaMenu") },
  ];

  function closeNotifications() {
    if (!notifications || notifications.hidden) return;
    notifications.hidden = true;
    notificationsBtn?.setAttribute("aria-expanded", "false");
  }

  function closeMenus(except = null) {
    menuPairs.forEach(({ button, menu }) => {
      if (!menu || menu === except) return;
      menu.hidden = true;
      button?.setAttribute("aria-expanded", "false");
    });
  }

  notificationsBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!notifications) return;
    const willOpen = notifications.hidden;
    closeNotifications();
    closeMenus();
    if (willOpen) {
      notifications.hidden = false;
      notificationsBtn.setAttribute("aria-expanded", "true");
    }
  });

  notifications?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  markRead?.addEventListener("click", () => {
    $$(".notif-item", notifications).forEach((item) => item.classList.remove("is-unread"));
    notificationsBtn?.classList.remove("has-dot");
    notificationsBtn?.setAttribute("aria-label", "Notifications");
    if (markRead) markRead.textContent = "All read";
    showToast("Notifications marked read.");
  });

  menuPairs.forEach(({ button, menu }) => {
    button?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!menu) return;
      const willOpen = menu.hidden;
      closeNotifications();
      closeMenus();
      if (willOpen) {
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
      }
    });

    menu?.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  document.addEventListener("click", () => {
    closeNotifications();
    closeMenus();
  });

  /* ------------------------------------------------------------------
     COMMAND PALETTE
     ------------------------------------------------------------------ */

  const cmdk = $("#cmdk");
  const cmdkInput = $("#cmdkInput");
  const cmdkClose = $("#cmdkClose");
  const cmdkEmpty = $("#cmdkEmpty");
  const searchOpener = $("#openSearch");
  const cmdkItems = $$(".cmdk-item");
  let activeCmdk = -1;
  let cmdkOpener = null;

  const visibleCmdk = () =>
    cmdkItems.filter((item) => !item.hidden && !item.closest(".cmdk-group")?.hidden);

  function setCmdkActive(index) {
    const items = visibleCmdk();
    if (!items.length) {
      activeCmdk = -1;
      cmdkItems.forEach((item) => item.classList.remove("is-active"));
      return;
    }
    activeCmdk = (index + items.length) % items.length;
    cmdkItems.forEach((item) => item.classList.toggle("is-active", item === items[activeCmdk]));
  }

  function filterCmdk(query) {
    const needle = query.trim().toLowerCase();
    cmdkItems.forEach((item) => {
      const haystack = (item.dataset.search || item.textContent || "").toLowerCase();
      item.hidden = Boolean(needle) && !haystack.includes(needle);
    });

    $$(".cmdk-group", cmdk).forEach((group) => {
      group.hidden = $$(".cmdk-item", group).every((item) => item.hidden);
    });

    if (cmdkEmpty) cmdkEmpty.hidden = visibleCmdk().length > 0;
    setCmdkActive(0);
  }

  function openCmdk(opener = document.activeElement) {
    if (!cmdk || typeof cmdk.showModal !== "function") return;
    if (cmdk.open) {
      cmdkInput?.focus();
      return;
    }
    cmdkOpener = opener instanceof HTMLElement ? opener : null;
    cmdk.showModal();
    if (cmdkInput) {
      cmdkInput.value = "";
      filterCmdk("");
      window.setTimeout(() => cmdkInput.focus(), 30);
    }
  }

  function closeCmdk() {
    if (cmdk?.open) cmdk.close();
  }

  searchOpener?.addEventListener("click", () => openCmdk(searchOpener));
  cmdkClose?.addEventListener("click", closeCmdk);

  cmdk?.addEventListener("click", (event) => {
    if (event.target === cmdk) closeCmdk();
  });

  cmdk?.addEventListener("close", () => {
    cmdkOpener?.focus?.();
  });

  cmdkInput?.addEventListener("input", () => filterCmdk(cmdkInput.value));

  cmdkInput?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCmdkActive(activeCmdk + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCmdkActive(activeCmdk - 1);
    } else if (event.key === "Enter") {
      const items = visibleCmdk();
      if (items[activeCmdk]) {
        event.preventDefault();
        items[activeCmdk].click();
      }
    }
  });

  cmdkItems.forEach((item, index) => {
    item.addEventListener("mouseenter", () => {
      item.classList.add("is-active");
      cmdkItems.forEach((other) => {
        if (other !== item) other.classList.remove("is-active");
      });
      activeCmdk = index;
    });
    item.addEventListener("click", () => {
      window.setTimeout(closeCmdk, 0);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeNotifications();
      closeMenus();
      if (!cmdk?.open) setNav(false);
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCmdk();
    }
  });

  /* ------------------------------------------------------------------
     CHART
     ------------------------------------------------------------------ */

  const chartPlot = $("#chartPlot");
  const chartX = $("#chartX");
  const chartTip = $("#chartTip");
  const chartSummary = $("#chartSummary");
  const rangeSelect = $("#rangeSelect");

  const MAX_CHART = 5000;

  const datasets = {
    year: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      leads: [3900, 3300, 2600, 3000, 3900, 3300, 4700, 3500, 1900, 2800, 3700, 4400],
      reached: [1100, 900, 700, 800, 1200, 1000, 1200, 950, 600, 800, 1100, 1300],
    },
    half: {
      labels: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"],
      leads: [3300, 4700, 3500, 1900, 2800, 3700],
      reached: [1000, 1200, 950, 600, 800, 1100],
    },
    month: {
      labels: ["1–5", "6–10", "11–15", "16–20", "21–25", "26–30"],
      leads: [3100, 2900, 3600, 3300, 2400, 1900],
      reached: [900, 800, 1100, 1000, 700, 500],
    },
  };

  let currentRange = "year";
  let defaultTip = 6;
  let activeTip = 6;
  let hoveringChart = false;
  let chartTipTimer = 0;

  function placeTip(index) {
    if (!chartPlot || !chartTip) return;
    const slots = $$(".bar-slot", chartPlot);
    const slot = slots[index];
    const data = datasets[currentRange];
    if (!slot) return;

    const stage = $("#chartStage");
    if (!stage) return;

    const stageRect = stage.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const slotHeight = slotRect.height;
    const barHeight = Math.max(5, (slotHeight * data.leads[index]) / MAX_CHART);
    const tipWidth = chartTip.offsetWidth || 140;
    const tipHeight = chartTip.offsetHeight || 52;

    let left = slotRect.left - stageRect.left + slotRect.width / 2;
    left = Math.max(tipWidth / 2 + 2, Math.min(stageRect.width - tipWidth / 2 - 2, left));

    let top = slotRect.top - stageRect.top + slotHeight - barHeight - tipHeight - 8;
    top = Math.max(0, top);

    chartTip.style.left = `${left}px`;
    chartTip.style.top = `${top}px`;
  }

  function showTip(index, focus = false) {
    if (!chartPlot || !chartTip) return;
    const data = datasets[currentRange];
    const slots = $$(".bar-slot", chartPlot);
    const slot = slots[index];
    if (!slot) return;

    activeTip = index;
    const leadValue = chartTip.querySelector("[data-tip-leads]");
    const reachedValue = chartTip.querySelector("[data-tip-reached]");
    if (leadValue) leadValue.textContent = compact(data.leads[index]);
    if (reachedValue) reachedValue.textContent = compact(data.reached[index]);

    if (focus) chartTip.classList.add("is-on");
    else chartTip.classList.add("is-on");
    placeTip(index);
  }

  function hideTip() {
    chartTip?.classList.remove("is-on");
  }

  function bindChart() {
    if (!chartPlot) return;
    const slots = $$(".bar-slot", chartPlot);

    slots.forEach((slot, index) => {
      slot.addEventListener("pointerenter", () => {
        hoveringChart = true;
        window.clearTimeout(chartTipTimer);
        showTip(index);
      });
      slot.addEventListener("focus", () => {
        hoveringChart = true;
        window.clearTimeout(chartTipTimer);
        showTip(index);
      });
    });

    chartPlot.addEventListener("pointerleave", () => {
      hoveringChart = false;
      showTip(defaultTip);
    });

    chartPlot.addEventListener("focusout", (event) => {
      if (!chartPlot.contains(event.relatedTarget)) {
        hoveringChart = false;
        showTip(defaultTip);
      }
    });
  }

  function renderChart() {
    if (!chartPlot) return;
    const data = datasets[currentRange];
    if (!data) return;

    chartPlot.innerHTML = data.labels
      .map((label, index) => {
        const height = Math.max(1, Math.round((data.leads[index] / MAX_CHART) * 100));
        return `<button class="bar-slot" type="button" style="--i: ${index}" aria-label="${label}: ${number.format(
          data.leads[index]
        )} leads, ${number.format(data.reached[index])} reached"><span class="bar" style="--h: ${height}"></span></button>`;
      })
      .join("");

    if (chartX) {
      chartX.style.setProperty("--cols", String(data.leads.length));
      chartX.innerHTML = data.labels.map((label) => `<span>${label}</span>`).join("");
    }

    if (chartSummary) {
      const peakIndex = data.leads.indexOf(Math.max(...data.leads));
      const totalLeads = data.leads.reduce((sum, value) => sum + value, 0);
      chartSummary.textContent = `${data.labels[0]} to ${data.labels[data.labels.length - 1]}: ${number.format(
        totalLeads
      )} captured leads. ${data.labels[peakIndex]} is the peak at ${number.format(data.leads[peakIndex])} leads.`;
    }

    defaultTip = data.leads.indexOf(Math.max(...data.leads));
    activeTip = defaultTip;
    hoveringChart = false;
    hideTip();
    bindChart();

    window.clearTimeout(chartTipTimer);
    chartTipTimer = window.setTimeout(() => {
      if (!hoveringChart) showTip(defaultTip);
    }, reduceMotion ? 40 : 300);
  }

  rangeSelect?.addEventListener("change", () => {
    currentRange = rangeSelect.value;
    renderChart();
  });

  window.addEventListener("resize", () => {
    if (chartTip?.classList.contains("is-on")) placeTip(activeTip);
  });

  renderChart();

  /* ------------------------------------------------------------------
     CALENDAR
     ------------------------------------------------------------------ */

  const calendarCard = $("#calendarCard");
  const calendarTitle = $("#calendarTitle");
  const calendarDates = $("#calendarDates");
  const calPrev = $("#calPrev");
  const calNext = $("#calNext");

  const weekdaysLong = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthsLong = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const stripTime = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, amount) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + amount);
    return stripTime(copy);
  };
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function startOfWeek(date) {
    const copy = stripTime(date);
    const offset = (copy.getDay() + 6) % 7;
    copy.setDate(copy.getDate() - offset);
    return copy;
  }

  const today = stripTime(new Date());
  let selectedDate = new Date(today);
  let cursorWeek = startOfWeek(today);

  function calendarMonthLabel(start) {
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      return `${monthsLong[start.getMonth()]} ${start.getFullYear()}`;
    }
    if (start.getFullYear() === end.getFullYear()) {
      return `${monthsShort[start.getMonth()]} – ${monthsShort[end.getMonth()]} ${end.getFullYear()}`;
    }
    return `${monthsShort[start.getMonth()]} ${start.getFullYear()} – ${monthsShort[end.getMonth()]} ${end.getFullYear()}`;
  }

  function renderCalendar(animate = false) {
    if (!calendarDates) return;

    if (calendarTitle) calendarTitle.textContent = calendarMonthLabel(cursorWeek);

    calendarDates.innerHTML = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(cursorWeek, index);
      const isToday = sameDay(date, today);
      const isSelected = sameDay(date, selectedDate);
      const className = `calendar-date${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}`;
      const label = `${isToday ? "Today, " : ""}${weekdaysLong[date.getDay()]} ${date.getDate()} ${
        monthsLong[date.getMonth()]
      } ${date.getFullYear()}`;

      return `<button type="button" class="${className}" data-time="${date.getTime()}" aria-label="${label}" aria-pressed="${
        isSelected ? "true" : "false"
      }"><span class="num">${date.getDate()}</span></button>`;
    }).join("");

    $$(".calendar-date", calendarDates).forEach((button) => {
      button.addEventListener("click", () => {
        selectedDate = new Date(Number(button.dataset.time));
        cursorWeek = startOfWeek(selectedDate);
        renderCalendar(true);
      });
    });

    if (animate && calendarCard) {
      calendarCard.classList.remove("is-shifting");
      // restart the tiny shift animation
      void calendarCard.offsetWidth;
      calendarCard.classList.add("is-shifting");
      window.setTimeout(() => calendarCard.classList.remove("is-shifting"), 300);
    }
  }

  calPrev?.addEventListener("click", () => {
    selectedDate = addDays(selectedDate, -7);
    cursorWeek = startOfWeek(selectedDate);
    renderCalendar(true);
  });

  calNext?.addEventListener("click", () => {
    selectedDate = addDays(selectedDate, 7);
    cursorWeek = startOfWeek(selectedDate);
    renderCalendar(true);
  });

  renderCalendar();

  /* ------------------------------------------------------------------
     AGENDA
     ------------------------------------------------------------------ */

  const agendaChecks = $$(".agenda-check");
  const agendaProgress = $("#agendaProgress");
  const agendaNext = $("#agendaNext");

  const shortDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  $$(".agenda-day").forEach((element) => {
    const offset = Number(element.dataset.dayOffset || 0);
    element.textContent = shortDate.format(addDays(today, offset));
  });

  function syncAgenda() {
    if (!agendaProgress) return;
    const done = agendaChecks.filter((input) => input.checked).length;
    agendaProgress.textContent = `${done} / ${agendaChecks.length} done`;

    if (agendaNext) {
      const next = agendaChecks.find((input) => !input.checked);
      if (!next) {
        agendaNext.textContent = "All calls done";
      } else {
        const time = next.closest(".agenda-row")?.querySelector(".agenda-time")?.textContent?.trim();
        agendaNext.textContent = time ? `Next up ${time}` : "Next up";
      }
    }
  }

  agendaChecks.forEach((input) => {
    input.addEventListener("change", syncAgenda);
  });

  syncAgenda();

  /* ------------------------------------------------------------------
     SOURCE MENU ACTIONS
     ------------------------------------------------------------------ */

  const sourceMenu = $("#sourceMenu");
  const agendaMenu = $("#agendaMenu");

  function downloadOverview() {
    const data = datasets[currentRange];
    const rows = [
      ["Metric", "Value"],
      ["Total leads", "18465"],
      ["Reached out", "9867"],
      ["Saved reports", "1284"],
      ["Do not contact", "342"],
      ["Scanned leads share", "65.75%"],
      ["Imported leads share", "34.25%"],
      [],
      ["Period", "Leads", "Reached"],
      ...data.labels.map((label, index) => [label, data.leads[index], data.reached[index]]),
    ];
    const csv = rows.map((row) => row.join(",")).join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lead-atlas-overview.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Overview CSV exported.");
  }

  async function copySummary() {
    const summary =
      "Lead Atlas overview — 18,465 leads · 9,867 reached · 1,284 saved reports · 342 do not contact.";
    try {
      await navigator.clipboard.writeText(summary);
      showToast("Summary copied to the clipboard.");
    } catch {
      const helper = document.createElement("textarea");
      helper.value = summary;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      try {
        document.execCommand("copy");
        showToast("Summary copied to the clipboard.");
      } catch {
        showToast("Copy is blocked in this browser.");
      }
      helper.remove();
    }
  }

  sourceMenu?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    closeMenus();
    if (action === "export") downloadOverview();
    if (action === "copy") copySummary();
  });

  agendaMenu?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    closeMenus();
    if (action === "mark-all") {
      agendaChecks.forEach((input) => {
        input.checked = true;
      });
      syncAgenda();
      showToast("Call list marked done.");
    }
    if (action === "reset") {
      agendaChecks.forEach((input) => {
        input.checked = false;
      });
      syncAgenda();
      showToast("Call list reset.");
    }
  });
})();
