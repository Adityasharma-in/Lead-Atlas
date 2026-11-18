import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeLeads, summarizeLeads, toExportLead } from '../src/leads.js';

const FETCHED_AT = new Date('2026-10-25T12:00:00.000Z');
const QUERY = { niche: 'plumbers', location: 'Austin, TX' };

function normalize(items, options = {}) {
  return normalizeLeads(items, {
    query: QUERY,
    runId: 'runMock12345',
    fetchedAt: FETCHED_AT,
    ...options,
  });
}

describe('normalizeLeads', () => {
  it('maps a rich Apify place into a clean lead', () => {
    const item = {
      title: 'Acme Plumbing',
      categories: [{ name: 'Plumber' }, 'Emergency service'],
      categoryName: 'Plumber',
      address: '123 Main St, Austin, TX 78701',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      countryCode: 'US',
      website: 'acmeplumbing.example.com',
      phones: ['(512) 555-0100', '512-555-0100', { phoneNumber: '+1 512 555 0199' }],
      phone: '(512) 555-0100',
      emails: ['HELLO@AcmePlumbing.example', { email: 'office@acmeplumbing.example' }],
      instagrams: ['@acmeplumbing'],
      facebooks: [{ url: 'https://www.facebook.com/acmeplumbing', username: 'acmeplumbing' }],
      totalScore: 4.46,
      reviewsCount: '1,234',
      location: { lat: 30.26721234, lng: -97.74305678 },
      permanentlyClosed: 'true',
      placeId: 'ChIJabc123',
      url: 'https://www.google.com/maps/place/Acme+Plumbing/@30.26,-97.74,17z',
      price: '$$',
      claimed: 'yes',
    };

    const { leads, total, duplicateCount, summary } = normalize([item]);
    const lead = leads[0];

    assert.equal(total, 1);
    assert.equal(duplicateCount, 0);
    // Place IDs are lowercased for the internal stable ID; the display value
    // keeps its original casing for Google Maps links.
    assert.equal(lead.id, 'place-chijabc123');
    assert.equal(lead.placeId, 'ChIJabc123');
    assert.equal(lead.name, 'Acme Plumbing');
    assert.equal(lead.category, 'Plumber');
    assert.deepEqual(lead.categories, ['Plumber', 'Emergency service']);
    assert.equal(lead.address, '123 Main St, Austin, TX 78701');
    assert.equal(lead.city, 'Austin');
    assert.equal(lead.state, 'TX');
    assert.equal(lead.postalCode, '78701');
    assert.equal(lead.countryCode, 'US');
    assert.equal(lead.website, 'https://acmeplumbing.example.com/');
    assert.equal(lead.domain, 'acmeplumbing.example.com');
    assert.equal(lead.hasWebsite, true);
    assert.equal(lead.phone, '(512) 555-0100');
    assert.deepEqual(lead.phones, ['(512) 555-0100', '+1 512 555 0199']);
    assert.deepEqual(lead.emails, ['hello@acmeplumbing.example', 'office@acmeplumbing.example']);
    assert.equal(lead.socials.length, 2);
    assert.deepEqual(
      lead.socials.map((social) => [social.network, social.handle]),
      [
        ['instagram', 'acmeplumbing'],
        ['facebook', 'acmeplumbing'],
      ],
    );
    assert.equal(lead.rating, 4.5);
    assert.equal(lead.reviewsCount, 1234);
    assert.equal(lead.priceLevel, '$$');
    assert.equal(lead.lat, 30.2672123);
    assert.equal(lead.lng, -97.7430568);
    assert.equal(lead.permanentlyClosed, true);
    assert.equal(lead.temporarilyClosed, false);
    assert.equal(lead.claimed, true);
    assert.equal(lead.scrapedAt, FETCHED_AT.toISOString());
    assert.equal(lead.searchNiche, 'plumbers');
    assert.equal(lead.searchLocation, 'Austin, TX');
    assert.equal(lead.runId, 'runMock12345');
    assert.equal(
      lead.mapsUrl,
      'https://www.google.com/maps/place/Acme+Plumbing/@30.26,-97.74,17z',
    );
    assert.equal(summary.withWebsite, 1);
    assert.equal(summary.withContact, 1);
    assert.equal(summary.avgRating, 4.5);
    assert.equal(summary.totalReviews, 1234);
  });

  it('merges duplicate places and preserves the best fields', () => {
    const { leads, total, duplicateCount } = normalize([
      {
        title: 'Alpha Dental',
        placeId: 'placeAlpha1',
        phone: '+1 111 111 1111',
        emails: ['front@alpha.example'],
        address: '1 Alpha Way',
      },
      {
        title: 'Alpha Dental',
        placeId: 'placeAlpha1',
        phone: '+1 222 222 2222',
        emails: ['front@alpha.example', 'billing@alpha.example'],
        website: 'https://alpha.example',
        instagrams: ['alphadental'],
        rating: 4.8,
      },
    ]);

    assert.equal(total, 1);
    assert.equal(duplicateCount, 1);
    assert.equal(leads[0].website, 'https://alpha.example/');
    assert.deepEqual(leads[0].phones, ['+1 111 111 1111', '+1 222 222 2222']);
    assert.deepEqual(leads[0].emails, ['front@alpha.example', 'billing@alpha.example']);
    assert.equal(leads[0].socials.length, 1);
    assert.equal(leads[0].rating, 4.8);
    assert.equal(leads[0].address, '1 Alpha Way');
  });

  it('deduplicates places without an ID by name and address', () => {
    const { total, duplicateCount } = normalize([
      { title: 'Corner Cafe', address: '5 Main St' },
      { title: 'Corner Cafe', address: '5 Main St' },
      { title: 'Corner Cafe', address: '9 Other St' },
    ]);

    assert.equal(total, 2);
    assert.equal(duplicateCount, 1);
  });

  it('bridges duplicates across phone, email and place id', () => {
    const { leads, total, duplicateCount } = normalize([
      { title: 'Bridge Co', phone: '512-555-0100' },
      {
        title: 'Bridge Co',
        phone: '(512) 555-0100',
        emails: ['shared@bridge.example'],
      },
      { title: 'Bridge Co', emails: ['SHARED@bridge.example'], placeId: 'bridge-1' },
    ]);

    assert.equal(total, 1);
    assert.equal(duplicateCount, 2);
    assert.equal(leads[0].placeId, 'bridge-1');
    assert.deepEqual(leads[0].phones, ['512-555-0100']);
    assert.deepEqual(leads[0].emails, ['shared@bridge.example']);
    assert.equal(leads[0].index, 1);
  });

  it('treats place ids as case-insensitive during deduplication', () => {
    const { leads, total, duplicateCount } = normalize([
      { title: 'Case Co', placeId: 'ChIJShared' },
      { title: 'Case Co', placeId: 'chijshared', website: 'https://case.example' },
    ]);

    assert.equal(total, 1);
    assert.equal(duplicateCount, 1);
    assert.equal(leads[0].placeId, 'ChIJShared');
    assert.equal(leads[0].id, 'place-chijshared');
    assert.equal(leads[0].website, 'https://case.example/');
    assert.equal(leads[0].domain, 'case.example');
    assert.equal(leads[0].hasWebsite, true);
  });

  it('keeps a merged rating and review count as one fresh snapshot', () => {
    const { leads } = normalize([
      { title: 'Fresh Co', placeId: 'fresh-1', totalScore: 4.2, reviewsCount: 10 },
      {
        title: 'Fresh Co',
        placeId: 'fresh-1',
        totalScore: 4.8,
        reviewsCount: 50,
        website: 'fresh.example',
      },
    ]);

    assert.equal(leads[0].rating, 4.8);
    assert.equal(leads[0].reviewsCount, 50);
    assert.equal(leads[0].website, 'https://fresh.example/');
    assert.equal(leads[0].phone, null);
  });

  it('recomputes contact fields after a merge so nothing goes stale', () => {
    const { leads } = normalize([
      { title: 'Phone Co', placeId: 'phone-1', phone: '5125550100' },
      {
        title: 'Phone Co',
        placeId: 'phone-1',
        phone: '5125550199',
        website: 'https://phone.example',
      },
    ]);

    assert.deepEqual(leads[0].phones, ['5125550100', '5125550199']);
    assert.equal(leads[0].phone, '5125550100');
    assert.equal(leads[0].domain, 'phone.example');
    assert.equal(leads[0].hasWebsite, true);
  });

  it('numbers remaining leads after duplicates and quality filtering', () => {
    const { leads } = normalize(
      [
        { title: 'Alpha', placeId: 'alpha', reviewsCount: 100 },
        { title: 'Duplicate Alpha', placeId: 'alpha', reviewsCount: 100 },
        { title: 'Too Thin', placeId: 'thin', reviewsCount: 5 },
        { title: 'Bravo', placeId: 'bravo', reviewsCount: 60 },
      ],
      { query: { ...QUERY, minReviews: 10 } },
    );

    assert.deepEqual(
      leads.map((lead) => [lead.name, lead.index]),
      [
        ['Alpha', 1],
        ['Bravo', 2],
      ],
    );
    assert.equal(leads[0].id, 'place-alpha');
    assert.equal(leads[1].id, 'place-bravo');
  });

  it('excludes leads below the configured minimum review count', () => {
    const result = normalize(
      [
        { title: 'Established', placeId: 'good', totalScore: 4.6, reviewsCount: 50 },
        { title: 'Forty Reviews', placeId: 'forty', totalScore: 4.8, reviewsCount: 40 },
        { title: 'Zero Reviews', placeId: 'zero', totalScore: 0, reviewsCount: 0 },
        { title: 'Five Reviews', placeId: 'five', totalScore: 5, reviewsCount: 5 },
        { title: 'Missing Reviews', placeId: 'missing', totalScore: 4.9 },
      ],
      { query: { ...QUERY, minReviews: 50 } },
    );

    assert.equal(result.total, 1);
    assert.equal(result.leads[0].name, 'Established');
    assert.equal(result.leads[0].reviewsCount, 50);
    assert.equal(result.filteredCount, 4);
    assert.deepEqual(result.filteredReasons, { reviews: 4 });
  });

  it('uses the default minimum review gate when the server asks for it', () => {
    const result = normalize(
      [
        { title: 'Real', placeId: 'real', reviewsCount: 10 },
        { title: 'Fluff', placeId: 'fluff', reviewsCount: 5 },
        { title: 'No Rating Fluff', placeId: 'fluff2', totalScore: 0, reviewsCount: 5 },
      ],
      { query: { ...QUERY, minReviews: 10 } },
    );

    assert.equal(result.total, 1);
    assert.equal(result.leads[0].name, 'Real');
    assert.equal(result.filteredReasons.reviews, 2);
  });

  it('applies the review gate after duplicate rows are merged', () => {
    const result = normalize(
      [
        { title: 'Merged', placeId: 'merged', totalScore: 4.2, reviewsCount: 10 },
        { title: 'Merged', placeId: 'merged', totalScore: 4.7, reviewsCount: 100 },
      ],
      { query: { ...QUERY, minReviews: 50 } },
    );

    assert.equal(result.total, 1);
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.leads[0].rating, 4.7);
    assert.equal(result.leads[0].reviewsCount, 100);
  });

  it('keeps every lead when the review gate is disabled', () => {
    const result = normalize(
      [
        { title: 'New Place', placeId: 'new', reviewsCount: 0 },
        { title: 'No Reviews', placeId: 'none' },
      ],
      { query: { ...QUERY, minReviews: 0 } },
    );

    assert.equal(result.total, 2);
    assert.equal(result.filteredCount, 0);
  });

  it('reports closed and low-rated exclusions separately', () => {
    const result = normalize(
      [
        { title: 'Closed', placeId: 'closed', permanentlyClosed: true, reviewsCount: 100 },
        { title: 'Low Rated', placeId: 'low', totalScore: 3.2, reviewsCount: 100 },
        { title: 'Keeper', placeId: 'keeper', totalScore: 4.4, reviewsCount: 100 },
      ],
      { query: { ...QUERY, skipClosed: true, minStars: 'four', minReviews: 10 } },
    );

    assert.equal(result.total, 1);
    assert.equal(result.leads[0].name, 'Keeper');
    assert.deepEqual(result.filteredReasons, { closed: 1, rating: 1 });
  });

  it('builds a Google Maps search link when Apify sends no place URL', () => {
    const { leads } = normalize([
      {
        title: 'No Site Bakery',
        address: '7 Flour Ln, Austin, TX',
        placeId: 'placeNoSite1',
      },
    ]);
    const maps = new URL(leads[0].mapsUrl);

    assert.equal(maps.hostname, 'www.google.com');
    assert.equal(maps.pathname, '/maps/search/');
    assert.equal(maps.searchParams.get('api'), '1');
    assert.equal(maps.searchParams.get('query'), 'No Site Bakery 7 Flour Ln, Austin, TX');
    assert.equal(maps.searchParams.get('query_place_id'), 'placeNoSite1');
    assert.equal(leads[0].hasWebsite, false);
    assert.equal(leads[0].website, null);
  });

  it('refuses unsafe website and map URLs', () => {
    const { leads } = normalize([
      {
        title: 'Suspicious Shop',
        website: 'javascript:alert(1)',
        url: 'data:text/html,<h1>nope</h1>',
        placeId: 'placeSuspicious1',
      },
    ]);

    assert.equal(leads[0].website, null);
    assert.equal(leads[0].hasWebsite, false);
    assert.ok(leads[0].mapsUrl.startsWith('https://www.google.com/maps/search/'));
  });

  it('normalizes social handles, profile URLs, and generic social fields', () => {
    const { leads } = normalize([
      {
        title: 'Social Studio',
        placeId: 'placeSocial1',
        instagrams: ['@socialstudio'],
        tiktoks: ['https://www.tiktok.com/@social.studio'],
        socialProfiles: [
          'https://www.linkedin.com/company/social-studio',
          { platform: 'Threads', url: 'https://www.threads.net/@socialstudio' },
        ],
        youtubes: ['socialstudio'],
      },
    ]);
    const socials = leads[0].socials;

    assert.deepEqual(
      socials.map((social) => [social.network, social.url]),
      [
        ['instagram', 'https://www.instagram.com/socialstudio'],
        ['youtube', 'https://www.youtube.com/@socialstudio'],
        ['tiktok', 'https://www.tiktok.com/@social.studio'],
        ['linkedin', 'https://www.linkedin.com/company/social-studio'],
        ['threads', 'https://www.threads.net/@socialstudio'],
      ],
    );
  });

  it('clamps ratings and falls back for missing fields', () => {
    const { leads } = normalize([
      { title: 'Too High', totalScore: 9, placeId: 'placeHigh1' },
      { title: 'Too Low', totalScore: -2, placeId: 'placeLow1' },
      { placeId: 'placeEmpty1' },
    ]);

    assert.equal(leads[0].rating, 5);
    assert.equal(leads[1].rating, 0);
    assert.equal(leads[2].name, 'Unnamed place');
    assert.equal(leads[2].category, 'Business');
    assert.equal(leads[2].address, null);
    assert.equal(leads[2].phone, null);
    assert.equal(leads[2].rating, null);
  });

  it('ignores non-object dataset rows', () => {
    const result = normalize([null, 'not a place', 42, { title: 'Real Place' }]);

    assert.equal(result.total, 1);
    assert.equal(result.leads[0].name, 'Real Place');
  });

  it('returns an empty report for a non-array dataset', () => {
    const result = normalizeLeads(null);

    assert.deepEqual(result.leads, []);
    assert.equal(result.total, 0);
    assert.equal(result.duplicateCount, 0);
    assert.equal(result.summary.total, 0);
  });
});

describe('summarizeLeads', () => {
  it('counts coverage, contact rate, closed places, and average rating', () => {
    const summary = summarizeLeads([
      {
        hasWebsite: true,
        emails: ['a@example.com'],
        phones: [],
        socials: ['instagram'],
        permanentlyClosed: false,
        temporarilyClosed: false,
        rating: 4,
        reviewsCount: 10,
      },
      {
        hasWebsite: false,
        emails: [],
        phones: ['+1 555 0100'],
        socials: [],
        permanentlyClosed: true,
        temporarilyClosed: false,
        rating: 5,
        reviewsCount: 30,
      },
      {
        hasWebsite: false,
        emails: [],
        phones: [],
        socials: [],
        permanentlyClosed: false,
        temporarilyClosed: true,
        rating: null,
        reviewsCount: null,
      },
    ]);

    assert.deepEqual(summary, {
      total: 3,
      withWebsite: 1,
      withoutWebsite: 2,
      withEmail: 1,
      withPhone: 1,
      withContact: 2,
      withSocial: 1,
      closed: 2,
      avgRating: 4.5,
      totalReviews: 40,
      contactRate: 67,
      outreach: {
        total: 3,
        toContact: 3,
        contacted: 0,
        doNotContact: 0,
        marked: 0,
        rate: 0,
      },
    });
  });

  it('handles an empty lead list', () => {
    const summary = summarizeLeads([]);

    assert.equal(summary.total, 0);
    assert.equal(summary.avgRating, null);
    assert.equal(summary.contactRate, 0);
  });
});

describe('toExportLead', () => {
  it('uses readable export keys and flattens social profiles', () => {
    const { leads } = normalize([
      {
        title: 'Export Co',
        placeId: 'placeExport1',
        website: 'https://export.example',
        emails: ['hi@export.example'],
        instagrams: ['exportco'],
        rating: 4.2,
      },
    ]);
    const exported = toExportLead(leads[0]);

    assert.equal(exported.businessName, 'Export Co');
    assert.equal(exported.googleMapsUrl, leads[0].mapsUrl);
    assert.equal(exported.apifyRunId, 'runMock12345');
    assert.equal(exported.outreachStatus, 'to-contact');
    assert.equal(exported.outreachStatusLabel, 'To contact');
    assert.equal(exported.contactedAt, null);
    assert.equal(exported.outreachNote, null);
    assert.deepEqual(exported.socialProfiles, [
      {
        network: 'instagram',
        label: 'Instagram',
        url: 'https://www.instagram.com/exportco',
        handle: 'exportco',
      },
    ]);
    assert.equal(exported.emails[0], 'hi@export.example');
  });
});
