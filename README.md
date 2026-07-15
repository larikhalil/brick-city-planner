# Brick City Planner

A digital, top-down **city planner for LEGO® sets** — design your city layout in a virtual space *before* buying the physical sets.

Browse a catalog of real sets, drag their footprints onto a stud grid that represents your table/floor, and see how the whole city fits together: total size (studs + cm), how baseplates tile, category mix, and piece count.

> Design spec: [`docs/superpowers/specs/2026-07-11-brick-city-planner-design.md`](docs/superpowers/specs/2026-07-11-brick-city-planner-design.md) ·
> Post-v1 roadmap: [`docs/superpowers/plans/2026-07-11-brick-city-planner-waves.md`](docs/superpowers/plans/2026-07-11-brick-city-planner-waves.md)

## Status

- **2D top-down** stud-grid planner · static site (HTML/CSS/vanilla JS) · hosted on GitHub Pages.
- Catalog built at build time from [Rebrickable](https://rebrickable.com/) bulk data (City, Town, Trains & Modular Buildings themes); ships as a static snapshot.
- A free, **non-commercial fan project**.

## Features

Built out across a research-driven 5-wave programme (see the roadmap above):

- **Editing** — drag/place/rotate/delete, stud snapping (tamed edge magnet + 🧲 toggle + Alt bypass — any-stud placement), port-to-port road/rail snapping, marquee multi-select + groups, copy/paste/duplicate/alt-drag clone, align & distribute, resizable notes/blocks, undo/redo with a history panel, autosave.
- **Commerce & data** — real per-set prices with manual override, "I own this" owned-vs-buy budget split, retired-set badges + Legacy toggle, bundle-pack rollup (buy boxes, not pieces) with a spare-parts panel, direct buy links (LEGO / BrickLink / Amazon), one-button shopping-list export (.txt / .csv / BrickLink .xml), wishlist.
- **Catalog & sharing** — search + category filters (incl. accessory-pack pieces), grid/list view, hover photo preview, favorites rail, starter-template gallery, named saves, one-click compressed share-link.
- **Accessibility & UX** — full keyboard placement/rotation, colorblind-safe patterns, high-contrast focus, ARIA live announcements, mobile/touch gestures, dark mode, lock pieces + Kid Mode, per-layer show/hide + lock.
- **Graphics & export** — photo-fill building tiles with facade cues, styled roads/tracks, terrain & zoning paint layer, sticky notes + custom MOC blocks, non-rectangular corner-modular footprints, and high-resolution PNG export with presentation mode.
- **Planning depth** — "Check my city" buildability checker (road plates count as ground), extra + custom baseplate sizes, true-stud scale reference overlay, real track curve-radius classes with mismatch warnings, track continuity / loop-closure validation, a rotatable read-only 3D / isometric preview (⟳ button + drag), and viewport culling for large layouts.
- **Mobile** — responsive phone layout with a canvas-first view, slide-up bottom-sheet catalog + summary, finger-drag to place and move pieces (works where HTML5 drag-and-drop can't), 44px touch targets, and tap-confirm delete.

## Changelog

- **Summary → grid: click to find & delete (2026-07-15)** — in the City summary, clicking a set's
  name in **Sets & ownership** (or a **By category** row) selects that set's placed tiles and scrolls
  the grid to centre them — quick way to locate a specific set (e.g. a retired/discontinued one) in a
  big city. Each set row also gets a **🗑 delete** (hover-reveal on desktop, always shown on touch)
  that removes every copy of that set from the grid (undoable with Ctrl+Z). Reuses the grid's existing
  `focusIds` (built for the Check-my-city "jump to issue" path).
- **Overhaul follow-up — feedback round 2 (2026-07-15)** — user-caught issues a screenshot-only
  review had missed, now fixed by driving the real site:
  - Catalog filter chips were `<span>`s (text/I-beam cursor, selectable) → now real `<button>`s
    (pointer cursor, keyboard-operable); buttons are globally non-selectable.
  - Summary "Sets & ownership" / wishlist: the **Retired** badge sat inside the ellipsis name span and
    got chopped → moved outside as a compact non-shrinking badge; names ellipsise with a full-name tooltip.
  - Catalog cards: buy links overflowed under the action buttons → row restructured so the actions sit
    under the name/sub/buys at full width.
  - New: **collapsible catalog & summary panels** (a ‹/› in each header collapses to a thin labeled rail
    so the city grid widens); the empty canvas shows the faint stud grid; mobile toggle cluster made
    borderless (never looks cut at the scroll edge); toolbar width capped so the collapsed layout doesn't
    strand a group; the "Recent" strip gets a right-edge scroll fade.
  - New tooling: `tools/qa/interaction-audit.mjs` drives the site with a realistic long-named/retired
    stress city and programmatically flags wrong cursors, text-selectable buttons, clipped badges and
    overflow — the class of bug static screenshots can't reveal. Reviewed again by the multi-agent QA loop.
- **UI/UX overhaul — "Playful Studio" (2026-07-15)** — a full visual + UX pass driven by user
  feedback (see [`docs/superpowers/specs/2026-07-15-ui-overhaul-design.md`](docs/superpowers/specs/2026-07-15-ui-overhaul-design.md)):
  - *Bug fixes* — holding **Alt** while dragging now only bypasses snapping (it no longer clones the
    selection); placed tiles no longer leak internal piece ids; stacked ground-tile labels no longer
    collide.
  - *Look* — retheme to a clean, warm "Playful Studio" palette; a consistent inline-**SVG icon set**
    replaces all emoji toolbar icons; primary actions + toggles are tactile 2-stud **bricks**; a small
    **stud glyph** marks section labels; per-panel baseplate-coloured header rules.
  - *Toolbar* — the ~20 loose canvas controls are grouped into labeled **bays** (History / Arrange /
    Layers / Tools / Table / Zoom / View) with a new visible **Duplicate** button.
  - *Catalog* — tidy two-line count (no wrap/cut-off), Legacy toggle on its own labeled row (untangled
    from Sort), clean card titles, SVG action icons.
  - *Discoverability* — the help modal is now a **Guide** with a labeled legend of what every button
    does (Save / Share / Export / every tool), plus the existing shortcuts & gestures.
  - *Mobile* — right-edge scroll-fade on the toolbars (clear scroll affordance), SVG bottom-tab icons,
    a contained onboarding card.
  - *Motion* — a green "snap" pulse when road/rail pieces connect + a tactile press on every control
    (all reduced-motion gated). Full dark-mode + colourblind-safe parity throughout.
  - *Tooling* — a durable Playwright QA harness under `tools/qa/` (screenshots + functional/console
    checks); reviewed by a multi-agent QA loop (UI / dark / mobile / UAT). 244 unit tests pass.
- **Round-1 feedback (2026-07-12)** — all 11 points from the first user review:
  1. *Snapping tamed* — edge magnetism for ordinary sets reduced 6 → 2 studs (road/track port snapping and baseplate tiling keep the strong pull); new persistent 🧲 toolbar toggle + hold-Alt-while-dragging bypass, so pieces can start on **any stud**.
  2. *Retired sets* — every record now carries `retired` (curated July-2026 availability research + an 18-24-month lifecycle rule); catalog/wishlist/ownership rows show a **Retired** badge ("LEGO no longer sells it new"), and a **Legacy** toggle (default off) hides the ~1,650 retired sets from the catalog.
  3. *Accessory packs + spare parts* — 32 bundle packs added (the full xtra line, VIP add-on packs, track packs 60205/60238, road plates 60304, classic road/rail packs) with **element-level contents** (`data/packs.json`); ~700 pack pieces are individually placeable under a new **Packs** chip; placing any piece rolls the purchase up to whole boxes and a **🧩 Spare parts** panel lists what's left over per box. Placed track/road pieces now also map to the packs that supply them in the budget + exports.
  4. *Real footprints* — ~280 curated stud sizes from per-set research (official "measures over" dims, baseplate evidence) + footprints **derived from set inventories** (baseplates, road plates, train/vehicle bases); "estimated" sets dropped from 1,650 to ~1,000, and only true estimates show the ≈ treatment. Fixed wrong curated sizes (11371 is 32×32; the 48×48 baseplates 10701/11024 are no longer forced to 32×32).
  5. *Readability* — canvas tiles: small tiles drop their sub-line, tiny tiles show pure art (name via tooltip), no more ≈ clutter on tile faces; catalog: 62px `contain` thumbnails on white (no stud-texture over photos), 2-line names, calmer meta row, mouse-hover enlarged preview.
  6. *3D preview rotation* — ⟳ button (90° steps) + smooth horizontal drag-to-rotate (fixed pitch, correct occlusion at every angle, stable wall shading).
  7. *Resizable notes* — sticky notes + custom MOC blocks get a corner drag-grip (min 4×4, per-stud, undoable; catalog sets stay fixed on purpose).
  8. *Road plates are ground* — roads no longer warn about missing baseplates and now **support** whatever stands on them in Check-my-city.
  9. *Grid = studs* — fine lines + dots mark every stud, bold boxes every 32 studs = one real baseplate (the standard plate is 32×32; per-stud detail fades as you zoom out).
  10./11. *One shopping list* — the three export buttons merged into one "⭱ Shopping list" chooser (Simple .txt / Spreadsheet .csv / BrickLink .xml with plain-English descriptions, remembers the last format).
  Plus: favicon, whole-pack MSRPs seeded, availability/footprint/pack research baked into `tools/*.json` for future rebuilds.
- **Wave 6/6 — Mobile**: responsive phone layout (canvas-first, bottom-sheet catalog + summary FABs, scrollable toolbars, 44px touch targets, safe-area aware); pointer/touch drag so a finger can place pieces from the catalog and move tiles (fixes the HTML5-drag-and-drop-doesn't-fire-on-touch gap) with `touch-action` fixes; larger touch handles and a tap-confirm before delete. Desktop unchanged.
- **Wave 5/5 — LEGO planning depth**: "Check my city" buildability checker (off-plate / wrong-layer / overlap / estimated / track-gap), more baseplate sizes (48×48 / 48×32 / 16×16 + custom, each snapping to its own grid), true-stud scale reference overlay + ruler, real track curve-radius classes (R40/R56/R72/R104) with mismatch warnings + proper switch geometry, track continuity / loop-closure validator with buffer stops, a read-only 3D / isometric preview, and viewport culling for large cities.
- **Wave 4/5 — Graphics & motion**: photo-fill tiles + facade cues, styled road/track art, terrain/zoning paint layer, sticky notes + custom MOC blocks, shaped corner-modular footprints, and hi-res PNG export + presentation mode.
- **Wave 3/5 — Accessibility & UX**: keyboard pipeline, colorblind-safe patterns, focus/ARIA, mobile touch safety, dark mode, lock + Kid Mode, per-layer visibility/lock.
- **Wave 2/5 — Commerce & data**: ownership, real prices, buy links, CSV, catalog browse UX, sharing, templates.
- **Wave 1/5 — Core editing**: undo/redo, multi-select + groups, copy/paste, align/distribute, interaction polish.

---

## Develop

- `npm test` — run the unit tests (`node --test`; pure logic in `js/` + pipeline helpers in `tools/`).
- `npm run build:data` — regenerate `data/sets.json` + thumbnails from Rebrickable bulk data (requires `sharp`, a build-time-only devDependency: `npm install`).
- `npm run serve` — serve locally at http://localhost:8080 (ES modules require `http://`, not `file://`).

## Deploy

Static site — hosted on GitHub Pages from `main` (repo root). All asset paths are relative, so it works at the `/brick-city-planner/` subpath. Push to `main` to deploy.

---

*LEGO® is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this site. Set data & imagery sourced from Rebrickable.*
