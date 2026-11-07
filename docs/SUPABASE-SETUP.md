# Supabase setup

Lead Atlas keeps the scanner local, but the workspace needs an account system and a
durable lead library. Those live in **your own Supabase project**:

- **Auth** — email + password, magic links, and password recovery.
- **Database** — `profiles`, `lead_reports`, `leads`, and `script_libraries`.
- **Security** — row level security (RLS) on every table, so a signed-in account can
  only read or write its own rows.

The browser talks to Supabase directly using the **anon / public** key. That key is
designed to be public; RLS is the security boundary. Never put a `service_role` key in
this app or in `.env`.

You need one Supabase project for your Lead Atlas install. The free tier is enough for
personal use.

## 1. Create the project

1. Sign in at <https://supabase.com/dashboard>.
2. Choose **New project**.
3. Pick an organization, name the project (for example `lead-atlas`), choose a region
   close to you, and set the database password.
4. Wait for the project to finish provisioning.

## 2. Run the schema

1. Open the project → **SQL Editor** → **New query**.
2. Open [`supabase/schema.sql`](../supabase/schema.sql) from this repository.
3. Copy the whole file into the editor and click **Run**.

The script is idempotent: it creates tables, indexes, triggers, and RLS policies only
when they are missing, so it is safe to run again after an update.

It creates:

| Object | Purpose |
| --- | --- |
| `public.profiles` | One row per account, created automatically on signup; also holds the account’s Apify token (`apify_token`) |
| `public.lead_reports` | Saved scans and imports, including summary and notes |
| `public.leads` | One durable row per lead, with the full normalized payload |
| `public.script_libraries` | One row per account with the full cold-call script array and default script |
| `handle_new_user()` | Creates the profile row when an account is created |
| `touch_updated_at()` | Maintains `updated_at` on every table |
| RLS policies | Owner-only select / insert / update / delete on all four tables |

## 3. Copy the API credentials

1. Open **Project Settings** → **API**.
2. Copy:
   - **Project URL** — looks like `https://abcdefghijklmno.supabase.co`
   - **anon / public** key — the long `eyJ…` key under **Project API keys**
3. Do **not** copy the `service_role` key.

If the project uses the newer publishable-key format, the value still belongs in
`SUPABASE_ANON_KEY`; the app treats it as the public browser key.

## 4. Add them to `.env`

From the repository root:

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
SUPABASE_URL=https://abcdefghijklmno.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Keep the optional `PORT` and `HOST` lines if you need them. The default app address is
`http://127.0.0.1:4317`.

`.env` is gitignored. Restart the server after changing it — the app reads the file once
at startup:

```bash
npm start
```

Check that the server sees the project:

```bash
curl http://127.0.0.1:4317/api/config
```

The `supabase` block should say `"configured": true` and show your project URL. The anon
key is intentionally included because the browser needs it.

## 5. Configure auth redirect URLs

Supabase sends confirmation, magic-link, and recovery emails back to the auth page. It has
one **Site URL** and a list of **Redirect URLs**. Set the Site URL to the primary origin
(the Vercel production domain for the live app), and add every origin you actually open the
app from to Redirect URLs. If one Supabase project backs both the local app and the Vercel
deployment, keep both sets of entries.

### Local redirect URLs

- `http://127.0.0.1:4317/auth.html`
- `http://127.0.0.1:4317/**` (covers `/auth.html` and every workspace deep link)
- `http://localhost:4317/auth.html` (useful if you open the app through `localhost`)
- `http://localhost:4317/**`

### Vercel production

The live deployment is `https://lead-atlas-ochre.vercel.app`.

- **Site URL**: `https://lead-atlas-ochre.vercel.app`
- **Redirect URLs**:
  - `https://lead-atlas-ochre.vercel.app/auth.html`
  - `https://lead-atlas-ochre.vercel.app/**`

Password sign-in works on Vercel without these entries. Email confirmation, magic links,
and password recovery fail until the deployed origin is allowed. Preview deployments get a
new hostname for every deploy; add that exact hostname if you test an email flow from a
preview, or use password sign-in there.

The auth page sends its current origin and pathname as `redirect_to`, so email links return
to `auth.html` and the workspace handoff resumes from there. If you change `PORT`, `HOST`,
or the production domain, add the matching origin and `/auth.html` path.

For local development you can leave email confirmation on and click the link Supabase
sends. To skip that step while testing, open **Authentication** → **Providers** →
**Email** and turn off **Confirm email**. Turn it back on before using the project for
real accounts.

## 6. Create your account and save a report

1. Start the server and open <http://127.0.0.1:4317> (or go straight to the auth page at
   <http://127.0.0.1:4317/auth.html>).
2. Click **Start free** (or **Sign in** if you already created an account).
3. Create the account, then sign in. The workspace opens at `app.html`.
4. Add your Apify key when you are ready to scan, or import a CSV/JSON file from the
   **Data desk**. Lead Atlas validates the key with Apify, then writes it to
   `public.profiles.apify_token` for the signed-in account and caches it in the browser.
5. Open a report and choose **Save to library**. Give it a name and optional private
   notes.
6. Open **Library** in the sidebar. The saved report should be there, with lead counts,
   outreach progress, and CSV/JSON export actions.
7. Refresh the page. Sign back in if needed; the library and Apify key should both reload
   from Supabase.

Signing out clears the browser cache of the Apify key, not the account copy. Signing in on
another browser loads the same key from `profiles.apify_token`; **Forget key** clears both.

Outreach marks made on a saved report are written back to its `leads` rows. If a write
fails, the mark still stays in this browser's local ledger and the app shows a warning.

Open **Scripts** in the workspace header, create or edit a script, and watch the save
badge. **Saved to account** means the library is in `public.script_libraries` for this
account; **Local only** means the browser copy is safe but the account write failed. The
library is also cached per account in the browser so it opens instantly and still works if
Supabase is briefly unreachable. Signing in on another browser should load the same
scripts.

## 7. Verify the security boundary

Run this in the SQL Editor while signed in as the project owner:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'lead_reports', 'leads', 'script_libraries');
```

All four rows should show `rowsecurity = true`.

To confirm the policies exist:

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

You should see owner-only policies for `profiles`, `lead_reports`, `leads` and
`script_libraries`.

To confirm the account key column exists (values stay private, so only the boolean is
shown):

```sql
select id, email, (apify_token is not null) as has_apify_token
from public.profiles;
```

To confirm a script library row exists without printing the script text:

```sql
select user_id, active_id, jsonb_array_length(scripts) as script_count, updated_at
from public.script_libraries;
```

## Deploying with Vercel

The repository is ready for Vercel’s zero-config **Express** preset. The linked project is
`lead-atlas` in team `adityatek14-4344`, and the production alias is
`https://lead-atlas-ochre.vercel.app`.

1. Link or import the repository:
   `vercel link --project lead-atlas --scope adityatek14-4344`.
2. Keep **Framework Preset: Express**, **Root Directory: `.`**, no Build Command, and no
   Output Directory. `public/**` is uploaded as static assets; `src/server.js` default
   export is the single serverless function.
3. Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SELF_UPDATE=off` for **Production**,
   **Preview**, and **Development**. Use the same values as `.env`. Never add a
   `service_role` key.
4. Disable **Settings → Deployment Protection → Vercel Authentication**, otherwise public
   routes redirect to `vercel.com/sso-api`.
5. Deploy with `vercel deploy` (preview) and `vercel deploy --prod` (production), or push to
   the connected GitHub branch. A CLI deploy uploads the current working tree; a Git deploy
   builds the pushed commit.
6. Add the production domain to Supabase redirect URLs (section 5), then test password
   sign-in and an email link.

`vercel link` may create `.env.local` with a short-lived OIDC token. `.env`, `.env.local`,
and `.vercel/` are gitignored; never commit them. If every page and API route hangs while
static CSS still loads, the deployment is running an old `src/server.js` whose default
export was the `createApp` factory. Deploy the current handler.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The auth page says **Supabase is not connected yet** | Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.env`, then restart the server. Check `/api/config` reports `"configured": true`. |
| **The Supabase schema is missing** | Run [`supabase/schema.sql`](../supabase/schema.sql) in the SQL Editor. If you just ran it, wait a moment for PostgREST's schema cache to refresh, then retry. |
| **The key dialog says the Apify-key column is missing** | The schema predates account-level keys. Re-run [`supabase/schema.sql`](../supabase/schema.sql); it adds `profiles.apify_token` without touching existing rows. Reload and save the key again. |
| **“The key is valid, but it could not be saved to your account”** | Retry while signed in. If it repeats, confirm the project is not paused, the `profiles` owner RLS policies exist, and `apify_token` is present. The key is not marked connected until the account write succeeds. |
| **Scripts say “Local only”** | The browser saved them, but the account write failed. Check the project is not paused and that `script_libraries` exists with owner-only RLS (re-run [`supabase/schema.sql`](../supabase/schema.sql)). Then edit a script or reopen the library to retry. Export a backup before clearing site data. |
| **Call scripts are empty on another device** | Sign in there with the same account and reload. If they are still missing, check the `script_libraries` row count above; the table or its RLS policies may be missing. A JSON backup can restore them from **Scripts → Import**. |
| **Scripts disappeared after signing in** | Scripts are scoped to the account. Sign in with the account that created them; the legacy browser-only library is migrated once when that account has no script row yet. |
| **Supabase blocked that request** | The RLS policies are missing or were edited. Re-run the policy section of `supabase/schema.sql`. |
| **Email or password is incorrect** | Use the same email you signed up with. Try **Forgot password?** or **Email me a sign-in link**. |
| **Confirm your email first** | Open the confirmation email, or turn off **Confirm email** for local testing. |
| **Too many emails sent** | Supabase rate-limits auth emails. Wait a minute, then request one link. |
| The email link opens the wrong page or an error | Add the origin you were using to **Authentication** → **URL Configuration** → **Redirect URLs**: `http://127.0.0.1:4317/auth.html` and its `/**` wildcard locally, or `https://lead-atlas-ochre.vercel.app/auth.html` and its `/**` wildcard on Vercel. Open the link in the same browser that requested it. |
| The deployed site redirects to `vercel.com/sso-api` | Deployment Protection is on. Open the Vercel project → **Settings** → **Deployment Protection** and disable **Vercel Authentication**. |
| Every deployed page and API hangs, but CSS loads | The build is running an old `src/server.js` that default-exported the `createApp` factory. Deploy the current tree, where the default export is the lazy Express request handler. |
| The deployed app says Supabase is not connected | Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the Vercel project’s Production, Preview, and Development environment variables, then redeploy. Confirm `/api/config` reports `"configured": true`. |
| The email link says the PKCE verifier is missing | Use the same browser that requested the link. The verifier lives in `localStorage`, so opening the link in a new tab is fine; a different browser is not. If it still fails, request a fresh link. |
| The workspace appears briefly, then returns to the auth page | Hard-refresh once so every tab has the current client. The client now survives transient refresh failures and coordinates token refresh across tabs; signing out in one tab still signs out the others by design. If it repeats, send the browser console error and the exact auth request status. |
| The library loads but is empty after a scan | Saving is explicit: open the report and choose **Save to library**. A scan that was never saved is not in the library. |
| A saved report opens with missing leads | The `leads` insert may have been interrupted. Delete the report and save it again; check the browser console for the Supabase error. |
| `service_role` key was pasted into `.env` | Remove it immediately and rotate the key in Supabase. Lead Atlas only needs the anon/public key. |

## How the pieces connect

```
Browser (vanilla JS)
  ├── /api/*  → local Express server or one Vercel Function → Apify
  └── https://<project>.supabase.co
        ├── /auth/v1/*      Supabase Auth (GoTrue)
        └── /rest/v1/*      PostgREST → Postgres + RLS
```

- On Vercel, the Express app runs as a single serverless function; `public/**` is served
  from the CDN and `/` is rewritten to `/index.html` by `vercel.json`.

- The server exposes the project URL and anon key through `GET /api/config`.
- The server adds the project origin to the CSP `connect-src`, so the browser can reach
  Supabase Auth and PostgREST without weakening the rest of the policy.
- Auth sessions are stored in browser `localStorage`; access tokens are refreshed
  automatically.
- Lead Atlas never receives your Supabase password. The browser exchanges it directly
  with Supabase Auth.
- The Apify token is saved to the signed-in account’s `profiles.apify_token` row and
  cached in browser `localStorage`. Owner-only RLS keeps the row private. The token is
  sent only to the local server, then to Apify; the server never stores or logs it.
- Call scripts are saved to the signed-in account’s `script_libraries` row and cached per
  account in the browser. The newest full-library write wins; script text goes only to
  your Supabase project, not to the local server or Apify.
- Signing out clears the browser cache. The account copy stays in Supabase until **Forget
  key** is used, the script library is cleared, or the profile row is deleted.
