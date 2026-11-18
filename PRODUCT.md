# PRODUCT.md — Lead Atlas

## What this is

Lead Atlas is a local-first Google Maps lead scanner for one operator. It turns a niche
and a neighbourhood into a verified lead library: phones, emails, websites, ratings,
social profiles and a Google Maps link for every row. Reports can be saved to a private
Supabase library, worked with an outreach ledger, annotated with private notes, read
against saved cold-call scripts, imported from CSV/JSON, and exported at any time.

The scan itself runs on the operator's own Apify account through the
`compass/crawler-google-places` actor. Lead Atlas never holds the Apify token on its
server: the token lives in the signed-in user's `profiles.apify_token` row (owner-only
RLS), is cached in the browser for boot, and is cleared on sign-out. Saved reports and
leads live in the user's own Supabase project, protected by row-level security.

## Who it is for

Solo local-growth operators: freelancers, small agencies, web studios, field sales and
growth consultants who do the knocking themselves. They work in short bursts between
calls, come back to the same list for weeks, and care about a phone number, a note and a
next action more than about dashboards for their own sake.

## The job to be done

1. Name a trade and a place.
2. Scan Google Maps and get a clean, callable sheet — not a raw data dump.
3. Save the sheet so it survives the tab closing.
4. Work the list: mark reached out / do not contact, add a note, read the script.
5. Export or reopen months later without losing the trail.

## Product truths that UI work must not invent

- Lead Atlas is **free**; scans are billed by the user's own Apify account at public
  pay-per-event rates (shown in the pricing page and scanner estimate).
- Apify's safety cap per run is at least **$0.50**; the scanner may return fewer places
  than requested.
- Review-count filtering is applied **after** the scan.
- Imports are parsed **in the browser**; the file never leaves the device.
- Users must bring their **own Apify token**. Contact enrichment is optional and costs
  more per place. "No website" scans run without contact enrichment.
- Data is stored in the user's Supabase project, guarded by RLS; the server never stores
  or logs the Apify token.
- Not affiliated with Google or Apify.

## Constraints

- No framework, no build step. Vanilla HTML/CSS/JS with ES modules.
- Five surfaces: `index.html` (persuade), `how-it-works.html` (persuade/read),
  `pricing.html` (persuade), `auth.html` (operate), `app.html` (operate).
- All pages load `styles.css`, `workspace.css`, `atlas.css` in that order.
- Existing JS contracts (IDs, state classes, `hidden`, hash routes) must keep working.
- Google Fonts only; CSP allow-lists `fonts.googleapis.com` and `fonts.gstatic.com`.
- Local server binds 127.0.0.1; Vercel deployment is public but stateless.
