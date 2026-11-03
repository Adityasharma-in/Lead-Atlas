# CALL-SCRIPTS.md — Cold-call script library + call sheet

## Problem Statement
Cold-calling a lead means reading the same script before every dial. Today those
scripts live outside Lead Atlas (WhatsApp, notes, a document), so the caller leaves
the report, finds the script, then comes back — and repeats that for every prospect.
The script needs to live in the same app as the call list and appear beside the lead
being called.

## Goals (In Scope)
- Save, edit, duplicate, delete, and search multiple plain-text cold-call scripts.
- Keep the script library in the browser, beside the existing outreach ledger.
- Open a readable **call sheet** from the report, header, or a lead drawer.
- Fill script placeholders from the current lead: business, category, city, address,
  phone, email, website, search niche, search location.
- Copy the filled script, and mark the lead reached out from the call sheet.
- Import existing scripts from JSON or plain text; export a JSON backup.
- Keep the UI fast, keyboard-friendly, and usable on a phone next to the phone call.

## Non-Goals (Out of Scope)
- No server database, accounts, or multi-device sync. Scripts are browser-local,
  exactly like outreach marks.
- No rich-text editing, audio recording, teleprompter scrolling, or call recording.
- No per-lead script assignment or campaign automation.
- No changes to `/api/config`, `/api/rules`, the rate limiter, or security headers.

## Acceptance Criteria
- [x] AC1: The header **Scripts** chip opens the library on every screen and at every
      breakpoint; the library also opens from the report toolbar and empty state.
- [x] AC2: A script can be created, renamed, edited, duplicated, deleted (with undo),
      searched, and marked as the script that opens by default.
- [x] AC3: Edits save automatically to `localStorage` under `leadAtlas.scripts.v1`;
      closing the dialog or switching scripts never loses a pending edit.
- [x] AC4: The lead drawer has a **Call script** action. The call sheet shows the
      chosen script filled with that lead's details; the report-level action shows a
      filled preview using the report query.
- [x] AC5: The call sheet can copy the filled script and mark the lead reached out;
      both results are announced with a toast.
- [x] AC6: JSON export/import round-trips; a `.txt`/`.md` file imports as one script.
- [x] AC7: Corrupt or oversized storage/files fail safely with actionable messages; the
      app still boots.
- [x] AC8: `npm test` stays green, with pure unit coverage for the script core.

## Design
- `public/scripts-core.js` — pure normalization, store operations, placeholder filling,
  import/export helpers. No DOM, storage, or network.
- `public/app.js` — load/save the store, two dialogs (library and call sheet), lead
  context, copy/outreach actions, import/export file handling.
- `public/index.html` — header chip, report action, drawer action, library dialog,
  call-sheet dialog, new script icon.
- `public/styles.css` — library grid, editor, placeholder chips, call-sheet reading
  surface, mobile stacking. Reuses `:root` tokens and the key-chip/dialog families.

## Data Model
```json
{
  "version": 1,
  "activeId": "scr_…",
  "scripts": [
    {
      "id": "scr_…",
      "title": "Dentist — no website",
      "body": "Hi, this is … calling about {business} in {city}…",
      "createdAt": "2026-11-03T09:00:00.000Z",
      "updatedAt": "2026-11-03T09:02:00.000Z"
    }
  ]
}
```

Limits: 60 scripts, 80-character titles, 12,000-character bodies, 2 MB imports.

## Placeholders
`{business}`, `{category}`, `{city}`, `{address}`, `{phone}`, `{email}`, `{website}`,
`{niche}`, `{location}`. Values come from the open lead first, then the report query;
missing values use natural fallbacks ("there", "your area", "this number"). Unknown
tokens stay visible so they can be corrected instead of silently disappearing.

## Storage & Privacy
Scripts never leave the browser. They are not sent to the local server, Apify, or any
third party. Export a JSON backup before clearing site data. Storage parse failures
fall back to an empty library and never block boot.

## Verification
- Pure unit tests in `test/scripts-core.test.js`: normalization, limits, store
  operations, active selection, merge/import, placeholder filling, export shape.
- Manual browser pass (2026-11-03): seed scripts, reload persistence, open from each entry
  point, fill a lead, copy, mark reached out, import a `.txt`, corrupt/oversized imports,
  storage-quota failure, and toast placement inside stacked dialogs.
- Full `npm test` (170 tests).
