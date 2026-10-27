import { ACTOR, LIMITS } from './config.js';
import { ApiError } from './errors.js';

const APIFY_BASE = (process.env.APIFY_API_BASE || 'https://api.apify.com/v2').replace(/\/+$/, '');

function safeApifyMessage(payload, status) {
  const raw =
    payload?.error?.message ||
    payload?.error?.toString?.() ||
    payload?.message ||
    `Apify returned HTTP ${status}.`;
  return String(raw).replace(/\s+/g, ' ').slice(0, 320);
}

function mapStatus(status, message) {
  if (status === 401) {
    return new ApiError(
      401,
      'INVALID_APIFY_KEY',
      'Apify rejected this API key. Check the key, then try again.',
    );
  }
  if (status === 402) {
    return new ApiError(
      402,
      'APIFY_PAYMENT_REQUIRED',
      'Your Apify account has no available credits for this run. Add credits or use a different key.',
    );
  }
  if (status === 403) {
    return new ApiError(
      403,
      'APIFY_FORBIDDEN',
      'This Apify key is not allowed to run this Actor. Check the key permissions in Apify Console.',
    );
  }
  if (status === 404) {
    return new ApiError(404, 'APIFY_NOT_FOUND', 'Apify could not find that run or resource.');
  }
  if (status === 429) {
    return new ApiError(
      429,
      'APIFY_RATE_LIMITED',
      'Apify is rate-limiting requests right now. Wait a few seconds and try again.',
    );
  }
  if (status >= 500) {
    return new ApiError(
      502,
      'APIFY_UNAVAILABLE',
      'Apify is having trouble right now. Your key is fine — try again in a moment.',
    );
  }
  return new ApiError(
    status === 400 ? 400 : 502,
    'APIFY_ERROR',
    `Apify could not complete that request: ${message}`,
  );
}

async function apifyRequest(token, endpoint, { method = 'GET', body, timeout = 30000 } = {}) {
  let response;
  try {
    response = await fetch(`${APIFY_BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ApiError(504, 'APIFY_TIMEOUT', 'Apify took too long to respond. Please try again.');
    }
    throw new ApiError(
      502,
      'APIFY_UNREACHABLE',
      'Could not reach Apify from the server. Check your internet connection and try again.',
    );
  }

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw mapStatus(response.status, safeApifyMessage(payload, response.status));
  }

  return payload?.data ?? payload;
}

export async function validateApifyKey(token) {
  const user = await apifyRequest(token, '/users/me', { timeout: 15000 });
  const plan =
    user?.plan?.name ||
    user?.plan?.title ||
    user?.plan?.id ||
    user?.plan?.planId ||
    (typeof user?.plan === 'string' ? user.plan : null);

  return {
    username: user?.username || 'Apify user',
    plan: plan ? String(plan) : null,
    userId: user?.id || null,
  };
}

export async function startActorRun(token, input, { maxTotalChargeUsd } = {}) {
  const params = new URLSearchParams({
    build: 'latest',
    timeout: String(LIMITS.runTimeoutSecs),
  });
  if (Number.isFinite(maxTotalChargeUsd) && maxTotalChargeUsd > 0) {
    params.set('maxTotalChargeUsd', maxTotalChargeUsd.toFixed(2));
  }

  return apifyRequest(token, `/acts/${ACTOR.apiId}/runs?${params.toString()}`, {
    method: 'POST',
    body: input,
    timeout: 40000,
  });
}

export async function getActorRun(token, runId) {
  return apifyRequest(token, `/actor-runs/${encodeURIComponent(runId)}`, { timeout: 20000 });
}

export async function getDataset(token, datasetId) {
  return apifyRequest(token, `/datasets/${encodeURIComponent(datasetId)}`, { timeout: 20000 });
}

export async function getDatasetItems(token, datasetId) {
  const pageSize = 500;
  const items = [];

  for (let offset = 0; offset < LIMITS.maxTotalItems; offset += pageSize) {
    const page = await apifyRequest(
      token,
      `/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${pageSize}&offset=${offset}`,
      { timeout: 60000 },
    );

    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...page);
    if (page.length < pageSize) break;
  }

  return items;
}

export async function abortActorRun(token, runId) {
  return apifyRequest(token, `/actor-runs/${encodeURIComponent(runId)}/abort`, {
    method: 'POST',
    timeout: 20000,
  });
}
