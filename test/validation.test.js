import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildActorInput,
  createRunPlan,
  estimateRunCost,
  isTerminalStatus,
  normalizeScanRequest,
  sanitizeText,
  validateDatasetId,
  validateRunId,
} from '../src/validation.js';

function expectApiError(fn, status, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

function baseQuery(overrides = {}) {
  return {
    niche: 'plumbers',
    location: 'Austin, TX',
    ...overrides,
  };
}

describe('sanitizeText', () => {
  it('strips control characters and collapses whitespace', () => {
    assert.equal(sanitizeText('  A\u0000B\tC\n D  ', 100), 'A B C D');
  });

  it('truncates to the requested length', () => {
    assert.equal(sanitizeText('abcdefghij', 4), 'abcd');
  });

  it('returns an empty string for non-strings', () => {
    assert.equal(sanitizeText(null, 10), '');
    assert.equal(sanitizeText(42, 10), '');
  });
});

describe('normalizeScanRequest', () => {
  it('applies defaults and trims input', () => {
    const query = normalizeScanRequest(baseQuery({ niche: '  coffee shops  ', location: '  Portland  ' }));

    assert.deepEqual(query, {
      niche: 'coffee shops',
      location: 'Portland',
      websiteFilter: 'allPlaces',
      includeContacts: true,
      contactsSuppressed: false,
      maxResults: 40,
      minStars: '',
      skipClosed: true,
    });
  });

  it('accepts friendly aliases for website filters and ratings', () => {
    const query = normalizeScanRequest(
      baseQuery({ websiteFilter: 'with', minStars: '4.5', includeContacts: 'no', skipClosed: '0' }),
    );

    assert.equal(query.websiteFilter, 'withWebsite');
    assert.equal(query.minStars, 'fourAndHalf');
    assert.equal(query.includeContacts, false);
    assert.equal(query.skipClosed, false);
  });

  it('forces contact enrichment off for no-website scans', () => {
    const query = normalizeScanRequest(baseQuery({ websiteFilter: 'withoutWebsite' }));

    assert.equal(query.includeContacts, false);
    assert.equal(query.contactsSuppressed, true);
  });

  it('does not flag suppression when the user already turned contacts off', () => {
    const query = normalizeScanRequest(
      baseQuery({ websiteFilter: 'withoutWebsite', includeContacts: false }),
    );

    assert.equal(query.includeContacts, false);
    assert.equal(query.contactsSuppressed, false);
  });

  it('accepts the full results range', () => {
    assert.equal(normalizeScanRequest(baseQuery({ maxResults: 1 })).maxResults, 1);
    assert.equal(normalizeScanRequest(baseQuery({ maxResults: '500' })).maxResults, 500);
  });

  it('rejects a missing niche or location', () => {
    expectApiError(
      () => normalizeScanRequest({ location: 'Austin' }),
      400,
      'VALIDATION_ERROR',
    );
    expectApiError(() => normalizeScanRequest({ niche: 'plumbers' }), 400, 'VALIDATION_ERROR');
    expectApiError(() => normalizeScanRequest({ niche: 'a', location: 'Austin' }), 400, 'VALIDATION_ERROR');
  });

  it('rejects malformed result counts', () => {
    for (const maxResults of [0, 501, 1.5, 'many', -3]) {
      expectApiError(() => normalizeScanRequest(baseQuery({ maxResults })), 400, 'VALIDATION_ERROR');
    }
  });

  it('rejects unknown filters and booleans', () => {
    expectApiError(
      () => normalizeScanRequest(baseQuery({ websiteFilter: 'sometimes' })),
      400,
      'VALIDATION_ERROR',
    );
    expectApiError(
      () => normalizeScanRequest(baseQuery({ minStars: 'seven' })),
      400,
      'VALIDATION_ERROR',
    );
    expectApiError(
      () => normalizeScanRequest(baseQuery({ includeContacts: 'maybe' })),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('rejects non-object bodies', () => {
    for (const input of [null, undefined, [], 'plumbers', 12]) {
      expectApiError(() => normalizeScanRequest(input), 400, 'VALIDATION_ERROR');
    }
  });
});

describe('buildActorInput', () => {
  it('maps the brief onto the Actor input, always requesting detail pages', () => {
    const query = normalizeScanRequest(
      baseQuery({
        maxResults: 25,
        minStars: 'three',
        skipClosed: false,
        includeContacts: false,
      }),
    );
    const input = buildActorInput(query);

    assert.deepEqual(input, {
      searchStringsArray: ['plumbers'],
      locationQuery: 'Austin, TX',
      maxCrawledPlacesPerSearch: 25,
      language: 'en',
      website: 'allPlaces',
      placeMinimumStars: 'three',
      searchMatching: 'all',
      skipClosedPlaces: false,
      scrapePlaceDetailPage: true,
      scrapeContacts: false,
      maximumLeadsEnrichmentRecords: 0,
      maxReviews: 0,
      maxImages: 0,
    });
  });
});

describe('estimateRunCost', () => {
  it('includes the run start fee and per-place detail charges', () => {
    const cost = estimateRunCost(normalizeScanRequest(baseQuery()));

    assert.equal(cost.perPlaceUsd, 0.009);
    assert.equal(cost.filtersApplied, 1);
    assert.equal(cost.estimateUsd, 0.367);
    assert.equal(cost.safetyCapUsd, 0.56);
    assert.equal(cost.currency, 'USD');
  });

  it('never estimates below the minimum per-place cost', () => {
    const cost = estimateRunCost(
      normalizeScanRequest(baseQuery({ maxResults: 1, includeContacts: false, skipClosed: false })),
    );

    // $0.004 place + $0.002 details + $0.007 start fee.
    assert.equal(cost.estimateUsd, 0.013);
    assert.equal(cost.safetyCapUsd, 0.5);
  });

  it('counts each active filter', () => {
    const cost = estimateRunCost(
      normalizeScanRequest(
        baseQuery({
          websiteFilter: 'withWebsite',
          minStars: 'four',
          skipClosed: false,
          includeContacts: false,
        }),
      ),
    );

    assert.equal(cost.filtersApplied, 2);
    assert.equal(cost.perPlaceUsd, 0.008);
  });

  it('scales the safety cap for large scans', () => {
    const cost = estimateRunCost(normalizeScanRequest(baseQuery({ maxResults: 500 })));

    assert.equal(cost.estimateUsd, 4.507);
    assert.equal(cost.safetyCapUsd, 6.77);
  });
});

describe('createRunPlan', () => {
  it('returns the query, actor input, cost, and notices', () => {
    const plan = createRunPlan(baseQuery({ maxResults: 250 }));

    assert.equal(plan.query.maxResults, 250);
    assert.equal(plan.actorInput.maxCrawledPlacesPerSearch, 250);
    assert.equal(plan.cost.estimateUsd, 2.257);
    assert.deepEqual(plan.notices, [
      'Large scans can take several minutes and use more Apify credits.',
    ]);
  });

  it('explains suppressed contact enrichment', () => {
    const plan = createRunPlan(baseQuery({ websiteFilter: 'withoutWebsite' }));

    assert.equal(plan.actorInput.scrapeContacts, false);
    assert.deepEqual(plan.notices, [
      'Contact enrichment was turned off because the scan is limited to places without a website.',
    ]);
  });
});

describe('run and dataset IDs', () => {
  it('accepts Apify-style IDs', () => {
    assert.equal(validateRunId('abc12345'), 'abc12345');
    assert.equal(validateDatasetId('Dataset123ABC'), 'Dataset123ABC');
  });

  it('rejects unsafe or implausible IDs', () => {
    for (const value of ['short', 'abc-12345', '../../etc', 'a'.repeat(41), null, 12]) {
      expectApiError(() => validateRunId(value), 400, 'VALIDATION_ERROR');
      expectApiError(() => validateDatasetId(value), 400, 'VALIDATION_ERROR');
    }
  });
});

describe('terminal statuses', () => {
  it('knows when a run has stopped', () => {
    for (const status of ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']) {
      assert.equal(isTerminalStatus(status), true);
    }
    assert.equal(isTerminalStatus('RUNNING'), false);
    assert.equal(isTerminalStatus('READY'), false);
  });
});
