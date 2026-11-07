# AGENTS.md — Project rules for Lead Atlas

## Role
You are an expert Node.js + Express engineer maintaining Lead Atlas, a local-first Google
Maps lead scanner with a Supabase-backed workspace. It proxies the
`compass/crawler-google-places` Apify Actor for a vanilla-JS frontend.

## Project Context
A local web app for one operator, now with accounts and a cloud lead library. It also ships
as a public Vercel deployment (project `lead-atlas`, production alias
<https://lead-atlas-ochre.vercel.app>) using Vercel’s Express preset. The local server holds
no secrets (the Apify token lives in the signed-in user's Supabase `profiles.apify_token`
row, owner-only RLS, and is cached in browser localStorage; Supabase uses only the public
anon key), binds 127.0.0.1, and returns field reports. The Vercel function is public but
stateless and likewise holds no server-side secrets. Saved reports and leads live in the
user's own Supabase project, protected by row level security. The browser talks
to Supabase Auth and PostgREST directly; that is the one deliberate third-party call path.
The repo doubles as the local deployment: it runs from the same folder the user git-clones,
so a one-click self-update feature (see PROJECT.md) depends on that. The Vercel deployment
has `SELF_UPDATE=off` and ships by Git push or `vercel deploy` instead. Never move files in
ways that break `git` or the module graph.

## Commands
- Run tests: `npm test` (Node built-in test runner; no network/token needed)
- Start dev server: `npm run dev` (watch) or `npm start`
- Bump version: `npm run bump:patch` / `bump:minor` / `bump:major` (never edit by hand)
- Deploy preview: `vercel deploy --scope adityatek14-4344` (project `lead-atlas`)
- Deploy production: `vercel deploy --prod --scope adityatek14-4344`, or promote a tested
  preview with `vercel promote <preview-url> --scope adityatek14-4344`
- Lint/format: none configured — match the existing code style exactly

## Architecture Principles
- Server modules are pure-ish: compute in plain functions, inject side effects (see
  `src/selfupdate.js`: runners injectable, helpers pure) so `node:test` needs no network.
- All Apify traffic is proxied through the local server (or the Vercel function); the
  browser never calls Apify directly. Supabase Auth/PostgREST is the deliberate exception,
  and the CSP `connect-src` must stay limited to `'self'` plus the configured project
  origin.
- Supabase security is RLS, not obscurity. The anon key is public by design; never add a
  `service_role` key to `.env`, the server, or the browser bundle.
- The Apify token is account data, not server config. Read and write it only through the
  signed-in user's `profiles.apify_token` row (owner-only RLS), cache it in localStorage
  for boot, and clear that cache on sign-out. Never log it or send another user's token.
- **Call scripts** live in one owner-only `script_libraries` row per account with an
  account-scoped browser cache; they are plain text and must never go to Apify or the
  local server.
- **Vercel deployment**: `src/server.js` default export must stay a lazy Express request
  handler; never export the `createApp` factory as default. Vercel serves `public/**`
  statically and ignores `express.static()`, while `vercel.json` rewrites `/` to
  `/index.html` and owns the static security headers/CSP. Keep those headers in sync with
  the server, set `SELF_UPDATE=off`, and never add a server-side secret to the function.
- Schema changes belong in `supabase/schema.sql`, must be idempotent, and must keep
  owner-only RLS policies on `profiles`, `lead_reports`, `leads`, and
  `script_libraries`.
- Errors surfacing to the UI must use `ApiError(status, code, message)` — the frontend
  maps `error.code`/`message` directly. Browser Supabase errors are mapped by
  `friendlySupabaseError()`; keep those messages actionable too.
- Frontend keeps all state in the single `state` object (including `auth` and `library`)
  and re-renders explicitly; no framework, no build step.
- The public site is multipage: `index.html`, `how-it-works.html` and `pricing.html` share
  `site.js`; `auth.html` is the only auth surface (`auth-page.js`); `app.html` is
  account-only, and `app.js` owns its hash routes. Do not fold auth back into `app.js` or
  recreate a single-document shell.

## Code Style
- ESM (`"type": "module"`), 2-space indent, double quotes in browser JS, single quotes ok
  in server files where already used, semicolons everywhere.
- UI copy: plainspoken field-report tone ("Field brief", "Data desk"). Avoid system-y jargon.
- CSS: reuse `:root` tokens (`--paper`, `--ink`, `--orange`, `--line`…), follow the
  `.key-chip` pill family for header controls.

## Boundaries
### Always:
- Run `npm test` after server/src or browser-core changes and before any commit.
- Keep commits small and descriptive (`feat:` / `fix:` / `docs:` / `test:` prefix).
- Update TASKS.md/MEMORY.md statuses when finishing a task.
- Keep `.env` out of git and document any new environment variable in `.env.example`,
  README, and `docs/SUPABASE-SETUP.md` when it affects setup.

### Ask First:
- Adding an npm dependency (currently: avoid — zero-dep app).
- Changing the public API shape of `/api/config`, `/api/runs` — i.e. breaking routes the
  browser depends on.
- Touching the rate limiter, security headers, or CSP `connect-src` allow-list.
- Changing the Supabase schema, RLS policies, or auth flow.
- Changing `vercel.json` rewrites/security headers, the Express preset/runtime, or
  deployment protection on the live project.

### Never:
- Commit secrets or tokens (`.env`, `.env.local`, and Vercel OIDC tokens are gitignored for
  a reason).
- Expose the server beyond 127.0.0.1 in code defaults.
- Put a Supabase `service_role` key in `.env`, the server, or the browser bundle.
- Log or persist the Apify token server-side, or expose another account's token.
- Weaken RLS or add a wildcard to the CSP `connect-src`.
- Ship placeholder/TODO code paths; every error message must tell the user what to do next.
- Force-push or rewrite history that the local self-updater might rely on — resets are
  pull-based via `git reset --hard origin/<branch>`.
