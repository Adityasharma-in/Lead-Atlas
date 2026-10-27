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

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
