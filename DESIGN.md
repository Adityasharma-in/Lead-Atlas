# DESIGN.md — Lead Atlas

## THESIS

Lead Atlas is a **live field instrument**, not a paper atlas and not a pastel SaaS.
The surface owns one idea: the moment a map scan becomes a precise call sheet. It refuses
the category's soft gradients, rounded lavender cards and decorative serif; it uses chalk,
ink, hi-vis signal lime and blueprint blue with the discipline of a survey console.

## OWN-WORLD

- **Ground:** chalk `#F2F3EB`, raised paper `#FCFCF7`, washed panel `#E7E9DD`.
- **Ink:** forest-black `#0C1611`, soft `#26332B`, muted `#5C665D`.
- **Signal:** hi-vis lime `#C8F14A` (live states, marks, primary action edge);
  blueprint ultramarine `#2337E8` (links, route lines, secondary emphasis).
- **Alerts:** oxide red `#C92A3F`; amber `#C98A00`; success green `#1E7A4C`.
- **Lines:** `#C9CEBF` hairlines; `#9FA898` for stronger rules. 1px is the default weight.
- **Type:** Archivo (variable, `wdth` 62–125) for display and UI; Spline Sans Mono for
  labels, coordinates, counts and table numerics. Display is expanded (`font-stretch:
  112–122%`), tight (`-0.04em`), 700–850. Labels are 10–11px mono uppercase, tracked
  `0.12em`. Body is 15–17px Archivo 400 at 1.55–1.65.
- **Shapes:** 8px controls, 12px cards, 16px large panels, 999px pills. 1px ink or line
  borders; no soft drop shadows on every card. Signature corner ticks (crosshair brackets)
  mark the live map, scanner and hero panels. Hard 4–6px offset ink shadows appear only on
  floating "field" cards, primary buttons and final CTA.
- **Texture:** a faint 72px blueprint grid on chalk surfaces, a fine 3px dot/halftone
  grain at very low opacity. No blobs, no coloured glows, no glassmorphism.
- **Icons:** 1.6px stroke, squared terminals; icons sit in lime or ink 34–40px squares.

## STORY

The operator sees that the businesses they need already exist on the map. They watch the
scan sweep the grid, trust the readout, and get a clean sheet they can call from. The
product then keeps that sheet — contacts, marks, notes, scripts — in a library that
survives the tab.

## FIRST VIEWPORT

A 48/52 split on chalk. Left: mono eyebrow with a lime signal square; three-line expanded
Archivo headline (“Every business / on the map. / One clean call sheet.”), the last line
marked with a lime highlighter rule; a 48ch lede; ink primary button with lime arrow block
and outlined secondary; a mono trust row. Right: a live survey panel with an ink 1px
frame, crosshair corners, coordinate top bar, chalk map with blueprint grid, lime scan
sweep and route, lime signal pins, a floating white lead card and a small ink library
card. A four-cell metrics band with hairline dividers closes the viewport.

## FORM

Full replacement of the incumbent "Atlas After Dark" world. Every surface is rebuilt in
the new grammar: marketing pages, auth, and the six workspace views. Content, product
truth, routes, IDs and functional behaviour are preserved.

## Component rules

- **Buttons:** ink fill / chalk text primary with a lime arrow block; chalk fill with ink
  border secondary; text link = mono uppercase with a 1px underline that extends on hover.
  Press scale `.985`. Focus ring: 2px ultramarine with 3px offset.
- **Cards:** paper surface, 1px line border, 12px radius, corner ticks on interactive or
  live cards. Hover raises by 2px and draws a lime 2px top edge, never a glow.
- **Live / selected states:** lime fill with ink text, or lime 3px marker on the left.
  Ultramarine is reserved for links, route lines and progress; never fill a large button
  with it.
- **Dark panels:** ink `#0C1611` with chalk text, lime numbers; used for the activity
  panel, the scanner estimate, report/progress/data heroes, the final CTA and the footer.
- **Tables:** mono row numbers, 11px mono uppercase headers, hairline row rules, hover
  lime left marker; tabular numerals.
- **Forms:** 1px line inputs on paper, 44–48px height, label mono uppercase; focus =
  ink border + lime inset ring; errors oxide red. Switches and range tracks use lime for
  the active portion.
- **Dialogs:** chalk paper, 16px radius, 1px ink border, 8px hard ink offset; headers use
  mono kicker + expanded Archivo title. Drawer slides from the right; mobile full height.
- **Motion:** scan-sweep, mark-in, ticker, radar and rise are the native moves. Entrances
  420–700ms with `cubic-bezier(0.16,1,0.3,1)`; hovers 160–240ms; no bounce except the
  switch thumb and toast. View changes rise 10px + fade. All motion has a
  `prefers-reduced-motion` shutdown.
- **Copy:** plainspoken field-report tone. Keep existing factual copy; do not invent
  prices, customers, benchmarks or capabilities.

## Responsive rules

- 1280px shell; 1400px workspace page; gutters 24px mobile / 40px desktop.
- Hero stacks at 1000px; map panel becomes full width with floating cards reduced to two.
- Bento collapses 3 → 2 → 1 columns. Preview shell hides its sidebar below 760px.
- App sidebar becomes an off-canvas drawer under 1080px; bottom nav appears under 760px.
- No horizontal overflow at 360px. Touch targets ≥ 44px.

## Anti-rules

- No cream/serif/orange revival, no violet gradients, no lavender paper.
- No `backdrop-filter` glass, neon glow, 3D blobs or generic gradient text.
- Do not remove `[hidden] { display:none !important }`, change JS IDs, or alter the
  `is-*` state classes.
- Do not weaken CSP or add server-side secrets.
