import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVE_RUN_MAX_AGE_MS,
  isActiveRunFresh,
  parseActiveRun,
} from '../public/active-run-core.js';

const STARTED_AT = 1_760_000_000_000; // 2025-10-09T08:53:20Z

const BASE = {
  runId: 'runMock12345',
  brief: { niche: 'plumbers', location: 'Austin, TX', maxResults: 40 },
  startedAt: STARTED_AT,
  target: 40,
  cap: 0.56,
  consoleUrl: 'https://console.apify.com/actors/runs/runMock12345',
};

function json(overrides = {}) {
  return JSON.stringify({ ...BASE, ...overrides });
}

describe('active-run-core parseActiveRun', () => {
  it('parses a complete record', () => {
    assert.deepEqual(parseActiveRun(json()), {
      runId: BASE.runId,
      brief: { niche: 'plumbers', location: 'Austin, TX', maxResults: 40 },
      startedAt: STARTED_AT,
      target: 40,
      cap: 0.56,
      consoleUrl: BASE.consoleUrl,
    });
  });

  it('returns null for empty or non-string input', () => {
    assert.equal(parseActiveRun(null), null);
    assert.equal(parseActiveRun(undefined), null);
    assert.equal(parseActiveRun(''), null);
    assert.equal(parseActiveRun('   '), null);
    assert.equal(parseActiveRun(42), null);
    assert.equal(parseActiveRun({ ...BASE }), null);
  });

  it('returns null for malformed JSON and non-object payloads', () => {
    assert.equal(parseActiveRun('{oops'), null);
    assert.equal(parseActiveRun('[]'), null);
    assert.equal(parseActiveRun('"hello"'), null);
    assert.equal(parseActiveRun('null'), null);
  });

  it('rejects run IDs that Apify could never issue', () => {
    assert.equal(parseActiveRun(json({ runId: 'run1234' })), null); // too short
    assert.equal(parseActiveRun(json({ runId: 'run-12345abc' })), null); // symbols
    assert.equal(parseActiveRun(json({ runId: 'a'.repeat(41) })), null); // too long
    assert.equal(parseActiveRun(json({ runId: 12345678 })), null); // not a string
  });

  it('trims a padded run ID', () => {
    const parsed = parseActiveRun(json({ runId: '  runMock12345  ' }));
    assert.equal(parsed?.runId, 'runMock12345');
  });

  it('requires a usable brief', () => {
    assert.equal(parseActiveRun(json({ brief: undefined })), null);
    assert.equal(parseActiveRun(json({ brief: 'plumbers' })), null);
    assert.equal(parseActiveRun(json({ brief: { niche: '  ', location: 'Austin' } })), null);
    assert.equal(parseActiveRun(json({ brief: { niche: 'plumbers' } })), null);
  });

  it('caps brief text and clamps the result count', () => {
    const parsed = parseActiveRun(
      json({
        brief: {
          niche: `  ${'n'.repeat(200)}  `,
          location: `  ${'l'.repeat(300)}  `,
          maxResults: 0,
        },
      }),
    );
    assert.equal(parsed?.brief.niche.length, 120);
    assert.equal(parsed?.brief.location.length, 160);
    assert.equal(parsed?.brief.maxResults, 1);

    assert.equal(
      parseActiveRun(json({ brief: { ...BASE.brief, maxResults: 9999 } }))?.brief.maxResults,
      500,
    );
    assert.equal(
      parseActiveRun(json({ brief: { ...BASE.brief, maxResults: 40.6 } }))?.brief.maxResults,
      41,
    );
    assert.equal(
      parseActiveRun(json({ brief: { ...BASE.brief, maxResults: 'junk' } }))?.brief.maxResults,
      40,
    );
  });

  it('requires a usable start timestamp', () => {
    assert.equal(parseActiveRun(json({ startedAt: undefined })), null);
    assert.equal(parseActiveRun(json({ startedAt: 0 })), null);
    assert.equal(parseActiveRun(json({ startedAt: -5 })), null);
    assert.equal(parseActiveRun(json({ startedAt: 'yesterday' })), null);
    assert.equal(parseActiveRun(json({ startedAt: '1760000000000' }))?.startedAt, STARTED_AT);
  });

  it('falls back to the brief when the target is missing or junk', () => {
    assert.equal(parseActiveRun(json({ target: undefined }))?.target, 40);
    assert.equal(parseActiveRun(json({ target: 'junk' }))?.target, 40);
    assert.equal(parseActiveRun(json({ target: -3 }))?.target, 40);
    assert.equal(parseActiveRun(json({ target: 12.7 }))?.target, 13);
  });

  it('only keeps a positive safety cap', () => {
    assert.equal(parseActiveRun(json({ cap: undefined }))?.cap, null);
    assert.equal(parseActiveRun(json({ cap: 0 }))?.cap, null);
    assert.equal(parseActiveRun(json({ cap: -1 }))?.cap, null);
    assert.equal(parseActiveRun(json({ cap: 'junk' }))?.cap, null);
    assert.equal(parseActiveRun(json({ cap: 1.25 }))?.cap, 1.25);
  });

  it('only keeps http(s) console URLs', () => {
    assert.equal(parseActiveRun(json({ consoleUrl: undefined }))?.consoleUrl, null);
    assert.equal(parseActiveRun(json({ consoleUrl: 'not a url' }))?.consoleUrl, null);
    assert.equal(
      parseActiveRun(json({ consoleUrl: 'javascript:alert(1)' }))?.consoleUrl,
      null,
    );
    const longUrl = `https://console.apify.com/${'x'.repeat(600)}`;
    assert.equal(parseActiveRun(json({ consoleUrl: longUrl }))?.consoleUrl.length, 500);
  });
});

describe('active-run-core isActiveRunFresh', () => {
  const record = { startedAt: STARTED_AT };

  it('accepts recent records', () => {
    assert.equal(isActiveRunFresh(record, STARTED_AT + 60_000), true);
    assert.equal(isActiveRunFresh(record, STARTED_AT + 23 * 60 * 60 * 1000), true);
  });

  it('rejects stale records after the default window', () => {
    assert.equal(isActiveRunFresh(record, STARTED_AT + ACTIVE_RUN_MAX_AGE_MS + 1), false);
    assert.equal(isActiveRunFresh(record, STARTED_AT + 48 * 60 * 60 * 1000), false);
  });

  it('treats the exact boundary as fresh', () => {
    assert.equal(isActiveRunFresh(record, STARTED_AT + ACTIVE_RUN_MAX_AGE_MS), true);
  });

  it('tolerates small clock skew but rejects far-future records', () => {
    assert.equal(isActiveRunFresh(record, STARTED_AT - 2 * 60 * 1000), true);
    assert.equal(isActiveRunFresh(record, STARTED_AT - 10 * 60 * 1000), false);
  });

  it('rejects malformed records and arguments', () => {
    assert.equal(isActiveRunFresh(null, STARTED_AT), false);
    assert.equal(isActiveRunFresh({}, STARTED_AT), false);
    assert.equal(isActiveRunFresh({ startedAt: 'yesterday' }, STARTED_AT), false);
    assert.equal(isActiveRunFresh(record, Number.NaN), false);
    assert.equal(isActiveRunFresh(record, STARTED_AT, -1), false);
  });

  it('honours a custom window', () => {
    const twoHours = 2 * 60 * 60 * 1000;
    assert.equal(isActiveRunFresh(record, STARTED_AT + twoHours, 60 * 60 * 1000), false);
    assert.equal(isActiveRunFresh(record, STARTED_AT + twoHours, 3 * 60 * 60 * 1000), true);
  });
});
