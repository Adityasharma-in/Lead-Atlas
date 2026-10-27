import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildJsonExport,
  escapeCsvCell,
  exportFilename,
  leadsToCsv,
} from '../src/csv.js';
import { normalizeLeads } from '../src/leads.js';

const FETCHED_AT = new Date('2026-10-25T12:00:00.000Z');
const QUERY = { niche: 'plumbers', location: 'Austin, TX' };

function makeLeads(items = []) {
  return normalizeLeads(items, { query: QUERY, runId: 'runMock12345', fetchedAt: FETCHED_AT });
}

function sampleItem(overrides = {}) {
  return {
    title: 'Acme Plumbing',
    placeId: 'placeCsv1',
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
    lat: 30.2672,
    lng: -97.7431,
    ...overrides,
  };
}

describe('escapeCsvCell', () => {
  it('leaves simple values alone', () => {
    assert.equal(escapeCsvCell('hello'), 'hello');
    assert.equal(escapeCsvCell(42), '42');
    assert.equal(escapeCsvCell(false), 'false');
    assert.equal(escapeCsvCell(null), '');
    assert.equal(escapeCsvCell(undefined), '');
  });

  it('quotes commas, quotes, newlines, and surrounding whitespace', () => {
    assert.equal(escapeCsvCell('a,b'), '"a,b"');
    assert.equal(escapeCsvCell('He said "hi"'), '"He said ""hi"""');
    assert.equal(escapeCsvCell('line one\nline two'), '"line one\nline two"');
    assert.equal(escapeCsvCell(' padded '), '" padded "');
  });

  it('neutralizes spreadsheet formulas', () => {
    assert.equal(escapeCsvCell('=1+1'), "'=1+1");
    assert.equal(escapeCsvCell('+SUM(A1)'), "'+SUM(A1)");
    assert.equal(escapeCsvCell('-42'), "'-42");
    assert.equal(escapeCsvCell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(escapeCsvCell('\tTabbed'), "'\tTabbed");
    assert.equal(escapeCsvCell('\rReturn'), `"'\rReturn"`);
  });

  it('quotes formula cells that also contain commas', () => {
    assert.equal(escapeCsvCell('=HYPERLINK("x","y")'), `"'=HYPERLINK(""x"",""y"")"`);
  });
});

describe('leadsToCsv', () => {
  it('writes a BOM, a full header, and CRLF line endings', () => {
    const { leads } = makeLeads([sampleItem()]);
    const csv = leadsToCsv(leads);
    const lines = csv.split('\r\n');

    assert.ok(csv.startsWith('\uFEFF'));
    assert.equal(lines.at(-1), '');
    assert.match(lines[0], /Business name,Category,Primary phone/);
    assert.match(
      lines[0],
      /Emails,Outreach status,Contacted at,Outreach note,Outreach updated at,Website/,
    );
    assert.match(lines[0], /Google Maps link,Place ID,Latitude,Longitude/);
    assert.match(lines[0], /Apify run ID/);
    assert.equal(lines.length, 3);
  });

  it('exports normalized values and preserves Google Maps verification links', () => {
    const { leads } = makeLeads([sampleItem()]);
    const csv = leadsToCsv(leads);

    assert.match(csv, /Acme Plumbing,Plumber,\(512\) 555-0100/);
    assert.match(csv, /hello@acme\.example/);
    assert.match(csv, /https:\/\/acme\.example\//);
    assert.match(csv, /Yes,4\.6,120/);
    assert.match(csv, /hello@acme\.example,To contact,,,/);
    assert.match(csv, /https:\/\/www\.google\.com\/maps\/search\/\?api=1/);
    assert.match(csv, /placeCsv1/);
    assert.match(csv, /runMock12345/);
  });

  it('escapes hostile scraped text in real rows', () => {
    const { leads } = makeLeads([
      sampleItem({
        title: '=HYPERLINK("http://evil.example","click")',
        address: '1 Main St, "Suite" 2',
        emails: ['a@b.example'],
      }),
    ]);
    const csv = leadsToCsv(leads);

    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"",""click"")"`));
    assert.ok(csv.includes('"1 Main St, ""Suite"" 2"'));
    assert.ok(!csv.includes('\n=HYPERLINK'));
  });
});

describe('buildJsonExport', () => {
  it('wraps normalized leads in a report envelope', () => {
    const { leads, summary } = makeLeads([sampleItem()]);
    const payload = buildJsonExport(leads, {
      query: QUERY,
      runId: 'runMock12345',
      summary,
      actor: 'compass/crawler-google-places',
    });

    assert.equal(payload.report.name, 'Lead Atlas field report');
    assert.equal(payload.report.searchNiche, 'plumbers');
    assert.equal(payload.report.searchLocation, 'Austin, TX');
    assert.equal(payload.report.apifyRunId, 'runMock12345');
    assert.equal(payload.report.apifyActor, 'compass/crawler-google-places');
    assert.equal(payload.report.totalLeads, 1);
    assert.equal(payload.report.summary.withWebsite, 1);
    assert.equal(payload.report.outreach.total, 1);
    assert.equal(payload.report.outreach.toContact, 1);
    assert.ok(!Number.isNaN(Date.parse(payload.report.generatedAt)));
    assert.equal(payload.leads.length, 1);
    assert.equal(payload.leads[0].businessName, 'Acme Plumbing');
    assert.equal(payload.leads[0].apifyRunId, 'runMock12345');
    assert.equal(payload.leads[0].latitude, 30.2672);
    assert.equal(payload.leads[0].outreachStatus, 'to-contact');
    assert.equal(payload.leads[0].outreachStatusLabel, 'To contact');
    assert.equal(payload.leads[0].socialProfiles[0].network, 'instagram');
  });

  it('falls back to the default actor name', () => {
    const payload = buildJsonExport([], {});

    assert.equal(payload.report.apifyActor, 'compass/crawler-google-places');
    assert.equal(payload.report.totalLeads, 0);
    assert.equal(payload.report.summary, null);
  });
});

describe('exportFilename', () => {
  it('builds a dated, sanitized filename with a run suffix', () => {
    const name = exportFilename({
      niche: 'Coffee & Tea',
      location: 'Austin, TX',
      runId: 'runMock12345',
      extension: 'csv',
    });

    assert.match(
      name,
      /^lead-atlas-coffee-tea-austin-tx-\d{4}-\d{2}-\d{2}-k12345\.csv$/,
    );
  });

  it('falls back when no search terms are available', () => {
    const name = exportFilename({ extension: 'json' });

    assert.match(name, /^lead-atlas-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('caps the slug length', () => {
    const name = exportFilename({
      niche: 'a'.repeat(120),
      location: 'b'.repeat(120),
      extension: 'csv',
    });
    const slug = name.replace(/^lead-atlas-/, '').replace(/-\d{4}-\d{2}-\d{2}\.csv$/, '');

    assert.equal(slug.length, 70);
  });
});
