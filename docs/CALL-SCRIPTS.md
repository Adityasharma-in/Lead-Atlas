# CALL-SCRIPTS.md — Cold-call script library + call sheet

## Problem Statement
Cold-calling a lead means reading the same script before every dial. Today those
scripts live outside Lead Atlas (WhatsApp, notes, a document), so the caller leaves
the report, finds the script, then comes back — and repeats that for every prospect.
The script needs to live in the same app as the call list and appear beside the lead
being called.

## Goals (In Scope)
- Save, edit, duplicate, delete, and search multiple plain-text cold-call scripts.
- Save the library to the signed-in account in Supabase and keep an account-scoped
  browser cache for instant edits and offline fallback.
- Open a readable **call sheet** from the report, header, or a lead drawer.
- Show the active script as plain text at the bottom of the extracted-leads report and at
  the bottom of each lead drawer, so reading it never requires opening a dialog.
- Fill script placeholders from the current lead: business, category, city, address,
  phone, email, website, search niche, search location.
- Copy the filled script, and mark the lead reached out from the call sheet.
- Import existing scripts from JSON or plain text; export a JSON backup.
- Keep the UI fast, keyboard-friendly, and usable on a phone next to the phone call.

## Non-Goals (Out of Scope)
- No sharing between accounts or team workspaces. Each signed-in user has one private
  library row (`public.script_libraries`).
- No real-time collaborative editing; the newest full-library write wins.
- No rich-text editing, audio recording, teleprompter scrolling, or call recording.
- No per-lead script assignment or campaign automation.
- No changes to `/api/config`, `/api/runs`, the rate limiter, or security headers.

## Acceptance Criteria
- [x] AC1: The header **Scripts** chip opens the library on every screen and at every
      breakpoint; the library also opens from the report toolbar and empty state.
- [x] AC2: A script can be created, renamed, edited, duplicated, deleted (with undo),
      searched, and marked as the script that opens by default.
- [x] AC3: Edits save locally under an account-scoped key and write through to
      `public.script_libraries`; closing the dialog or switching scripts never loses a
      pending edit. A failed cloud write leaves the local copy marked **Local only**.
- [x] AC4: The lead drawer has a **Call script** action. The call sheet shows the
      chosen script filled with that lead's details; the report-level action shows a
      filled preview using the report query.
- [x] AC5: The call sheet can copy the filled script and mark the lead reached out;
      both results are announced with a toast.
- [x] AC6: JSON export/import round-trips; a `.txt`/`.md` file imports as one script.
- [x] AC7: Corrupt or oversized storage/files fail safely with actionable messages; the
      app still boots.
- [x] AC8: `npm test` stays green, with pure unit coverage for the script core and the
      Supabase row shape.
- [x] AC9: The report body ends with the active script as plain text, filled from the
      report query, with no reveal button; the panel updates when the default script or its
      contents change.
- [x] AC10: The lead drawer ends with the active script filled from that lead, also with no
      reveal button; the call-sheet action stays available for copy and outreach actions.

## Design
- `public/scripts-core.js` — pure normalization, store operations, placeholder filling,
  import/export helpers, and Supabase row conversion. No DOM, storage, or network.
- `public/app.js` — load/save the store, account sync, two dialogs (library and call
  sheet), lead context, copy/outreach actions, import/export file handling. The inline
  report and drawer scripts render through the same `activeScript()` +
  `fillScriptTemplate()` path, and refresh from `renderScriptChip()` so edits and default
  changes are reflected immediately.
- `public/app.html` — header chip, report action, drawer action, bottom-of-report and
  bottom-of-drawer inline script sections, library dialog, call-sheet dialog, new script
  icon.
- `public/styles.css` — library grid, editor, placeholder chips, call-sheet reading
  surface, inline report/drawer script sections, mobile stacking. Reuses `:root` tokens and
  the key-chip/dialog families.
- `supabase/schema.sql` — `public.script_libraries`, its update trigger, and owner-only
  RLS policies.

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
The library is stored in two places: the signed-in account's `public.script_libraries`
row (owner-only RLS) and an account-scoped local cache under
`leadAtlas.scripts.v1.<user-id>`. The local cache is written first so typing stays
instant; cloud writes are debounced and flushed when the library closes or the user signs
out. A failed cloud write leaves the local copy in place and the editor shows **Local
only**. Scripts are never sent to the local server or Apify. Export a JSON backup before
clearing site data or losing access to the account. Storage parse failures fall back to an
empty library and never block boot.

## Verification
- Pure unit tests in `test/scripts-core.test.js`: normalization, limits, store
  operations, active selection, merge/import, placeholder filling, export shape, and
  Supabase row round-tripping/error detection.
- Manual browser pass (2026-11-03): seed scripts, reload persistence, open from each entry
  point, fill a lead, copy, mark reached out, import a `.txt`, corrupt/oversized imports,
  storage-quota failure, and toast placement inside stacked dialogs.
- Account sync pass (2026-11-05): a Playwright harness with a fake Supabase API verified
  legacy migration, create/edit/default writes to `script_libraries`, flush on close and
  sign-out, reload, a fresh browser context loading the account row, the **Saved to
  account** badge at 390 px with no dialog overflow, and the missing-table fallback to
  **Local only**. Live-schema cross-device verification is still pending.
- Full `npm test` (198 tests).
