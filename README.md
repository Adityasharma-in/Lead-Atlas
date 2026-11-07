# Lead Atlas

A local-first Google Maps lead scanner with a private, Supabase-backed lead library. Give
it a niche and a location, and it returns a field report of businesses with phones, emails,
websites, social profiles, ratings, and a verification link to each Google Maps listing.
Save the good ones to your workspace, work the call list, and pick it back up tomorrow.
Ready to export as CSV or JSON.

Already have a lead file? The **Data desk** imports an existing CSV, TSV, JSON, or JSONL
file and opens it in the same report UI. Imports are parsed entirely in the browser: the
file stays on your device unless you explicitly save the report to your library.

Lead Atlas is a small Node.js app that runs the official
[`compass/crawler-google-places`](https://apify.com/compass/crawler-google-places) Actor on
your own Apify account. Accounts, saved reports, and leads live in your own Supabase
project, protected by row level security. Your Apify token is saved to your account’s
`profiles` row (owner-only RLS) and cached in your browser; it is sent only to your local
server and then to Apify.

![Lead Atlas home screen](docs/lead-atlas-home.png)

![Lead Atlas field report](docs/lead-atlas-report.png)

The current deployment is at **<https://lead-atlas-ochre.vercel.app>**. It runs the same
multipage site and account workspace, backed by the same Supabase project.

## Requirements

- Node.js 20 or newer
- A [Supabase project](https://supabase.com/dashboard) for accounts and the lead library
  (the free tier is enough)
- An [Apify account](https://console.apify.com/sign-up) with a little credit
- An Apify API token ([Console → Integrations](https://console.apify.com/account/integrations))

## Quick start

```bash
npm install
cp .env.example .env
```

Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` from your Supabase project, then run
[`supabase/schema.sql`](supabase/schema.sql) once in the Supabase SQL Editor. The full
walkthrough — project creation, redirect URLs, email confirmation, and verification — is
in [docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md).

```bash
npm start
```

Open <http://127.0.0.1:4317>, create an account, and add an Apify token. The app validates
the token with Apify, saves it to your Supabase profile, and caches it in `localStorage`
so the next sign-in on this browser starts instantly.

Then fill in the brief:

1. **Niche** — what to search for, e.g. `dentists`, `coffee roasters`, `emergency plumbers`.
2. **Location** — a city, region, or country, e.g. `Austin, TX` or `Lisbon, Portugal`.
3. **Website** — all places, only places with a website, or only places without one.
4. **Contact enrichment** — scrape emails and extra phone numbers when available.
5. **Minimum rating** and **skip closed places** — optional quality filters.
6. **Places** — 1 to 500 results.

Press **Run the scan**. Progress is polled live; when the Actor finishes, the report opens
with filters, search, sorting, a detail drawer, outreach tracking, and CSV/JSON downloads.

Open the **Data desk** from the header, report toolbar, or hero card to import an existing
lead file. Drop a CSV/TSV, JSON, or JSONL file — including a Lead Atlas export, an Apify
dataset, or a generic spreadsheet with headers — and it opens in the normal report with
filters, search, sorting, the lead drawer, outreach tracking, map links, and CSV/JSON
downloads.

## Deploying to Vercel

The live app is deployed on Vercel as project `lead-atlas` in team `adityatek14-4344`,
using the zero-config **Express** preset:

- `src/server.js` default-exports a lazy Express request handler. The first request builds
  the app, so Vercel’s environment variables are present before the CSP and `/api/config`
  are computed. The named `createApp` export remains for local use and tests.
- `public/**` is uploaded as static assets and served by Vercel’s CDN. Vercel ignores
  `express.static()`, so the function only handles `/api/*` and the `/` rewrite.
- `vercel.json` rewrites `/` to `/index.html` and applies security headers plus the CSP to
  static HTML and function responses.
- `SELF_UPDATE=off` is set because a serverless function has no git clone and cannot
  respawn. Update a Vercel deployment by pushing a commit (Git integration) or by running
  another deploy; one-click self-update remains a local-clone feature.

Project settings:

| Setting | Value |
| --- | --- |
| Framework Preset | Express |
| Root Directory | `.` |
| Build Command | None |
| Output Directory | None |
| Node.js Version | 26.x |
| Deployment Protection | Vercel Authentication **disabled** (public site) |

Environment variables are set for **Production**, **Preview**, and **Development**:

| Variable | Value | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | your Supabase project URL | Browser auth/PostgREST and the CSP origin |
| `SUPABASE_ANON_KEY` | public anon or publishable key | Browser auth/PostgREST; RLS is the boundary |
| `SELF_UPDATE` | `off` | No git updater or server restart on serverless |

Deploy from this folder with the Vercel CLI:

```bash
vercel link --project lead-atlas --scope adityatek14-4344
vercel deploy            # preview URL
vercel deploy --prod     # production URL
```

A CLI deploy uploads the **current working tree**. The project is also connected to the
GitHub repository: a push to `main` builds Production, and other branches build Previews.
Commit and push before relying on a Git-triggered deploy.

`.env`, `.env.local`, and `.vercel/` are gitignored. `vercel link` may write a short-lived
OIDC token to `.env.local`; never commit that file.

Finally, allow the deployed origin in Supabase **Authentication → URL Configuration**:

- **Site URL**: `https://lead-atlas-ochre.vercel.app`
- **Redirect URLs**:
  - `https://lead-atlas-ochre.vercel.app/auth.html`
  - `https://lead-atlas-ochre.vercel.app/**`

Password sign-in works without this step. Confirmation, magic-link, and password-recovery
emails need it, because Supabase only returns to an allowed URL. Add each preview domain
separately if you test email links from a preview deployment. See
[docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md#5-configure-auth-redirect-urls).

## Accounts, the workspace, and the lead library

Lead Atlas is a multipage site. The public side has three pages — **Home**
(`index.html`), **How it works** (`how-it-works.html`), and **Pricing & FAQ**
(`pricing.html`) — sharing one navigation and footer. **Start free** and **Sign in** open
the account page (`auth.html`), which creates accounts and signs you in with a password, a
magic link, or a password-recovery link. It also shows a clear notice when Supabase is not
configured yet, instead of failing silently.

Signing in opens the account-only workspace at `app.html`. Visiting the workspace signed
out returns you to `auth.html`, then brings you back to the same view after sign-in. Each
workspace view is deep-linkable — `#dashboard`, `#library`, `#setup`, `#report`, `#data`,
and `#progress` — and browser back/forward moves between them. On phones, a five-item
bottom bar (Overview, Scan, Library, Data, More) keeps the main surfaces in thumb reach:

- **Overview** — saved-report and lead counts, reached-out and do-not-contact totals, this
  month's additions, recent reports, Apify key status, saved script count, and the outreach
  ledger.

- **Overview** — saved-report and lead counts, reached-out and do-not-contact totals, this
  month's additions, recent reports, Apify key status, saved script count, and the outreach
  ledger.
- **Lead library** — every saved scan and import, searchable by name, niche, or place and
  filterable by source. Each card shows lead count, reached count, average rating, progress,
  and CSV/JSON export buttons.
- **Save to library** — open any scan or imported report and choose the save button in the
  report toolbar. Give the report a name and optional private notes. Saving again updates
  the existing report instead of creating a duplicate.
- **Open a saved report** — the full report is reconstructed from the stored lead payload,
  including contacts, socials, map links, outreach marks, dates, and notes. Search, sort,
  filters, the detail drawer, exports, and call scripts all work as they do on a live scan.

Saved reports live in your own Supabase project:

| Table | Contents |
| --- | --- |
| `profiles` | One row per account, created automatically on signup |
| `lead_reports` | Report name, niche, location, source, lead count, summary, notes |
| `leads` | One row per lead with the full normalized payload and outreach state |
| `script_libraries` | One owner-only row per account with the full call-script array and default script |

Row level security limits every row to the signed-in account. The browser uses the public
anon key; the server exposes it through `/api/config` and adds the project origin to the
CSP. The `service_role` key is never used by this app. See
[docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md) for the full setup and troubleshooting
guide.

Call scripts are saved to your account in `script_libraries` and cached in this browser, so
they follow you to another browser or device. The local cache keeps the editor instant and
keeps the library readable while the account copy loads, or if Supabase is briefly
unreachable. Script text is sent only to your Supabase project, never to Apify. The outreach
ledger is still mirrored in `localStorage` so unsaved reports keep their trail, while saved
reports write each mark back to the corresponding `leads` row.

## Scans survive a closed tab

A scan runs on Apify, not in your browser, so a closed tab, a refresh, or a crash does not
lose it. Reopen Lead Atlas within 24 hours and the app reconnects to the scan you were
watching:

- **Still running** — the live progress screen comes back, with the same run ID, elapsed
  time, and a "Reconnected" note.
- **Finished while you were away** — the report opens automatically; nothing to re-run.
- **The pointer** lives in `localStorage` under `leadAtlas.activeRun.v1`. It is cleared as
  soon as the report opens, the scan fails, or you abort — so it never hijacks a normal
  visit.

Reconnecting needs the same Apify account key saved to your account, because that key is
what allows the app to read the run. Only the most recent scan is remembered; starting a
new scan replaces the pointer.

## One-click updates from GitHub

Lead Atlas is served from the same git clone it runs in, so the app can update itself the
same way you would: pull the newest commit and restart, in one click.

- On page load — and every 5 minutes after that — the app asks the local server to compare
  its build with the tip of your repository's branch on GitHub.
- When a newer commit exists, a **Update available** chip appears in the header. The footer
  always shows the version and the build you are running (`Version 1.6.1`, then
  `Build <sha> · <branch>` when the folder is a git clone).
- Click the chip and the server **stashes any uncommitted local edits**, fetches and resets
  to the remote tip, runs `npm install` only if `package.json` or the lockfile changed, and
  respawns itself onto the new build. The page waits for the new server, reloads, and
  confirms with a toast.
- Nothing is lost by default: pre-update edits go to a git stash, recoverable with
  `git stash list`. Brave-new-code days only: check `git status` before forcing anything.

The check goes through the GitHub REST API (fallback: plain `git ls-remote`) and is cached
for 60 seconds, so polling stays cheap. The browser never talks to GitHub directly.

Disable the feature with `SELF_UPDATE=off` — the chip disappears and `/api/update` answers
with a clear "turned off" message. Requirements: the folder must be a git clone of a
GitHub repository with `origin` set, and `git` must be on your PATH.

On Vercel, `SELF_UPDATE=off` is set because the app runs as a serverless function with no
git clone and no process to restart. Ship changes with a commit and push, or with another
`vercel deploy`; the deployed footer still reports the app version.

## Versioning

The app version lives in the `version` field of `package.json` and is shown in the footer
(`Version 1.6.1`), in the startup banner, and via `GET /api/health`, `GET /api/config`, and
`GET /api/version`.

The scheme is semver-like with one house rule — the minor part stops at 9:

| Part | Bumped when | Example |
| --- | --- | --- |
| Patch | bug fixes, tiny tweaks, copy nits | `1.1.0` → `1.1.1` |
| Minor | a new feature or a notable change | `1.1.11` → `1.2.0` |
| Major | minor rolls over past 9, or a breaking change | `1.9.4` → `2.0.0` |

The patch part has no cap (`1.1.9` → `1.1.10` → `1.1.11`). Bump the version with npm —
never by hand:

```bash
npm run bump:patch   # fix landed
npm run bump:minor   # feature landed
npm run bump:major   # minor passed 9 (rare)
```

Commit the bump together with the change that caused it, so the version that ships on
GitHub is the version the updater reports after a one-click update.

## Importing an existing lead file

1. Open the **Data desk** (no Apify key or scan required).
2. Drop a file onto the page or choose one from disk.
3. The file is parsed locally and the lead report opens automatically.

Imports support:

- Lead Atlas CSV and JSON exports
- Apify Google Maps dataset JSON, including nested `location` and `addressInfo`
- CSV, TSV, semicolon-delimited, and tab-delimited files
- JSON arrays, `{ "leads": [...] }` / `{ "items": [...] }` documents, and JSONL/NDJSON
- Common header aliases such as `Business name`, `Company`, `Phone Number`, `Email`,
  `Website`, `Instagram`, and `Place ID`
- Outreach columns such as `Outreach status`, `Contacted at`, `Outreach note`, `DNC`,
  `Contacted`, and `Last contacted`
- Up to 8 MB or 5,000 leads per file

Extra columns are preserved in the lead drawer and included in imported CSV/JSON exports.
Duplicate rows are merged by place ID, name + address, phone, or email. Outreach marks,
contact dates, and notes are restored from the file, so a Lead Atlas CSV or JSON export is
a complete backup of your call list. Imported exports are built in the browser, so they
work without an Apify key. Files are never uploaded to the local server. If you choose
**Save to library**, the parsed report and its leads are written to your own Supabase
project.

## Outreach tracking

Each lead carries one exclusive outreach state:

| State | Meaning |
| --- | --- |
| **To contact** | Still on the call list (the default) |
| **Reached out** | You have already made contact; the first mark is dated |
| **Do not contact** | Keep this business off future outreach |

Mark a lead from the three check buttons in the **Outreach** table column, from the filter
strip above the report, or from the **Outreach trail** section in the detail drawer. The
drawer also takes a private note of up to 280 characters — who answered, the best time to
call, or what you sent. Filter and sort by outreach state, and use the tally chips above
the table to jump between the next call list and the leads you have already handled.

Marks are mirrored in `localStorage` under `leadAtlas.outreach.v1`, keyed by place ID, then
phone, then email, then name + address, so unsaved reports keep their trail and a new scan
of the same market keeps the marks you already made. On a saved report, each mark is also
written to that lead's row in your Supabase library. If the write fails, the browser copy
stays and the app shows a warning. Nothing is sent to Apify.

CSV exports include `Outreach status`, `Contacted at`, `Outreach note`, and
`Outreach updated at`. JSON exports include the same data on each lead plus an
`outreach` count block in `report`. Re-importing either file restores the marks and notes.
A bare `To contact` cell is treated as the default; an explicit state, contact date, or
note from a file wins over the browser ledger.

## Call scripts and the call sheet

Keep the words you actually say beside the leads you call. Open the **Scripts** chip in the
header on any screen to write, edit, search, duplicate, and delete scripts; the report
toolbar and the lead drawer open the same scripts as a readable **call sheet**. The active
script also appears as plain text at the bottom of every extracted lead report, and again at
the bottom of a lead’s detail drawer filled with that lead’s details — no extra click needed.

- **Saved to your account.** New scripts, edits, imports, deletions, and the default-script
  choice write through to your private `script_libraries` row. The editor still caches
  locally so typing stays instant; signing in on another browser loads the same library.
- **Write once, read beside every lead.** The report ends with the active script filled from
  the current search niche and location. The same script sits at the bottom of a lead drawer,
  filled with the business name, category, city, address, phone, email, and website from that
  lead. The **Call sheet** buttons still open a focused reading view with copy and outreach
  actions.
- **Placeholders keep the script reusable.** Put `{business}`, `{category}`, `{city}`,
  `{address}`, `{phone}`, `{email}`, `{website}`, `{niche}`, or `{location}` anywhere in the
  body. Missing values use plain fallbacks ("there", "your area", "this number"); unknown
  tokens stay visible so you can correct them instead of silently losing text.
- **Mark the call without leaving the script.** **Mark reached out** updates the lead's
  outreach trail and the ledger immediately. **Copy script** copies the filled text, and
  **Edit script** jumps from the call sheet to the library with the same script selected.
- **Choose what opens first.** New scripts become the default automatically. Use **Use by
  default** on any saved script to make the call sheet start there next time. Changing the
  script inside a call sheet affects only that call sheet; it never changes your saved
  default behind your back.
- **Backups are portable.** **Export** downloads every script as a JSON backup. **Import**
  accepts that backup, a JSON array, or a plain `.txt`/`.md` file (one script per file).
  Import merges by id and by identical title + body, so running it twice does not create
  duplicates.

Scripts save automatically as you type. The editor writes to an account-scoped local cache
first, then syncs the full library to your Supabase `script_libraries` row (debounced while
you type and flushed when the library closes). The save badge says **Saved to account** when
the cloud write succeeds and **Local only** if it could not. Limits are 60 scripts,
80-character titles, 12,000-character bodies, and 2 MB per import. If the browser cannot
save (quota, private mode, or storage disabled), the editor says **Not saved** and tells you
to export a backup before retrying.

## What you get

Each lead includes, when Apify provides it:

- Business name, category, address, city/region, postal code, country
- Phone numbers and emails
- Website, domain, and whether a website exists
- Rating, review count, price level
- Social profiles (Instagram, Facebook, LinkedIn, YouTube, TikTok, X, Pinterest, etc.)
- Latitude/longitude, place ID, closed status
- A **Google Maps verification link**
- Search niche, search location, scrape timestamp, and Apify run ID
- An outreach state, optional contact date, and private outreach note (saved with the
  library and included in exports)

### CSV

UTF-8 with a BOM, CRLF line endings, and formula-injection protection for spreadsheet
apps. The export includes one row per lead and a stable column order. Outreach columns
sit directly after `Emails`, so they are easy to spot in Excel or Google Sheets.

### JSON

```json
{
  "report": {
    "name": "Lead Atlas field report",
    "generatedAt": "2026-10-25T12:00:00.000Z",
    "searchNiche": "plumbers",
    "searchLocation": "Austin, TX",
    "apifyRunId": "…",
    "apifyActor": "compass/crawler-google-places",
    "totalLeads": 40,
    "summary": { "…": "…" },
    "outreach": {
      "total": 40,
      "toContact": 31,
      "contacted": 7,
      "doNotContact": 2,
      "marked": 9,
      "rate": 18
    }
  },
  "leads": [
    {
      "businessName": "Acme Plumbing",
      "phone": "(512) 555-0100",
      "emails": ["hello@acme.example"],
      "outreachStatus": "contacted",
      "outreachStatusLabel": "Reached out",
      "contactedAt": "2026-10-20T15:30:00.000Z",
      "outreachUpdatedAt": "2026-10-20T15:30:00.000Z",
      "outreachNote": "Spoke to Sam; send the menu",
      "googleMapsUrl": "https://www.google.com/maps/…",
      "…": "…"
    }
  ]
}
```

## How it works

```
Browser (vanilla HTML/CSS/JS)
  ├── x-apify-token header
  │     ▼
  │   Express server (local 127.0.0.1:4317, or one Vercel Function)
  │     │  Authorization: Bearer <token>
  │     ▼
  │   Apify API → compass/crawler-google-places → dataset
  │     │
  │     ▼
  │   Normalization → report, CSV, JSON
  │
  └── https://<project>.supabase.co (anon key + RLS)
        ├── /auth/v1/*   accounts, sessions, recovery
        └── /rest/v1/*   lead_reports + leads + script_libraries
```

- The server proxies every Apify request. The browser never calls Apify directly.
- On Vercel, that server is one Fluid function and `public/**` is served by the CDN. Run
  and dataset metadata stay in an in-memory cache per function instance, so a later poll
  can fetch the same run from Apify again instead of reusing a warm cache.
- Saved reports and outreach marks go directly from the browser to your Supabase project.
  RLS limits every row to the signed-in account; the local server never stores lead data.
- Every run requests `scrapePlaceDetailPage: true` so website, contact, and detail fields
  are available.
- Dataset rows are normalized, deduplicated by place ID (or name + address), and merged
  when Apify returns the same place twice.
- Only one search string and one location are sent per scan. Reviews and images are
  disabled to keep runs fast and inexpensive.
- Run and dataset metadata are cached in memory. Restarting the server clears that cache;
  results already exported are unaffected.

## Cost and safety cap

Estimates use Apify's public **FREE-tier pay-per-event** rates. Paid plans are cheaper.
Prices can change; check the [Actor pricing page](https://apify.com/compass/crawler-google-places/pricing)
for the current numbers.

| Event | Estimate |
| --- | ---: |
| Run start | $0.007 |
| Place scraped | $0.004 |
| Place detail page | $0.002 |
| Contact enrichment | $0.002 per place |
| Each active filter | $0.001 per place |

Example: 40 places, contact enrichment on, skip-closed on, no rating filter:

```
40 × ($0.004 + $0.002 + $0.002 + $0.001) + $0.007 = $0.367
```

The UI rounds that to **$0.37**. The server sets Apify's `maxTotalChargeUsd` to
`max($0.50, estimate × 1.5)`, so this run is capped at **$0.56**. Apify stops the run if
spend reaches the cap. The estimate is a planning number, not a quote.

Contact enrichment is automatically disabled for **places without a website**, because
there is no site to enrich from. It uses the Actor's website-based company-contacts add-on;
the separate employee-level **business leads enrichment** add-on is intentionally left off
(`maximumLeadsEnrichmentRecords: 0`) to keep scans predictable and inexpensive.

## Security and privacy

- The Apify token is saved to the signed-in user’s `public.profiles.apify_token` row in
  your Supabase project. Owner-only RLS means only that account can read or change it.
  The browser keeps a copy in `localStorage` under `leadAtlas.apifyToken.v1`; signing out
  clears that copy. The local server never stores the token and never logs it.
- Anyone who can sign in as your account can read the token from that profile row. Use a
  strong password, keep email confirmation on, and do not share the account.
- The token is sent to the local server in the `x-apify-token` header and forwarded to
  Apify as a Bearer token.
- **Forget key** clears the browser copy and nulls `profiles.apify_token` for the account.
  If the Supabase write fails, the dialog keeps the key and tells you to retry rather than
  claiming it was removed.
- In the local app the server binds to `127.0.0.1` by default. Do not expose that process
  directly to the public internet: it is a local proxy for a personal API token. On Vercel
  the Express app runs as a public serverless function with no server-side secrets, API
  rate limits, same-origin POST checks, and a caller-supplied Apify token. Treat it as the
  app backend, not a general-purpose public API.
- API responses use `Cache-Control: no-store`; security headers include a strict CSP,
  `X-Frame-Options: DENY`, and `nosniff`.
- Cross-origin POSTs are blocked, and run/key endpoints are rate-limited per IP.
- The update endpoints follow the same rules: `/api/update` accepts same-origin POSTs only
  and is limited to 3 attempts per minute; `/api/version` is limited to 60 per minute. The
  updater talks to GitHub from the server, never from the browser.
- Scraped text is escaped before rendering and prefixed when it could be interpreted as a
  spreadsheet formula in CSV exports.
- Supabase Auth and PostgREST are the only third-party services the browser calls directly.
  The CSP `connect-src` is limited to `'self'` plus the configured Supabase project origin.
- Supabase passwords are sent directly from the browser to Supabase Auth and never reach
  the local server. Sessions are stored in browser `localStorage`; access tokens refresh
  automatically.
- The anon/public key is exposed to the browser by design. RLS on `profiles`,
  `lead_reports`, `leads`, and `script_libraries` restricts every row to the signed-in
  account. The `service_role` key must never be used in this app.
- Imported lead files are read with the browser `File` API and parsed in memory. They are
  not sent to the local server or Apify. If you choose **Save to library**, the parsed
  report and leads are written to your own Supabase project.
- Outreach marks and notes are mirrored in this browser under `leadAtlas.outreach.v1` and,
  for saved reports, written to the corresponding `leads` rows in your Supabase project.
  They are included in files you download. Nothing goes to Apify.
- Call scripts are saved to your Supabase `script_libraries` row and cached under an
  account-scoped `leadAtlas.scripts.v1.<user-id>` key. Script text is never sent to the
  local server or Apify. The JSON script backup is a separate download from the lead
  report, and importing scripts does not touch the outreach ledger or report.
- There is no telemetry. External requests are Google Fonts (page styling), Apify (your
  scans), and your Supabase project (auth and library). Fonts can be removed from the
  `<link>` tags in the five HTML pages if you need a fully offline UI.

## Configuration

Put local values in `.env` (copy [`.env.example`](.env.example)). The server reads it once
at startup; restart after changing it.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | — | Supabase project URL; also added to the CSP `connect-src` |
| `SUPABASE_ANON_KEY` | — | Public anon key used by the browser client; RLS is the boundary |
| `PORT` | `4317` | Local HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `APIFY_API_BASE` | `https://api.apify.com/v2` | Apify API base URL (used by tests) |
| `SELF_UPDATE` | on | Set to `off` (or `0`/`false`) to disable the one-click updater |
| `GITHUB_TOKEN` | — | Optional token sent to the GitHub API for private repos and higher rate limits |

On Vercel, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SELF_UPDATE=off` in the project’s
**Settings → Environment Variables** for Production, Preview, and Development. `PORT`,
`HOST`, and the GitHub updater settings do not apply to the serverless deployment.

Never put `SUPABASE_SERVICE_ROLE_KEY` in `.env`: Lead Atlas does not use it. If you change
the port or host, add the matching origin to Supabase **Authentication** → **URL
Configuration** so email links can return to `auth.html`.

```bash
PORT=4318 npm start
```

A `GITHUB_TOKEN` is not needed for public repositories. If you set one, it is only used in
the server's update check against `api.github.com` and is never sent anywhere else.

## Tests

```bash
npm test
```

The suite uses Node's built-in test runner and a local mock Apify server — no token or
network access required. It covers:

- Request validation, website/rating aliases, Actor input, and cost estimates
- Lead normalization, contact/social extraction, deduplication, and summaries
- Outreach normalization, stable lead keys, counts, note limits, and date handling
- Cold-call script normalization, limits, store operations, placeholder filling,
  import/export merging, and backup round-trips
- Account-level Apify token precedence, trimming, missing-column detection, and the
  browser-cache fallback
- CSV escaping, formula injection protection, JSON export, and filenames
- Browser-side CSV/TSV/JSON/JSONL import parsing, aliases, deduplication, extras,
  outreach fields, and export round-trips
- Active-scan records — parsing, brief normalization, URL and freshness rules for
  reattaching after a closed tab
- Self-update helpers (repository URLs, commit/ls-remote parsing, dependency detection),
  update/apply flows with injected git and fetch runners, and the version/update routes
- Supabase config validation, project-ref extraction, CSP `connect-src` wiring, and the
  public `/api/config` shape
- Server routes, token handling, origin checks, live status, abort, and exports

## Project structure

```
lead-atlas/
├── .env.example          Local environment template (Supabase URL and anon key)
├── public/
│   ├── index.html        Public home
│   ├── how-it-works.html Field-method page
│   ├── pricing.html      Pricing and FAQ
│   ├── auth.html         Sign in, create account and recovery page
│   ├── app.html          Account-only workspace, report and dialogs
│   ├── site.js           Public nav, reveal motion, active page, sign-out notice
│   ├── auth-page.js      Auth controller, mode tabs and return-path handoff
│   ├── styles.css        Design system and report layout
│   ├── workspace.css     Public page, auth, workspace and bottom-nav styles
│   ├── app.js            Workspace routing, UI state, library, polling, report, exports
│   ├── supabase-client.js Dependency-free GoTrue + PostgREST browser client
│   ├── account-core.js   Account Apify-token precedence and schema-cache rules
│   ├── active-run-core.js Active-scan pointer parsing and freshness rules
│   ├── import-core.js    Browser-side CSV/JSON import parser and exports
│   ├── outreach-core.js  Outreach states, keys, notes, dates and counts
│   ├── scripts-core.js   Script normalization, store, placeholders, import/export
│   └── favicon.svg
├── src/
│   ├── server.js         Express app and API routes
│   ├── supabase.js       Supabase env parsing, project ref and CSP sources
│   ├── env.js            Minimal .env reader
│   ├── selfupdate.js     One-click git-based self-update (checks, apply, restart)
│   ├── version.js        App version parsing and bump rules (reads package.json)
│   ├── apify.js          Apify HTTP client and error mapping
│   ├── validation.js     Brief validation, Actor input, cost estimate
│   ├── leads.js          Dataset normalization and summaries
│   ├── csv.js            CSV/JSON exports and filenames
│   ├── config.js         Actor, limits, pricing, security headers, CSP builder
│   └── errors.js         Typed API errors
├── supabase/
│   └── schema.sql        Tables, indexes, triggers and RLS policies
├── docs/
│   ├── SUPABASE-SETUP.md Project, schema, redirect URL and verification guide
│   └── CALL-SCRIPTS.md   Script-library design record
├── vercel.json           Vercel root rewrite and security/CSP headers
├── .vercelignore         Keeps env files, tests, docs and deps out of uploads
├── scripts/
│   └── bump-version.js   CLI behind npm run bump:patch / bump:minor / bump:major
└── test/
    ├── validation.test.js
    ├── leads.test.js
    ├── csv.test.js
    ├── import-core.test.js
    ├── account-core.test.js
    ├── outreach-core.test.js
    ├── scripts-core.test.js
    ├── active-run-core.test.js
    ├── selfupdate.test.js
    ├── supabase.test.js
    ├── version.test.js
    └── server.test.js
```

## Limitations

- Results are limited to what the Apify Actor returns; Google Maps data can be incomplete
  or stale.
- Contact enrichment depends on the business website and is best-effort. Some places will
  have no email.
- A scan is one niche + one location. Run separate scans for multiple areas.
- The browser tab can be closed mid-scan without losing the run — reopen the app within
  24 hours and it reconnects (see **Scans survive a closed tab**). Only the most recent
  scan is remembered, and place counts only advance while the tab is open, because the
  polling runs in your browser.
- The local server is designed for one person at a time. Accounts separate libraries, but
  there is no team sharing, roles, or persistent job queue; scans run on Apify.
- On Vercel the backend is a serverless function, so in-memory run and dataset caches are
  per instance. A poll can repeat an Apify read and a cold start can add latency; the scan
  itself still runs on Apify. Vercel Authentication must stay off for the site to be public.
- Saved reports and their outreach marks sync through Supabase, so the same account sees
  them on another device. Unsaved reports use the browser ledger only. If the Supabase
  project is paused or unreachable, the library and saved-report sync are unavailable.
- Clearing site data removes the browser outreach ledger, the call-script cache, and the
  cached Apify key. Saved-report outreach, call scripts, and the Apify token are restored
  from Supabase when you sign in again; export scripts first if you also lost access to the
  account.
- Call scripts sync through the same Supabase project as your library. They are plain text
  with no rich formatting, teleprompter scrolling, recording, per-lead assignment, or
  campaign automation.
- Placeholders only fill from the open lead and the current report query. Unknown tokens
  stay visible, and an unsupported field falls back to generic wording rather than empty
  text.
- The one-click updater syncs the working copy to the remote branch tip. Local uncommitted
  changes are swept into a git stash first; they are kept, but not merged back. If you
  develop in the same clone you serve, commit or stash your work as you would normally.
- Updates are only offered when a scan is not running, and the update check needs `git` on
  the PATH plus GitHub reachability. When either fails, the UI simply stays quiet.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Port 4317 is already in use` | Run `PORT=4318 npm start` |
| The auth page says “Supabase is not connected yet” | Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.env`, restart the server, and confirm `/api/config` reports `"configured": true`. |
| “The Supabase schema is missing” | Run `supabase/schema.sql` in the Supabase SQL Editor. If it just ran, wait for the PostgREST schema cache, then retry. |
| The key dialog says your profile is missing the Apify-key column | The schema predates account-level keys. Run `supabase/schema.sql` in the SQL Editor, wait for the schema cache, then reload and save the key again. |
| “The key is valid, but it could not be saved to your account” | Leave the dialog open and retry. If it repeats, confirm the Supabase project is running, the `profiles` RLS policies are intact, and the `apify_token` column exists. |
| The Apify key is missing on another device | Sign in there with the same account. The key loads from `profiles.apify_token`; if the column is missing, run the schema, then save the key once from any device. |
| “Supabase blocked that request” | Re-run the RLS policies in `supabase/schema.sql`; `profiles`, `lead_reports`, `leads`, and `script_libraries` must all have RLS enabled. |
| A confirmation or magic link returns to the wrong page | Add the exact origin (including `/auth.html`, or the local wildcard) to Supabase **Authentication** → **URL Configuration** → **Redirect URLs**, and open the link in the same browser that requested it. For Vercel, add `https://lead-atlas-ochre.vercel.app/auth.html` and `https://lead-atlas-ochre.vercel.app/**`, then request a fresh link. |
| The deployed site redirects to `vercel.com/sso-api` | Deployment Protection is on. In Vercel, open the project → **Settings** → **Deployment Protection** and disable **Vercel Authentication**, or run `vercel project protection disable lead-atlas --sso`. |
| Every deployed page and API hangs, but CSS loads | The deployment was built from an old `src/server.js` that default-exported the app factory. Deploy the current tree, where the default export is the lazy Express request handler. |
| The Vercel deployment shows an old version | A CLI deploy uploads the current working tree; a Git deploy builds the pushed commit. Redeploy the intended source — `/api/version` should report `1.6.1`. |
| `/api/*` returns 404 on Vercel | Confirm the project uses the Express preset and the current `vercel.json`. API routes are handled by the single function, not by static output. |
| “Confirm your email first” | Click the confirmation link Supabase sent, or turn off **Confirm email** for local testing. |
| The library is empty after a scan | Saving is explicit: open the report and choose **Save to library**. A scan that was never saved is not in the library. |
| The free Supabase project stopped responding | Resume it in the Supabase dashboard; free projects pause after a period of inactivity. |
| `Apify rejected this API key` | Copy a fresh token from Console → Integrations |
| `Your Apify account has no available credits` | Add credit to Apify or use another account |
| A scan returns no places | Broaden the niche/location, raise the result count, or relax filters |
| “The report could not be pulled” after a completed run | Restart the server with the latest code. Apify names the run dataset `defaultDatasetId`; older builds looked for `datasetId`. |
| A file will not import | Use CSV, TSV, JSON, or JSONL under 8 MB. The file needs a business-name column or at least one phone, email, or website per row. The error message on the Data desk explains what was missing. |
| Imported report has no niche or location | That metadata was not in the file. The report still works; its heading falls back to the file name. |
| The scan says “lost contact” | Check Apify Console; the run may still be running there |
| Outreach marks disappeared | Saved-report marks are restored from Supabase when you reopen the report. Unsaved reports use the per-browser ledger; export and re-import a CSV/JSON file to restore those, or check that site data was not cleared. |
| Call scripts disappeared | Sign in with the same account and reload: the library loads from `script_libraries`. If the table is missing, run `supabase/schema.sql`. A JSON script backup can also restore them (**Scripts → Import**); lead report exports do not contain scripts. |
| Scripts say “Local only” | The browser saved them, but the account write failed. Check the Supabase project is running and run `supabase/schema.sql` if the `script_libraries` table is missing, then edit or reopen the library to retry. Export a backup before clearing site data. |
| Call scripts are missing on another device | Sign in there with the same account. Scripts load from `script_libraries` and are cached per account in that browser. If the table or RLS policy is missing, re-run `supabase/schema.sql`. |
| A script file will not import | Use a Lead Atlas script JSON backup, a JSON array of scripts, or a plain `.txt`/`.md` file under 2 MB. The import message names the problem; a backup exported from Lead Atlas always round-trips. |
| The editor says “Not saved” | The browser refused to write `localStorage` (quota, private mode, or site storage disabled). Export a backup, free some site storage or allow storage for the app, then edit again. |
| A placeholder stayed as text | Only the tokens listed in **Call scripts and the call sheet** are replaced. Check the spelling — unknown tokens stay visible on purpose. |
| The update chip never appears | The folder may not be a git clone, `origin` may not point at GitHub, the working copy is detached, or `SELF_UPDATE=off` is set. Check `git remote -v` and `git status`. |
| Reopening the app jumps into an old scan | That is the resume feature. Start a new scan, open the report, or click **Abort scan** to clear it. Records older than 24 hours are ignored automatically. |
| A closed-tab scan did not come back | Resume needs the same Apify key in this browser, the scan must be under 24 hours old, and only the most recent scan is remembered. The run remains visible in Apify Console. |
| An update leaves old code running | Restart the terminal command once (`Ctrl+C`, `npm start`). `/api/update` always reports whether it respawned the server. |
| “Local changes could not be stashed” | The updater stops before touching anything. Inspect `git status`, commit or discard your edits, then click update again. |
| Recover pre-update edits | `git stash list` shows the snapshot (e.g. *Lead Atlas pre-update snapshot …*); `git stash pop` or `git stash apply` brings the edits back. |

## Disclaimer

Lead Atlas is not affiliated with Google or Apify. Respect Google's terms, Apify's terms,
and applicable privacy and marketing laws when using scraped business data.
