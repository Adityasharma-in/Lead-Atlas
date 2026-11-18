/**
 * Boot cache snapshots.
 *
 * The workspace paints the last dashboard immediately on a return visit and
 * refreshes Supabase in the background. These helpers only validate and shape
 * the cache; they never touch storage, the DOM or the network.
 */

export const BOOT_CACHE_VERSION = 1;
export const CONFIG_CACHE_KEY = "leadAtlas.config.v1";
export const DASHBOARD_CACHE_PREFIX = "leadAtlas.dashboardCache.v1";
export const BOOT_CACHE_LIMITS = { reports: 200, activity: 5000 };

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function count(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function cleanReport(value) {
  if (!isObject(value)) return null;
  const id =
    typeof value.id === "string"
      ? value.id.trim()
      : typeof value.id === "number"
        ? String(value.id)
        : "";
  if (!id) return null;
  return {
    id,
    name: text(value.name) || "Saved report",
    niche: text(value.niche),
    location: text(value.location),
    source: text(value.source),
    run_id: nullableText(value.run_id),
    lead_count: count(value.lead_count),
    summary: isObject(value.summary) ? value.summary : {},
    created_at: nullableText(value.created_at),
    updated_at: nullableText(value.updated_at),
  };
}

function cleanActivity(value) {
  if (!isObject(value)) return null;
  const reportId =
    typeof value.report_id === "string"
      ? value.report_id
      : typeof value.report_id === "number"
        ? String(value.report_id)
        : "";
  if (!reportId) return null;
  return {
    report_id: reportId,
    lead_key: text(value.lead_key),
    outreach_status: text(value.outreach_status),
    contacted_at: nullableText(value.contacted_at),
    created_at: nullableText(value.created_at),
  };
}

function cleanStats(value) {
  if (!isObject(value)) return null;
  return {
    reports: count(value.reports),
    leads: count(value.leads),
    contacted: count(value.contacted),
    doNotContact: count(value.doNotContact),
  };
}

function cleanConfig(value) {
  if (!isObject(value)) return null;
  if (!isObject(value.limits) || !isObject(value.pricing) || !isObject(value.supabase)) {
    return null;
  }
  if (!Array.isArray(value.minStars) || !Array.isArray(value.minReviews)) return null;
  return value;
}

/** Storage key for one account's dashboard snapshot. */
export function dashboardCacheKey(userId) {
  const id = typeof userId === "string" ? userId.trim() : "";
  return id ? `${DASHBOARD_CACHE_PREFIX}.${id}` : "";
}

/** Serialize the smallest dashboard snapshot the first paint needs. */
export function serializeDashboardCache(snapshot = {}, now = Date.now()) {
  if (!isObject(snapshot)) return "";
  const stats = cleanStats(snapshot.stats);
  if (!stats || !Array.isArray(snapshot.reports) || !Array.isArray(snapshot.activity)) {
    return "";
  }
  const reports = snapshot.reports
    .slice(0, BOOT_CACHE_LIMITS.reports)
    .map(cleanReport)
    .filter(Boolean);
  const activity = snapshot.activity
    .slice(0, BOOT_CACHE_LIMITS.activity)
    .map(cleanActivity)
    .filter(Boolean);
  return JSON.stringify({
    version: BOOT_CACHE_VERSION,
    savedAt: timestamp(now),
    reports,
    stats,
    activity,
  });
}

/** Read a dashboard snapshot, rejecting corrupt or outdated cache entries. */
export function parseDashboardCache(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.version !== BOOT_CACHE_VERSION) return null;
  const stats = cleanStats(parsed.stats);
  if (!stats || !Array.isArray(parsed.reports) || !Array.isArray(parsed.activity)) {
    return null;
  }
  return {
    version: BOOT_CACHE_VERSION,
    savedAt: timestamp(parsed.savedAt),
    reports: parsed.reports
      .slice(0, BOOT_CACHE_LIMITS.reports)
      .map(cleanReport)
      .filter(Boolean),
    stats,
    activity: parsed.activity
      .slice(0, BOOT_CACHE_LIMITS.activity)
      .map(cleanActivity)
      .filter(Boolean),
  };
}

/** Serialize the server config used to configure Supabase before the fetch. */
export function serializeConfigCache(config, now = Date.now()) {
  const clean = cleanConfig(config);
  if (!clean) return "";
  return JSON.stringify({
    version: BOOT_CACHE_VERSION,
    savedAt: timestamp(now),
    config: clean,
  });
}

/** Read the cached server config, rejecting corrupt or outdated entries. */
export function parseConfigCache(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.version !== BOOT_CACHE_VERSION) return null;
  return cleanConfig(parsed.config);
}
