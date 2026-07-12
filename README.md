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

- **Editing** — drag/place/rotate/delete, stud snapping, port-to-port road/rail snapping, marquee multi-select + groups, copy/paste/duplicate/alt-drag clone, align & distribute, undo/redo with a history panel, autosave.
- **Commerce & data** — real per-set prices with manual override, "I own this" owned-vs-buy budget split, direct buy links (LEGO / BrickLink / Amazon), BrickLink-compatible + CSV export, wishlist.
- **Catalog & sharing** — search + category filters, grid/list view, favorites rail, starter-template gallery, named saves, one-click compressed share-link.
- **Accessibility & UX** — full keyboard placement/rotation, colorblind-safe patterns, high-contrast focus, ARIA live announcements, mobile/touch gestures, dark mode, lock pieces + Kid Mode, per-layer show/hide + lock.
- **Graphics & export** — photo-fill building tiles with facade cues, styled roads/tracks, terrain & zoning paint layer, sticky notes + custom MOC blocks, non-rectangular corner-modular footprints, and high-resolution PNG export with presentation mode.
- **Planning depth** — "Check my city" buildability checker, extra + custom baseplate sizes, true-stud scale reference overlay, real track curve-radius classes with mismatch warnings, track continuity / loop-closure validation, a read-only 3D / isometric preview, and viewport culling for large layouts.
- **Mobile** — responsive phone layout with a canvas-first view, slide-up bottom-sheet catalog + summary, finger-drag to place and move pieces (works where HTML5 drag-and-drop can't), 44px touch targets, and tap-confirm delete.

## Changelog

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
