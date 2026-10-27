/**
 * Lead file import engine.
 *
 * Pure functions only — no DOM and no network. The browser app uses this to
 * read a CSV/JSON lead file locally and render it in the same report UI as a
 * live Apify scan. The test suite imports the same functions in Node.
 */

import {
  OUTREACH,
  normalizeOutreachDate,
  normalizeOutreachNote,
  normalizeOutreachStatus,
  outreachCounts,
  outreachStatusLabel,
} from "./outreach-core.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_EXTRAS = 12;
const EXTRA_VALUE_LIMIT = 280;
const MAX_EXPORT_EXTRA_COLUMNS = 20;
const FORMULA_START = /^[=+\-@\t\r]/;
const numberFormatter = new Intl.NumberFormat("en-US");

export const IMPORT_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxLeads: 5000,
};

const ALIASES = {
  name: [
    "businessname",
    "name",
    "title",
    "business",
    "company",
    "companyname",
    "place",
    "placename",
    "listingname",
    "storename",
    "merchantname",
  ],
  category: [
    "category",
    "categoryname",
    "primarycategory",
    "type",
    "industry",
    "businesscategory",
    "sector",
  ],
  categories: ["categories", "allcategories", "tags"],
  primaryPhone: [
    "primaryphone",
    "phone",
    "phonenumber",
    "telephone",
    "tel",
    "phone1",
    "mainphone",
    "mobile",
    "mobilephone",
    "contactphone",
    "whatsapp",
  ],
  allPhones: ["allphones", "phones", "phonenumbers", "allnumbers", "extraphones", "secondaryphones"],
  primaryEmail: ["primaryemail", "email", "emailaddress", "contactemail", "mail", "email1"],
  allEmails: ["emails", "emailaddresses", "allemails", "extemails"],
  website: [
    "website",
    "websiteurl",
    "web",
    "site",
    "url",
    "companywebsite",
    "homepage",
    "webaddress",
    "domain",
  ],
  address: [
    "address",
    "fulladdress",
    "streetaddress",
    "locationaddress",
    "street",
    "location",
  ],
  city: ["city", "town", "locality"],
  state: ["state", "stateregion", "region", "province", "stateprovince", "county"],
  postalCode: ["postalcode", "postcode", "zip", "zipcode", "pincode", "pin"],
  countryCode: ["countrycode", "country"],
  rating: [
    "rating",
    "stars",
    "star",
    "score",
    "totalscore",
    "averagerating",
    "googlerating",
    "reviewrating",
    "starscore",
  ],
  reviewsCount: [
    "reviews",
    "reviewcount",
    "reviewscount",
    "usercount",
    "userratingscount",
    "userratingstotal",
    "numberofreviews",
    "totalreviews",
    "reviewtotal",
  ],
  priceLevel: ["pricelevel", "price", "pricerange", "pricedescription"],
  socialProfiles: [
    "socialprofiles",
    "socials",
    "sociallinks",
    "socialmediaprofiles",
    "socialmedia",
    "socialprofile",
    "social",
  ],
  mapsUrl: [
    "googlemapslink",
    "googlemapsurl",
    "mapsurl",
    "maplink",
    "googlemaps",
    "placeurl",
    "googleplaceurl",
    "googlelink",
    "mapurl",
  ],
  placeId: ["placeid", "fid", "fsqid", "googleplaceid", "businessplaceid", "googleid"],
  lat: ["latitude", "lat"],
  lng: ["longitude", "lng", "lon", "long"],
  permanentlyClosed: [
    "permanentlyclosed",
    "permclosed",
    "closedpermanently",
    "ispermanentlyclosed",
  ],
  temporarilyClosed: [
    "temporarilyclosed",
    "tempclosed",
    "closedtemporarily",
    "istemporarilyclosed",
  ],
  status: ["status", "businessstatus", "openstatus", "openingstatus"],
  scrapedAt: ["scrapedat", "scraped", "createdat", "extractedat", "importedat", "date"],
  niche: ["searchniche", "niche", "searchterm", "query", "keyword", "keywords", "search"],
  searchLocation: ["searchlocation", "searcharea", "market"],
  runId: ["apifyrunid", "runid", "apifyrun"],
  claimed: ["claimed", "isclaimed", "verified"],
  hasWebsite: ["haswebsite", "websiteavailable"],
  outreachStatus: [
    "outreachstatus",
    "outreachstatuslabel",
    "contactstatus",
    "contactstatuslabel",
    "contactedstatus",
    "outreachstate",
    "outreach",
    "leadstatus",
    "crmstatus",
    "followupstatus",
  ],
  outreachNote: [
    "outreachnote",
    "outreachnotes",
    "contactnote",
    "contactnotes",
    "followupnote",
    "followupnotes",
    "outreachcomment",
  ],
  contactedAt: [
    "contactedat",
    "contactedon",
    "lastcontacted",
    "lastcontactedat",
    "lastcontactdate",
    "contactdate",
    "datecontacted",
    "outreachdate",
    "reachedoutat",
  ],
  outreachUpdatedAt: [
    "outreachupdatedat",
    "outreachupdatedon",
    "contactstatusupdatedat",
    "contactupdatedat",
    "outreachstatusupdatedat",
  ],
  contactedFlag: [
    "contacted",
    "iscontacted",
    "hasbeencontacted",
    "reachedout",
    "alreadycontacted",
  ],
  doNotContact: [
    "donotcontact",
    "donotcontactagain",
    "doesnotwantcontact",
    "nevercontact",
    "optout",
    "optedout",
    "dnc",
    "blocked",
  ],
};

const SOCIAL_FIELDS = [
  {
    network: "instagram",
    label: "Instagram",
    base: "https://www.instagram.com/",
    aliases: ["instagram", "instagramurl", "instagramprofile", "instagramhandle", "instagrams"],
  },
  {
    network: "facebook",
    label: "Facebook",
    base: "https://www.facebook.com/",
    aliases: ["facebook", "facebookurl", "facebookprofile", "facebookpage", "facebooks"],
  },
  {
    network: "linkedin",
    label: "LinkedIn",
    base: "https://www.linkedin.com/in/",
    aliases: ["linkedin", "linkedinurl", "linkedinprofile", "linkedins", "linkedinpage"],
  },
  {
    network: "youtube",
    label: "YouTube",
    base: "https://www.youtube.com/@",
    aliases: ["youtube", "youtubeurl", "youtubechannel", "youtubeprofile", "youtubes"],
  },
  {
    network: "tiktok",
    label: "TikTok",
    base: "https://www.tiktok.com/@",
    aliases: ["tiktok", "tiktokurl", "tiktokprofile", "tiktoks"],
  },
  {
    network: "twitter",
    label: "X / Twitter",
    base: "https://x.com/",
    aliases: [
      "twitter",
      "twitterurl",
      "twitterprofile",
      "twitterhandle",
      "twitters",
      "xprofile",
      "xhandle",
    ],
  },
  {
    network: "pinterest",
    label: "Pinterest",
    base: "https://www.pinterest.com/",
    aliases: ["pinterest", "pinteresturl", "pinterestprofile", "pinterests"],
  },
  {
    network: "snapchat",
    label: "Snapchat",
    base: "https://www.snapchat.com/add/",
    aliases: ["snapchat", "snapchaturl", "snapchatprofile", "snapchats"],
  },
  {
    network: "threads",
    label: "Threads",
    base: "https://www.threads.net/@",
    aliases: ["threads", "threadsurl", "threadsprofile"],
  },
  {
    network: "telegram",
    label: "Telegram",
    base: "https://t.me/",
    aliases: ["telegram", "telegramurl", "telegramprofile"],
  },
];

const SOCIAL_HOSTS = [
  ["instagram.com", "Instagram", "instagram"],
  ["facebook.com", "Facebook", "facebook"],
  ["fb.com", "Facebook", "facebook"],
  ["linkedin.com", "LinkedIn", "linkedin"],
  ["youtube.com", "YouTube", "youtube"],
  ["youtu.be", "YouTube", "youtube"],
  ["tiktok.com", "TikTok", "tiktok"],
  ["twitter.com", "X / Twitter", "twitter"],
  ["x.com", "X / Twitter", "twitter"],
  ["pinterest.com", "Pinterest", "pinterest"],
  ["snapchat.com", "Snapchat", "snapchat"],
  ["threads.net", "Threads", "threads"],
  ["t.me", "Telegram", "telegram"],
];

const EXTRA_KEY_DENYLIST = new Set([
  "imageurl",
  "imageurls",
  "images",
  "photos",
  "photo",
  "thumbnail",
  "thumbnails",
  "logo",
  "logourl",
  "openinghours",
  "openinghoursstructured",
  "openinghoursextra",
  "populartimes",
  "reviews",
  "reviewsdistribution",
  "menu",
  "orderby",
  "reservetableurl",
  "tablebookingurl",
  "detailedhours",
  "additionalinfo",
  "location",
  "addressinfo",
]);

const ALL_ALIAS_KEYS = new Set([
  ...Object.values(ALIASES).flat(),
  ...SOCIAL_FIELDS.flatMap((field) => field.aliases),
]);

function formatCount(value) {
  return numberFormatter.format(Number(value) || 0);
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function firstValue(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = text(entry);
      if (candidate) return candidate;
    }
    return "";
  }
  return text(value);
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function toArray(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function mapFor(item) {
  const map = new Map();
  if (!item || typeof item !== "object") return map;
  for (const [key, value] of Object.entries(item)) {
    const normalized = normalizeKey(key);
    if (!normalized || map.has(normalized)) continue;
    map.set(normalized, value);
  }
  return map;
}

function pick(map, aliases) {
  for (const alias of aliases) {
    if (!map.has(alias)) continue;
    const value = map.get(alias);
    if (value === undefined || value === null || value === "") continue;
    return value;
  }
  return "";
}

function pickText(map, aliases) {
  return firstValue(pick(map, aliases));
}

function safeUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  let candidate = raw;
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    if (!/^(?:www\.)?(?:[\w-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(candidate)) return null;
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (!URL_PROTOCOLS.has(url.protocol)) return null;
    if (!url.hostname || url.hostname.includes(" ")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function domainOf(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function isEmail(value) {
  const email = text(value).replace(/^mailto:/i, "").toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function phoneDigits(value) {
  return text(value).replace(/[^\d]/g, "");
}

function cleanPhone(value) {
  const raw = text(value);
  if (!raw) return null;
  const digits = phoneDigits(raw);
  if (digits.length < 6 || digits.length > 20) return null;
  return raw.replace(/\s+/g, " ").slice(0, 80);
}

function emailFromEntry(entry) {
  if (typeof entry === "string") return isEmail(entry);
  if (!entry || typeof entry !== "object") return null;
  return (
    isEmail(entry.email) ||
    isEmail(entry.value) ||
    isEmail(entry.address) ||
    isEmail(entry.emailAddress) ||
    isEmail(entry.contact)
  );
}

function phoneFromEntry(entry) {
  if (typeof entry === "string" || typeof entry === "number") return cleanPhone(entry);
  if (!entry || typeof entry !== "object") return null;
  return (
    cleanPhone(entry.phone) ||
    cleanPhone(entry.phoneNumber) ||
    cleanPhone(entry.number) ||
    cleanPhone(entry.value) ||
    cleanPhone(entry.formatted) ||
    cleanPhone(entry.internationalFormat)
  );
}

function splitCellValues(value, pattern) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap((entry) => splitCellValues(entry, pattern));
  return String(value)
    .split(pattern)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function phoneParts(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => phoneParts(entry));
  const raw = text(value);
  if (!raw) return [];
  return raw
    .split(/[|;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const slashed = entry.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
      if (slashed.length > 1) return slashed;
      const commaSeparated = entry.split(/\s*,\s*/);
      if (
        commaSeparated.length > 1 &&
        commaSeparated.every((part) => phoneDigits(part).length >= 6)
      ) {
        return commaSeparated;
      }
      return [entry];
    });
}

function numberOrNull(value, { commaDecimal = false } = {}) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value).trim();
  if (!raw) return null;
  raw = raw.replace(/\/\s*\d+(?:[.,]\d+)?\s*$/, "");
  raw = raw.replace(/[^\d.,+\-]/g, "");
  if (!raw) return null;
  if (commaDecimal && raw.includes(",") && !raw.includes(".")) {
    raw = raw.replace(",", ".");
  } else if (raw.includes(",") && raw.includes(".")) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else {
    raw = raw.replace(/,/g, "");
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.max(0, Math.round(parsed));
}

function isoDateOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e12 ? value : value > 1e9 ? value * 1000 : null;
    if (!milliseconds) return null;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function boolOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "closed"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "open", "not closed"].includes(normalized)) return false;
  return null;
}

function isGoogleMapsUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "maps.app.goo.gl" || host === "goo.gl") return parsed.pathname.startsWith("/maps");
    if (!/(^|\.)google\.[a-z.]+$/i.test(host)) return false;
    return parsed.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

function networkFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    const known = SOCIAL_HOSTS.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
    if (known) return { label: known[1], network: known[2] };
  } catch {
    return null;
  }
  return { label: "Social profile", network: "social" };
}

function handleFromUrl(url) {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    if (!segments.length) return "";
    const handle = decodeURIComponent(segments[segments.length - 1]);
    return handle.replace(/^@/, "");
  } catch {
    return "";
  }
}

function socialFromValue(value, meta = {}) {
  let url = null;
  let handle = "";

  if (typeof value === "string") {
    const raw = value.trim();
    url = safeUrl(raw);
    if (!url && /^@?[a-z0-9_.-]{2,60}$/i.test(raw)) {
      handle = raw.replace(/^@/, "");
      const base =
        meta.base ||
        SOCIAL_FIELDS.find((field) => field.network === meta.network)?.base ||
        "";
      if (base) url = `${base}${encodeURIComponent(handle)}`;
    }
  } else if (value && typeof value === "object") {
    url = safeUrl(
      value.url ||
        value.link ||
        value.profileUrl ||
        value.profile ||
        value.href ||
        value.value,
    );
    handle = firstText(value.username, value.handle, value.name, value.title, value.id);
  }

  if (!url) return null;
  const inferred = networkFromUrl(url);
  const network = meta.network || inferred?.network || "social";
  const label = meta.label || inferred?.label || "Social profile";
  if (!handle) handle = handleFromUrl(url);

  return {
    network,
    label,
    url,
    handle: handle ? String(handle).slice(0, 80) : null,
  };
}

function socialEntries(value, networkHint = "") {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => socialEntries(entry, networkHint));
  }
  if (typeof value === "object") {
    if (value.url || value.link || value.profileUrl || value.profile || value.href || value.value) {
      return [{ value, networkHint }];
    }
    return Object.entries(value).flatMap(([key, entry]) => socialEntries(entry, key));
  }
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      return socialEntries(JSON.parse(raw), networkHint);
    } catch {
      /* treat it as a plain cell */
    }
  }
  return raw
    .split(/[|;\n]+/)
    .flatMap((entry) => entry.split(/\s+(?=https?:\/\/)/))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ({ value: entry, networkHint }));
}

function collectSocials(map) {
  const socials = [];
  const seen = new Set();
  const add = (social) => {
    if (!social?.url) return;
    const key = social.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    socials.push(social);
  };

  for (const field of SOCIAL_FIELDS) {
    for (const entry of socialEntries(pick(map, field.aliases))) {
      add(
        socialFromValue(entry.value, {
          label: field.label,
          network: field.network,
          base: field.base,
        }),
      );
    }
  }

  for (const entry of socialEntries(pick(map, ALIASES.socialProfiles))) {
    const value = entry.value;
    const platform =
      value && typeof value === "object"
        ? firstText(value.platform, value.label, value.network)
        : "";
    const hint = entry.networkHint ? normalizeKey(entry.networkHint) : "";
    const hinted = hint
      ? SOCIAL_FIELDS.find(
          (field) =>
            field.network === hint ||
            normalizeKey(field.label) === hint ||
            field.aliases.includes(hint),
        )
      : null;
    const meta = platform
      ? { label: platform, network: normalizeKey(platform) }
      : hinted
        ? { label: hinted.label, network: hinted.network, base: hinted.base }
        : {};
    add(socialFromValue(value, meta));
  }

  return socials;
}

function collectEmails(map) {
  const emails = [];
  const seen = new Set();
  const add = (email) => {
    if (!email || seen.has(email)) return;
    seen.add(email);
    emails.push(email);
  };

  for (const source of [pick(map, ALIASES.allEmails), pick(map, ALIASES.primaryEmail)]) {
    for (const entry of toArray(source)) {
      if (entry && typeof entry === "object") {
        add(emailFromEntry(entry));
        continue;
      }
      for (const part of splitCellValues(entry, /[,;|\s]+/)) {
        add(isEmail(part));
      }
    }
  }
  return emails;
}

function collectPhones(map) {
  const phones = [];
  const seen = new Set();
  const add = (phone) => {
    const key = phone ? phoneDigits(phone) : "";
    if (!phone || !key || seen.has(key)) return;
    seen.add(key);
    phones.push(phone);
  };

  for (const source of [pick(map, ALIASES.primaryPhone), pick(map, ALIASES.allPhones)]) {
    for (const entry of toArray(source)) {
      if (entry && typeof entry === "object") {
        add(phoneFromEntry(entry));
        continue;
      }
      for (const part of phoneParts(entry)) {
        add(cleanPhone(part));
      }
    }
  }
  return phones;
}

function categoriesFor(map) {
  const raw = pick(map, ALIASES.categories);
  let values = [];
  if (Array.isArray(raw)) {
    values = raw
      .map((entry) =>
        typeof entry === "string" ? entry.trim() : text(entry?.name || entry?.title),
      )
      .filter(Boolean);
  } else {
    values = splitCellValues(raw, /[,|;]+/);
  }
  return [...new Set(values)].slice(0, 12);
}

function extraValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim().slice(0, EXTRA_VALUE_LIMIT);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => extraValue(entry))
      .filter(Boolean)
      .join(" · ")
      .slice(0, EXTRA_VALUE_LIMIT);
  }
  return "";
}

function collectExtras(item) {
  const extras = [];
  const seen = new Set();
  const add = (label, value) => {
    const display = extraValue(value);
    if (!display) return;
    const trimmedLabel = String(label ?? "").trim().slice(0, 60);
    if (!trimmedLabel) return;
    const key = trimmedLabel.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    extras.push({ label: trimmedLabel, value: display });
  };

  if (!item || typeof item !== "object") return extras;
  for (const [key, value] of Object.entries(item)) {
    const normalized = normalizeKey(key);
    if (!normalized) continue;

    if (normalized === "extrafields" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [label, entry] of Object.entries(value)) add(label, entry);
      continue;
    }
    if (ALL_ALIAS_KEYS.has(normalized) || EXTRA_KEY_DENYLIST.has(normalized)) continue;
    add(key, value);
    if (extras.length >= MAX_EXTRAS) break;
  }
  return extras.slice(0, MAX_EXTRAS);
}

function searchMapsUrl(name, address, placeId) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", [name, address].filter(Boolean).join(" ") || "Google Maps place");
  if (placeId) url.searchParams.set("query_place_id", placeId);
  return url.toString();
}

function parseOutreach(map) {
  const statusText = pickText(map, ALIASES.outreachStatus);
  let status = normalizeOutreachStatus(statusText);
  let contactedAt = normalizeOutreachDate(pickText(map, ALIASES.contactedAt));
  let updatedAt = normalizeOutreachDate(pickText(map, ALIASES.outreachUpdatedAt));
  const note = normalizeOutreachNote(pickText(map, ALIASES.outreachNote)) || null;

  const contactedRaw = pick(map, ALIASES.contactedFlag);
  const contactedFlag = boolOrNull(contactedRaw);
  const contactedDate =
    contactedFlag === null ? normalizeOutreachDate(contactedRaw) : null;
  if (!contactedAt && contactedDate) contactedAt = contactedDate;

  const doNotContactFlag = boolOrNull(pick(map, ALIASES.doNotContact));

  let explicit = false;
  if (status !== null) {
    // A bare “To contact” cell is the same as no mark, so a local outreach
    // ledger is still allowed to fill in a newer contacted state.
    explicit = status !== OUTREACH.TODO || Boolean(contactedAt || updatedAt || note);
  }

  if (doNotContactFlag === true) {
    status = OUTREACH.DO_NOT_CONTACT;
    explicit = true;
  } else if (contactedFlag === true) {
    status = OUTREACH.CONTACTED;
    explicit = true;
  } else if (contactedFlag === false) {
    status = OUTREACH.TODO;
    explicit = true;
  } else if (doNotContactFlag === false) {
    status = status || OUTREACH.TODO;
    explicit = true;
  }

  if (contactedDate) {
    status = OUTREACH.CONTACTED;
    explicit = true;
  }
  if (!status && contactedAt) {
    status = OUTREACH.CONTACTED;
    explicit = true;
  }
  if (!explicit && (note || updatedAt)) {
    status = status || OUTREACH.TODO;
    explicit = true;
  }

  return {
    status: status || OUTREACH.TODO,
    explicit,
    contactedAt,
    updatedAt,
    note,
  };
}

function createLead(item, index, fallbackName = "") {
  const map = mapFor(item);
  let name = pickText(map, ALIASES.name);
  const nameFromFallback = !name && Boolean(fallbackName);
  if (!name && fallbackName) name = fallbackName;

  const categories = categoriesFor(map);
  const category = pickText(map, ALIASES.category) || categories[0] || "Business";
  const emails = collectEmails(map);
  const phones = collectPhones(map);
  const socials = collectSocials(map);

  let website = safeUrl(pick(map, ALIASES.website));
  let mapsUrl = safeUrl(pick(map, ALIASES.mapsUrl));
  if (website && isGoogleMapsUrl(website)) {
    if (!mapsUrl) mapsUrl = website;
    website = null;
  }
  if (!mapsUrl) {
    // Apify's raw dataset uses `url` for the Maps listing and `website` for
    // the business site. Treat `url` as a map link only when it really is one.
    const genericUrl = safeUrl(map.get("url"));
    if (genericUrl && isGoogleMapsUrl(genericUrl)) mapsUrl = genericUrl;
  }
  if (!name && website) {
    name = domainOf(website) || "";
  }

  const city =
    pickText(map, ALIASES.city) ||
    firstText(map.get("addressinfo")?.city) ||
    null;
  const state =
    pickText(map, ALIASES.state) ||
    firstText(map.get("addressinfo")?.state) ||
    null;
  const postalCode =
    pickText(map, ALIASES.postalCode) ||
    firstText(map.get("addressinfo")?.postalCode) ||
    null;
  const countryCode =
    pickText(map, ALIASES.countryCode) ||
    firstText(map.get("addressinfo")?.countryCode) ||
    null;
  const rawAddress = pick(map, ALIASES.address);
  const addressText =
    typeof rawAddress === "string" || typeof rawAddress === "number" ? text(rawAddress) : "";
  const address =
    addressText || [city, state, postalCode].filter(Boolean).join(", ") || null;

  const placeId = pickText(map, ALIASES.placeId) || null;
  const ratingRaw = numberOrNull(pick(map, ALIASES.rating), { commaDecimal: true });
  const ratingCapped = ratingRaw !== null && ratingRaw > 5;
  const rating =
    ratingRaw === null ? null : Math.min(5, Math.max(0, Math.round(ratingRaw * 10) / 10));
  const reviewsCount = integerOrNull(pick(map, ALIASES.reviewsCount));
  const priceLevel = pickText(map, ALIASES.priceLevel) || null;

  const locationValue = map.get("location");
  const coordinatesValue = map.get("coordinates");
  const geoValue = map.get("geo");
  const latRaw = numberOrNull(
    firstPresent(
      pick(map, ALIASES.lat),
      locationValue?.lat,
      locationValue?.latitude,
      coordinatesValue?.lat,
      coordinatesValue?.latitude,
      geoValue?.lat,
      geoValue?.latitude,
    ),
    { commaDecimal: true },
  );
  const lngRaw = numberOrNull(
    firstPresent(
      pick(map, ALIASES.lng),
      locationValue?.lng,
      locationValue?.lon,
      locationValue?.longitude,
      coordinatesValue?.lng,
      coordinatesValue?.lon,
      coordinatesValue?.longitude,
      geoValue?.lng,
      geoValue?.lon,
      geoValue?.longitude,
    ),
    { commaDecimal: true },
  );
  const lat =
    latRaw !== null && latRaw >= -90 && latRaw <= 90 ? Math.round(latRaw * 1e7) / 1e7 : null;
  const lng =
    lngRaw !== null && lngRaw >= -180 && lngRaw <= 180
      ? Math.round(lngRaw * 1e7) / 1e7
      : null;

  const status = pickText(map, ALIASES.status).toLowerCase();
  const permanentlyClosed =
    boolOrNull(pick(map, ALIASES.permanentlyClosed)) ??
    (status.startsWith("permanently") || status === "closed");
  const temporarilyClosed =
    boolOrNull(pick(map, ALIASES.temporarilyClosed)) ?? status.startsWith("temporarily");
  const claimed = boolOrNull(pick(map, ALIASES.claimed));
  const scrapedAt = isoDateOrNull(pick(map, ALIASES.scrapedAt));
  const searchNiche = pickText(map, ALIASES.niche) || null;
  const searchLocation = pickText(map, ALIASES.searchLocation) || null;
  const runId = pickText(map, ALIASES.runId) || null;
  const outreach = parseOutreach(map);
  const extraFields = collectExtras(item);

  const finalName =
    name || (phones.length || emails.length || website || socials.length ? "Unnamed place" : "");
  if (!finalName) return null;

  const lead = {
    id: placeId ? `place-${placeId}` : `import-${index}`,
    placeId,
    name: finalName,
    category,
    categories,
    address,
    city,
    state,
    postalCode,
    countryCode,
    website,
    domain: domainOf(website),
    hasWebsite: Boolean(website),
    phone: phones[0] || null,
    phones,
    emails,
    socials,
    rating,
    reviewsCount,
    priceLevel,
    mapsUrl: mapsUrl || searchMapsUrl(finalName, address, placeId),
    lat,
    lng,
    permanentlyClosed,
    temporarilyClosed,
    claimed,
    scrapedAt,
    searchNiche,
    searchLocation,
    runId,
    outreachStatus: outreach.status,
    outreachSource: outreach.explicit ? "file" : null,
    contactedAt: outreach.contactedAt,
    outreachUpdatedAt: outreach.updatedAt,
    outreachNote: outreach.note,
    extraFields,
  };

  return {
    lead,
    ratingCapped,
    unnamed: finalName === "Unnamed place",
    nameFromFallback,
  };
}

function dedupeKey(lead) {
  if (lead.placeId) return `place:${lead.placeId.toLowerCase()}`;
  if (lead.name && lead.name !== "Unnamed place") {
    return `name:${lead.name.toLowerCase()}|${(lead.address || "").toLowerCase()}`;
  }
  const phoneKey = lead.phones.map(phoneDigits).find((digits) => digits.length >= 6);
  if (phoneKey) return `phone:${phoneKey}`;
  const emailKey = lead.emails[0]?.toLowerCase();
  if (emailKey) return `email:${emailKey}`;
  return `id:${lead.id}`;
}

function mergeLead(existing, incoming) {
  const merged = { ...existing };
  for (const field of [
    "address",
    "city",
    "state",
    "postalCode",
    "countryCode",
    "website",
    "domain",
    "priceLevel",
    "placeId",
    "lat",
    "lng",
    "scrapedAt",
    "searchNiche",
    "searchLocation",
    "runId",
    "claimed",
    "reviewsCount",
    "rating",
  ]) {
    if (
      (merged[field] === null || merged[field] === undefined || merged[field] === "") &&
      incoming[field] !== null &&
      incoming[field] !== undefined &&
      incoming[field] !== ""
    ) {
      merged[field] = incoming[field];
    }
  }
  if (merged.category === "Business" && incoming.category && incoming.category !== "Business") {
    merged.category = incoming.category;
  }
  if (merged.name === "Unnamed place" && incoming.name !== "Unnamed place") {
    merged.name = incoming.name;
  }
  merged.hasWebsite = Boolean(merged.website);
  if (merged.website && !merged.domain) merged.domain = domainOf(merged.website);

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

  merged.categories = [
    ...new Set([...(existing.categories || []), ...(incoming.categories || [])]),
  ].slice(0, 12);

  const extras = new Map(
    (existing.extraFields || []).map((entry) => [entry.label.toLowerCase(), entry]),
  );
  for (const entry of incoming.extraFields || []) {
    const key = entry.label.toLowerCase();
    if (!extras.has(key)) extras.set(key, entry);
  }
  merged.extraFields = [...extras.values()];

  const existingStamp = existing.outreachUpdatedAt
    ? Date.parse(existing.outreachUpdatedAt) || 0
    : 0;
  const incomingStamp = incoming.outreachUpdatedAt
    ? Date.parse(incoming.outreachUpdatedAt) || 0
    : 0;
  if (
    incoming.outreachSource === "file" &&
    (existing.outreachSource !== "file" || incomingStamp > existingStamp)
  ) {
    merged.outreachStatus = incoming.outreachStatus;
    merged.outreachSource = "file";
    merged.contactedAt = incoming.contactedAt || existing.contactedAt || null;
    merged.outreachUpdatedAt = incoming.outreachUpdatedAt || existing.outreachUpdatedAt || null;
    merged.outreachNote = incoming.outreachNote || existing.outreachNote || null;
  } else if (!merged.outreachNote && incoming.outreachNote) {
    merged.outreachNote = incoming.outreachNote;
  }

  merged.permanentlyClosed = existing.permanentlyClosed || incoming.permanentlyClosed;
  merged.temporarilyClosed = existing.temporarilyClosed || incoming.temporarilyClosed;
  return merged;
}

function mappedFieldList(leads) {
  const fields = [];
  const add = (name) => {
    if (!fields.includes(name)) fields.push(name);
  };
  for (const lead of leads) {
    if (lead.name && lead.name !== "Unnamed place") add("name");
    if (lead.category && lead.category !== "Business") add("category");
    if (lead.categories.length) add("categories");
    if (lead.phones.length) add("phones");
    if (lead.emails.length) add("emails");
    if (lead.website) add("website");
    if (lead.address) add("address");
    if (lead.city) add("city");
    if (lead.state) add("state");
    if (lead.postalCode) add("postalCode");
    if (lead.countryCode) add("countryCode");
    if (lead.rating !== null) add("rating");
    if (lead.reviewsCount !== null) add("reviewsCount");
    if (lead.priceLevel) add("priceLevel");
    if (lead.socials.length) add("socials");
    if (lead.placeId) add("placeId");
    if (lead.lat !== null || lead.lng !== null) add("coordinates");
    if (lead.permanentlyClosed || lead.temporarilyClosed) add("closed");
    if (lead.searchNiche) add("searchNiche");
    if (lead.searchLocation) add("searchLocation");
    if (lead.scrapedAt) add("scrapedAt");
    if (lead.runId) add("runId");
    if (lead.claimed !== null) add("claimed");
    if (
      lead.outreachSource === "file" ||
      lead.contactedAt ||
      lead.outreachNote ||
      (lead.outreachStatus && lead.outreachStatus !== OUTREACH.TODO)
    ) {
      add("outreach");
    }
  }
  return fields;
}

function normalizeItems(items, { rootMeta = {}, nameFallbackHeader = "" } = {}) {
  const leads = [];
  const byKey = new Map();
  const extraFieldNames = [];
  const extraFieldSeen = new Set();
  const warnings = [];
  const query = {
    niche: firstText(rootMeta.niche),
    location: firstText(rootMeta.location),
  };
  let skippedRows = 0;
  let duplicateCount = 0;
  let unnamedCount = 0;
  let ratingCappedCount = 0;
  let nameFallbackCount = 0;

  items.forEach((item, index) => {
    const fallbackName =
      nameFallbackHeader && item && typeof item === "object"
        ? text(item[nameFallbackHeader])
        : "";
    const built =
      item && typeof item === "object" ? createLead(item, index + 1, fallbackName) : null;
    if (!built) {
      skippedRows += 1;
      return;
    }
    if (built.ratingCapped) ratingCappedCount += 1;
    if (built.unnamed) unnamedCount += 1;
    if (built.nameFromFallback) nameFallbackCount += 1;

    const lead = built.lead;
    if (!query.niche && lead.searchNiche) query.niche = lead.searchNiche;
    if (!query.location && lead.searchLocation) query.location = lead.searchLocation;

    for (const entry of lead.extraFields) {
      const key = entry.label.toLowerCase();
      if (!extraFieldSeen.has(key)) {
        extraFieldSeen.add(key);
        extraFieldNames.push(entry.label);
      }
    }

    const key = dedupeKey(lead);
    if (byKey.has(key)) {
      duplicateCount += 1;
      const existing = byKey.get(key);
      Object.assign(existing, mergeLead(existing, lead));
      return;
    }
    byKey.set(key, lead);
    leads.push(lead);
  });

  if (skippedRows) {
    warnings.push(`${plural(skippedRows, "row")} skipped — no usable business name or contact.`);
  }
  if (duplicateCount) {
    warnings.push(`${plural(duplicateCount, "duplicate row")} merged.`);
  }
  if (unnamedCount) {
    warnings.push(
      `${plural(unnamedCount, "lead")} had no business name and is shown as “Unnamed place”.`,
    );
  }
  if (ratingCappedCount) {
    warnings.push("Ratings above 5 stars were capped at 5.");
  }
  if (nameFallbackCount && nameFallbackHeader) {
    warnings.push(
      `No business-name column was recognised; “${nameFallbackHeader}” was used for names.`,
    );
  }

  return {
    leads,
    total: leads.length,
    rowsRead: items.length,
    skippedRows,
    duplicateCount,
    unnamedCount,
    mappedFields: mappedFieldList(leads),
    extraFieldNames,
    query: { niche: query.niche || null, location: query.location || null },
    warnings,
  };
}

export function detectDelimiter(source) {
  const textValue = String(source ?? "").replace(/^\uFEFF/, "");
  const counts = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  let lines = 0;

  for (let index = 0; index < textValue.length; index += 1) {
    const char = textValue[index];
    if (char === '"') {
      if (quoted && textValue[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "\n") {
      lines += 1;
      if (lines >= 5) break;
      continue;
    }
    if (counts.has(char)) counts.set(char, counts.get(char) + 1);
  }

  let best = ",";
  let bestCount = 0;
  for (const [delimiter, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = delimiter;
    }
  }
  return best;
}

export function parseCsv(source, delimiter = ",") {
  const value = String(source ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && value[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((entry) => entry !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((entry) => entry !== "")) rows.push(row);
  }
  return rows;
}

function itemsFromRows(rows) {
  const header = (rows[0] || []).map((cell) => String(cell ?? "").trim());
  if (!header.some(Boolean)) {
    throw new Error("The first row of this CSV has no column names.");
  }
  const items = [];
  for (const row of rows.slice(1)) {
    const item = {};
    header.forEach((label, index) => {
      if (!label) return;
      if (item[label] === undefined) item[label] = row[index] ?? "";
    });
    if (Object.values(item).some((entry) => text(entry))) items.push(item);
  }
  return { header, items };
}

function lookLikeLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const map = mapFor(value);
  const probes = [
    ...ALIASES.name,
    ...ALIASES.primaryEmail,
    ...ALIASES.primaryPhone,
    ...ALIASES.website,
    ...ALIASES.address,
    ...ALIASES.placeId,
  ];
  return probes.some((alias) => map.has(alias));
}

function metaFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { niche: "", location: "" };
  }
  const query = value.query && typeof value.query === "object" ? value.query : {};
  const search = value.search && typeof value.search === "object" ? value.search : {};
  return {
    niche: firstText(value.searchNiche, value.search_niche, value.niche, query.niche, search.niche),
    location: firstText(
      value.searchLocation,
      value.search_location,
      typeof value.location === "string" ? value.location : "",
      query.location,
      search.location,
    ),
  };
}

function extractJsonItems(parsed) {
  if (Array.isArray(parsed)) {
    if (parsed.length && Array.isArray(parsed[0])) {
      const header = parsed[0].map((cell) => String(cell ?? "").trim());
      const items = parsed
        .slice(1)
        .map((row) => {
          const item = {};
          header.forEach((label, index) => {
            if (label && item[label] === undefined) item[label] = row[index] ?? "";
          });
          return item;
        })
        .filter((item) => Object.values(item).some((entry) => text(entry)));
      return {
        items,
        header,
        meta: { niche: "", location: "" },
      };
    }
    return {
      items: parsed.filter((entry) => entry && typeof entry === "object"),
      header: [],
      meta: { niche: "", location: "" },
    };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("This JSON file does not contain a lead array.");
  }

  const candidates = [
    { items: parsed.leads, meta: parsed.report || parsed.meta || parsed },
    { items: parsed.items, meta: parsed.meta || parsed },
    { items: parsed.data?.items, meta: parsed.data?.meta || parsed.meta || parsed },
    { items: parsed.data?.leads, meta: parsed.data?.report || parsed.meta || parsed },
    { items: parsed.data, meta: parsed.meta || parsed },
    { items: parsed.results, meta: parsed.meta || parsed },
    { items: parsed.records, meta: parsed.meta || parsed },
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate.items)) {
      return {
        items: candidate.items.filter((entry) => entry && typeof entry === "object"),
        header: [],
        meta: metaFrom(candidate.meta),
      };
    }
  }

  if (lookLikeLead(parsed)) {
    return {
      items: [parsed],
      header: [],
      meta: { niche: "", location: "" },
    };
  }

  const objectValues = Object.values(parsed);
  if (objectValues.length && objectValues.every((entry) => lookLikeLead(entry))) {
    return {
      items: objectValues,
      header: [],
      meta: { niche: "", location: "" },
    };
  }

  throw new Error(
    "No lead array was found in this JSON file. Expected an array of leads or a { leads: [...] } document.",
  );
}

function parseJsonSource(source) {
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    parseError = error;
  }

  if (!parseError) {
    const result = extractJsonItems(parsed);
    return { ...result, jsonLines: false };
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    try {
      const items = lines.map((line) => JSON.parse(line));
      if (items.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
        return {
          items,
          header: [],
          meta: { niche: "", location: "" },
          jsonLines: true,
        };
      }
    } catch {
      /* fall through to the friendly error */
    }
  }

  throw new Error(
    "That JSON file could not be parsed. Check that it is valid JSON or one JSON object per line.",
  );
}

function detectFormat(name, source) {
  const extension = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "json" || extension === "jsonl" || extension === "ndjson") {
    return extension === "json" ? "json" : "jsonl";
  }
  if (extension === "csv" || extension === "tsv") return "csv";
  const trimmed = source.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  return "csv";
}

function findNameFallbackHeader(header) {
  const keys = new Set(header.map((label) => normalizeKey(label)));
  if (ALIASES.name.some((alias) => keys.has(alias))) return "";
  for (const label of header) {
    const key = normalizeKey(label);
    if (!key) continue;
    if (
      ["id", "no", "number", "index", "sno", "slno", "srno", "row", "rownumber", "sr"].includes(
        key,
      )
    ) {
      continue;
    }
    return label;
  }
  return "";
}

export function parseImportContent({ name = "", text: rawText = "" } = {}) {
  const source = String(rawText ?? "").replace(/^\uFEFF/, "");
  if (!source.trim()) {
    throw new Error("That file is empty. Choose a CSV or JSON file with at least one lead.");
  }

  let format = detectFormat(name, source);
  let items = [];
  let header = [];
  let rootMeta = { niche: "", location: "" };

  if (format === "json" || format === "jsonl") {
    const parsed = parseJsonSource(source);
    items = parsed.items;
    header = parsed.header || [];
    rootMeta = parsed.meta || rootMeta;
    if (parsed.jsonLines) format = "jsonl";
  } else {
    const delimiter = /\.tsv$/i.test(name) ? "\t" : detectDelimiter(source);
    const rows = parseCsv(source, delimiter);
    if (!rows.length) throw new Error("No rows were found in this CSV file.");
    const csv = itemsFromRows(rows);
    header = csv.header;
    items = csv.items;
  }

  let truncated = 0;
  if (items.length > IMPORT_LIMITS.maxLeads) {
    truncated = items.length - IMPORT_LIMITS.maxLeads;
    items = items.slice(0, IMPORT_LIMITS.maxLeads);
  }

  const nameFallbackHeader = header.length ? findNameFallbackHeader(header) : "";
  const normalized = normalizeItems(items, { rootMeta, nameFallbackHeader });
  if (truncated) {
    normalized.warnings.unshift(
      `Only the first ${formatCount(IMPORT_LIMITS.maxLeads)} rows were read; ${formatCount(
        truncated,
      )} were ignored.`,
    );
  }
  if (!normalized.leads.length) {
    throw new Error(
      "No leads could be read. The file needs at least one row with a business name, phone, email, or website.",
    );
  }

  return {
    format,
    sourceName: name || null,
    ...normalized,
  };
}

const EXPORT_COLUMNS = [
  ["Business name", (lead) => lead.name],
  ["Category", (lead) => lead.category],
  ["Primary phone", (lead) => lead.phone],
  ["All phones", (lead) => lead.phones.join(" | ")],
  ["Emails", (lead) => lead.emails.join(" | ")],
  ["Outreach status", (lead) => outreachStatusLabel(lead.outreachStatus)],
  ["Contacted at", (lead) => lead.contactedAt],
  ["Outreach note", (lead) => lead.outreachNote],
  ["Outreach updated at", (lead) => lead.outreachUpdatedAt],
  ["Website", (lead) => lead.website],
  ["Has website", (lead) => (lead.hasWebsite ? "Yes" : "No")],
  ["Rating", (lead) => (lead.rating === null ? "" : lead.rating)],
  ["Reviews", (lead) => (lead.reviewsCount === null ? "" : lead.reviewsCount)],
  ["Address", (lead) => lead.address],
  ["City", (lead) => lead.city],
  ["State / region", (lead) => lead.state],
  ["Postal code", (lead) => lead.postalCode],
  ["Country code", (lead) => lead.countryCode],
  ["Social profiles", (lead) => lead.socials.map((social) => social.url).join(" | ")],
  ["Google Maps link", (lead) => lead.mapsUrl],
  ["Place ID", (lead) => lead.placeId],
  ["Latitude", (lead) => (lead.lat === null ? "" : lead.lat)],
  ["Longitude", (lead) => (lead.lng === null ? "" : lead.lng)],
  ["Permanently closed", (lead) => (lead.permanentlyClosed ? "Yes" : "No")],
  ["Temporarily closed", (lead) => (lead.temporarilyClosed ? "Yes" : "No")],
  ["Search niche", (lead) => lead.searchNiche],
  ["Search location", (lead) => lead.searchLocation],
  ["Scraped at", (lead) => lead.scrapedAt],
  ["Apify run ID", (lead) => lead.runId],
];

function cellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  let stringValue = String(value);
  if (FORMULA_START.test(stringValue)) stringValue = `'${stringValue}`;
  return stringValue;
}

export function escapeCsvCell(value) {
  const cell = cellValue(value);
  if (/[",\r\n]/.test(cell) || /^\s|\s$/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function leadsToCsv(leads) {
  const extraLabels = [];
  const seen = new Set();
  for (const lead of leads) {
    for (const entry of lead.extraFields || []) {
      const key = entry.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extraLabels.push(entry.label);
      if (extraLabels.length >= MAX_EXPORT_EXTRA_COLUMNS) break;
    }
    if (extraLabels.length >= MAX_EXPORT_EXTRA_COLUMNS) break;
  }

  const header = [...EXPORT_COLUMNS.map(([label]) => label), ...extraLabels];
  const rows = leads.map((lead) => {
    const values = EXPORT_COLUMNS.map(([, getter]) => getter(lead));
    const extras = new Map(
      (lead.extraFields || []).map((entry) => [entry.label.toLowerCase(), entry.value]),
    );
    for (const label of extraLabels) values.push(extras.get(label.toLowerCase()) ?? "");
    return values.map(escapeCsvCell).join(",");
  });

  return `\uFEFF${[header.map(escapeCsvCell).join(","), ...rows].join("\r\n")}\r\n`;
}

export function toExportLead(lead) {
  const exported = {
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
    outreachStatus: normalizeOutreachStatus(lead.outreachStatus) || OUTREACH.TODO,
    outreachStatusLabel: outreachStatusLabel(lead.outreachStatus),
    contactedAt: normalizeOutreachDate(lead.contactedAt),
    outreachUpdatedAt: normalizeOutreachDate(lead.outreachUpdatedAt),
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
  if (lead.extraFields?.length) {
    exported.extraFields = Object.fromEntries(
      lead.extraFields.map((entry) => [entry.label, entry.value]),
    );
  }
  return exported;
}

export function buildClientJsonExport(leads, meta = {}) {
  const summary =
    meta.summary && typeof meta.summary === "object" ? { ...meta.summary } : null;
  const outreach = outreachCounts(leads);
  if (summary) summary.outreach = outreach;

  return {
    report: {
      name: meta.reportName || "Lead Atlas field report",
      generatedAt: new Date().toISOString(),
      sourceFile: meta.fileName || null,
      searchNiche: meta.query?.niche || null,
      searchLocation: meta.query?.location || null,
      apifyRunId: meta.runId || null,
      apifyActor: meta.actor || "compass/crawler-google-places",
      totalLeads: leads.length,
      summary,
      outreach,
    },
    leads: leads.map(toExportLead),
  };
}

export function buildImportJson(leads, meta = {}) {
  return buildClientJsonExport(leads, {
    ...meta,
    reportName: meta.reportName || "Lead Atlas imported field report",
  });
}
