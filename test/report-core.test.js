import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REPORT_FILTER_DEFAULTS,
  REPORT_SORTS,
  compareLeads,
  filterReportLeads,
  hasActiveFilters,
  leadMatchesFilters,
  leadSearchText,
  normalizeReportFilters,
  paginateReportLeads,
} from "../public/report-core.js";

function lead(overrides = {}) {
  return {
    id: "lead-1",
    index: 1,
    name: "Acme",
    rating: 4.5,
    reviewsCount: 100,
    website: "https://acme.example/",
    hasWebsite: true,
    phones: ["5125550100"],
    emails: [],
    outreachStatus: "to-contact",
    ...overrides,
  };
}

describe("normalizeReportFilters", () => {
  it("returns documented defaults for empty input", () => {
    assert.deepEqual(normalizeReportFilters(), REPORT_FILTER_DEFAULTS);
    assert.deepEqual(normalizeReportFilters(null), REPORT_FILTER_DEFAULTS);
  });

  it("keeps every supported filter value", () => {
    const filters = normalizeReportFilters({
      q: "  acme  ",
      website: "without",
      contact: "phone",
      outreach: "contacted",
      rating: "4",
      reviews: "50",
      sort: "name",
      page: "2",
    });

    assert.deepEqual(filters, {
      q: "acme",
      website: "without",
      contact: "phone",
      outreach: "contacted",
      rating: "4",
      reviews: "50",
      sort: "name",
      page: 2,
    });
  });

  it("replaces unknown values with safe defaults", () => {
    const filters = normalizeReportFilters({
      website: "maybe",
      contact: "carrier-pigeon",
      outreach: "ghosted",
      rating: "seven",
      reviews: "lots",
      sort: "random",
      page: "many",
    });

    assert.deepEqual(filters, REPORT_FILTER_DEFAULTS);
  });

  it("clamps the page to a positive whole number", () => {
    assert.equal(normalizeReportFilters({ page: 0 }).page, 1);
    assert.equal(normalizeReportFilters({ page: -4 }).page, 1);
    assert.equal(normalizeReportFilters({ page: 3.9 }).page, 3);
    assert.equal(normalizeReportFilters({ page: "5" }).page, 5);
  });

  it("only exposes the five useful sort options", () => {
    assert.deepEqual(
      REPORT_SORTS.map((sort) => sort.value),
      ["rating", "rating-asc", "reviews", "name", "contacted"],
    );
  });
});

describe("hasActiveFilters", () => {
  it("ignores the default view and page number", () => {
    assert.equal(hasActiveFilters(), false);
    assert.equal(hasActiveFilters({ page: 4 }), false);
  });

  it("detects search, filters and non-default sorts", () => {
    assert.equal(hasActiveFilters({ q: "acme" }), true);
    assert.equal(hasActiveFilters({ website: "with" }), true);
    assert.equal(hasActiveFilters({ contact: "none" }), true);
    assert.equal(hasActiveFilters({ outreach: "contacted" }), true);
    assert.equal(hasActiveFilters({ rating: "4.5" }), true);
    assert.equal(hasActiveFilters({ reviews: "10" }), true);
    assert.equal(hasActiveFilters({ sort: "name" }), true);
  });
});

describe("leadSearchText", () => {
  it("covers identity, location, contacts, socials and notes", () => {
    const haystack = leadSearchText(
      lead({
        name: "Acme Plumbing",
        category: "Plumber",
        categories: ["Emergency service"],
        address: "1 Main St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        domain: "acme.example",
        placeId: "ChIJ123",
        phones: ["5125550100"],
        emails: ["hello@acme.example"],
        socials: [{ network: "instagram", label: "Instagram", handle: "acme" }],
        outreachNote: "Call Tuesday",
        outreachStatus: "contacted",
      }),
    );

    for (const token of [
      "acme plumbing",
      "plumber",
      "emergency service",
      "1 main st",
      "austin",
      "tx",
      "78701",
      "acme.example",
      "chij123",
      "5125550100",
      "hello@acme.example",
      "instagram",
      "call tuesday",
      "reached out",
    ]) {
      assert.ok(haystack.includes(token), `missing "${token}"`);
    }
  });
});

describe("leadMatchesFilters", () => {
  it("filters on website presence", () => {
    assert.equal(leadMatchesFilters(lead(), { website: "with" }), true);
    assert.equal(leadMatchesFilters(lead(), { website: "without" }), false);
    assert.equal(leadMatchesFilters(lead({ website: null, hasWebsite: false }), { website: "without" }), true);
    assert.equal(leadMatchesFilters(lead({ website: "https://x.example", hasWebsite: false }), { website: "with" }), true);
  });

  it("filters on phone, email, reachability and no contact", () => {
    assert.equal(leadMatchesFilters(lead(), { contact: "phone" }), true);
    assert.equal(leadMatchesFilters(lead(), { contact: "email" }), false);
    assert.equal(leadMatchesFilters(lead({ emails: ["hi@acme.example"] }), { contact: "email" }), true);
    assert.equal(leadMatchesFilters(lead(), { contact: "reachable" }), true);

    const cold = lead({ phones: [], phone: null, emails: [] });
    assert.equal(leadMatchesFilters(cold, { contact: "none" }), true);
    assert.equal(leadMatchesFilters(cold, { contact: "reachable" }), false);
  });

  it("treats a missing outreach status as to-contact", () => {
    assert.equal(leadMatchesFilters(lead({ outreachStatus: null }), { outreach: "to-contact" }), true);
    assert.equal(leadMatchesFilters(lead({ outreachStatus: "Reached out" }), { outreach: "contacted" }), true);
    assert.equal(leadMatchesFilters(lead({ outreachStatus: "Do not contact" }), { outreach: "do-not-contact" }), true);
    assert.equal(leadMatchesFilters(lead({ outreachStatus: "contacted" }), { outreach: "to-contact" }), false);
  });

  it("applies rating floors and excludes unrated leads from a floor", () => {
    assert.equal(leadMatchesFilters(lead({ rating: 4.5 }), { rating: "4.5" }), true);
    assert.equal(leadMatchesFilters(lead({ rating: 4.4 }), { rating: "4.5" }), false);
    assert.equal(leadMatchesFilters(lead({ rating: null }), { rating: "3" }), false);
    assert.equal(leadMatchesFilters(lead({ rating: 0 }), { rating: "all" }), true);
  });

  it("applies review floors and treats a missing count as zero", () => {
    assert.equal(leadMatchesFilters(lead({ reviewsCount: 50 }), { reviews: "50" }), true);
    assert.equal(leadMatchesFilters(lead({ reviewsCount: 40 }), { reviews: "50" }), false);
    assert.equal(leadMatchesFilters(lead({ reviewsCount: null }), { reviews: "10" }), false);
    assert.equal(leadMatchesFilters(lead({ reviewsCount: "1,234" }), { reviews: "250" }), false);
  });

  it("requires every search token to match", () => {
    assert.equal(leadMatchesFilters(lead(), { q: "acme 5125550100" }), true);
    assert.equal(leadMatchesFilters(lead(), { q: "acme nowhere" }), false);
    assert.equal(leadMatchesFilters(lead(), { q: "ACME" }), true);
  });

  it("rejects null leads", () => {
    assert.equal(leadMatchesFilters(null, {}), false);
  });
});

describe("compareLeads", () => {
  it("sorts best rated first and keeps unrated rows last", () => {
    const rows = [
      lead({ id: "unrated", name: "Zed", rating: null, reviewsCount: 900 }),
      lead({ id: "ok", name: "Beta", rating: 4.1, reviewsCount: 10 }),
      lead({ id: "best", name: "Alpha", rating: 4.9, reviewsCount: 20 }),
    ].sort((a, b) => compareLeads(a, b, "rating"));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["best", "ok", "unrated"],
    );
  });

  it("sorts lowest rated first and still keeps unrated rows last", () => {
    const rows = [
      lead({ id: "best", rating: 4.9 }),
      lead({ id: "unrated", rating: null }),
      lead({ id: "low", rating: 3.1 }),
    ].sort((a, b) => compareLeads(a, b, "rating-asc"));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["low", "best", "unrated"],
    );
  });

  it("breaks rating ties with review volume, then name, then index", () => {
    const rows = [
      lead({ id: "c", name: "Charlie", rating: 4.5, reviewsCount: 10, index: 3 }),
      lead({ id: "b", name: "Bravo", rating: 4.5, reviewsCount: 90, index: 2 }),
      lead({ id: "a", name: "Alpha", rating: 4.5, reviewsCount: 90, index: 5 }),
      lead({ id: "d", name: "Delta", rating: 4.5, reviewsCount: 90, index: 1 }),
    ].sort((a, b) => compareLeads(a, b, "rating"));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["a", "b", "d", "c"],
    );
  });

  it("sorts most reviewed first with a rating tie-break", () => {
    const rows = [
      lead({ id: "few", reviewsCount: 10, rating: 5 }),
      lead({ id: "many-low", reviewsCount: 500, rating: 3.9 }),
      lead({ id: "many-high", reviewsCount: 500, rating: 4.8 }),
    ].sort((a, b) => compareLeads(a, b, "reviews"));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["many-high", "many-low", "few"],
    );
  });

  it("sorts names naturally and case-insensitively", () => {
    const rows = [
      lead({ id: "10", name: "Cafe 10" }),
      lead({ id: "2", name: "cafe 2" }),
      lead({ id: "b", name: "Baker" }),
    ].sort((a, b) => compareLeads(a, b, "name"));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["b", "2", "10"],
    );
  });

  it("sorts last contacted first and puts never-contacted rows last", () => {
    const rows = [
      lead({ id: "never", contactedAt: null }),
      lead({ id: "older", contactedAt: "2026-11-01T10:00:00.000Z" }),
      lead({ id: "newer", contactedAt: "2026-11-10T10:00:00.000Z" }),
      lead({ id: "junk", contactedAt: "not a date" }),
    ].sort((a, b) => compareLeads(a, b, "contacted"));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["newer", "older", "junk", "never"],
    );
  });

  it("falls back to the default sort for unknown values", () => {
    const rows = [
      lead({ id: "low", rating: 3 }),
      lead({ id: "high", rating: 5 }),
    ].sort((a, b) => compareLeads(a, b, "made-up"));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["high", "low"],
    );
  });
});

describe("filterReportLeads", () => {
  it("filters, then sorts the survivors", () => {
    const rows = [
      lead({ id: "a", name: "Alpha", rating: 4.2 }),
      lead({ id: "b", name: "Bravo", rating: 4.8 }),
      lead({ id: "c", name: "Charlie", rating: 3.1 }),
    ];

    const result = filterReportLeads(rows, { rating: "4" });
    assert.deepEqual(
      result.map((row) => row.id),
      ["b", "a"],
    );
  });

  it("returns an empty array for empty or non-array input", () => {
    assert.deepEqual(filterReportLeads(null, {}), []);
    assert.deepEqual(filterReportLeads([], {}), []);
  });
});

describe("paginateReportLeads", () => {
  const rows = [
    lead({ id: "z", name: "Zulu", index: 1 }),
    lead({ id: "a", name: "Alpha", index: 2 }),
    lead({ id: "e", name: "Echo", index: 3 }),
    lead({ id: "b", name: "Bravo", index: 4 }),
    lead({ id: "d", name: "Delta", index: 5 }),
  ];

  it("returns the visible slice and page labels", () => {
    const page = paginateReportLeads(rows, { sort: "name", page: 2 }, 2);

    assert.equal(page.page, 2);
    assert.equal(page.totalPages, 3);
    assert.equal(page.start, 2);
    assert.equal(page.end, 4);
    assert.deepEqual(
      page.pageLeads.map((row) => row.id),
      ["d", "e"],
    );
    assert.equal(page.filtered.length, 5);
  });

  it("clamps a page beyond the end and an empty result to page one", () => {
    const beyond = paginateReportLeads(rows, { page: 99 }, 2);
    assert.equal(beyond.page, 3);
    assert.equal(beyond.start, 4);
    assert.equal(beyond.end, 5);

    const empty = paginateReportLeads(rows, { q: "no such business", page: 9 }, 2);
    assert.equal(empty.page, 1);
    assert.equal(empty.totalPages, 1);
    assert.equal(empty.start, 0);
    assert.equal(empty.end, 0);
    assert.deepEqual(empty.pageLeads, []);
  });

  it("never uses the page row position as the lead number", () => {
    const page = paginateReportLeads(rows, { sort: "name", page: 2 }, 2);

    assert.deepEqual(
      page.pageLeads.map((row) => [row.id, row.index]),
      [
        ["d", 5],
        ["e", 3],
      ],
    );
    // The stored number is untouched by filtering and paging.
    assert.equal(rows[0].index, 1);
  });

  it("uses a safe page size", () => {
    assert.equal(paginateReportLeads(rows, {}, 0).pageSize, 1);
    assert.equal(paginateReportLeads(rows, {}, -5).pageSize, 1);
    assert.equal(paginateReportLeads(rows, {}, "3").pageSize, 3);
    assert.equal(paginateReportLeads(rows, {}).pageSize, 12);
  });

  it("keeps ordering deterministic on every page", () => {
    const tied = Array.from({ length: 30 }, (_, index) =>
      lead({
        id: `tie-${index}`,
        name: "Same Name",
        rating: 4.5,
        reviewsCount: 100,
        index: 30 - index,
      }),
    );

    const first = paginateReportLeads(tied, { sort: "rating", page: 1 }, 10);
    const second = paginateReportLeads(tied, { sort: "rating", page: 2 }, 10);
    const combined = [...first.pageLeads, ...second.pageLeads];

    assert.deepEqual(
      combined.map((row) => row.index),
      tied
        .map((row) => row.index)
        .sort((a, b) => a - b)
        .slice(0, 20),
    );
  });
});
