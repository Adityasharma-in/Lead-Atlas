import { LIMITS, MIN_STARS, PRICING } from './config.js';
import { ApiError } from './errors.js';

const WEBSITE_FILTERS = new Set(['allPlaces', 'withWebsite', 'withoutWebsite']);
const WEBSITE_ALIASES = {
  all: 'allPlaces',
  allplaces: 'allPlaces',
  with: 'withWebsite',
  withwebsite: 'withWebsite',
  without: 'withoutWebsite',
  withoutwebsite: 'withoutWebsite',
};

const STAR_ALIASES = {
  '2': 'two',
  '2.0': 'two',
  '2.5': 'twoAndHalf',
  '2andhalf': 'twoAndHalf',
  '3': 'three',
  '3.0': 'three',
  '3.5': 'threeAndHalf',
  '3andhalf': 'threeAndHalf',
  '4': 'four',
  '4.0': 'four',
  '4.5': 'fourAndHalf',
  '4andhalf': 'fourAndHalf',
};

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);

export function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function parseBoolean(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'off', 'no'].includes(normalized)) return false;
  }
  throw new ApiError(400, 'VALIDATION_ERROR', `${label} must be true or false.`);
}

function parseMaxResults(value) {
  if (value === undefined || value === null || value === '') return LIMITS.defaultResults;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < LIMITS.minResults || number > LIMITS.maxResults) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `Results per scan must be a whole number from ${LIMITS.minResults} to ${LIMITS.maxResults}.`,
    );
  }
  return number;
}

function parseWebsiteFilter(value) {
  if (value === undefined || value === null || value === '') return 'allPlaces';
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Website filter must be a string.');
  }
  const cleaned = value.trim();
  if (WEBSITE_FILTERS.has(cleaned)) return cleaned;
  const alias = WEBSITE_ALIASES[cleaned.toLowerCase().replace(/[\s_-]/g, '')];
  if (alias) return alias;
  throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid website filter.');
}

function parseMinStars(value) {
  if (value === undefined || value === null || value === '' || value === 'all') return '';
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Minimum rating must be a string.');
  }
  const cleaned = value.trim();
  if (Object.prototype.hasOwnProperty.call(MIN_STARS, cleaned)) return cleaned;
  const alias = STAR_ALIASES[cleaned.toLowerCase().replace(/\s+/g, '')];
  if (alias) return alias;
  throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid minimum rating.');
}

export function normalizeScanRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Send a JSON object with your scan settings.');
  }

  const niche = sanitizeText(input.niche, LIMITS.maxNicheLength);
  const location = sanitizeText(input.location, LIMITS.maxLocationLength);

  if (niche.length < 2) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Enter a business type or niche (at least 2 characters).',
    );
  }
  if (location.length < 2) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Enter a location, such as a city, region, or country.',
    );
  }

  const websiteFilter = parseWebsiteFilter(input.websiteFilter);
  const contactsRequested = parseBoolean(input.includeContacts, true, 'Contact enrichment');
  const includeContacts = websiteFilter === 'withoutWebsite' ? false : contactsRequested;

  return {
    niche,
    location,
    websiteFilter,
    includeContacts,
    contactsSuppressed: contactsRequested && !includeContacts,
    maxResults: parseMaxResults(input.maxResults),
    minStars: parseMinStars(input.minStars),
    skipClosed: parseBoolean(input.skipClosed, true, 'Skip closed places'),
  };
}

export function buildActorInput(query) {
  return {
    searchStringsArray: [query.niche],
    locationQuery: query.location,
    maxCrawledPlacesPerSearch: query.maxResults,
    language: 'en',
    website: query.websiteFilter,
    placeMinimumStars: query.minStars,
    searchMatching: 'all',
    skipClosedPlaces: query.skipClosed,
    scrapePlaceDetailPage: true,
    scrapeContacts: query.includeContacts,
    // Separate paid add-on for employee-level leads. Keep at 0; website-based
    // company contacts are controlled by scrapeContacts above.
    maximumLeadsEnrichmentRecords: 0,
    maxReviews: 0,
    maxImages: 0,
  };
}

export function estimateRunCost(query) {
  const filtersApplied =
    (query.websiteFilter !== 'allPlaces' ? 1 : 0) +
    (query.skipClosed ? 1 : 0) +
    (query.minStars ? 1 : 0);

  const perPlaceUsd =
    PRICING.place +
    PRICING.placeDetails +
    (query.includeContacts ? PRICING.contacts : 0) +
    filtersApplied * PRICING.filter;

  const estimateUsd =
    Math.round((query.maxResults * perPlaceUsd + PRICING.start) * 10000) / 10000;
  const safetyCapUsd = Math.max(
    PRICING.minimumRunCharge,
    Math.ceil(estimateUsd * 1.5 * 100) / 100,
  );

  return {
    perPlaceUsd: Math.round(perPlaceUsd * 10000) / 10000,
    estimateUsd,
    safetyCapUsd: Math.round(safetyCapUsd * 100) / 100,
    filtersApplied,
    currency: 'USD',
    basis: 'Apify FREE-tier rates; paid plans are cheaper',
  };
}

export function createRunPlan(input) {
  const query = normalizeScanRequest(input);
  const notices = [];
  if (query.contactsSuppressed) {
    notices.push(
      'Contact enrichment was turned off because the scan is limited to places without a website.',
    );
  }
  if (query.maxResults >= 250) {
    notices.push('Large scans can take several minutes and use more Apify credits.');
  }

  return {
    query,
    actorInput: buildActorInput(query),
    cost: estimateRunCost(query),
    notices,
  };
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export function validateRunId(runId) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9]{8,40}$/.test(runId)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'That run ID is not valid.');
  }
  return runId;
}

export function validateDatasetId(datasetId) {
  if (typeof datasetId !== 'string' || !/^[A-Za-z0-9]{8,40}$/.test(datasetId)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'That dataset ID is not valid.');
  }
  return datasetId;
}
