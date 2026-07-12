# Brick City Planner — Post-v1 Wave Roadmap

> Reconstructed 2026-07-12 after a lost session. Source of truth for the 5-wave enhancement
> programme that follows the original v1 build plan (`2026-07-11-brick-city-planner.md`).

## Origin

A 15-agent research fleet (`bcp-feedback-fleet`) harvested enhancement ideas, six aggressive
persona stress-tests, and real forum/competitor research into a **43-idea feedback board**
(`docs/_recovered-session/feedback-board.html`). Those ideas were sequenced into **5 waves**, each
executed as its own `implementer → review → fix` workflow. Categories: Quality-of-life (QOL),
UI & visual (UI), Graphics & motion (MOTION), Performance (PERF), LEGO planning (PLAN),
Accessibility (ACC).

Recovered raw artifacts live in `docs/_recovered-session/`:
- `feedback-board.html` — the full interactive 43-idea board + personas + research.
- `research-fleet-synthesis.json` — raw research output.
- `wave1-workflow-output.json`, `wave2-workflow-output.json` — the Wave 1 & 2 build/review logs.
- `motion-1-3-ui5-deferred-work/` — **partial Wave 4 code** (MOTION-1/2/3 + UI-5) that was started
  during Wave 3 then split out to keep Wave 3's commit clean. Contains a full pre-split patch plus
  new modules (`objects.js` terrain, enhanced `schematic.js`, `decor`/`objects`/`schematic` tests).

## Wave status

### Wave 1/5 — Core editing foundation + polish · ✅ COMMITTED (`4a28567`)
Undo/redo w/ history panel (QOL-1), marquee multi-select + groups (QOL-2), copy/paste/duplicate/
alt-drag (QOL-3), align & distribute (QOL-4); polish: autosave indicator (QOL-9), first-run empty
state (UI-1), resize-grip affordance + shortcut cheat-sheet (UI-2), snap ghost preview (MOTION-5),
interaction juice (MOTION-6), and the viewport/drag/zoom perf work (PERF-1/2/3).

### Wave 2/5 — Commerce & data · ✅ COMMITTED (`961ebcc`)
"I own this" + owned-vs-buy split (PLAN-1), real MSRP prices + override (PLAN-2), buy links +
generic-piece part maps (PLAN-5), BrickLink/CSV export (PLAN-9); catalog browse UX: grid/list
toggle + larger thumbs (UI-4), recently-used/favorites rail (QOL-7); sharing: compressed share-link
(QOL-5), named saves, starter templates gallery (QOL-6), wishlist tab (PLAN-6).

### Wave 3/5 — Accessibility & UX · 🟡 DONE, UNCOMMITTED (this working tree)
Full keyboard placement/rotation pipeline (ACC-1), non-colour signals + colorblind-safe patterns
(ACC-2 / ACC-2c), high-contrast focus ring + AA panels (ACC-3), ARIA live announcer (ACC-4),
mobile/touch single-pointer safety (ACC-5), dark mode (UI-3), lock pieces + Kid Mode (QOL-8),
per-layer show/hide + lock (QOL-10). All 94 unit tests pass. Clean of MOTION-1/2/3/UI-5 (deferred).

### Wave 4/5 — Graphics & Motion (visual richness + export) · ⚪ NOT STARTED
Head-start: partial code in `docs/_recovered-session/motion-1-3-ui5-deferred-work/`.
- **MOTION-1** — photo-fill building tiles (Rebrickable thumbnail) + directional facade cue.
- **MOTION-2** — styled road/track rendering (asphalt, lane dashes, sidewalks, curbs, bevel).
- **MOTION-3** — terrain / zone paint layer (grass, water, plaza, sand) under buildings.
- **MOTION-4** — non-rectangular footprints for corner/L-shaped sets *(Large; Nice-to-have)*.
- **UI-5** — canvas annotations / sticky notes + custom-rectangle MOC blocking.
- **PLAN-4** — high-resolution PNG export + presentation mode *(the most-cited request)*.

### Wave 5/5 — LEGO planning depth & correctness · ⚪ NOT STARTED
- **PLAN-3** — buildability checker ("Check my city": off-plate, misaligned ports, wrong-layer, `~`).
- **PLAN-7** — more baseplate sizes (48×48, 48×32, 16×16, custom).
- **PLAN-8** — realistic scale reference overlay (minifig/car silhouettes + ruler).
- **PLAN-10** — real curve-radius classes (R40/R56/R72/R104) + mismatch warnings + switch geometry
  *(Large)*.
- **PLAN-11** — track continuity / loop-closure validator + buffer stops.
- **PLAN-12** — 3D / isometric + elevation preview toggle *(Large; keep 2D primary)*.
- **PERF-1** — viewport culling + dirty-rect / per-layer caching (render only visible tiles, redraw
  only the changed layer) for 300+-tile / large-baseplate cities.

> **Reconciliation note (2026-07-12 audit).** The original intended grouping (recorded mid-build)
> put MOTION-1/2/3 + UI-5 in Wave 3 and PERF-1/2/3 + PLAN-3/7/8 in Wave 4. Execution diverged: Wave 3
> shipped **accessibility-only** (motion split into the deferred bundle), so the remaining work was
> re-bucketed into Wave 4 = *all graphics/motion + export* and Wave 5 = *all planning depth + PERF-1*.
> **PERF-2** (in-place pointermove updates) shipped pre-waves; **PERF-3** (pointer-anchored zoom +
> pinch/pan) is effectively covered by the base pan/zoom + ACC-5 touch work — only optional kinetic/
> inertial pan remains as a nicety. A full-tree audit confirms Waves 4+5 above cover every
> not-yet-built idea except the two Skip items.

### Explicitly out of scope (research verdict: Skip)
- **PLAN-13** — freeform/non-grid road placement (fights the grid-snap identity).
- **PLAN-14** — live multiplayer (infeasible on static GitHub Pages; share-link covers the real need).

## Execution convention
Each wave = one commit titled `Wave N/5: <theme>`. Deploy is `git push origin main` → GitHub Pages
(user pushes). Not an HR-SITE project: no APP_VERSION / version-bump / liveVersion.
