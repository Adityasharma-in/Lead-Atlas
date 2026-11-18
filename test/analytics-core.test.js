import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANALYTICS_DAYS,
  buildOutreachAnalytics,
  isThisMonth,
  localDayKey,
  localMonthKey,
} from "../public/analytics-core.js";

// Local-time constructors keep these tests independent of the machine's
// timezone: the dashboard groups by the operator's calendar, not UTC.
const NOW = new Date(2026, 10, 13, 15, 30);
const TODAY = (hour = 10) => new Date(2026, 10, 13, hour, 0).toISOString();
const YESTERDAY = (hour = 10) => new Date(2026, 10, 12, hour, 0).toISOString();
const DAY = (day, hour = 10) => new Date(2026, 10, day, hour, 0).toISOString();

describe("localDayKey and localMonthKey", () => {
  it("uses local calendar parts", () => {
    assert.equal(localDayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
    assert.equal(localMonthKey(new Date(2026, 0, 5, 23, 59)), "2026-01");
    assert.equal(localDayKey("2026-11-13T10:00:00.000Z"), "2026-11-13");
  });

  it("returns an empty key for missing or invalid dates", () => {
    assert.equal(localDayKey(null), "");
    assert.equal(localDayKey(""), "");
    assert.equal(localDayKey("not a date"), "");
    assert.equal(localMonthKey(undefined), "");
  });
});

describe("buildOutreachAnalytics", () => {
  it("counts today's reached clients and compares with yesterday", () => {
    const analytics = buildOutreachAnalytics({
      now: NOW,
      account: "  Aditya  ",
      leads: [
        { created_at: DAY(1), contacted_at: TODAY(9), outreach_status: "contacted" },
        { created_at: DAY(2), contacted_at: TODAY(11), outreach_status: "contacted" },
        { created_at: DAY(3), contacted_at: YESTERDAY(), outreach_status: "contacted" },
        { created_at: DAY(4), outreach_status: "contacted" },
        { created_at: TODAY(8), outreach_status: "to-contact" },
      ],
    });

    assert.equal(analytics.account, "Aditya");
    assert.equal(analytics.today.reached, 2);
    assert.equal(analytics.today.leads, 1);
    assert.equal(analytics.yesterday.reached, 1);
    assert.equal(analytics.delta, 1);
    assert.equal(analytics.maxReached, 2);
    assert.equal(analytics.best.key, "2026-11-13");
    assert.equal(analytics.today.isToday, true);
    assert.equal(analytics.lifetime.leads, 5);
    assert.equal(analytics.lifetime.reached, 4);
    assert.equal(analytics.lifetime.toContact, 1);
    assert.equal(analytics.lifetime.doNotContact, 0);
    assert.equal(analytics.generatedAt, NOW.toISOString());
  });

  it("builds a complete day series ending today", () => {
    const analytics = buildOutreachAnalytics({ now: NOW });

    assert.equal(analytics.days.length, ANALYTICS_DAYS);
    assert.equal(analytics.days[0].key, "2026-10-31");
    assert.equal(analytics.days[analytics.days.length - 1].key, "2026-11-13");
    assert.equal(analytics.days[analytics.days.length - 1].isToday, true);
    assert.equal(analytics.today.label, "Nov 13");
    assert.equal(analytics.today.weekday, "Fri");
    assert.ok(analytics.days.every((bucket) => bucket.reached === 0));
    assert.equal(analytics.maxReached, 1);
  });

  it("places created leads and reports in their day buckets", () => {
    const analytics = buildOutreachAnalytics({
      now: NOW,
      reports: [
        { id: "r1", source: "scan", created_at: DAY(12) },
        { id: "r2", source: "import", created_at: DAY(12) },
      ],
      leads: [
        { created_at: DAY(12), outreach_status: "to-contact" },
        { created_at: DAY(12), contacted_at: DAY(12), outreach_status: "contacted" },
      ],
    });
    const bucket = analytics.days.find((entry) => entry.key === "2026-11-12");

    assert.equal(bucket.leads, 2);
    assert.equal(bucket.reached, 1);
    assert.equal(bucket.scans, 1);
    assert.equal(bucket.imports, 1);
  });

  it("splits the month by account source and contact state", () => {
    const analytics = buildOutreachAnalytics({
      now: NOW,
      reports: [
        { id: "r1", source: "scan", created_at: DAY(2) },
        { id: "r2", source: "import", created_at: DAY(5) },
        { id: "old", source: "scan", created_at: new Date(2026, 9, 5, 10).toISOString() },
      ],
      leads: [
        {
          report_id: "r1",
          created_at: DAY(1),
          contacted_at: DAY(3),
          outreach_status: "contacted",
        },
        { report_id: "r2", created_at: DAY(4), outreach_status: "do-not-contact" },
        { report_id: "r2", created_at: DAY(4), outreach_status: "to-contact" },
        {
          report_id: null,
          created_at: DAY(6),
          contacted_at: DAY(10),
          outreach_status: "contacted",
        },
        {
          report_id: "missing-report",
          created_at: new Date(2026, 9, 20, 10).toISOString(),
          contacted_at: DAY(9),
          outreach_status: "contacted",
        },
      ],
    });

    assert.equal(analytics.month.key, "2026-11");
    assert.equal(analytics.month.leads, 4);
    assert.equal(analytics.month.reached, 3);
    assert.equal(analytics.month.scans, 1);
    assert.equal(analytics.month.imports, 1);

    assert.deepEqual(analytics.month.bySource.scan, {
      leads: 1,
      reached: 1,
      reports: 1,
      toContact: 0,
      doNotContact: 0,
    });
    assert.deepEqual(analytics.month.bySource.import, {
      leads: 2,
      reached: 0,
      reports: 1,
      toContact: 1,
      doNotContact: 1,
    });
    assert.deepEqual(analytics.month.bySource.unknown, {
      leads: 1,
      reached: 2,
      reports: 0,
      toContact: 0,
      doNotContact: 0,
    });

    assert.equal(analytics.lifetime.leads, 5);
    assert.equal(analytics.lifetime.reached, 3);
    assert.equal(analytics.lifetime.toContact, 1);
    assert.equal(analytics.lifetime.doNotContact, 1);
  });

  it("counts a contacted status without a timestamp in lifetime, not day stats", () => {
    const analytics = buildOutreachAnalytics({
      now: NOW,
      leads: [{ created_at: DAY(1), outreach_status: "Reached out" }],
    });

    assert.equal(analytics.today.reached, 0);
    assert.equal(analytics.month.reached, 0);
    assert.equal(analytics.lifetime.reached, 1);
  });

  it("ignores invalid dates but still counts the lead", () => {
    const analytics = buildOutreachAnalytics({
      now: NOW,
      leads: [
        { created_at: "garbage", contacted_at: "also garbage", outreach_status: "to-contact" },
        { created_at: null, contacted_at: null, outreach_status: "to-contact" },
      ],
    });

    assert.equal(analytics.lifetime.leads, 2);
    assert.equal(analytics.lifetime.toContact, 2);
    assert.equal(analytics.month.leads, 0);
    assert.equal(analytics.today.leads, 0);
  });

  it("treats a report with an unknown source as unknown", () => {
    const analytics = buildOutreachAnalytics({
      now: NOW,
      reports: [{ id: "r1", source: "manual", created_at: DAY(2) }],
      leads: [{ report_id: "r1", created_at: DAY(2), outreach_status: "to-contact" }],
    });

    assert.equal(analytics.month.bySource.unknown.leads, 1);
    assert.equal(analytics.month.bySource.unknown.reports, 0);
  });

  it("honours a custom window and clamps unsafe values", () => {
    assert.equal(buildOutreachAnalytics({ now: NOW, days: 3 }).days.length, 3);
    assert.equal(buildOutreachAnalytics({ now: NOW, days: "7" }).days.length, 7);
    assert.equal(buildOutreachAnalytics({ now: NOW, days: 0 }).days.length, ANALYTICS_DAYS);
    assert.equal(buildOutreachAnalytics({ now: NOW, days: -5 }).days.length, 1);
    assert.equal(buildOutreachAnalytics({ now: NOW, days: 500 }).days.length, 60);
  });

  it("handles empty input safely", () => {
    const analytics = buildOutreachAnalytics({ now: NOW });

    assert.equal(analytics.today.reached, 0);
    assert.equal(analytics.delta, 0);
    assert.equal(analytics.month.leads, 0);
    assert.equal(analytics.month.reached, 0);
    assert.equal(analytics.lifetime.leads, 0);
    assert.equal(analytics.account, "");
  });
});

describe("isThisMonth", () => {
  it("compares local calendar months", () => {
    assert.equal(isThisMonth(DAY(1), NOW), true);
    assert.equal(isThisMonth(new Date(2026, 9, 31, 23, 59).toISOString(), NOW), false);
    assert.equal(isThisMonth("not a date", NOW), false);
  });
});
