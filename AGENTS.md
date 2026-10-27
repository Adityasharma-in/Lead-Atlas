# AGENTS.md — Project rules for Lead Atlas

## Role
You are an expert Node.js + Express engineer maintaining Lead Atlas, a local-first Google
Maps lead scanner that proxies the `compass/crawler-google-places` Apify Actor for a
vanilla-JS frontend.

## Project Context
A single-user local web app. The server holds no secrets (the Apify token lives in browser
localStorage), binds 127.0.0.1, and returns a field report of businesses. The repo doubles
as the deployment: it runs from the same folder the user git-clones, so shipping features
means committing to this repository. A one-click self-update feature (see PROJECT.md)
depends on that — never move files in ways that break `git` or the module graph.

## Commands
- Run tests: `npm test` (Node built-in test runner; no network/token needed)
- Start dev server: `npm run dev` (watch) or `npm start`
- Lint/format: none configured — match the existing code style exactly

## Architecture Principles
- Server modules are pure-ish: compute in plain functions, inject side effects (see
  `src/selfupdate.js`: runners injectable, helpers pure) so `node:test` needs no network.
- All Apify traffic is proxied through the local server; the browser never calls third
  parties (strict CSP). Keep it that way.
- Errors surfacing to the UI must use `ApiError(status, code, message)` — the frontend
  maps `error.code`/`message` directly.
- Frontend keeps all state in the single `state` object and re-renders explicitly;
  no framework, no build step.

## Code Style
- ESM (`"type": "module"`), 2-space indent, double quotes in browser JS, single quotes ok
  in server files where already used, semicolons everywhere.
- UI copy: plainspoken field-report tone ("Field brief", "Data desk"). Avoid system-y jargon.
- CSS: reuse `:root` tokens (`--paper`, `--ink`, `--orange`, `--line`…), follow the
  `.key-chip` pill family for header controls.

## Boundaries
### Always:
- Run `npm test` after server/src changes and before any commit.
- Keep commits small and descriptive (`feat:` / `fix:` / `docs:` / `test:` prefix).
- Update TASKS.md/MEMORY.md statuses when finishing a task.

### Ask First:
- Adding an npm dependency (currently: avoid — zero-dep app).
- Changing the public API shape of `/api/config`, `/api/rules` — i.e. breaking routes the
  browser depends on.
- Touching the rate limiter or security headers.

### Never:
- Commit secrets or tokens (`.env` is gitignored for a reason).
- Expose the server beyond 127.0.0.1 in code defaults.
- Ship placeholder/TODO code paths; every error message must tell the user what to do next.
- Force-push or rewrite history that the local self-updater might rely on — resets are
  pull-based via `git reset --hard origin/<branch>`.
