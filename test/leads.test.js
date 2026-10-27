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
    assert.equal(lead.id, 'place-ChIJabc123');
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
