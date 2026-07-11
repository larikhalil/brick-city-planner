# Brick City Planner — Design Spec

- **Date:** 2026-07-11
- **Status:** Approved design → ready for implementation planning
- **Repo:** `larikhalil/brick-city-planner` (public)
- **Working name:** Brick City Planner *(neutral brand — "LEGO" kept out of repo/name per LEGO Fair Play)*

---

## 1. Overview

A **digital, top-down LEGO® city planner**: a browser tool for laying out a LEGO city in a virtual space **before buying the physical sets**. Users browse a catalog of real LEGO sets, drag each set's **footprint** onto a **stud grid** representing their table/floor, and see how the whole city fits together — total size, how baseplates tile, category mix, and piece count.

**Primary job:** answer "will this all fit, how big is it, and how do the pieces lay out?" — i.e. *space/layout planning*, not a brick-accurate 3D build.

**Audience:** LEGO City / Modular Buildings hobbyists planning a purchase or a display.

**Core principles**
- **2D top-down only.** No 3D. (Full 3D already exists free — BrickLink Studio, Mecabricks — and there's no legal source of 3D set models. 2D is the right tool for *layout*.)
- **Static, offline-capable.** Runs entirely in the browser; no server, no runtime API, no keys in client code. Hosted free on GitHub Pages.
- **Real data, sourced legally.** Catalog built from Rebrickable's free bulk data; ships as a static JSON snapshot.
- **Honest about estimates.** Footprints that aren't hand-verified are flagged `≈` and are user-adjustable.

---

## 2. Scope

### v1 (this spec)
- Data pipeline → `data/sets.json` + bundled set thumbnails.
- Catalog: search, category filter, set metadata, add-to-grid.
- Grid canvas: place / move / rotate / delete tiles, stud snapping, baseplate guides, overlap detection, pan/zoom.
- Summary: total footprint (studs + cm + m²), sets placed, total pieces, by-category breakdown, warnings.
- Persistence: autosave + named layouts in localStorage; import/export layout as `.json`.
- Legal disclaimers + attribution.
- Deploy to GitHub Pages.

### Later (noted, NOT built in v1)
- **Price / budget totals** — price is *not* in the free data; needs a separate source (BrickLink price guide, OAuth). Deferred. v1 uses **piece count** as the scale proxy.
- **cm-derived footprints** from LEGO.com / Brickset `modelDimensions` (needs Brickset API key; ~50% coverage) to sharpen estimates.
- Isometric "pretty view"; PNG export of the plan; shopping-list/checklist export; deeper footprint curation; multi-level shelves.

### Non-goals
- Not a brick-level builder. Not a store/checkout. Not commercial (no ads/sales — that's the line that flips Fair Play from tolerated to infringing).

---

## 3. Key decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | View model | **2D top-down stud grid** |
| 2 | Name / repo | **Brick City Planner** / `brick-city-planner` (no "LEGO" in name) |
| 3 | Data source | **Rebrickable bulk CSV** (free, keyless), build-time → static JSON |
| 4 | Catalog scope | Themes: **City, Town, Trains, Modular Buildings** (+ descendants); optional Creator Expert / Icons |
| 5 | Images | **Bundle** downloaded thumbnails in repo (stable/offline), placeholder swatch on miss |
| 6 | Footprints | **Curated studs** for modulars + top City sets; **estimated + `≈` flagged** for the rest; all user-resizable |
| 7 | Price | **Deferred to v2**; piece count is the v1 scale metric |
| 8 | Tech | Static **HTML/CSS/vanilla JS (ES modules)**, no build step; Node for the offline pipeline |

---

## 4. Architecture

Two independent parts with a single interface between them (`data/sets.json`):

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│  BUILD-TIME PIPELINE (Node) │        │   RUNTIME APP (browser, static)   │
│  tools/build-catalog.mjs    │        │   index.html + js/*  (ES modules) │
│                             │        │                                    │
│  Rebrickable CSV ─┐         │  emits │   fetch(data/sets.json) ─┐         │
│  curated table  ──┼──► JSON ├───────►│   catalog ─ grid ─ summary│        │
│  images ──────────┘  + img/ │        │   localStorage (layouts)  │        │
└─────────────────────────────┘        └──────────────────────────────────┘
        run occasionally                       runs in every browser
```

- The **pipeline** runs locally/occasionally; its output (`sets.json` + `img/sets/*`) is committed. The app never talks to Rebrickable at runtime.
- The **app** is pure client-side: load JSON, render, manipulate, persist to `localStorage`, import/export files.

---

## 5. Data pipeline — `tools/build-catalog.mjs`

Node ≥18 (built-in `fetch`, `node:zlib`, `node:fs`), **zero runtime deps** (small hand-rolled CSV parser).

### 5.1 Inputs (Rebrickable CDN — free, no key, HEAD-verified 200)
- `https://cdn.rebrickable.com/media/downloads/sets.csv.gz` → `set_num, name, year, theme_id, num_parts, img_url`
- `https://cdn.rebrickable.com/media/downloads/themes.csv.gz` → `id, name, parent_id`

### 5.2 Steps
1. Download both `.csv.gz`, gunzip, parse (handle quoted fields with embedded commas).
2. **Resolve included theme IDs**: from configured **root theme IDs** (`tools/themes.include.json`), recursively collect all descendants via `parent_id` (chains can be >1 level). Match by **ID**, never name (duplicate "City" nodes exist) and never number prefix (prefixes are polluted — e.g. 79xx also holds Star Wars).
3. **Filter** sets to `theme_id ∈ includedIds`. Drop sets with `num_parts` < a small floor (e.g. <5) to skip spare-part/gear entries (configurable).
4. **Resolve footprint** per set (§5.3).
5. **Normalize category** per set for color-coding (§5.4).
6. **Download image** from `img_url` → `img/sets/<set_num>.<ext>`; on missing/failed URL, record `img: null` (app renders placeholder). *(Thumbnail resize is an optional post-step via `sharp` if repo size warrants — not required for v1.)*
7. **Emit** minified `data/sets.json` (§6.1) + a small `data/meta.json` (build date, source snapshot date, counts, attribution string).

### 5.3 Footprint resolution (in priority order)
1. **Curated** (`tools/footprints.json`, keyed by set number) → `{w,h,source:"curated"}`. Authoritative; no `≈`. Seed = all Modular Buildings (§ Appendix A) + a hand-built list of popular/large City sets.
2. **Estimated** (everything else) → bucketed heuristic → `{w,h,source:"estimated"}`, flagged `≈`. Heuristic (v1, deliberately simple; refine later):
   - Bucket by `num_parts`: `<80 → 8×8`, `<200 → 16×8`, `<400 → 16×16`, `<800 → 32×16`, `<1500 → 32×32`, `≥1500 → 48×32`.
   - Category overrides: trains → long/thin (`8 × min(64, derived-long-side)`); road/baseplate packs → `32×32`.
   - Clamp to whole studs; never 0.
3. *(v2)* **cm-derived**: LEGO.com/Brickset `build_width × build_depth` ÷ 0.8 → studs, `source:"derived"`, flagged `≈`.

`source ∈ {curated, estimated, derived}`. UI treats **anything ≠ curated** as `≈ approximate`.

### 5.4 Category normalization
Map each set's resolved theme (leaf + its root) to one **category** used for tile color + filter chips:
`police, fire, train, city (general Town/City), modular, road, park, space, arctic, harbor, farm, airport, other`.
A small lookup keyed on theme name/id → category, with `other`/`city` fallbacks. Stored as `category` on each record.

---

## 6. Data model

### 6.1 `data/sets.json` — catalog (built artifact)
```jsonc
[
  {
    "set_num": "60316-1",     // Rebrickable id (with variant suffix)
    "num": "60316",           // display number
    "name": "Police Station",
    "year": 2022,
    "theme_id": 61,
    "theme": "Police",        // resolved leaf theme
    "root": "City",           // City | Town | Trains | Modular | Creator Expert | Icons
    "category": "police",     // normalized (§5.4)
    "pieces": 668,
    "img": "img/sets/60316-1.jpg",   // or null → placeholder
    "footprint": { "w": 48, "h": 32, "source": "curated" }
  }
]
```

### 6.2 Layout — saved city (localStorage + import/export)
```jsonc
{
  "app": "brick-city-planner",
  "version": 1,
  "name": "My Town v1",
  "units": "studs",                 // display preference
  "placed": [
    { "id": "p1", "set_num": "60316-1", "x": 0,  "y": 0,  "w": 48, "h": 32, "rot": 0 },
    { "id": "p2", "set_num": "10182-1", "x": 0,  "y": 44, "w": 32, "h": 32, "rot": 0 }
  ],
  "updated": "2026-07-11T00:00:00Z"
}
```
- `x,y,w,h` in **studs** (integers); `w,h` default to the set's footprint but are **user-overridable** (resize). `rot ∈ {0,90,180,270}`.
- **Total footprint** = bounding box of all `placed` tiles (their real effective extents), *not* a fixed board.
- localStorage keys: `bcp.cities` (`{ name → layout }`), `bcp.current` (active name). Autosave debounced on change.

---

## 7. App modules (units, isolated)

Static site, ES modules loaded by `index.html`. Each module has one job, a small interface, and testable pure logic separated from DOM.

| Module | Responsibility | Key interface (pure vs DOM) |
|--------|----------------|------------------------------|
| `js/data.js` | Load & index `sets.json`; lookup by `set_num` | `loadCatalog()`, `getSet(num)` |
| `js/units.js` | Stud↔cm conversion & formatting | *pure*: `studsToCm`, `fmtDims`, `fmtArea` |
| `js/geometry.js` | Effective extents (rotation), overlap, bounding box, snap | *pure*: `extent(tile)`, `overlaps(a,b)`, `bbox(tiles)`, `snap(v,step)` |
| `js/catalog.js` | Render list, search, category filter, "add" events | DOM; emits `add(set)` |
| `js/grid.js` | Canvas: render tiles, place/move/rotate/delete, snapping, baseplate guides, pan/zoom, selection, overlap highlight | DOM; owns placed-tile state |
| `js/summary.js` | Compute & render stats from placed tiles + catalog | uses `geometry`,`units` |
| `js/storage.js` | localStorage load/save, named cities, import/export `.json`, validation | *mostly pure* serialize/validate |
| `js/app.js` | Bootstrap; wire catalog→grid→summary→storage; toolbar/units | DOM glue |

Pure logic (`units`, `geometry`, `storage` serialize/validate) is unit-tested; DOM modules are thin.

---

## 8. Interaction & coordinate system

- **Unit base:** studs (integer). **1 stud = 0.8 cm** (8 mm pitch; 32 studs = 25.6 cm). **1 baseplate = 32 studs.** Area shown in cm²/m² when large.
- **Grid render:** fine stud dots + light lines; **bold line every 32 studs** (baseplate boundary). Rulers in studs on top/left. Unit toggle switches summary/labels between studs and cm (grid stays studs).
- **Place:** drag a catalog set onto the grid, or click "＋" to drop at viewport center. New tile uses the set's footprint (rounded to studs).
- **Move:** drag tile; **snaps to nearest stud** (optional coarse "snap to ½-baseplate / 16" toggle).
- **Rotate:** 90° steps; swaps effective `w/h` for footprint & overlap (square modulars unaffected).
- **Resize:** drag a corner handle to override `w/h` (studs) — the escape hatch for imperfect estimates.
- **Delete:** select + Delete key / toolbar trash.
- **Overlap:** axis-aligned rect intersection between effective extents; overlapping tiles get a red outline + a count in Summary. Overlaps are allowed (warned, not blocked).
- **Pan/zoom:** stage scrolls; zoom buttons + wheel; "Fit" frames all tiles. Zoom range clamped.
- **Selection:** click selects; toolbar (rotate/delete) acts on selection; keyboard: arrows nudge by 1 stud, R rotate, Del delete, Esc deselect.
- **Accessibility:** tiles focusable; visible focus ring; keyboard nudging; respects `prefers-reduced-motion`.

---

## 9. Error handling & edge cases

| Case | Behavior |
|------|----------|
| `sets.json` fails to load | Catalog shows an error state with a Retry button; grid still usable with existing layout |
| Image 404 / `img:null` | Category-colored placeholder swatch (with stud texture) |
| Set in a saved layout not found in catalog | Keep the tile using its stored `w/h/name` snapshot; badge it "set not in catalog" |
| Invalid / wrong-version import | Reject with a clear message; **do not** overwrite the current city |
| localStorage unavailable/full | Warn once; keep working in memory; export still works |
| Empty city | Summary shows zeros; friendly empty-state hint on the grid |
| Huge city (perf) | DOM tiles are cheap for realistic counts; if needed, cap render / virtualize (note only) |
| Pipeline: CDN fetch fails | Retry with backoff, then clear error + non-zero exit; no partial `sets.json` written |
| Pipeline: missing `img_url` | Skip image, set `img:null`; continue |
| Pipeline: unknown `theme_id` on a set | Excluded by the theme filter (only included IDs pass) |

---

## 10. Legal / attribution (must ship — Fair Play)

- Footer, **verbatim:** *"LEGO® is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this site."*
- Footer credit: *"Set data & imagery sourced from Rebrickable."*
- Use **"LEGO®"** only as an adjective; **never** display/recreate the LEGO logo; **never** bundle MOC (fan-creation) images (bulk `sets.csv` is official-only, so this holds automatically).
- **Non-commercial**: no ads, sales, or endorsement language.
- `LICENSE`: **MIT** for our code. Rebrickable data is "use for any purpose." README states non-affiliation.
- "LEGO" stays out of the **repo name** and any custom domain.

---

## 11. Project structure

```
brick-city-planner/
├─ index.html
├─ css/styles.css
├─ js/
│  ├─ app.js  data.js  units.js  geometry.js
│  ├─ catalog.js  grid.js  summary.js  storage.js
├─ data/
│  ├─ sets.json          # built artifact (committed)
│  └─ meta.json          # build date, counts, attribution
├─ img/sets/             # bundled set thumbnails (committed)
├─ tools/
│  ├─ build-catalog.mjs  # the pipeline
│  ├─ themes.include.json# root theme IDs to include
│  ├─ footprints.json    # curated studs table (Appendix A + curated City sets)
│  └─ category-map.json  # theme → category lookup
├─ test/                 # node --test unit tests (pure logic + pipeline helpers)
├─ docs/superpowers/specs/2026-07-11-brick-city-planner-design.md
├─ LICENSE  README.md  .gitignore
```

---

## 12. Testing strategy

- **Unit (zero-dep `node --test`)** on pure logic:
  - `units`: stud↔cm, formatting, area thresholds.
  - `geometry`: rotation extents, overlap true/false/edge-touch, bbox, snap rounding.
  - `storage`: serialize/round-trip, version/shape validation, reject malformed import.
  - pipeline helpers: CSV parse (quoted commas), recursive theme-descendant resolver (on fixture themes), footprint bucket heuristic, category mapping.
- **Manual smoke checklist / `/verify`** for the app: load catalog, add/move/rotate/resize/delete, overlap warning appears/clears, unit toggle, save→reload persists, export→import round-trips, image-miss placeholder, dark/light.
- **TDD** the pure-logic units (write tests first per project convention).

---

## 13. Build & deploy

- **Data:** run `node tools/build-catalog.mjs` locally to (re)generate `data/sets.json` + images; commit.
- **App:** no build step. Deploy via **GitHub Pages** (serve repo root from `main`). Local dev uses any static server (e.g. `python -m http.server`) since ES modules need `http://`.
- **Refresh:** re-run the pipeline periodically (Rebrickable data refreshes daily); optional scheduled GitHub Action later.

---

## 14. Open risks / caveats

- **Footprint accuracy is the known weak spot.** Only curated studs are exact; estimates are flagged `≈` and resizable. Mitigation: curate the high-value sets; make resizing frictionless.
- **Repo image weight** (~1,000–1,500 images). Acceptable (~tens of MB); add `sharp` thumbnailing if it grows.
- **Rebrickable's "any purpose" grant is permission, revocable in principle** — low risk for a hobby app, not a perpetual guarantee. We ship a static snapshot regardless.
- **Data freshness** — `sets.json` is a snapshot; refresh by re-running the pipeline.
- **Modular 11371 (Shopping Street)** footprint is angled/off-grid (~48×32) — verify before locking its curated value.
- This is sourcing/design research, **not legal advice**.

---

## Appendix A — Curated modular footprints (seed for `footprints.json`)

| Set | Name | Year | Studs |
|-----|------|------|-------|
| 10182 | Cafe Corner | 2007 | 32×32 |
| 10190 | Market Street | 2007 | 32×32 |
| 10185 | Green Grocer | 2008 | 32×32 |
| 10197 | Fire Brigade | 2009 | 32×32 |
| 10211 | Grand Emporium | 2010 | 32×32 |
| 10218 | Pet Shop | 2011 | 32×32 |
| 10224 | Town Hall | 2012 | 32×32 |
| 10232 | Palace Cinema | 2013 | 32×32 |
| 10243 | Parisian Restaurant | 2014 | 32×32 |
| 10246 | Detective's Office | 2015 | 32×32 |
| 10251 | Brick Bank | 2016 | 32×32 |
| 10255 | Assembly Square | 2017 | 48×32 |
| 10260 | Downtown Diner | 2018 | 32×32 |
| 10264 | Corner Garage | 2019 | 32×32 |
| 10270 | Bookshop | 2020 | 32×32 |
| 10278 | Police Station | 2021 | 32×32 |
| 10297 | Boutique Hotel | 2022 | 32×32 |
| 10312 | Jazz Club | 2023 | 32×32 |
| 10326 | Natural History Museum | 2023 | 48×32 |
| 10350 | Tudor Corner | 2025 | 32×32 |
| 11371 | Shopping Street | 2026 | 48×32 *(verify — angled/off-grid)* |

## Appendix B — Theme filter (root IDs → walk descendants)

**Include** (Rebrickable theme IDs): **City = 52** (Airport 53, Cargo 54, Coast Guard 55, Construction 56, Farm 57, Fire 58, Harbor 59, Hospital 60, Police 61, Traffic 63, Off-Road 64, Arctic 65, **Trains 66**, Jungle 614, Mars 679, Stuntz 744, Space 793), **Town = 50** (Classic Town 67, Paradisa 90, Town Jr. 94, Town Plan 104, World City 105, City Center 106, …), **Train (vintage) = 233** (4.5V 235, RC 240), **Modular Buildings = 155** (Mini 156). *Optional:* Creator Expert 673, Icons 721 (large city/display sets only).

**Exclude** false-positives sharing old number ranges: Star Wars 158, Bionicle 324, Adventurers 296, Harry Potter 246, and Seasonal "City" advent (208) unless advent sets are wanted. Implementation resolves descendants by ID recursively, then `sets.filter(s => includedIds.has(s.theme_id))`.
