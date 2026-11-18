export const ACTOR = {
  slug: 'compass/crawler-google-places',
  apiId: 'compass~crawler-google-places',
  name: 'Google Maps Scraper',
  url: 'https://apify.com/compass/crawler-google-places',
  docsUrl: 'https://apify.com/compass/crawler-google-places/api',
  consoleRunUrl: (runId) => `https://console.apify.com/actors/runs/${runId}`,
};

export const LIMITS = {
  minResults: 1,
  maxResults: 500,
  defaultResults: 40,
  maxNicheLength: 120,
  maxLocationLength: 160,
  runTimeoutSecs: 3600,
  maxTotalItems: 2000,
  defaultMinReviews: 10,
};

export const MIN_STARS = {
  '': 'Any rating',
  two: '2+ stars',
  twoAndHalf: '2.5+ stars',
  three: '3+ stars',
  threeAndHalf: '3.5+ stars',
  four: '4+ stars',
  fourAndHalf: '4.5+ stars',
};

// Apify's actor exposes placeMinimumStars but not a review-count minimum, so
// this gate is enforced after the dataset is normalized. Defaults to 10 to
// drop the 0-review / 5-review fluff without hiding established businesses.
export const MIN_REVIEWS = {
  '': 'Any reviews',
  '10': '10+ reviews',
  '25': '25+ reviews',
  '50': '50+ reviews',
  '100': '100+ reviews',
  '250': '250+ reviews',
  '500': '500+ reviews',
};

// Apify's public FREE-tier pay-per-event rates for this Actor, in USD.
// Paid plans are cheaper. These are estimates only; Apify bills the key owner.
export const PRICING = {
  place: 0.004,
  placeDetails: 0.002,
  contacts: 0.002,
  filter: 0.001,
  start: 0.007,
  minimumRunCharge: 0.5,
};

export const BROWSER_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function buildContentSecurityPolicy(extraConnectSources = []) {
  const connectSources = ["'self'", ...extraConnectSources.filter(Boolean)];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src ${[...new Set(connectSources)].join(' ')}`,
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy();
