/**
 * Outreach analytics.
 *
 * Pure functions only. Aggregates the signed-in account's saved leads by local
 * calendar day and month. "Reached" uses contacted_at, so a mark made today
 * counts today even when the lead was scraped weeks ago.
 */

import { normalizeOutreachStatus } from "./outreach-core.js";

export const ANALYTICS_DAYS = 14;

function dateValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function localDayKey(value) {
  const date = dateValue(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localMonthKey(value) {
  const date = dateValue(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function formatShortDay(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatWeekday(date) {
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function sourceForLead(lead, reportById) {
  const report = reportById.get(String(lead?.report_id ?? ""));
  if (report?.source === "import") return "import";
  if (report?.source === "scan") return "scan";
  return "unknown";
}

function emptySource() {
  return { leads: 0, reached: 0, reports: 0, toContact: 0, doNotContact: 0 };
}

/**
 * Build the dashboard view.
 *
 * @param {object} input
 * @param {object[]} input.leads   Saved lead activity rows (lead_key optional).
 * @param {object[]} input.reports Saved report rows with id/source/created_at.
 * @param {Date}     input.now     Clock injection for deterministic tests.
 * @param {string}   input.account Display label for the signed-in account.
 * @param {number}   input.days    Number of day buckets, including today.
 */
export function buildOutreachAnalytics({
  leads = [],
  reports = [],
  now = new Date(),
  account = "",
  days = ANALYTICS_DAYS,
} = {}) {
  const clock = dateValue(now) || new Date();
  const today = startOfDay(clock);
  const windowDays = Math.max(1, Math.min(60, Math.floor(Number(days) || ANALYTICS_DAYS)));
  const reportById = new Map(
    (Array.isArray(reports) ? reports : []).map((report) => [String(report?.id ?? ""), report]),
  );

  const buckets = [];
  const bucketByKey = new Map();
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const bucket = {
      key: localDayKey(date),
      date,
      label: formatShortDay(date),
      weekday: formatWeekday(date),
      reached: 0,
      leads: 0,
      scans: 0,
      imports: 0,
      isToday: offset === 0,
    };
    buckets.push(bucket);
    bucketByKey.set(bucket.key, bucket);
  }

  const month = {
    key: localMonthKey(clock),
    reached: 0,
    leads: 0,
    scans: 0,
    imports: 0,
    bySource: {
      scan: emptySource(),
      import: emptySource(),
      unknown: emptySource(),
    },
  };

  const lifetime = {
    leads: 0,
    reached: 0,
    toContact: 0,
    doNotContact: 0,
  };

  for (const report of reportById.values()) {
    const created = dateValue(report?.created_at);
    if (!created) continue;
    const source = report?.source === "import" ? "import" : "scan";
    if (localMonthKey(created) === month.key) {
      month[source === "scan" ? "scans" : "imports"] += 1;
      month.bySource[source].reports += 1;
    }
    const bucket = bucketByKey.get(localDayKey(created));
    if (bucket) bucket[source === "scan" ? "scans" : "imports"] += 1;
  }

  for (const lead of Array.isArray(leads) ? leads : []) {
    const source = sourceForLead(lead, reportById);
    const status = normalizeOutreachStatus(lead?.outreach_status ?? lead?.outreachStatus) || "to-contact";
    const created = dateValue(lead?.created_at);
    const contacted = dateValue(lead?.contacted_at ?? lead?.contactedAt);
    const wasReached = Boolean(contacted) || status === "contacted";

    lifetime.leads += 1;
    if (wasReached) lifetime.reached += 1;
    else if (status === "do-not-contact") lifetime.doNotContact += 1;
    else lifetime.toContact += 1;

    if (created) {
      const createdMonth = localMonthKey(created);
      if (createdMonth === month.key) {
        month.leads += 1;
        month.bySource[source].leads += 1;
      }
      const bucket = bucketByKey.get(localDayKey(created));
      if (bucket) bucket.leads += 1;
    }

    if (contacted) {
      if (localMonthKey(contacted) === month.key) {
        month.reached += 1;
        month.bySource[source].reached += 1;
      }
      const bucket = bucketByKey.get(localDayKey(contacted));
      if (bucket) bucket.reached += 1;
    }

    if (created && localMonthKey(created) === month.key) {
      if (status === "do-not-contact") month.bySource[source].doNotContact += 1;
      else if (!wasReached) month.bySource[source].toContact += 1;
    }
  }

  const todayKey = localDayKey(today);
  const yesterdayKey = localDayKey(addDays(today, -1));
  const todayStats = bucketByKey.get(todayKey) || buckets[buckets.length - 1];
  const yesterdayStats = bucketByKey.get(yesterdayKey) || {
    key: yesterdayKey,
    reached: 0,
    leads: 0,
    scans: 0,
    imports: 0,
  };
  const delta = todayStats.reached - yesterdayStats.reached;
  const best = buckets.reduce(
    (winner, bucket) => (bucket.reached > winner.reached ? bucket : winner),
    buckets[0],
  );
  const maxReached = Math.max(1, ...buckets.map((bucket) => bucket.reached));

  return {
    account: String(account || "").trim(),
    generatedAt: clock.toISOString(),
    today: { ...todayStats, key: todayKey },
    yesterday: { ...yesterdayStats, key: yesterdayKey },
    delta,
    best: { ...best },
    maxReached,
    days: buckets,
    month,
    lifetime,
  };
}

/** True when the lead row belongs to the current local month. */
export function isThisMonth(value, now = new Date()) {
  const date = dateValue(value);
  return Boolean(date) && localMonthKey(date) === localMonthKey(now);
}
