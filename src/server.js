import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ACTOR,
  BROWSER_HEADERS,
  CONTENT_SECURITY_POLICY,
  LIMITS,
  MIN_STARS,
  PRICING,
} from './config.js';
import { ApiError, isApiError } from './errors.js';
import {
  abortActorRun,
  getActorRun,
  getDataset,
  getDatasetItems,
  startActorRun,
  validateApifyKey,
} from './apify.js';
import {
  createRunPlan,
  isTerminalStatus,
  sanitizeText,
  validateRunId,
} from './validation.js';
import { normalizeLeads } from './leads.js';
import { buildJsonExport, exportFilename, leadsToCsv } from './csv.js';
import { createSelfUpdater } from './selfupdate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TOKEN_PATTERN = /^[\x21-\x7e]{20,300}$/;
const RUN_CACHE_LIMIT = 250;
const DATASET_CACHE_TTL_MS = 30_000;
const DATASET_CACHE_LIMIT = 40;

const runCache = new Map();
const datasetCache = new Map();

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function datasetIdForRun(run) {
  // Apify's run resource uses `defaultDatasetId`. Keep the other shapes as
  // fallbacks for older cached responses and API-compatible proxies.
  const id =
    run?.defaultDatasetId ||
    run?.datasetId ||
    run?.storageIds?.datasets?.default;
  return typeof id === 'string' && id ? id : null;
}

function rememberRun(runId, data) {
  if (runCache.size >= RUN_CACHE_LIMIT) {
    const oldest = runCache.keys().next().value;
    if (oldest) runCache.delete(oldest);
  }
  runCache.set(runId, { ...data, rememberedAt: Date.now() });
}

function readToken(req) {
  const raw = req.get('x-apify-token');
  if (!raw) {
    throw new ApiError(
      401,
      'APIFY_KEY_REQUIRED',
      'Add your Apify API key to run a scan. It stays in this browser.',
    );
  }
  const token = raw.trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new ApiError(
      401,
      'INVALID_APIFY_KEY_FORMAT',
      'That does not look like a valid Apify API key. Copy the full token from Apify Console.',
    );
  }
  return token;
}

function queryFromRequest(req) {
  return {
    niche: sanitizeText(req.query?.niche, LIMITS.maxNicheLength) || null,
    location: sanitizeText(req.query?.location, LIMITS.maxLocationLength) || null,
  };
}

function serializeRun(run, { itemCount = null, cached = null } = {}) {
  const status = String(run?.status || 'UNKNOWN');
  const usageUsd =
    numberOrNull(run?.usageTotalUsd) ??
    numberOrNull(run?.usage?.totalUsd) ??
    numberOrNull(run?.cost);
  const query = cached?.query || null;

  return {
    runId: run?.id || cached?.runId || null,
    status,
    terminal: isTerminalStatus(status),
    datasetId: datasetIdForRun(run) || cached?.datasetId || null,
    consoleUrl: run?.id ? ACTOR.consoleRunUrl(run.id) : null,
    createdAt: run?.createdAt || null,
    startedAt: run?.startedAt || null,
    finishedAt: run?.finishedAt || null,
    itemCount,
    targetCount: query?.maxResults ?? cached?.query?.maxResults ?? null,
    usageUsd,
    statusMessage: run?.statusMessage || null,
    query,
    cost: cached?.cost || null,
    notices: cached?.notices || [],
  };
}

async function loadRunStatus(token, runId) {
  const run = await getActorRun(token, runId);
  const datasetId = datasetIdForRun(run);
  let itemCount = null;

  if (datasetId) {
    try {
      const dataset = await getDataset(token, datasetId);
      itemCount = Number.isFinite(dataset?.itemCount) ? dataset.itemCount : null;
    } catch {
      // Dataset stats can lag behind the run; status must still work.
    }
  }

  const cached = runCache.get(runId) || null;
  return { run, itemCount, cached };
}

function normalizeQueryForRun(runId, req) {
  const cached = runCache.get(runId);
  if (cached?.query?.niche && cached?.query?.location) return cached.query;
  return queryFromRequest(req);
}

async function loadDatasetItems(token, datasetId, { refresh = false } = {}) {
  const cached = datasetCache.get(datasetId);
  if (!refresh && cached && Date.now() - cached.fetchedAt < DATASET_CACHE_TTL_MS) {
    return cached.items;
  }

  const items = await getDatasetItems(token, datasetId);
  if (datasetCache.size >= DATASET_CACHE_LIMIT) {
    const oldest = datasetCache.keys().next().value;
    if (oldest) datasetCache.delete(oldest);
  }
  datasetCache.set(datasetId, { items, fetchedAt: Date.now() });
  return items;
}

async function loadExport(token, runId, req) {
  const run = await getActorRun(token, runId);
  if (!isTerminalStatus(String(run?.status))) {
    throw new ApiError(
      409,
      'RUN_NOT_READY',
      'This scan is still running. Wait for it to finish, then try again.',
    );
  }
  const datasetId = datasetIdForRun(run);
  if (!datasetId) {
    throw new ApiError(409, 'NO_DATASET', 'This run did not produce a dataset.');
  }

  const query = normalizeQueryForRun(runId, req);
  const items = await loadDatasetItems(token, datasetId, { refresh: true });
  const normalized = normalizeLeads(items, {
    query,
    runId,
    fetchedAt: new Date(),
  });

  return { run, query, datasetId, ...normalized };
}

function rateLimit({ windowMs, max, code, message }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'local';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      next(new ApiError(429, code, message, { retryAfter }));
      return;
    }

    if (buckets.size > 5000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    next();
  };
}

function sameOriginOnly(req, res, next) {
  const origin = req.get('origin');
  if (!origin) {
    next();
    return;
  }
  try {
    const originHost = new URL(origin).host;
    if (originHost !== req.get('host')) {
      next(new ApiError(403, 'CROSS_ORIGIN_BLOCKED', 'Cross-origin requests are not allowed.'));
      return;
    }
  } catch {
    next(new ApiError(403, 'CROSS_ORIGIN_BLOCKED', 'That request origin is not valid.'));
    return;
  }

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    next(new ApiError(403, 'CROSS_ORIGIN_BLOCKED', 'Cross-origin requests are not allowed.'));
    return;
  }
  next();
}

export function createApp(options = {}) {
  const selfUpdate =
    options.selfUpdate || createSelfUpdater({ canRestart: options.canRestart === true });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  // Rate limiters are scoped to this app instance so tests and multiple
  // instances never share buckets.
  const runLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    code: 'RUN_RATE_LIMITED',
    message: 'That is a lot of scans in a short time. Wait a few minutes before starting another.',
  });

  const keyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    code: 'KEY_RATE_LIMITED',
    message: 'Too many key checks. Wait a moment, then try again.',
  });

  const versionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    code: 'UPDATE_CHECK_RATE_LIMITED',
    message: 'Too many update checks. Wait a minute, then try again.',
  });

  const updateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    code: 'UPDATE_RATE_LIMITED',
    message: 'Too many update attempts. Wait a minute, then try again.',
  });

  app.use((req, res, next) => {
    for (const [header, value] of Object.entries(BROWSER_HEADERS)) {
      res.setHeader(header, value);
    }
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  });

  app.use(express.json({ limit: '32kb', strict: true }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'lead-atlas',
      actor: ACTOR.slug,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      actor: {
        slug: ACTOR.slug,
        name: ACTOR.name,
        url: ACTOR.url,
        docsUrl: ACTOR.docsUrl,
      },
      limits: {
        minResults: LIMITS.minResults,
        maxResults: LIMITS.maxResults,
        defaultResults: LIMITS.defaultResults,
      },
      minStars: Object.entries(MIN_STARS).map(([value, label]) => ({ value, label })),
      pricing: {
        ...PRICING,
        currency: 'USD',
        note: 'Estimates use public Apify FREE-tier pay-per-event rates. Paid plans are cheaper.',
      },
      tokenHeader: 'x-apify-token',
    });
  });

  app.get('/api/version', versionLimiter, async (req, res, next) => {
    try {
      res.json(await selfUpdate.status());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/update', sameOriginOnly, updateLimiter, async (req, res, next) => {
    try {
      const result = await selfUpdate.apply();
      const restart = selfUpdate.scheduleRestart();
      res.json({
        status: restart ? 'restarting' : 'updated',
        restarting: Boolean(restart),
        canRestart: Boolean(restart),
        ...result,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/key/validate', keyLimiter, sameOriginOnly, async (req, res, next) => {
    try {
      const token = readToken(req);
      const account = await validateApifyKey(token);
      res.json({
        valid: true,
        username: account.username,
        plan: account.plan,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/runs', runLimiter, sameOriginOnly, async (req, res, next) => {
    try {
      const token = readToken(req);
      const plan = createRunPlan(req.body);
      const run = await startActorRun(token, plan.actorInput, {
        maxTotalChargeUsd: plan.cost.safetyCapUsd,
      });

      if (!run?.id) {
        throw new ApiError(
          502,
          'APIFY_BAD_RESPONSE',
          'Apify accepted the request but returned no run ID. Check your Apify Console.',
        );
      }

      const runId = validateRunId(run.id);
      rememberRun(runId, {
        runId,
        datasetId: datasetIdForRun(run),
        query: plan.query,
        cost: plan.cost,
        notices: plan.notices,
      });

      res.status(201).json({
        run: serializeRun(run, {
          itemCount: 0,
          cached: runCache.get(runId),
        }),
        query: plan.query,
        cost: plan.cost,
        notices: plan.notices,
        actorInput: plan.actorInput,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs/:runId', async (req, res, next) => {
    try {
      const token = readToken(req);
      const runId = validateRunId(req.params.runId);
      const { run, itemCount, cached } = await loadRunStatus(token, runId);

      if (cached) {
        rememberRun(runId, {
          ...cached,
          datasetId: cached.datasetId || datasetIdForRun(run),
        });
      }

      res.json({
        run: serializeRun(run, {
          itemCount,
          cached: cached || runCache.get(runId) || null,
        }),
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs/:runId/results', async (req, res, next) => {
    try {
      const token = readToken(req);
      const runId = validateRunId(req.params.runId);
      const run = await getActorRun(token, runId);

      if (!isTerminalStatus(String(run?.status))) {
        throw new ApiError(
          409,
          'RUN_NOT_READY',
          'This scan is still running. Results will appear when it finishes.',
          { status: run?.status || 'UNKNOWN' },
        );
      }
      const datasetId = datasetIdForRun(run);
      if (!datasetId) {
        throw new ApiError(409, 'NO_DATASET', 'This run did not produce a dataset.');
      }

      const query = normalizeQueryForRun(runId, req);
      const items = await loadDatasetItems(token, datasetId);
      const normalized = normalizeLeads(items, { query, runId, fetchedAt: new Date() });
      const record = runCache.get(runId);

      res.json({
        ...normalized,
        datasetId,
        runStatus: run.status,
        fetchedAt: new Date().toISOString(),
        cost: record?.cost || null,
        notices: record?.notices || [],
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs/:runId/data', async (req, res, next) => {
    try {
      const token = readToken(req);
      const runId = validateRunId(req.params.runId);
      const { leads, query, summary, datasetId } = await loadExport(token, runId, req);

      const json = buildJsonExport(leads, {
        query,
        runId,
        summary,
        actor: ACTOR.slug,
      });

      res.json({
        runId,
        datasetId,
        query,
        total: leads.length,
        generatedAt: json.report.generatedAt,
        csv: leadsToCsv(leads),
        json,
        csvFilename: exportFilename({
          niche: query?.niche,
          location: query?.location,
          runId,
          extension: 'csv',
        }),
        jsonFilename: exportFilename({
          niche: query?.niche,
          location: query?.location,
          runId,
          extension: 'json',
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/runs/:runId/abort', sameOriginOnly, async (req, res, next) => {
    try {
      const token = readToken(req);
      const runId = validateRunId(req.params.runId);
      const current = await getActorRun(token, runId);

      if (isTerminalStatus(String(current?.status))) {
        res.json({
          run: serializeRun(current, { cached: runCache.get(runId) || null }),
          alreadyFinished: true,
        });
        return;
      }

      const run = await abortActorRun(token, runId);
      res.json({
        run: serializeRun(run || current, { cached: runCache.get(runId) || null }),
        alreadyFinished: false,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs/:runId/export/csv', async (req, res, next) => {
    try {
      const token = readToken(req);
      const runId = validateRunId(req.params.runId);
      const { leads, query } = await loadExport(token, runId, req);
      const filename = exportFilename({
        niche: query?.niche,
        location: query?.location,
        runId,
        extension: 'csv',
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(leadsToCsv(leads));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs/:runId/export/json', async (req, res, next) => {
    try {
      const token = readToken(req);
      const runId = validateRunId(req.params.runId);
      const { leads, query, summary } = await loadExport(token, runId, req);
      const payload = buildJsonExport(leads, {
        query,
        runId,
        summary,
        actor: ACTOR.slug,
      });
      const filename = exportFilename({
        niche: query?.niche,
        location: query?.location,
        runId,
        extension: 'json',
      });

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'That API route does not exist.' },
    });
  });

  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      etag: true,
      lastModified: true,
      setHeaders(res) {
        // Local app: always revalidate so an updated frontend never runs against a stale cache.
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  app.get('*', (req, res, next) => {
    if (req.path.includes('.')) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Not found.' },
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400)) {
      res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' },
      });
      return;
    }
    if (error?.type === 'entity.too.large') {
      res.status(413).json({
        error: { code: 'BODY_TOO_LARGE', message: 'That request is too large.' },
      });
      return;
    }

    if (isApiError(error)) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
      return;
    }

    console.error('[lead-atlas] Unhandled request error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on the local server. Check the terminal, then try again.',
      },
    });
  });

  return app;
}

export { createApp as default };

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const port = Number(process.env.PORT) || 4317;
  const host = process.env.HOST || '127.0.0.1';
  // When the self-updater respawns this process, the previous server may still
  // hold the port for up to ~1.2s. A restarted child waits politely instead of
  // exiting, then behaves like a normal server once bound.
  const isUpdateChild = process.env.LA_UPDATE_CHILD === '1';
  const app = createApp({ canRestart: true });
  let bindAttempts = 0;
  const server = app.listen(port, host, () => {
    console.log(`\n  Lead Atlas is charting at http://${host}:${port}\n`);
    console.log(`  Actor: ${ACTOR.slug}`);
    console.log('  Your Apify key is entered in the browser and never stored by this server.\n');
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      if (isUpdateChild && bindAttempts < 40) {
        bindAttempts += 1;
        console.info(`  [update] Waiting for the previous server to release port ${port} (attempt ${bindAttempts})…`);
        server.close();
        setTimeout(() => server.listen(port, host), 500);
        return;
      }
      console.error(`\n  Port ${port} is already in use. Start with another port, e.g. PORT=4318 npm start\n`);
      process.exitCode = 1;
      return;
    }
    console.error('[lead-atlas] Server error:', error);
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log('\n  Closing the atlas.\n');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2500).unref();
    });
  }
}
