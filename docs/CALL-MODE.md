# CALL-MODE.md — One lead at a time

## Problem Statement

Calling a lead inside Lead Atlas costs a chain of small moves: find the row, open
the drawer, scroll to the script, dial, come back, mark a status, type a note,
close the drawer, find the next row. That tax repeats thirty to fifty times a
day, and the report table is not a phone UI. The script, the number, the note,
and the outcome should all be in one place, with one key between leads.

## Goals (In Scope)

- Open a focused **call mode** session from the report hero or a lead drawer.
- Work through a queue built from the leads that currently match the report's
  filters, in the current sort order, minus leads already marked do not contact
  (unless the operator explicitly includes them).
- Show the business name, category, rating, full address, and a large `tel:`
  link for every lead in the queue that is not blocked.
- Show the active cold-call script filled with that lead's placeholders, with a
  script picker inside the session.
- Let the operator mark **Reached out**, **Do not contact**, or **To contact**
  without leaving the session, reusing the existing outreach ledger.
- Offer note presets, a private note field, and a visible save state.
- Move with **Next** / **Previous**, finish the queue without wrapping, and show
  a session summary with **Start over** and **Back to report**.
- Be keyboard-first on desktop and thumb-first on a phone.
- Fail safely: no script, no phone, no leads, or a stale report must all produce
  a clear next step instead of an empty panel.

## Non-Goals (Out of Scope)

- **No schema change.** `supabase/schema.sql`, RLS policies, and the outreach row
  shape stay exactly as they are. This feature writes the existing
  `outreach_status`, `outreach_note`, and `contacted_at` fields.
- **No saved follow-up task.** A durable “next action” (a callback date, a type,
  and its own note) needs new columns, export/import fields, and a dashboard
  queue. That is a data-model feature and stays deferred rather than half-built.
  In this release “next action” means the session's forward step: the primary
  footer action records the outcome and opens the next lead, and the next
  business is named before you press it.
- No dialer integration beyond `tel:` links, no call recording, no telephony,
  no background timers, no campaign automation.
- No changes to `/api/config`, `/api/runs`, the rate limiter, security headers,
  CSP, or the Vercel deployment shape.
- No new npm dependencies and no build step.

## Acceptance Criteria

- [x] AC1: The report hero and the lead drawer both open call mode. The drawer
      closes first so two dialogs never stack.
- [x] AC2: The queue mirrors the filtered, sorted report, keeps report order,
      skips duplicate ids, and excludes do-not-contact leads by default. If the
      queue is empty because every remaining lead is blocked, the empty state
      offers to include them.
- [x] AC3: Opening from a lead starts on that lead. Otherwise the session starts
      on the first lead that has not been reached out to, or the first lead when
      every lead in the view has been.
- [x] AC4: The session shows name, category, rating, address, and a large phone
      link. Additional phone numbers stay available. A lead without a phone
      shows a plain explanation and its email/Maps links. A do-not-contact lead
      included for review keeps its details but loses the dial target until it
      is returned to the contact list.
- [x] AC5: The script is filled from that lead through `scriptContextFor()` and
      `fillScriptTemplate()`. Switching scripts inside the session re-fills
      without leaving the lead. A missing script offers a way to write one.
- [x] AC6: Outcome buttons write through `setOutreachStatus()`; the note is
      saved in the same write. Marks sync to a saved report through
      `syncSavedLead()` exactly like the table and drawer.
- [x] AC7: Note presets append without duplicating text and never exceed the
      280-character limit. The note saves on blur, on advance, on outcome, on
      a visibility change, and when the session closes.
- [x] AC8: `J` / `ArrowRight` moves next, `K` / `ArrowLeft` previous, `C` marks
      reached out and advances, `X` marks do not contact and advances, `U`
      returns the lead to the contact list, and `N` focuses the note. Shortcuts
      are ignored while typing, with modifiers held, and on key repeat.
- [x] AC9: Reaching past the last lead shows a summary of the session and does
      not wrap. **Start over** rebuilds from the current report view.
- [x] AC10: Call mode survives a trip to the phone app: returning to the tab
      re-renders the current lead without resetting the queue or the note.
- [x] AC11: `npm test` stays green and `public/call-mode-core.js` has pure unit
      coverage for queue planning, stepping, shortcuts, presets, and progress.
- [x] AC12: The workspace still passes its existing report, drawer, script,
      export, import, saved-report, and shortcut flows.

## Design

### Files

- `public/call-mode-core.js` — pure session rules: queue planning, stepping,
  shortcut resolution, note presets, progress. No DOM, storage, or network.
- `test/call-mode-core.test.js` — unit coverage for the rules above.
- `public/app.html` — `#callModeDialog`, the report hero action, and the drawer
  action. Reuses the existing icon sprite and dialog conventions.
- `public/app.js` — `state.callMode`, rendering, entry points, keyboard handling,
  note persistence, and the small shared note writer used by the drawer too.
- `public/atlas.css` — the Survey Signal treatment for the session, plus phone
  layout and safe-area rules.

### Session state

```js
state.callMode = {
  open: false,
  queue: [],          // lead ids, frozen at open/restart
  index: -1,          // 0-based position in queue
  leadId: null,       // last rendered lead id
  scriptId: null,     // script picker choice for this session
  includeBlocked: false,
  complete: false,
  noteDirty: false,
  returnFocus: null,  // control to restore when the session closes
  scriptSignature: "", // last rendered lead/script pair
};
```

The queue is a **snapshot**. Marking a lead during the session does not reshuffle
the list under the operator's hands; the lead keeps its position and its new
status is shown in place. **Start over** rebuilds from the current view.

### Queue rules

`planCallSession(leads, { leadId, includeBlocked })` returns `{ ids, startIndex }`:

1. Walk the leads in the order the report is currently showing them: filtered,
   then sorted by the active sort.
2. Skip entries without an id and skip duplicates (first wins).
3. Skip `do-not-contact` unless `includeBlocked` is true.
4. If `leadId` is in the queue, start there.
5. Otherwise start at the first lead that is not `contacted`.
6. If every lead is contacted, start at the first lead.
7. An empty queue returns `startIndex: -1`.

`stepCallQueue(index, total, direction)` returns `{ index, done, moved }`:

- `done` means “stepped past the end” (only possible forward).
- `moved` is false when the step is clamped (previous on the first lead).
- A step never wraps.

### Data writes

- Status and note go through the existing `setOutreachStatus(lead, status, { note })`
  path, so the local ledger, the saved-report sync, the Undo toast, and the
  export fields all behave exactly as they do from the table.
- A note-only save uses one shared `writeOutreachNote(lead, value)` helper built
  from the same ledger entry shape as the drawer's save. The drawer keeps its
  own UI bookkeeping but no longer duplicates the write. A save refreshes the
  report underneath the session without re-rendering the session itself, so the
  note field and script picker are never disturbed mid-edit.
- There is no new storage key, no new network call, and no server change.

### Entry points

- **Report hero:** a signal-accented **Call mode** button, first in the action
  row, opens the session with no requested lead.
- **Lead drawer:** a **Call this lead** button opens the session with that lead
  requested. The drawer closes first. A do-not-contact lead never starts a
  session: the drawer button is disabled with an explanation, and a requested
  blocked lead falls back to the first open lead with a toast that says why.
- **Including blocked leads.** The empty-state **Include do-not-contact** action
  rebuilds the queue with those leads for a review pass. Their details render,
  but the dial target is replaced by a note until **To contact** / `U` clears
  the mark, so the session never invites a call the mark prevents.
- The existing **Call sheet** and inline scripts are untouched. Call mode is the
  dialing loop; the call sheet remains the read/copy surface.

### Keyboard and focus

`resolveCallShortcut({ key, typing, repeat, meta, ctrl, alt })`:

| Key | Action |
| --- | --- |
| `J`, `ArrowRight` | Next lead |
| `K`, `ArrowLeft` | Previous lead |
| `C` | Mark reached out, then next |
| `X` | Mark do not contact, then next |
| `U` | Return to the contact list (stay) |
| `N` | Focus the note |

- Typing in an `input`, `textarea`, or `select` suppresses every shortcut, as do
  `meta`/`ctrl`/`alt` and held-down repeats.
- The primary footer action changes with the lead: **Reached out & next** while
  the lead is to-contact, **Next lead** once it is marked.
- Shortcuts are handled at the document level while the session is open, so a
  control that disappears mid-advance cannot silently disable the map. On the
  summary, only `K` / `ArrowLeft` steps back into the queue; the panel owns the
  forward path.
- On open, focus goes to the phone link when the lead has a dialable number,
  otherwise the footer action; on completion, focus moves to the summary panel.
  Closing returns focus to the control that opened the session when it is still
  on screen.
- Escape uses the native dialog close. A dirty note is saved on close.

### Accessibility

- Native `<dialog>` with `showModal()`, labelled by the business name.
- The progress bar is a real `role="progressbar"` with `aria-valuenow`.
- Outcome buttons are `aria-pressed` and reuse the drawer's group semantics.
- Moving to a lead announces its name and position through a polite live region.
- Note state is announced through a polite live region.
- Every icon-only control has an `aria-label`; keyboard hints are decorative.
- A phone number only becomes a dial link when it has at least six dialable
  digits, matching the drawer.
- Focus rings use the existing blue outline; reduced motion is inherited from the
  shared dialog animation rules.

### Responsive behavior

- Desktop: a two-column body — lead and script on the left, outcome and note on
  the right — with a persistent footer.
- ≤760px: the dialog becomes the viewport, the body stacks, and the footer stays
  pinned above the safe area. Navigation becomes a thumb row (Previous and Next
  on one line, Skip beneath), and the long keyboard hint line is hidden while the
  outcome buttons keep their shortcuts in a compact key cap.
- ≤560px: the type scale tightens, the phone link stays at thumb size, and the
  note keeps a 16px input so iOS does not zoom the sheet.

### Failure modes

| Situation | Behavior |
| --- | --- |
| No report | Entry points are inert; call mode never opens. |
| Report has no leads | Empty state: run a scan or import a file, then open call mode again. |
| Filters hide every lead | Empty state: “No leads match the current filters” + Back to report. |
| All leads blocked | Empty state explains and offers **Include do-not-contact**. |
| No script saved | Script panel explains and offers **Write a script**. |
| No phone | The phone block is replaced by a plain note; email/Maps stay usable. |
| Blocked lead included | The dial target is replaced by a note until the lead is returned to the contact list. |
| Note at 280 chars | Preset refuses with “Note is full”; typed text is capped by `maxlength`. |
| Lead vanished from results | Session closes; a toast says the report changed. |

## Test Plan

- Pure: `node --test test/call-mode-core.test.js` covers ordering, duplicate ids,
  blocked filtering, requested-lead fallback, all-contacted fallback, stepping,
  clamping, completion, shortcut guards, preset appending (added, duplicate,
  full, empty), and progress formatting.
- Suite: `npm test` must stay green.
- Manual smoke: open from hero and drawer; dial a lead; mark all three outcomes;
  undo a mark; switch scripts; append every preset; fill the note to the limit
  and try one more preset; move with every shortcut while focused in the note;
  complete the queue; step back with `K`; restart; return from the dialer;
  include blocked leads and confirm the dial target stays hidden until reset;
  resize to 390px and 1440px; reopen an existing saved report and confirm marks
  persist.

## Rollout

Feature release: `npm run bump:minor` (1.9.0 → 2.0.0 under the house minor-cap
rule). README, TASKS.md, and MEMORY.md are updated in the same commit.
