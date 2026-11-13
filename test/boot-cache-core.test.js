import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOOT_CACHE_LIMITS,
  BOOT_CACHE_VERSION,
  CONFIG_CACHE_KEY,
  DASHBOARD_CACHE_PREFIX,
  dashboardCacheKey,
  parseConfigCache,
  parseDashboardCache,
  serializeConfigCache,
  serializeDashboardCache,
} from "../public/boot-cache-core.js";

const NOW = Date.UTC(2026, 10, 13, 10, 30);

function report(index = 1, overrides = {}) {
  return {
    id: `report-${index}`,
    name: `Report ${index}`,
    niche: "Dentists",
    location: "Austin",
    source: "scan",
    run_id: `run-${index}`,
    lead_count: 12,
    summary: { total: 12, outreach: { contacted: 3 } },
    created_at: "2026-11-13T09:00:00.000Z",
    updated_at: "2026-11-13T09:30:00.000Z",
    ...overrides,
  };
}

function activity(index = 1, overrides = {}) {
  return {
    report_id: `report-${index}`,
    lead_key: `lead-${index}`,
    outreach_status: index % 2 ? "contacted" : "to-contact",
    contacted_at: index % 2 ? "2026-11-13T09:15:00.000Z" : null,
    created_at: "2026-11-13T09:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    reports: [report(1), report(2)],
    stats: { reports: 2, leads: 24, contacted: 3, doNotContact: 1 },
    activity: [activity(1), activity(2)],
    ...overrides,
  };
}

function minimalConfig(overrides = {}) {
  return {
    appVersion: "1.9.0",
    limits: { maxResults: 500 },
    pricing: { place: 0.004 },
    minStars: [{ value: "4", label: "4+" }],
    minReviews: [{ value: "10", label: "10+" }],
    supabase: { configured: true, url: "https://demo.supabase.co", anonKey: "public" },
    ...overrides,
  };
}

describe("dashboardCacheKey", () => {
  it("scopes the key to one account", () => {
    assert.equal(dashboardCacheKey("user-1"), `${DASHBOARD_CACHE_PREFIX}.user-1`);
    assert.notEqual(dashboardCacheKey("user-1"), dashboardCacheKey("user-2"));
  });

  it("returns an empty key without a usable user id", () => {
    assert.equal(dashboardCacheKey(""), "");
    assert.equal(dashboardCacheKey("   "), "");
    assert.equal(dashboardCacheKey(null), "");
    assert.equal(dashboardCacheKey(42), "");
  });

  it("uses a versioned cache prefix", () => {
    assert.match(DASHBOARD_CACHE_PREFIX, /v1$/);
    assert.match(CONFIG_CACHE_KEY, /v1$/);
  });
});

describe("serializeDashboardCache and parseDashboardCache", () => {
  it("round-trips the snapshot the first paint needs", () => {
    const parsed = parseDashboardCache(serializeDashboardCache(snapshot(), NOW));
    assert.equal(parsed.version, BOOT_CACHE_VERSION);
    assert.equal(parsed.savedAt, NOW);
    assert.deepEqual(parsed.stats, { reports: 2, leads: 24, contacted: 3, doNotContact: 1 });
    assert.equal(parsed.reports.length, 2);
    assert.equal(parsed.reports[0].name, "Report 1");
    assert.equal(parsed.activity.length, 2);
    assert.equal(parsed.activity[0].lead_key, "lead-1");
  });

  it("drops malformed rows but keeps the valid ones", () => {
    const parsed = parseDashboardCache(
      serializeDashboardCache(
        snapshot({
          reports: [report(1), null, { name: "No id" }, { id: 7, name: "Numeric id" }],
          activity: [activity(1), {}, { report_id: "", lead_key: "orphan" }, { report_id: 9 }],
        }),
        NOW,
      ),
    );
    assert.deepEqual(
      parsed.reports.map((row) => row.id),
      ["report-1", "7"],
    );
    assert.deepEqual(
      parsed.activity.map((row) => row.report_id),
      ["report-1", "9"],
    );
  });

  it("caps reports and activity at the boot limits", () => {
    const manyReports = Array.from({ length: BOOT_CACHE_LIMITS.reports + 25 }, (_, index) =>
      report(index + 1),
    );
    const manyActivity = Array.from({ length: BOOT_CACHE_LIMITS.activity + 25 }, (_, index) =>
      activity(index + 1),
    );
    const parsed = parseDashboardCache(
      serializeDashboardCache(snapshot({ reports: manyReports, activity: manyActivity }), NOW),
    );
    assert.equal(parsed.reports.length, BOOT_CACHE_LIMITS.reports);
    assert.equal(parsed.activity.length, BOOT_CACHE_LIMITS.activity);
  });

  it("returns an empty string when the snapshot is incomplete", () => {
    assert.equal(serializeDashboardCache({ reports: [], activity: [] }, NOW), "");
    assert.equal(serializeDashboardCache({ stats: snapshot().stats, activity: [] }, NOW), "");
    assert.equal(
      serializeDashboardCache({ stats: snapshot().stats, reports: "nope", activity: [] }, NOW),
      "",
    );
    assert.equal(serializeDashboardCache(null, NOW), "");
  });

  it("rejects corrupt JSON, outdated versions and wrong shapes", () => {
    assert.equal(parseDashboardCache("not json"), null);
    assert.equal(parseDashboardCache(""), null);
    assert.equal(parseDashboardCache(null), null);
    assert.equal(
      parseDashboardCache(JSON.stringify({ version: 99, reports: [], activity: [], stats: {} })),
      null,
    );
    assert.equal(
      parseDashboardCache(
        JSON.stringify({
          version: BOOT_CACHE_VERSION,
          reports: [],
          activity: [],
          stats: { reports: 0, leads: 0, contacted: 0, doNotContact: 0 },
        }),
      ) !== null,
      true,
      "an empty but valid snapshot should load",
    );
    assert.equal(
      parseDashboardCache(JSON.stringify({ version: BOOT_CACHE_VERSION, stats: {} })),
      null,
    );
  });

  it("normalizes negative counts and missing timestamps", () => {
    const parsed = parseDashboardCache(
      serializeDashboardCache(
        snapshot({
          stats: { reports: -1, leads: "12", contacted: 3.9, doNotContact: null },
        }),
        NOW,
      ),
    );
    assert.deepEqual(parsed.stats, { reports: 0, leads: 12, contacted: 3, doNotContact: 0 });
    const untimed = parseDashboardCache(
      JSON.stringify({
        version: BOOT_CACHE_VERSION,
        savedAt: -5,
        reports: [],
        activity: [],
        stats: { reports: 0, leads: 0, contacted: 0, doNotContact: 0 },
      }),
    );
    assert.equal(untimed.savedAt, 0);
  });
});

describe("serializeConfigCache and parseConfigCache", () => {
  it("round-trips the server config", () => {
    const config = minimalConfig();
    assert.deepEqual(parseConfigCache(serializeConfigCache(config, NOW)), config);
  });

  it("rejects config without the shapes the workspace needs", () => {
    assert.equal(serializeConfigCache(null), "");
    assert.equal(serializeConfigCache({ limits: {}, pricing: {} }), "");
    assert.equal(serializeConfigCache(minimalConfig({ supabase: null })), "");
    assert.equal(serializeConfigCache(minimalConfig({ minStars: "4" })), "");
    assert.equal(serializeConfigCache(minimalConfig({ minReviews: null })), "");
  });

  it("rejects corrupt, outdated or incomplete cached config", () => {
    assert.equal(parseConfigCache("nope"), null);
    assert.equal(parseConfigCache(""), null);
    assert.equal(
      parseConfigCache(JSON.stringify({ version: 0, config: minimalConfig() })),
      null,
    );
    assert.equal(
      parseConfigCache(JSON.stringify({ version: BOOT_CACHE_VERSION, config: { limits: {} } })),
      null,
    );
  });
});
