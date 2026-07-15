# Brick City Planner — UI/UX Overhaul (2026-07-15)

Design spec for a visual + UX overhaul driven by user feedback: "desktop not clean/tidy;
holding Alt to un-snap accidentally clones; mobile isn't as good; the catalog column cuts
off words like *legacy* / *discontinued*. Make it nice, interactive, fun, clean, easy to use."

Orchestrated as a multi-phase, agent-QA'd effort. Branch: `feature/ui-overhaul`.
End state (user choice): **deploy when green** — merge to `main` → GitHub Pages.

## Decisions (locked with the user)

- **Visual direction: Blend — "Studio + Toybox".** Clean, organized, spacious structure of a pro
  design tool (Linear/Figma calm) warmed with LEGO color, brick tactility on key controls, and
  playful snap/place micro-animations. Not a childish theme; not a sterile tool. Clean AND fun.
- **Declutter: Moderate.** Group toolbars into labeled sections with dividers + tooltips; keep
  everything visible (nothing hidden behind overflow menus).
- **Ship: deploy when green.** QA loop passes → commit `main` → push.

## Confirmed bugs (root causes)

1. **Alt does two jobs.** `grid.js` bound Alt to BOTH clone (`spawnCopies` on pointerdown) and
   snap-bypass (`!e.altKey` in move). Result: un-snapping always spawned a copy. → **Fixed in
   Phase A:** Alt = bypass-snap only; duplicate stays on Ctrl+D / copy-paste / a new ⧉ Duplicate
   button. Shortcuts modal updated.
2. **Leaked internal id on tile faces.** Tile sub-line printed `set_num` verbatim; synthetic pieces
   carry slugs like `piece-road-straight`. → **Fixed in Phase A:** only real numeric set numbers
   show; synthetic pieces show just the size.
3. **Catalog header/labels cut off & cramped** ("138 sets · 1665 retired hidden" wraps; "LEGACY
   SORT" jammed). → Phase C (catalog restyle).
4. **Mobile toolbars overflow into cut-off horizontal scroll**, emoji icons render inconsistently
   (🌙 looks like a banana). → Phase C (mobile layout + SVG icon set).

## Design language

- **Tokens** (`css/styles.css :root`): real spacing scale (8px base), neutral surfaces + soft
  borders, LEGO-yellow primary accent, systematized category palette, two radii (card vs. chunky
  brick-button), restrained shadows + a tactile pressed-brick state. Full dark-mode +
  colorblind-safe parity (infra exists).
- **Type**: friendly geometric sans (system stack) for UI; keep letter-spaced small-caps section
  labels; warm the wordmark/headings.
- **Icons**: one consistent inline-SVG monoline set replacing emoji-only toolbar buttons (fixes the
  banana-moon + inconsistent mobile emoji). Emoji kept only where playful (category chips).
- **Motion**: snap "bounce" + subtle click on connect, quick settle on place, 1px brick-press on
  buttons. All behind `prefers-reduced-motion`.

## Layout (Moderate declutter — grouped, all visible)

- **Topbar**: brand · city context (name + save dot) · grouped view toggles (units/theme/cbsafe/
  scale/snap as one segmented cluster) · actions (Export primary, rest quieter). Graceful wrap.
- **Canvas toolbar**: labeled sections + dividers + tooltips — History · Arrange (rotate/front/back/
  delete/lock **+ ⧉ Duplicate**) · Layers · Tools · Table · Zoom · View (check/3D/PNG/help).
- **Catalog**: one-line count with the "retired hidden" note demoted; Legacy toggle + Sort on
  properly-spaced rows (no wrap/cutoff); polished chips; fix stacked-ground-tile label collision.
- **Summary**: spacing/rhythm polish; structure kept.
- **Mobile**: compact reachable toolbars (no cut-off horizontal scroll), SVG icons, 44px targets,
  canvas-first preserved.

## Non-goals

Keep every existing feature and data model. No feature removal, no catalog rebuild. This is a
visual/UX + targeted-bug effort.

## Orchestration

- **Phase A — bugs (done).** Alt decouple + id-leak fixed; verified on the live site by
  `tools/qa/verify-fixes.mjs` (5/5) + `npm test` (244/244).
- **Phase B — direction.** Workflow renders 3 mockups of the Blend shell (accent/toolbar variants);
  screenshots presented to the user to choose the winner.
- **Phase C — implement.** Ordered passes: tokens → topbar → toolbar → catalog → tiles → summary →
  mobile → motion + SVG icons.
- **Phase D — QA loop.** Workflow fans out UI-checker + functional-tester + UAT agents that drive
  the live site (`tools/qa/lib.mjs`), screenshot, file findings; adversarially verified, ranked,
  fixed; loop until clean. Then `npm test` green.
- **Ship.** README changelog, merge to `main`, push, hand off before/after.

## QA harness (`tools/qa/`)

- `lib.mjs` — static server + Playwright (system Chrome) + interaction helpers (place via the ＋
  button since HTML5 DnD can't be fired; pointer-drag placed tiles; read tile sub-lines).
- `shot.mjs` — scenario screenshots (empty/sample × desktop/laptop/mobile + mobile catalog sheet).
- `verify-fixes.mjs` — Phase-A behavioural checks.
- Playwright is a build-time `devDependency` (like `sharp`) — nothing ships to users.
