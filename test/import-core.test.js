import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImportJson,
  detectDelimiter,
  escapeCsvCell,
  leadsToCsv,
  parseCsv,
  parseImportContent,
  toExportLead,
} from "../public/import-core.js";

const LEAD_ATLAS_HEADER =
  "Business name,Category,Primary phone,All phones,Emails,Website,Has website,Rating,Reviews,Address,City,State / region,Postal code,Country code,Social profiles,Google Maps link,Place ID,Latitude,Longitude,Permanently closed,Temporarily closed,Search niche,Search location,Scraped at,Apify run ID,Notes";

test("detectDelimiter recognises comma, semicolon and tab files", () => {
  assert.equal(detectDelimiter("Name,Phone\nAcme,123"), ",");
  assert.equal(detectDelimiter("Name;Phone\nAcme;123"), ";");
  assert.equal(detectDelimiter("Name\tPhone\nAcme\t123"), "\t");
  assert.equal(
    detectDelimiter('"Name, Inc.";Phone\n"Acme, Inc.";123'),
    ";",
  );
});

test("parseCsv handles BOM, quoted commas, escaped quotes and newlines", () => {
  const rows = parseCsv(
    '\uFEFFBusiness name,Notes\r\n"Acme, Inc.","Said ""hello""\nSecond line"\r\n',
  );
  assert.deepEqual(rows, [
    ["Business name", "Notes"],
    ["Acme, Inc.", 'Said "hello"\nSecond line'],
  ]);
});

test("imports the Lead Atlas CSV export shape", () => {
  const csv = [
    LEAD_ATLAS_HEADER,
    [
      "Acme Coffee",
      "Coffee shop",
      "(512) 555-0100",
      "(512) 555-0100 | (512) 555-0101",
      "hi@acme.example | sales@acme.example",
      "https://acme.example",
      "Yes",
      "4.6",
      "123",
      "1 Main St",
      "Austin",
      "TX",
      "78701",
      "US",
      "https://instagram.com/acme | https://www.facebook.com/acme",
      "https://www.google.com/maps/place/acme",
      "ChIJ123",
      "30.2672",
      "-97.7431",
      "No",
      "No",
      "coffee shops",
      '"Austin, TX"',
      "2026-01-01T00:00:00.000Z",
      "run123",
      "Walk-in only",
    ].join(","),
  ].join("\r\n");

  const result = parseImportContent({ name: "leads.csv", text: csv });
  assert.equal(result.format, "csv");
  assert.equal(result.leads.length, 1);
  assert.equal(result.rowsRead, 1);

  const lead = result.leads[0];
  assert.equal(lead.name, "Acme Coffee");
  assert.equal(lead.category, "Coffee shop");
  assert.deepEqual(lead.phones, ["(512) 555-0100", "(512) 555-0101"]);
  assert.deepEqual(lead.emails, ["hi@acme.example", "sales@acme.example"]);
  assert.equal(lead.website, "https://acme.example/");
  assert.equal(lead.domain, "acme.example");
  assert.equal(lead.rating, 4.6);
  assert.equal(lead.reviewsCount, 123);
  assert.equal(lead.city, "Austin");
  assert.equal(lead.state, "TX");
  assert.equal(lead.postalCode, "78701");
  assert.equal(lead.socials.length, 2);
  assert.equal(lead.mapsUrl, "https://www.google.com/maps/place/acme");
  assert.equal(lead.placeId, "ChIJ123");
  assert.equal(lead.lat, 30.2672);
  assert.equal(lead.lng, -97.7431);
  assert.equal(lead.searchNiche, "coffee shops");
  assert.equal(lead.searchLocation, "Austin, TX");
  assert.equal(lead.runId, "run123");
  assert.deepEqual(
    lead.extraFields.map((entry) => [entry.label, entry.value]),
    [["Notes", "Walk-in only"]],
  );
  assert.deepEqual(result.query, {
    niche: "coffee shops",
    location: "Austin, TX",
  });
});

test("imports a Lead Atlas JSON report with contacts, socials and query metadata", () => {
  const payload = {
    report: {
      name: "Lead Atlas field report",
      searchNiche: "plumbers",
      searchLocation: "Austin, TX",
      totalLeads: 1,
    },
    leads: [
      {
        businessName: "Acme Plumbing",
        category: "Plumber",
        phone: "(512) 555-0100",
        phones: ["(512) 555-0100", "(512) 555-0199"],
        emails: ["hello@acme.example"],
        website: "https://acmeplumbing.example",
        hasWebsite: true,
        rating: 4.8,
        reviewsCount: 50,
        address: "1 Pipe St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        countryCode: "US",
        socialProfiles: [
          {
            network: "instagram",
            label: "Instagram",
            url: "https://www.instagram.com/acmeplumbing",
            handle: "acmeplumbing",
          },
        ],
        googleMapsUrl: "https://www.google.com/maps/place/acme-plumbing",
        placeId: "place-9",
        latitude: 30.1,
        longitude: -97.2,
        permanentlyClosed: false,
        temporarilyClosed: false,
        searchNiche: "plumbers",
        searchLocation: "Austin, TX",
        scrapedAt: "2026-01-02T03:04:05.000Z",
        apifyRunId: "run-9",
      },
    ],
  };

  const result = parseImportContent({
    name: "report.json",
    text: JSON.stringify(payload),
  });

  assert.equal(result.format, "json");
  assert.equal(result.leads.length, 1);
  const lead = result.leads[0];
  assert.equal(lead.name, "Acme Plumbing");
  assert.equal(lead.domain, "acmeplumbing.example");
  assert.equal(lead.socials[0].label, "Instagram");
  assert.equal(lead.socials[0].handle, "acmeplumbing");
  assert.deepEqual(result.query, {
    niche: "plumbers",
    location: "Austin, TX",
  });
});

test("imports a generic semicolon CSV with aliases, handles and extras", () => {
  const csv = [
    "Company;Phone Number;Email Address;Website;Instagram;Notes",
    '"Acme, Inc.";+1 512 555 0100;hello@acme.example;www.acme.example;@acme;"VIP account"',
  ].join("\n");

  const result = parseImportContent({ name: "generic.csv", text: csv });
  assert.equal(result.leads.length, 1);
  const lead = result.leads[0];
  assert.equal(lead.name, "Acme, Inc.");
  assert.equal(lead.phone, "+1 512 555 0100");
  assert.deepEqual(lead.emails, ["hello@acme.example"]);
  assert.equal(lead.website, "https://www.acme.example/");
  assert.equal(lead.socials[0].url, "https://www.instagram.com/acme");
  assert.equal(lead.extraFields[0].label, "Notes");
  assert.equal(lead.extraFields[0].value, "VIP account");
});

test("imports raw Apify-style JSON without treating the Maps URL as the website", () => {
  const items = [
    {
      title: "Mesa Roasters",
      totalScore: 4.6,
      reviewsCount: 210,
      categoryName: "Coffee shop",
      address: "2 East Ave",
      website: "https://mesa.example",
      phone: "+1 512 555 0130",
      placeId: "apify-1",
      url: "https://www.google.com/maps/place/mesa-roasters",
      location: { lat: 30.2, lng: -97.7 },
      instagrams: ["https://www.instagram.com/mesaroasters"],
      permanentlyClosed: false,
    },
  ];

  const result = parseImportContent({
    name: "apify.json",
    text: JSON.stringify(items),
  });
  const lead = result.leads[0];
  assert.equal(lead.name, "Mesa Roasters");
  assert.equal(lead.website, "https://mesa.example/");
  assert.equal(lead.mapsUrl, "https://www.google.com/maps/place/mesa-roasters");
  assert.equal(lead.rating, 4.6);
  assert.equal(lead.reviewsCount, 210);
  assert.equal(lead.lat, 30.2);
  assert.equal(lead.lng, -97.7);
  assert.equal(lead.socials[0].label, "Instagram");
});

test("deduplicates rows and merges their contact details", () => {
  const csv = [
    "Business name,Phone,Email,Place ID",
    "Acme,5125550101,a@acme.example,place-1",
    "Acme,5125550102,b@acme.example,place-1",
  ].join("\n");

  const result = parseImportContent({ name: "dupes.csv", text: csv });
  assert.equal(result.leads.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.leads[0].phones, ["5125550101", "5125550102"]);
  assert.deepEqual(result.leads[0].emails, ["a@acme.example", "b@acme.example"]);
  assert.ok(result.warnings.some((warning) => warning.includes("duplicate")));
});

test("skips rows with no name or contact and caps ratings above five", () => {
  const csv = [
    "Name,Address,Rating,Website",
    ",1 Nowhere Rd,,",
    "Rated Place,Somewhere,8.7,https://rated.example",
  ].join("\n");

  const result = parseImportContent({ name: "messy.csv", text: csv });
  assert.equal(result.leads.length, 1);
  assert.equal(result.skippedRows, 1);
  assert.equal(result.leads[0].rating, 5);
  assert.ok(result.warnings.some((warning) => warning.includes("capped")));
});

test("reads JSONL files", () => {
  const jsonl = [
    JSON.stringify({ businessName: "One", phone: "5125550101" }),
    JSON.stringify({ businessName: "Two", phone: "5125550102" }),
  ].join("\n");

  const result = parseImportContent({ name: "leads.jsonl", text: jsonl });
  assert.equal(result.format, "jsonl");
  assert.equal(result.leads.length, 2);
});

test("CSV export round-trips imported leads and protects formulas", () => {
  const csv = [
    "Name,Phone,Website,Notes",
    "=Acme,5125550100,https://acme.example,Follow up",
  ].join("\n");
  const first = parseImportContent({ name: "leads.csv", text: csv });
  const exported = leadsToCsv(first.leads);

  assert.match(exported, /'=Acme/);
  assert.match(exported, /^\uFEFFBusiness name,/);

  const second = parseImportContent({ name: "roundtrip.csv", text: exported });
  assert.equal(second.leads.length, 1);
  assert.equal(second.leads[0].name, "'=Acme");
  assert.equal(second.leads[0].extraFields[0].label, "Notes");
  assert.equal(second.leads[0].extraFields[0].value, "Follow up");
});

test("JSON export carries extras and report metadata", () => {
  const csv = ["Name,Phone,Notes", "Acme,5125550100,Call Tuesday"].join("\n");
  const result = parseImportContent({ name: "leads.csv", text: csv });
  const payload = buildImportJson(result.leads, {
    fileName: "leads.csv",
    query: result.query,
    summary: { total: result.leads.length },
  });

  assert.equal(payload.report.sourceFile, "leads.csv");
  assert.equal(payload.leads[0].extraFields.Notes, "Call Tuesday");
  assert.equal(toExportLead(result.leads[0]).extraFields.Notes, "Call Tuesday");

  const roundTrip = parseImportContent({
    name: "leads.json",
    text: JSON.stringify(payload),
  });
  assert.equal(roundTrip.leads[0].extraFields[0].value, "Call Tuesday");
});

test("imports outreach marks, dates and notes from CSV", () => {
  const csv = [
    "Business name,Phone,Email,Outreach status,Contacted at,Outreach note,Outreach updated at",
    'Acme,5125550100,a@acme.example,Reached out,2026-10-20T15:30:00.000Z,"Left voicemail, call Friday",2026-10-21T09:00:00.000Z',
    "Beta,5125550101,,Do not contact,,Asked to be removed,2026-10-22T10:00:00.000Z",
    "Gamma,5125550102,,To contact,,,",
  ].join("\n");

  const result = parseImportContent({ name: "outreach.csv", text: csv });
  assert.equal(result.leads.length, 3);

  const [acme, beta, gamma] = result.leads;
  assert.equal(acme.outreachStatus, "contacted");
  assert.equal(acme.outreachSource, "file");
  assert.equal(acme.contactedAt, "2026-10-20T15:30:00.000Z");
  assert.equal(acme.outreachUpdatedAt, "2026-10-21T09:00:00.000Z");
  assert.equal(acme.outreachNote, "Left voicemail, call Friday");

  assert.equal(beta.outreachStatus, "do-not-contact");
  assert.equal(beta.outreachSource, "file");
  assert.equal(beta.outreachNote, "Asked to be removed");

  assert.equal(gamma.outreachStatus, "to-contact");
  assert.equal(gamma.outreachSource, null);
  assert.ok(result.mappedFields.includes("outreach"));
});

test("bare 'To contact' stays a default so a browser mark can win", () => {
  const csv = [
    "Business name,Phone,Outreach status",
    "Acme,5125550100,To contact",
  ].join("\n");

  const result = parseImportContent({ name: "bare.csv", text: csv });
  assert.equal(result.leads[0].outreachStatus, "to-contact");
  assert.equal(result.leads[0].outreachSource, null);
});

test("outreach survives CSV and JSON export round-trips", () => {
  const csv = [
    "Business name,Phone,Outreach status,Contacted at,Outreach note,Outreach updated at",
    'Acme,5125550100,Reached out,2026-10-20T15:30:00.000Z,"Spoke to Sam, send menu",2026-10-21T09:00:00.000Z',
    "Beta,5125550101,Do not contact,,Opted out,2026-10-22T10:00:00.000Z",
  ].join("\n");
  const first = parseImportContent({ name: "outreach.csv", text: csv });

  const csvExport = leadsToCsv(first.leads);
  assert.match(
    csvExport,
    /Emails,Outreach status,Contacted at,Outreach note,Outreach updated at/,
  );
  assert.match(csvExport, /Reached out,2026-10-20T15:30:00\.000Z/);
  assert.match(csvExport, /Spoke to Sam, send menu/);

  const csvRoundTrip = parseImportContent({ name: "roundtrip.csv", text: csvExport });
  assert.equal(csvRoundTrip.leads[0].outreachStatus, "contacted");
  assert.equal(csvRoundTrip.leads[0].outreachNote, "Spoke to Sam, send menu");
  assert.equal(csvRoundTrip.leads[0].contactedAt, "2026-10-20T15:30:00.000Z");
  assert.equal(csvRoundTrip.leads[1].outreachStatus, "do-not-contact");

  const payload = buildImportJson(first.leads, {
    fileName: "outreach.csv",
    query: first.query,
  });
  assert.equal(payload.report.outreach.total, 2);
  assert.equal(payload.report.outreach.contacted, 1);
  assert.equal(payload.report.outreach.doNotContact, 1);
  assert.equal(payload.leads[0].outreachStatus, "contacted");
  assert.equal(payload.leads[0].outreachStatusLabel, "Reached out");
  assert.equal(payload.leads[0].outreachNote, "Spoke to Sam, send menu");

  const jsonRoundTrip = parseImportContent({
    name: "roundtrip.json",
    text: JSON.stringify(payload),
  });
  assert.equal(jsonRoundTrip.leads[0].outreachStatus, "contacted");
  assert.equal(jsonRoundTrip.leads[0].contactedAt, "2026-10-20T15:30:00.000Z");
  assert.equal(jsonRoundTrip.leads[0].outreachNote, "Spoke to Sam, send menu");
  assert.equal(jsonRoundTrip.leads[1].outreachStatus, "do-not-contact");
});

test("rejects empty files and JSON without a lead array", () => {
  assert.throws(
    () => parseImportContent({ name: "empty.csv", text: "  " }),
    /file is empty/i,
  );
  assert.throws(
    () =>
      parseImportContent({
        name: "wrong.json",
        text: JSON.stringify({ hello: "world" }),
      }),
    /No lead array/i,
  );
  assert.throws(
    () => parseImportContent({ name: "bad.json", text: "{ nope" }),
    /could not be parsed/i,
  );
});

test("escapeCsvCell quotes separators, whitespace and doubles quotes", () => {
  assert.equal(escapeCsvCell("plain"), "plain");
  assert.equal(escapeCsvCell("with,comma"), '"with,comma"');
  assert.equal(escapeCsvCell('with"quote'), '"with""quote"');
  assert.equal(escapeCsvCell(" padded "), '" padded "');
  assert.equal(escapeCsvCell("=formula"), "'=formula");
  assert.equal(escapeCsvCell(42), "42");
});
