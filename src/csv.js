import { outreachCounts, outreachStatusLabel } from '../public/outreach-core.js';
import { toExportLead } from './leads.js';

const FORMULA_START = /^[=+\-@\t\r]/;

const COLUMNS = [
  ['Business name', (lead) => lead.name],
  ['Category', (lead) => lead.category],
  ['Primary phone', (lead) => lead.phone],
  ['All phones', (lead) => lead.phones.join(' | ')],
  ['Emails', (lead) => lead.emails.join(' | ')],
  ['Outreach status', (lead) => outreachStatusLabel(lead.outreachStatus)],
  ['Contacted at', (lead) => lead.contactedAt ?? ''],
  ['Outreach note', (lead) => lead.outreachNote ?? ''],
  ['Outreach updated at', (lead) => lead.outreachUpdatedAt ?? ''],
  ['Website', (lead) => lead.website],
  ['Has website', (lead) => (lead.hasWebsite ? 'Yes' : 'No')],
  ['Rating', (lead) => (lead.rating === null ? '' : lead.rating)],
  ['Reviews', (lead) => lead.reviewsCount ?? ''],
  ['Address', (lead) => lead.address],
  ['City', (lead) => lead.city],
  ['State / region', (lead) => lead.state],
  ['Postal code', (lead) => lead.postalCode],
  ['Country code', (lead) => lead.countryCode],
  ['Social profiles', (lead) => lead.socials.map((social) => social.url).join(' | ')],
  ['Google Maps link', (lead) => lead.mapsUrl],
  ['Place ID', (lead) => lead.placeId],
  ['Latitude', (lead) => lead.lat ?? ''],
  ['Longitude', (lead) => lead.lng ?? ''],
  ['Permanently closed', (lead) => (lead.permanentlyClosed ? 'Yes' : 'No')],
  ['Temporarily closed', (lead) => (lead.temporarilyClosed ? 'Yes' : 'No')],
  ['Search niche', (lead) => lead.searchNiche],
  ['Search location', (lead) => lead.searchLocation],
  ['Scraped at', (lead) => lead.scrapedAt],
  ['Apify run ID', (lead) => lead.runId],
];

function cellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let valueString = String(value);
  // Never allow a spreadsheet to treat scraped text as a formula.
  if (FORMULA_START.test(valueString)) valueString = `'${valueString}`;
  return valueString;
}

export function escapeCsvCell(value) {
  const cell = cellValue(value);
  if (/[",\r\n]/.test(cell) || /^\s|\s$/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function leadsToCsv(leads) {
  const header = COLUMNS.map(([label]) => escapeCsvCell(label)).join(',');
  const rows = leads.map((lead) =>
    COLUMNS.map(([, getter]) => escapeCsvCell(getter(lead))).join(','),
  );
  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}

export function buildJsonExport(leads, meta = {}) {
  return {
    report: {
      name: 'Lead Atlas field report',
      generatedAt: new Date().toISOString(),
      searchNiche: meta.query?.niche || null,
      searchLocation: meta.query?.location || null,
      apifyRunId: meta.runId || null,
      apifyActor: meta.actor || 'compass/crawler-google-places',
      totalLeads: leads.length,
      summary: meta.summary || null,
      outreach: outreachCounts(leads),
    },
    leads: leads.map(toExportLead),
  };
}

export function exportFilename({ niche, location, runId, extension }) {
  const slug = [niche, location]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  const date = new Date().toISOString().slice(0, 10);
  const suffix = runId ? `-${String(runId).slice(-6)}` : '';
  return `lead-atlas-${slug || 'export'}-${date}${suffix}.${extension}`;
}
