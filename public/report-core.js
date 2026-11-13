/**
 * Report filter, sort and pagination engine.
 *
 * Pure functions only. The browser calls these for every table render so the
 * UI cannot drift from the tested behavior. Lead numbers come from
 * lead-identity-core and never from the filtered row position.
 */

import {
  normalizeOutreachStatus,
  outreachStatusLabel,
} from "./outreach-core.js";

export const REPORT_FILTER_DEFAULTS = Object.freeze({
  q: "",
  website: "all",
  contact: "all",
  outreach: "all",
  rating: "all",
  reviews: "all",
  sort: "rating",
  page: 1,
});

export const REPORT_SORTS = Object.freeze([
  { value: "rating", label: "Best rated" },
  { value: "rating-asc", label: "Lowest rated" },
  { value: "reviews", label: "Most reviewed" },
  { value: "name", label: "Name A–Z" },
  { value: "contacted", label: "Last contacted" },
]);

export const REPORT_CONTACT_FILTERS = Object.freeze([
  { value: "all", label: "Any" },
  { value: "reachable", label: "Phone or email" },
  { value: "phone", label: "Has phone" },
  { value: "email", label: "Has email" },
  { value: "none", label: "No contact" },
]);

export const REPORT_REVIEW_FILTERS = Object.freeze([
  { value: "all", label: "Any" },
  { value: "10", label: "10+" },
  { value: "50", label: "50+" },
  { value: "100", label: "100+" },
  { value: "250", label: "250+" },
  { value: "500", label: "500+" },
]);

const SORT_VALUES = new Set(REPORT_SORTS.map((sort) => sort.value));
const WEBSITE_VALUES = new Set(["all", "with", "without"]);
const CONTACT_VALUES = new Set(REPORT_CONTACT_FILTERS.map((filter) => filter.value));
const OUTREACH_VALUES = new Set([
  "all",
  "to-contact",
  "contacted",
  "do-not-contact",
]);
const RATING_VALUES = new Set(["all", "4.5", "4", "3"]);
const REVIEW_VALUES = new Set(REPORT_REVIEW_FILTERS.map((filter) => filter.value));

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "en", {
    sensitivity: "base",
    numeric: true,
  });
}

function compareIndex(a, b) {
  const indexA = numeric(a?.index) ?? Number.MAX_SAFE_INTEGER;
  const indexB = numeric(b?.index) ?? Number.MAX_SAFE_INTEGER;
  return indexA - indexB || compareText(a?.id, b?.id);
}

function hasPhone(lead) {
  return array(lead?.phones).some((value) => String(value || "").trim()) || Boolean(lead?.phone);
}

function hasEmail(lead) {
  return array(lead?.emails).some((value) => String(value || "").trim());
}

function hasContact(lead) {
  return hasPhone(lead) || hasEmail(lead);
}

function ratingOf(lead) {
  const value = numeric(lead?.rating);
  return value === null ? null : Math.min(5, Math.max(0, value));
}

function reviewsOf(lead) {
  return Math.max(0, Math.round(numeric(lead?.reviewsCount) ?? 0));
}

function contactedStamp(lead) {
  if (!lead?.contactedAt) return 0;
  const stamp = Date.parse(lead.contactedAt);
  return Number.isFinite(stamp) ? stamp : 0;
}

/** Normalize unknown filter input into the one supported shape. */
export function normalizeReportFilters(filters = {}) {
  const input = filters && typeof filters === "object" ? filters : {};
  const page = Math.max(1, Math.floor(numeric(input.page) ?? 1));
  return {
    q: text(input.q),
    website: WEBSITE_VALUES.has(input.website) ? input.website : "all",
    contact: CONTACT_VALUES.has(input.contact) ? input.contact : "all",
    outreach: OUTREACH_VALUES.has(input.outreach) ? input.outreach : "all",
    rating: RATING_VALUES.has(String(input.rating)) ? String(input.rating) : "all",
    reviews: REVIEW_VALUES.has(String(input.reviews)) ? String(input.reviews) : "all",
    sort: SORT_VALUES.has(input.sort) ? input.sort : REPORT_FILTER_DEFAULTS.sort,
    page,
  };
}

export function hasActiveFilters(filters = {}) {
  const value = normalizeReportFilters(filters);
  return Boolean(
    value.q ||
      value.website !== "all" ||
      value.contact !== "all" ||
      value.outreach !== "all" ||
      value.rating !== "all" ||
      value.reviews !== "all" ||
      value.sort !== REPORT_FILTER_DEFAULTS.sort,
  );
}

/** Search across every human-useful field, including identity and notes. */
export function leadSearchText(lead = {}) {
  return [
    lead.name,
    lead.category,
    ...array(lead.categories),
    lead.address,
    lead.city,
    lead.state,
    lead.postalCode,
    lead.countryCode,
    lead.domain,
    lead.website,
    lead.placeId,
    lead.priceLevel,
    ...array(lead.phones),
    lead.phone,
    ...array(lead.emails),
    ...array(lead.socials).flatMap((social) => [social?.label, social?.network, social?.handle]),
    lead.outreachNote,
    outreachStatusLabel(lead.outreachStatus),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function leadMatchesFilters(lead, filters) {
  if (!lead) return false;
  const value = normalizeReportFilters(filters);

  if (value.website === "with" && !lead.hasWebsite && !lead.website) return false;
  if (value.website === "without" && (lead.hasWebsite || lead.website)) return false;

  if (value.contact === "phone" && !hasPhone(lead)) return false;
  if (value.contact === "email" && !hasEmail(lead)) return false;
  if (value.contact === "reachable" && !hasContact(lead)) return false;
  if (value.contact === "none" && hasContact(lead)) return false;

  const status = normalizeOutreachStatus(lead.outreachStatus) || "to-contact";
  if (value.outreach !== "all" && status !== value.outreach) return false;

  if (value.rating !== "all") {
    const floor = Number(value.rating);
    const rating = ratingOf(lead);
    if (rating === null || rating < floor) return false;
  }

  if (value.reviews !== "all") {
    const floor = Number(value.reviews);
    if (reviewsOf(lead) < floor) return false;
  }

  const query = value.q.toLowerCase();
  if (query) {
    const haystack = leadSearchText(lead);
    for (const token of query.split(/\s+/).filter(Boolean)) {
      if (!haystack.includes(token)) return false;
    }
  }

  return true;
}

export function compareLeads(a, b, sort) {
  const direction = sort === "rating-asc" ? 1 : -1;
  const ratingA = ratingOf(a);
  const ratingB = ratingOf(b);
  const reviewsA = reviewsOf(a);
  const reviewsB = reviewsOf(b);

  if (sort === "rating" || sort === "rating-asc") {
    // Unrated rows are always last, whichever direction is selected.
    const missingA = ratingA === null ? 1 : 0;
    const missingB = ratingB === null ? 1 : 0;
    return (
      missingA - missingB ||
      direction * ((ratingA ?? 0) - (ratingB ?? 0)) ||
      reviewsB - reviewsA ||
      compareText(a?.name, b?.name) ||
      compareIndex(a, b)
    );
  }

  if (sort === "reviews") {
    return (
      reviewsB - reviewsA ||
      (ratingB ?? -1) - (ratingA ?? -1) ||
      compareText(a?.name, b?.name) ||
      compareIndex(a, b)
    );
  }

  if (sort === "name") {
    return (
      compareText(a?.name, b?.name) ||
      (ratingB ?? -1) - (ratingA ?? -1) ||
      compareIndex(a, b)
    );
  }

  if (sort === "contacted") {
    return (
      contactedStamp(b) - contactedStamp(a) ||
      (ratingB ?? -1) - (ratingA ?? -1) ||
      compareText(a?.name, b?.name) ||
      compareIndex(a, b)
    );
  }

  // Unknown sort values fall back to the documented default, never to DOM or
  // array order.
  return compareLeads(a, b, REPORT_FILTER_DEFAULTS.sort);
}

export function filterReportLeads(leads = [], filters = {}) {
  const value = normalizeReportFilters(filters);
  return array(leads).filter((lead) => leadMatchesFilters(lead, value)).sort((a, b) => compareLeads(a, b, value.sort));
}

/**
 * One call for the whole table: filter, sort, clamp the page and return only
 * the visible slice. `start`/`end` are zero-based/one-past for labels.
 */
export function paginateReportLeads(leads = [], filters = {}, pageSize = 12) {
  const value = normalizeReportFilters(filters);
  const size = Math.max(1, Math.floor(numeric(pageSize) ?? 12));
  const filtered = filterReportLeads(leads, value);
  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(value.page, totalPages);
  const start = (page - 1) * size;
  const end = Math.min(start + size, filtered.length);
  return {
    filtered,
    page,
    totalPages,
    pageSize: size,
    start,
    end,
    pageLeads: filtered.slice(start, end),
  };
}
