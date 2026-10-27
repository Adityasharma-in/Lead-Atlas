import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

const TOKEN = 'apify_api_testtoken1234567890';
const BAD_TOKEN = 'apify_api_badtoken1234567890';
const RUN_ID = 'runMock12345';
const DATASET_ID = 'dsMock12345';

const RAW_ITEMS = [
  {
    title: 'Acme Plumbing',
    placeId: 'placeAcme1',
    categoryName: 'Plumber',
    address: '123 Main St, Austin, TX',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    countryCode: 'US',
    phone: '(512) 555-0100',
    phones: ['(512) 555-0100'],
    emails: ['hello@acme.example'],
    website: 'https://acme.example',
    totalScore: 4.6,
    reviewsCount: 120,
    instagrams: ['acmeplumbing'],
    location: { lat: 30.2672, lng: -97.7431 },
  },
  {
    title: 'Bright Electric',
    placeId: 'placeBright1',
    categoryName: 'Electrician',
    address: '9 Volt Way, Austin, TX',
    phone: '(512) 555-0200',
    website: null,
    totalScore: 4.2,
    reviewsCount: 44,
  },
  {
    title: 'Acme Plumbing',
    placeId: 'placeAcme1',
    phones: ['(512) 555-0111'],
    emails: ['office@acme.example'],
  },
];

const mockState = {
  runStatus: 'RUNNING',
  items: RAW_ITEMS,
  actorInput: null,
  startQuery: null,
  abortCalled: false,
  lastAuth: null,
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function createMockApify() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const auth = req.headers.authorization || null;
      mockState.lastAuth = auth;

      if (auth !== `Bearer ${TOKEN}`) {
        sendJson(res, 401, { error: { message: 'Authentication token is invalid' } });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/users/me') {
        sendJson(res, 200, {
          data: { id: 'userField1', username: 'field-tester', plan: { name: 'FREE' } },
        });
        return;
      }

      if (
        req.method === 'POST' &&
        url.pathname === '/acts/compass~crawler-google-places/runs'
      ) {
        mockState.actorInput = await readJsonBody(req);
        mockState.startQuery = Object.fromEntries(url.searchParams.entries());
        sendJson(res, 201, {
          data: {
            id: RUN_ID,
            status: 'READY',
            defaultDatasetId: DATASET_ID,
            createdAt: '2026-10-25T11:59:00.000Z',
          },
        });
        return;
      }

      const runMatch = url.pathname.match(/^\/actor-runs\/([^/]+)(\/abort)?$/);
      if (runMatch) {
        const runId = decodeURIComponent(runMatch[1]);
        if (runId !== RUN_ID) {
          sendJson(res, 404, { error: { message: 'Run not found' } });
          return;
        }
        if (runMatch[2] === '/abort' && req.method === 'POST') {
          mockState.abortCalled = true;
          mockState.runStatus = 'ABORTED';
          sendJson(res, 200, {
            data: { id: RUN_ID, status: 'ABORTED', defaultDatasetId: DATASET_ID },
          });
          return;
        }
        sendJson(res, 200, {
          data: {
            id: RUN_ID,
            status: mockState.runStatus,
            defaultDatasetId: DATASET_ID,
            createdAt: '2026-10-25T11:59:00.000Z',
            startedAt: '2026-10-25T11:59:02.000Z',
            finishedAt:
              mockState.runStatus === 'RUNNING' ? null : '2026-10-25T12:00:00.000Z',
            usageTotalUsd: 0.1234,
            statusMessage: null,
          },
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === `/datasets/${DATASET_ID}`) {
        sendJson(res, 200, { data: { id: DATASET_ID, itemCount: mockState.items.length } });
        return;
      }

      if (req.method === 'GET' && url.pathname === `/datasets/${DATASET_ID}/items`) {
        sendJson(res, 200, mockState.items);
        return;
      }

      sendJson(res, 404, { error: { message: 'Mock Apify route not found' } });
    } catch (error) {
      sendJson(res, 500, { error: { message: error.message } });
    }
  });
}

describe('Lead Atlas server', () => {
  let mockServer;
  let appServer;
  let baseUrl;

  async function request(path, { method = 'GET', token, body, rawBody, headers = {} } = {}) {
    const requestHeaders = { ...headers };
    if (token) requestHeaders['x-apify-token'] = token;
    if (body !== undefined || rawBody !== undefined) {
      requestHeaders['content-type'] = 'application/json';
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { response, status: response.status, headers: response.headers, text, json };
  }

  before(async () => {
    mockServer = createMockApify();
    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const { port } = mockServer.address();
    process.env.APIFY_API_BASE = `http://127.0.0.1:${port}`;

    const { createApp } = await import('../src/server.js');
    const app = createApp();
    appServer = await new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    baseUrl = `http://127.0.0.1:${appServer.address().port}`;
  });

  after(async () => {
    if (appServer) await new Promise((resolve) => appServer.close(resolve));
    if (mockServer) await new Promise((resolve) => mockServer.close(resolve));
  });

  it('serves health, config, and the static app with security headers', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');
    assert.equal(health.json.actor, 'compass/crawler-google-places');

    const config = await request('/api/config');
    assert.equal(config.status, 200);
    assert.equal(config.json.pricing.start, 0.007);
    assert.equal(config.json.pricing.currency, 'USD');
    assert.equal(config.json.limits.maxResults, 500);
    assert.equal(config.json.tokenHeader, 'x-apify-token');
    assert.ok(config.json.minStars.some((option) => option.value === 'fourAndHalf'));

    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('cache-control'), 'no-cache');
    assert.match(home.text, /Lead Atlas/);
  });

  it('requires an Apify token and validates its format', async () => {
    const missing = await request('/api/runs/runMock12345');
    assert.equal(missing.status, 401);
    assert.equal(missing.json.error.code, 'APIFY_KEY_REQUIRED');

    const short = await request('/api/key/validate', {
      method: 'POST',
      token: 'too-short',
    });
    assert.equal(short.status, 401);
    assert.equal(short.json.error.code, 'INVALID_APIFY_KEY_FORMAT');
  });

  it('rejects cross-origin POSTs', async () => {
    const blocked = await request('/api/key/validate', {
      method: 'POST',
      token: TOKEN,
      headers: { origin: 'http://evil.example' },
    });

    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.code, 'CROSS_ORIGIN_BLOCKED');
  });

  it('validates a key with Apify and surfaces rejected keys', async () => {
    const valid = await request('/api/key/validate', { method: 'POST', token: TOKEN });
    assert.equal(valid.status, 200);
    assert.equal(valid.json.valid, true);
    assert.equal(valid.json.username, 'field-tester');
    assert.equal(valid.json.plan, 'FREE');
    assert.equal(mockState.lastAuth, `Bearer ${TOKEN}`);

    const rejected = await request('/api/key/validate', { method: 'POST', token: BAD_TOKEN });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.json.error.code, 'INVALID_APIFY_KEY');
  });

  it('rejects malformed JSON and invalid briefs', async () => {
    const malformed = await request('/api/key/validate', {
      method: 'POST',
      token: TOKEN,
      rawBody: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.error.code, 'INVALID_JSON');

    const invalid = await request('/api/runs', {
      method: 'POST',
      token: TOKEN,
      body: { niche: 'p', location: 'Austin' },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error.code, 'VALIDATION_ERROR');
  });

  it('starts a run with the safety cap and full Actor input', async () => {
    const started = await request('/api/runs', {
      method: 'POST',
      token: TOKEN,
      body: {
        niche: 'plumbers',
        location: 'Austin, TX',
        maxResults: 40,
        websiteFilter: 'allPlaces',
        includeContacts: true,
        minStars: '',
        skipClosed: true,
      },
    });

    assert.equal(started.status, 201);
    assert.equal(started.json.run.runId, RUN_ID);
    assert.equal(started.json.run.datasetId, DATASET_ID);
    assert.equal(started.json.run.terminal, false);
    assert.equal(started.json.query.niche, 'plumbers');
    assert.equal(started.json.cost.estimateUsd, 0.367);
    assert.equal(started.json.cost.safetyCapUsd, 0.56);

    assert.equal(mockState.startQuery.build, 'latest');
    assert.equal(mockState.startQuery.timeout, '3600');
    assert.equal(mockState.startQuery.maxTotalChargeUsd, '0.56');
    assert.equal(mockState.lastAuth, `Bearer ${TOKEN}`);
    assert.equal(mockState.actorInput.searchStringsArray[0], 'plumbers');
    assert.equal(mockState.actorInput.locationQuery, 'Austin, TX');
    assert.equal(mockState.actorInput.maxCrawledPlacesPerSearch, 40);
    assert.equal(mockState.actorInput.website, 'allPlaces');
    assert.equal(mockState.actorInput.scrapePlaceDetailPage, true);
    assert.equal(mockState.actorInput.scrapeContacts, true);
    assert.equal(mockState.actorInput.maxReviews, 0);
    assert.equal(mockState.actorInput.maxImages, 0);
  });

  it('reports live status while a run is in progress', async () => {
    mockState.runStatus = 'RUNNING';
    const status = await request(`/api/runs/${RUN_ID}`, { token: TOKEN });

    assert.equal(status.status, 200);
    assert.equal(status.json.run.status, 'RUNNING');
    assert.equal(status.json.run.terminal, false);
    assert.equal(status.json.run.datasetId, DATASET_ID);
    assert.equal(status.json.run.itemCount, 3);
    assert.equal(status.json.run.usageUsd, 0.1234);
    assert.equal(status.json.run.cost.estimateUsd, 0.367);
    assert.equal(status.json.run.consoleUrl, `https://console.apify.com/actors/runs/${RUN_ID}`);
  });

  it('refuses results and exports until the run is terminal', async () => {
    const results = await request(`/api/runs/${RUN_ID}/results`, { token: TOKEN });
    assert.equal(results.status, 409);
    assert.equal(results.json.error.code, 'RUN_NOT_READY');

    const csv = await request(`/api/runs/${RUN_ID}/export/csv`, { token: TOKEN });
    assert.equal(csv.status, 409);
    assert.equal(csv.json.error.code, 'RUN_NOT_READY');
  });

  it('aborts a running run', async () => {
    const aborted = await request(`/api/runs/${RUN_ID}/abort`, {
      method: 'POST',
      token: TOKEN,
    });

    assert.equal(aborted.status, 200);
    assert.equal(aborted.json.alreadyFinished, false);
    assert.equal(aborted.json.run.status, 'ABORTED');
    assert.equal(mockState.abortCalled, true);
  });

  it('normalizes a finished dataset', async () => {
    mockState.runStatus = 'SUCCEEDED';
    const results = await request(
      `/api/runs/${RUN_ID}/results?niche=plumbers&location=Austin%2C%20TX`,
      { token: TOKEN },
    );

    assert.equal(results.status, 200);
    assert.equal(results.json.total, 2);
    assert.equal(results.json.datasetId, DATASET_ID);
    assert.equal(results.json.duplicateCount, 1);
    assert.equal(results.json.runStatus, 'SUCCEEDED');
    assert.equal(results.json.query.niche, 'plumbers');
    assert.equal(results.json.summary.withWebsite, 1);
    assert.equal(results.json.summary.withContact, 2);
    assert.equal(results.json.summary.avgRating, 4.4);
    assert.equal(results.json.cost.estimateUsd, 0.367);
    assert.deepEqual(results.json.notices, []);

    const acme = results.json.leads.find((lead) => lead.name === 'Acme Plumbing');
    assert.equal(acme.placeId, 'placeAcme1');
    assert.deepEqual(acme.phones, ['(512) 555-0100', '(512) 555-0111']);
    assert.deepEqual(acme.emails, ['hello@acme.example', 'office@acme.example']);
    assert.equal(acme.hasWebsite, true);
    assert.equal(acme.searchNiche, 'plumbers');
    assert.ok(acme.mapsUrl.startsWith('https://www.google.com/maps/search/'));
  });

  it('exports a safe CSV with the expected download filename', async () => {
    const response = await fetch(`${baseUrl}/api/runs/${RUN_ID}/export/csv`, {
      headers: { 'x-apify-token': TOKEN },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString('utf8');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/csv/);
    assert.match(
      response.headers.get('content-disposition'),
      /^attachment; filename="lead-atlas-plumbers-austin-tx-\d{4}-\d{2}-\d{2}-k12345\.csv"$/,
    );
    // UTF-8 BOM, so Excel opens the file as UTF-8.
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(text, /^\uFEFFBusiness name,Category,Primary phone/);
    assert.match(text, /Emails,Outreach status,Contacted at,Outreach note,Outreach updated at/);
    assert.match(text, /Acme Plumbing,Plumber/);
    assert.match(text, /https:\/\/www\.google\.com\/maps\/search\/\?api=1/);
    assert.match(text, new RegExp(RUN_ID));
  });

  it('exports JSON with report metadata', async () => {
    const exported = await request(`/api/runs/${RUN_ID}/export/json`, { token: TOKEN });

    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /^application\/json/);
    assert.match(
      exported.headers.get('content-disposition'),
      /^attachment; filename="lead-atlas-plumbers-austin-tx-\d{4}-\d{2}-\d{2}-k12345\.json"$/,
    );
    assert.equal(exported.json.report.searchNiche, 'plumbers');
    assert.equal(exported.json.report.searchLocation, 'Austin, TX');
    assert.equal(exported.json.report.apifyRunId, RUN_ID);
    assert.equal(exported.json.report.totalLeads, 2);
    assert.equal(exported.json.report.summary.total, 2);
    assert.equal(exported.json.report.outreach.total, 2);
    assert.equal(exported.json.report.outreach.toContact, 2);
    assert.equal(exported.json.leads.length, 2);
    assert.equal(exported.json.leads[0].businessName, 'Acme Plumbing');
    assert.equal(exported.json.leads[0].outreachStatus, 'to-contact');
    assert.equal(exported.json.leads[0].outreachStatusLabel, 'To contact');
  });

  it('rejects invalid run IDs and unknown API routes', async () => {
    const invalid = await request('/api/runs/short', { token: TOKEN });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error.code, 'VALIDATION_ERROR');

    const unknown = await request('/api/does-not-exist');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.error.code, 'NOT_FOUND');
  });
});
