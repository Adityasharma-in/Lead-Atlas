import {
  OUTREACH,
  outreachCounts,
  outreachStatusLabel,
} from '../public/outreach-core.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_PROTOCOLS = new Set(['http:', 'https:']);

const SOCIAL_FIELDS = [
  ['instagrams', 'Instagram', 'instagram', 'https://www.instagram.com/'],
  ['facebooks', 'Facebook', 'facebook', 'https://www.facebook.com/'],
  ['linkedIns', 'LinkedIn', 'linkedin', 'https://www.linkedin.com/in/'],
  ['linkedins', 'LinkedIn', 'linkedin', 'https://www.linkedin.com/in/'],
  ['youtubes', 'YouTube', 'youtube', 'https://www.youtube.com/@'],
  ['tiktoks', 'TikTok', 'tiktok', 'https://www.tiktok.com/@'],
  ['twitters', 'X / Twitter', 'twitter', 'https://x.com/'],
  ['pinterests', 'Pinterest', 'pinterest', 'https://www.pinterest.com/'],
  ['snapchats', 'Snapchat', 'snapchat', 'https://www.snapchat.com/add/'],
];

const SOCIAL_HOSTS = [
  ['instagram.com', 'Instagram', 'instagram'],
  ['facebook.com', 'Facebook', 'facebook'],
  ['linkedin.com', 'LinkedIn', 'linkedin'],
  ['youtube.com', 'YouTube', 'youtube'],
  ['youtu.be', 'YouTube', 'youtube'],
  ['tiktok.com', 'TikTok', 'tiktok'],
  ['twitter.com', 'X / Twitter', 'twitter'],
  ['x.com', 'X / Twitter', 'twitter'],
  ['pinterest.com', 'Pinterest', 'pinterest'],
  ['snapchat.com', 'Snapchat', 'snapchat'],
  ['threads.net', 'Threads', 'threads'],
  ['t.me', 'Telegram', 'telegram'],
];

function text(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return '';
}

function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function safeUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    if (!/^(?:www\.)?(?:[\w-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(candidate)) return null;
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (!URL_PROTOCOLS.has(url.protocol)) return null;
    if (!url.hostname || url.hostname.includes(' ')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function domainOf(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function isEmail(value) {
  const email = text(value).replace(/^mailto:/i, '').toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function phoneDigits(value) {
  return text(value).replace(/[^\d]/g, '');
}

function cleanPhone(value) {
  const raw = text(value);
  if (!raw) return null;
  const digits = phoneDigits(raw);
  if (digits.length < 6 || digits.length > 20) return null;
  return raw.replace(/\s+/g, ' ').slice(0, 80);
}

function emailFromEntry(entry) {
  if (typeof entry === 'string') return isEmail(entry);
  if (!entry || typeof entry !== 'object') return null;
  return (
    isEmail(entry.email) ||
    isEmail(entry.value) ||
    isEmail(entry.address) ||
    isEmail(entry.emailAddress) ||
    isEmail(entry.contact)
  );
}

function phoneFromEntry(entry) {
  if (typeof entry === 'string' || typeof entry === 'number') return cleanPhone(entry);
  if (!entry || typeof entry !== 'object') return null;
  return (
    cleanPhone(entry.phone) ||
    cleanPhone(entry.phoneNumber) ||
    cleanPhone(entry.number) ||
    cleanPhone(entry.value) ||
    cleanPhone(entry.formatted) ||
    cleanPhone(entry.internationalFormat)
  );
}

function collectContacts(item) {
  const emailSources = [
    item.emails,
    item.email,
    item.impressum?.emails,
    item.impressum?.email,
    item.contact?.emails,
    item.contacts?.emails,
    item.enrichment?.emails,
    item.enriched?.emails,
  ];
  const phoneSources = [
    item.phones,
    item.phone,
    item.phoneUnformatted,
    item.impressum?.phones,
    item.impressum?.phone,
    item.contact?.phones,
    item.contacts?.phones,
    item.enrichment?.phones,
    item.enriched?.phones,
  ];

  const emails = [];
  const seenEmails = new Set();
  for (const source of emailSources) {
    for (const entry of toArray(source)) {
      const email = emailFromEntry(entry);
      if (email && !seenEmails.has(email)) {
        seenEmails.add(email);
        emails.push(email);
      }
    }
  }

  const phones = [];
  const seenPhones = new Set();
  for (const source of phoneSources) {
    for (const entry of toArray(source)) {
      const phone = phoneFromEntry(entry);
      const key = phone ? phoneDigits(phone) : '';
      if (phone && key && !seenPhones.has(key)) {
        seenPhones.add(key);
        phones.push(phone);
      }
    }
  }

  return { emails, phones };
}

function socialEntry(platformLabel, network, base, entry) {
  let url = null;
  let handle = '';

  if (typeof entry === 'string') {
    const raw = entry.trim();
    url = safeUrl(raw);
    if (!url && /^@?[a-z0-9_.-]{2,60}$/i.test(raw)) {
      handle = raw.replace(/^@/, '');
      url = `${base}${encodeURIComponent(handle)}`;
    }
  } else if (entry && typeof entry === 'object') {
    url = safeUrl(
      entry.url ||
        entry.link ||
        entry.profileUrl ||
        entry.profile ||
        entry.href ||
        entry.value,
    );
    handle = firstText(entry.username, entry.handle, entry.name, entry.title, entry.id);
  }

  if (!url) return null;
  if (!handle) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      handle = segments.length ? decodeURIComponent(segments[segments.length - 1]) : '';
      if (handle.startsWith('@')) handle = handle.slice(1);
    } catch {
      handle = '';
    }
  }

  return {
    network,
    label: platformLabel,
    url,
    handle: handle ? String(handle).slice(0, 80) : null,
  };
}

function networkFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    const known = SOCIAL_HOSTS.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
    if (known) return { label: known[1], network: known[2] };
  } catch {
    return null;
  }
  return { label: 'Social profile', network: 'social' };
}

function collectSocials(item) {
  const socials = [];
  const seen = new Set();
  const add = (social) => {
    if (!social || !social.url) return;
    const key = social.url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    socials.push(social);
  };

  for (const [field, label, network, base] of SOCIAL_FIELDS) {
    for (const entry of toArray(item[field])) {
      add(socialEntry(label, network, base, entry));
    }
  }

  const genericSources = [
    item.socialProfiles,
    item.socialMediaProfiles,
    item.socials,
    item.socialLinks,
  ];

  for (const source of genericSources) {
    if (!source) continue;
    if (Array.isArray(source)) {
      for (const entry of source) {
        if (typeof entry === 'string') {
          const url = safeUrl(entry);
          const meta = url ? networkFromUrl(url) : null;
          if (url && meta) add(socialEntry(meta.label, meta.network, '', url));
        } else if (entry && typeof entry === 'object') {
          const url = safeUrl(
            entry.url || entry.link || entry.profileUrl || entry.href || entry.value,
          );
          if (!url) continue;
          const inferred = networkFromUrl(url);
          add(
            socialEntry(
              firstText(entry.platform, entry.label, entry.network) || inferred?.label,
              firstText(entry.platform, entry.network).toLowerCase() || inferred?.network,
              '',
              { ...entry, url },
            ),
          );
        }
      }
    } else if (typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        for (const entry of toArray(value)) {
          const url = safeUrl(
            typeof entry === 'string'
              ? entry
              : entry?.url || entry?.link || entry?.profileUrl || entry?.value,
          );
          add(
            socialEntry(
              label,
              key.toLowerCase(),
              '',
              typeof entry === 'string' ? url : { ...entry, url },
            ),
          );
        }
      }
    }
  }

  return socials;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.max(0, Math.round(number));
}

function isoDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function boolOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return null;
}

function mapsUrlFor(item, name, address, placeId) {
  const explicit = [
    item.url,
    item.googleMapsUrl,
    item.mapsUrl,
    item.placeUrl,
    item.googleMapsPlaceUrl,
  ]
    .map(safeUrl)
    .find((url) => url && /(^|\.)google\.[a-z.]+$/i.test(new URL(url).hostname.replace(/^www\./, '')));

  if (explicit) return explicit;

  const fallback = new URL('https://www.google.com/maps/search/');
  fallback.searchParams.set('api', '1');
  fallback.searchParams.set('query', [name, address].filter(Boolean).join(' ') || 'Google Maps place');
  if (placeId) fallback.searchParams.set('query_place_id', placeId);
  return fallback.toString();
}

function createLead(item, context) {
  const name = firstText(item.title, item.name, item.businessName) || 'Unnamed place';
  const address = firstText(
    item.address,
    item.fullAddress,
    [item.street, item.city, item.state, item.postalCode].filter(Boolean).join(', '),
  );
  const placeId = firstText(item.placeId, item.place_id, item.fid, item.fsq_id) || null;
  const website = safeUrl(item.website || item.websiteUrl || item.domain);
  const { emails, phones } = collectContacts(item);
  const socials = collectSocials(item);
  const categories = toArray(item.categories)
    .map((value) => (typeof value === 'string' ? value.trim() : text(value?.name || value?.title)))
    .filter(Boolean)
    .slice(0, 12);
  const category = firstText(item.categoryName, item.category, categories[0]) || 'Business';
  const rating = numberOrNull(item.totalScore ?? item.rating ?? item.stars);
  const reviewsCount = integerOrNull(
    item.reviewsCount ?? item.reviewCount ?? item.reviews ?? item.userRatingsTotal,
  );
  const mapsUrl = mapsUrlFor(item, name, address, placeId);
  const lat = numberOrNull(item.location?.lat ?? item.lat ?? item.latitude);
  const lng = numberOrNull(item.location?.lng ?? item.lng ?? item.longitude);

  return {
    id: placeId ? `place-${placeId}` : `lead-${context.index}`,
    placeId,
    name,
    category,
    categories,
    address: address || null,
    city: firstText(item.city, item.addressInfo?.city) || null,
    state: firstText(item.state, item.addressInfo?.state) || null,
    postalCode: firstText(item.postalCode, item.zip, item.addressInfo?.postalCode) || null,
    countryCode: firstText(item.countryCode, item.addressInfo?.countryCode) || null,
    website,
    domain: domainOf(website),
    hasWebsite: Boolean(website),
    phone: phones[0] || null,
    phones,
    emails,
    outreachStatus: OUTREACH.TODO,
    outreachStatusLabel: outreachStatusLabel(OUTREACH.TODO),
    contactedAt: null,
    outreachUpdatedAt: null,
    outreachNote: null,
    socials,
    rating: rating === null ? null : Math.min(5, Math.max(0, Math.round(rating * 10) / 10)),
    reviewsCount,
    priceLevel: firstText(item.price, item.priceLevel) || null,
    mapsUrl,
    lat: lat === null ? null : Math.round(lat * 1e7) / 1e7,
    lng: lng === null ? null : Math.round(lng * 1e7) / 1e7,
    permanentlyClosed: boolOrNull(item.permanentlyClosed) ?? false,
    temporarilyClosed: boolOrNull(item.temporarilyClosed) ?? false,
    claimed: boolOrNull(item.claimed),
    scrapedAt: isoDateOrNull(item.scrapedAt || item.scraped_at || context.fetchedAt),
    searchNiche: context.query?.niche || null,
    searchLocation: context.query?.location || null,
    runId: context.runId || null,
  };
}

function dedupeKey(lead) {
  if (lead.placeId) return `place:${lead.placeId}`;
  return `name:${lead.name.toLowerCase()}|${(lead.address || '').toLowerCase()}`;
}

function mergeLead(existing, incoming) {
  const merged = { ...existing };
  for (const field of [
    'website',
    'domain',
    'hasWebsite',
    'phone',
    'address',
    'city',
    'state',
    'postalCode',
    'countryCode',
    'rating',
    'reviewsCount',
    'priceLevel',
    'lat',
    'lng',
    'claimed',
    'scrapedAt',
  ]) {
    if (
      (merged[field] === null || merged[field] === undefined || merged[field] === '') &&
      incoming[field] !== null &&
      incoming[field] !== undefined &&
      incoming[field] !== ''
    ) {
      merged[field] = incoming[field];
    }
  }
  merged.emails = [...new Set([...existing.emails, ...incoming.emails])];
  const phoneKeys = new Set(existing.phones.map(phoneDigits));
  merged.phones = [...existing.phones];
  for (const phone of incoming.phones) {
    const digits = phoneDigits(phone);
    if (digits && !phoneKeys.has(digits)) {
      phoneKeys.add(digits);
      merged.phones.push(phone);
    }
  }
  merged.phone = merged.phones[0] || null;
  const socialKeys = new Set(existing.socials.map((social) => social.url));
  merged.socials = [...existing.socials];
  for (const social of incoming.socials) {
    if (!socialKeys.has(social.url)) {
      socialKeys.add(social.url);
      merged.socials.push(social);
    }
  }
  merged.permanentlyClosed = existing.permanentlyClosed || incoming.permanentlyClosed;
  merged.temporarilyClosed = existing.temporarilyClosed || incoming.temporarilyClosed;
  return merged;
}

export function normalizeLeads(items, { query = null, runId = null, fetchedAt = new Date() } = {}) {
  if (!Array.isArray(items)) {
    return {
      leads: [],
      summary: summarizeLeads([]),
      total: 0,
      duplicateCount: 0,
      query,
      runId,
    };
  }

  const fetchedAtIso = fetchedAt instanceof Date ? fetchedAt.toISOString() : String(fetchedAt);
  const byKey = new Map();
  let duplicateCount = 0;

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const lead = createLead(item, { index: index + 1, query, runId, fetchedAt: fetchedAtIso });
    const key = dedupeKey(lead);
    if (byKey.has(key)) {
      duplicateCount += 1;
      byKey.set(key, mergeLead(byKey.get(key), lead));
    } else {
      byKey.set(key, lead);
    }
  });

  const leads = [...byKey.values()];
  return {
    leads,
    summary: summarizeLeads(leads),
    total: leads.length,
    duplicateCount,
    query,
    runId,
  };
}

export function summarizeLeads(leads) {
  const summary = {
    total: leads.length,
    withWebsite: 0,
    withoutWebsite: 0,
    withEmail: 0,
    withPhone: 0,
    withContact: 0,
    withSocial: 0,
    closed: 0,
    avgRating: null,
    totalReviews: 0,
    contactRate: 0,
  };

  let ratingSum = 0;
  let ratingCount = 0;

  for (const lead of leads) {
    if (lead.hasWebsite) summary.withWebsite += 1;
    else summary.withoutWebsite += 1;
    if (lead.emails.length) summary.withEmail += 1;
    if (lead.phones.length) summary.withPhone += 1;
    if (lead.emails.length || lead.phones.length) summary.withContact += 1;
    if (lead.socials.length) summary.withSocial += 1;
    if (lead.permanentlyClosed || lead.temporarilyClosed) summary.closed += 1;
    if (typeof lead.rating === 'number') {
      ratingSum += lead.rating;
      ratingCount += 1;
    }
    summary.totalReviews += lead.reviewsCount || 0;
  }

  if (ratingCount > 0) summary.avgRating = Math.round((ratingSum / ratingCount) * 10) / 10;
  if (leads.length > 0) {
    summary.contactRate = Math.round((summary.withContact / leads.length) * 100);
  }
  summary.outreach = outreachCounts(leads);
  return summary;
}

export function toExportLead(lead) {
  return {
    businessName: lead.name,
    category: lead.category,
    categories: lead.categories,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    postalCode: lead.postalCode,
    countryCode: lead.countryCode,
    phone: lead.phone,
    phones: lead.phones,
    emails: lead.emails,
    outreachStatus: lead.outreachStatus || OUTREACH.TODO,
    outreachStatusLabel: outreachStatusLabel(lead.outreachStatus),
    contactedAt: lead.contactedAt || null,
    outreachUpdatedAt: lead.outreachUpdatedAt || null,
    outreachNote: lead.outreachNote || null,
    website: lead.website,
    hasWebsite: lead.hasWebsite,
    rating: lead.rating,
    reviewsCount: lead.reviewsCount,
    priceLevel: lead.priceLevel,
    socialProfiles: lead.socials.map((social) => ({
      network: social.network,
      label: social.label,
      url: social.url,
      handle: social.handle,
    })),
    googleMapsUrl: lead.mapsUrl,
    placeId: lead.placeId,
    latitude: lead.lat,
    longitude: lead.lng,
    permanentlyClosed: lead.permanentlyClosed,
    temporarilyClosed: lead.temporarilyClosed,
    searchNiche: lead.searchNiche,
    searchLocation: lead.searchLocation,
    scrapedAt: lead.scrapedAt,
    apifyRunId: lead.runId,
  };
}
