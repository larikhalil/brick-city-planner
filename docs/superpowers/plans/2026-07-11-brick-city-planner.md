# Brick City Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, offline-capable 2D top-down web app for planning a LEGO® city layout from real set data before purchase.

**Architecture:** Two decoupled parts joined by one file (`data/sets.json`). A build-time Node pipeline (`tools/`) turns Rebrickable's free bulk CSV into a filtered, footprint-annotated static JSON plus bundled thumbnails. A runtime browser app (`index.html` + `js/*` ES modules) loads that JSON, renders a catalog + stud-grid canvas + summary, and persists layouts to `localStorage`.

**Tech Stack:** Vanilla HTML/CSS/JavaScript (ES modules, no framework, no build step). Node ≥18 for the offline pipeline (zero runtime dependencies). Tests via `node --test`. Hosted on GitHub Pages.

## Global Constraints

Every task's requirements implicitly include these:

- **Runtime:** Node ≥18 for pipeline (built-in `fetch`, `node:zlib`, `node:fs`). **Zero runtime npm dependencies.**
- **App:** static site, ES modules, **no build step**. Must run from GitHub Pages and from a local static server over `http://`.
- **Units:** base unit = **studs (integers)**. `1 stud = 0.8 cm`. `1 baseplate = 32 studs`.
- **Footprint sources:** `source ∈ {curated, estimated, derived}`. UI flags anything `≠ curated` as `≈ approximate`.
- **Legal (must ship):** footer disclaimer **verbatim**: `LEGO® is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this site.` Plus credit: `Set data & imagery sourced from Rebrickable.` Use "LEGO®" only as an adjective; **never** display/recreate the LEGO logo; **never** bundle MOC images; **non-commercial** (no ads/sales). Keep "LEGO" out of the repo name.
- **License:** MIT for our code.
- **Layout data model:** placed tile = `{ id:string, set_num:string, x:int, y:int, w:int, h:int, rot:0|90|180|270 }` in studs.
- **Catalog record model** (`data/sets.json` element):
  `{ set_num, num, name, year, theme_id, theme, root, category, pieces, img|null, footprint:{w,h,source} }`.
- **Commits:** conventional style, frequent (one per task minimum). Commit author is the repo default.

---

## File Structure

```
brick-city-planner/
├─ index.html                 # app shell (from approved mockup)
├─ css/styles.css             # ported from approved mockup
├─ js/
│  ├─ app.js                  # bootstrap + wiring + toolbar
│  ├─ data.js                 # load & index sets.json
│  ├─ units.js                # stud↔cm conversion + formatting  (pure)
│  ├─ geometry.js             # extent/overlap/bbox/snap          (pure)
│  ├─ storage.js              # localStorage + import/export      (pure core)
│  ├─ catalog.js              # catalog render/search/filter (DOM)
│  ├─ grid.js                 # canvas: place/move/rotate/resize/delete/overlap/zoom (DOM)
│  └─ summary.js              # stats + breakdown + warnings (DOM)
├─ data/
│  ├─ sets.json               # built artifact
│  └─ meta.json               # build date, counts, attribution
├─ img/sets/                  # bundled set thumbnails
├─ tools/
│  ├─ build-catalog.mjs       # pipeline orchestrator
│  ├─ record.mjs              # pure buildSetRecord()
│  ├─ lib/
│  │  ├─ csv.mjs              # parseCsv()          (pure)
│  │  ├─ themes.mjs           # buildIncludedThemeIds() (pure)
│  │  ├─ footprint.mjs        # estimate/resolveFootprint() (pure)
│  │  └─ category.mjs         # categoryFor()       (pure)
│  ├─ themes.include.json     # root theme IDs
│  ├─ footprints.json         # curated studs table
│  └─ category-map.json       # theme→category overrides
├─ test/
│  ├─ smoke.test.mjs  csv.test.mjs  themes.test.mjs  footprint.test.mjs
│  ├─ category.test.mjs  record.test.mjs  units.test.mjs  geometry.test.mjs
│  └─ storage.test.mjs  data.test.mjs
├─ docs/superpowers/{specs,plans}/…
├─ package.json  LICENSE  README.md  .gitignore
```

**Testing conventions:** unit tests use `node --test` on the pure modules (Tasks 2–10). DOM/UI tasks (11–19) use **manual browser verification** — each lists the exact observable result to confirm. Serve locally with `python -m http.server 8080` (ES modules need `http://`).

---

## Task 1: Project scaffold & test harness

**Files:**
- Create: `package.json`, `LICENSE`, `test/smoke.test.mjs`

**Interfaces:**
- Produces: `npm test` runs `node --test`; `npm run build:data`; `npm run serve`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "brick-city-planner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Top-down city planner for LEGO sets",
  "scripts": {
    "test": "node --test",
    "build:data": "node tools/build-catalog.mjs",
    "serve": "python -m http.server 8080"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Write `LICENSE`** (MIT)

```
MIT License

Copyright (c) 2026 larikhalil

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Write the smoke test** `test/smoke.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: 1 test passing, exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json LICENSE test/smoke.test.mjs
git commit -m "chore: scaffold project + test harness"
```

---

## Task 2: CSV parser

**Files:**
- Create: `tools/lib/csv.mjs`, `test/csv.test.mjs`

**Interfaces:**
- Produces: `parseCsv(text: string) → Array<Record<string,string>>` — RFC4180-ish; handles quoted fields with embedded commas/quotes; keys from header row.

- [ ] **Step 1: Write failing test** `test/csv.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../tools/lib/csv.mjs';

test('parses simple rows to objects', () => {
  const rows = parseCsv('id,name\n1,Alpha\n2,Beta\n');
  assert.deepEqual(rows, [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }]);
});

test('handles quoted field with comma and escaped quote', () => {
  const rows = parseCsv('id,name\n1,"Smith, ""Bob"""\n');
  assert.equal(rows[0].name, 'Smith, "Bob"');
});

test('ignores trailing empty line and \\r', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/csv.test.mjs`
Expected: FAIL — cannot find module `../tools/lib/csv.mjs`.

- [ ] **Step 3: Implement** `tools/lib/csv.mjs`

```js
export function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test test/csv.test.mjs`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add tools/lib/csv.mjs test/csv.test.mjs
git commit -m "feat(pipeline): CSV parser"
```

---

## Task 3: Theme descendant resolver

**Files:**
- Create: `tools/lib/themes.mjs`, `tools/themes.include.json`, `test/themes.test.mjs`

**Interfaces:**
- Consumes: theme rows `{id, name, parent_id}` (strings from CSV).
- Produces: `buildIncludedThemeIds(themeRows, rootIds: number[]) → Set<number>` — roots plus all recursive descendants (chains > 1 deep).

- [ ] **Step 1: Write failing test** `test/themes.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIncludedThemeIds } from '../tools/lib/themes.mjs';

const rows = [
  { id: '52', name: 'City', parent_id: '' },
  { id: '61', name: 'Police', parent_id: '52' },
  { id: '999', name: 'Sub-Police', parent_id: '61' },   // 2 levels deep
  { id: '158', name: 'Star Wars', parent_id: '' },
];

test('collects root + all descendants, excludes others', () => {
  const ids = buildIncludedThemeIds(rows, [52]);
  assert.ok(ids.has(52) && ids.has(61) && ids.has(999));
  assert.ok(!ids.has(158));
});

test('handles multiple roots', () => {
  const ids = buildIncludedThemeIds(rows, [52, 158]);
  assert.equal(ids.size, 4);
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/themes.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `tools/lib/themes.mjs`

```js
export function buildIncludedThemeIds(themeRows, rootIds) {
  const children = new Map();
  for (const t of themeRows) {
    const parent = t.parent_id === '' || t.parent_id == null ? null : Number(t.parent_id);
    if (parent != null) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(Number(t.id));
    }
  }
  const included = new Set();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop();
    if (included.has(id)) continue;
    included.add(id);
    for (const c of children.get(id) || []) stack.push(c);
  }
  return included;
}
```

- [ ] **Step 4: Write config** `tools/themes.include.json`

```json
{
  "roots": [52, 50, 233, 155],
  "_comment": "52=City 50=Town 233=Train(vintage) 155=Modular Buildings. Optional big-build roots 673 (Creator Expert) / 721 (Icons) intentionally omitted from v1 to avoid non-city noise."
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `node --test test/themes.test.mjs`
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add tools/lib/themes.mjs tools/themes.include.json test/themes.test.mjs
git commit -m "feat(pipeline): recursive theme filter"
```

---

## Task 4: Footprint resolver + estimator

**Files:**
- Create: `tools/lib/footprint.mjs`, `tools/footprints.json`, `test/footprint.test.mjs`

**Interfaces:**
- Produces:
  - `estimateFootprint({num_parts, category}) → {w, h}`
  - `resolveFootprint(set, curated) → {w, h, source}` where `set` has `{num, num_parts, category}` and `curated` is `{ [setNumber]: {w,h} }`.

- [ ] **Step 1: Write failing test** `test/footprint.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateFootprint, resolveFootprint } from '../tools/lib/footprint.mjs';

test('estimate buckets by piece count', () => {
  assert.deepEqual(estimateFootprint({ num_parts: 40, category: 'city' }), { w: 8, h: 8 });
  assert.deepEqual(estimateFootprint({ num_parts: 300, category: 'city' }), { w: 16, h: 16 });
  assert.deepEqual(estimateFootprint({ num_parts: 5000, category: 'city' }), { w: 48, h: 32 });
});

test('train override is long and thin', () => {
  const fp = estimateFootprint({ num_parts: 900, category: 'train' });
  assert.equal(fp.h, 8);
  assert.ok(fp.w >= 24);
});

test('curated wins and is marked curated', () => {
  const fp = resolveFootprint({ num: '10255', num_parts: 4002, category: 'modular' },
                              { '10255': { w: 48, h: 32 } });
  assert.deepEqual(fp, { w: 48, h: 32, source: 'curated' });
});

test('falls back to estimated', () => {
  const fp = resolveFootprint({ num: '99999', num_parts: 300, category: 'city' }, {});
  assert.deepEqual(fp, { w: 16, h: 16, source: 'estimated' });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/footprint.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `tools/lib/footprint.mjs`

```js
const BUCKETS = [
  [80, 8, 8], [200, 16, 8], [400, 16, 16], [800, 32, 16], [1500, 32, 32],
];

export function estimateFootprint({ num_parts = 0, category = 'other' } = {}) {
  let w = 48, h = 32; // default for >= 1500 pieces
  for (const [max, bw, bh] of BUCKETS) {
    if (num_parts < max) { w = bw; h = bh; break; }
  }
  if (category === 'train') { h = 8; w = Math.min(64, Math.max(24, w * 2)); }
  else if (category === 'road') { w = 32; h = 32; }
  return { w, h };
}

export function resolveFootprint(set, curated = {}) {
  const c = curated[set.num] || curated[set.set_num];
  if (c) return { w: c.w, h: c.h, source: 'curated' };
  const e = estimateFootprint(set);
  return { w: e.w, h: e.h, source: 'estimated' };
}
```

- [ ] **Step 4: Write curated table** `tools/footprints.json`

```json
{
  "10182": { "w": 32, "h": 32 }, "10190": { "w": 32, "h": 32 },
  "10185": { "w": 32, "h": 32 }, "10197": { "w": 32, "h": 32 },
  "10211": { "w": 32, "h": 32 }, "10218": { "w": 32, "h": 32 },
  "10224": { "w": 32, "h": 32 }, "10232": { "w": 32, "h": 32 },
  "10243": { "w": 32, "h": 32 }, "10246": { "w": 32, "h": 32 },
  "10251": { "w": 32, "h": 32 }, "10255": { "w": 48, "h": 32 },
  "10260": { "w": 32, "h": 32 }, "10264": { "w": 32, "h": 32 },
  "10270": { "w": 32, "h": 32 }, "10278": { "w": 32, "h": 32 },
  "10297": { "w": 32, "h": 32 }, "10312": { "w": 32, "h": 32 },
  "10326": { "w": 48, "h": 32 }, "10350": { "w": 32, "h": 32 },
  "11371": { "w": 48, "h": 32 }
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `node --test test/footprint.test.mjs`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add tools/lib/footprint.mjs tools/footprints.json test/footprint.test.mjs
git commit -m "feat(pipeline): footprint resolver + curated modular table"
```

---

## Task 5: Category mapping

**Files:**
- Create: `tools/lib/category.mjs`, `tools/category-map.json`, `test/category.test.mjs`

**Interfaces:**
- Produces: `categoryFor(themeName: string, root: string, map: object) → string` in
  `{police, fire, train, city, modular, road, park, space, arctic, harbor, farm, airport, other}`.

- [ ] **Step 1: Write failing test** `test/category.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryFor } from '../tools/lib/category.mjs';

test('explicit map override wins', () => {
  assert.equal(categoryFor('Fire', 'City', { fire: 'fire' }), 'fire');
});
test('heuristics by keyword', () => {
  assert.equal(categoryFor('Police', 'City', {}), 'police');
  assert.equal(categoryFor('Cargo Train', 'City', {}), 'train');
  assert.equal(categoryFor('Arctic', 'City', {}), 'arctic');
});
test('modular root fallback', () => {
  assert.equal(categoryFor('Assembly Square', 'Modular', {}), 'modular');
});
test('unknown falls back to city', () => {
  assert.equal(categoryFor('Whatever', 'Town', {}), 'city');
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/category.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `tools/lib/category.mjs`

```js
export function categoryFor(themeName = '', root = '', map = {}) {
  const key = themeName.toLowerCase();
  if (map[key]) return map[key];
  if (/police/.test(key)) return 'police';
  if (/fire/.test(key)) return 'fire';
  if (/train/.test(key)) return 'train';
  if (/modular/.test(key)) return 'modular';
  if (/space|mars|lunar/.test(key)) return 'space';
  if (/arctic/.test(key)) return 'arctic';
  if (/harbo|coast/.test(key)) return 'harbor';
  if (/farm/.test(key)) return 'farm';
  if (/airport/.test(key)) return 'airport';
  if (/park|garden/.test(key)) return 'park';
  if (root === 'Modular') return 'modular';
  return 'city';
}
```

- [ ] **Step 4: Write** `tools/category-map.json`

```json
{
  "_comment": "Optional explicit theme-name (lowercase) → category overrides; heuristics in category.mjs cover the rest.",
  "coast guard": "harbor",
  "off-road": "city",
  "stuntz": "city"
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `node --test test/category.test.mjs`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add tools/lib/category.mjs tools/category-map.json test/category.test.mjs
git commit -m "feat(pipeline): category mapping"
```

---

## Task 6: Set-record builder + pipeline orchestrator

**Files:**
- Create: `tools/record.mjs`, `tools/build-catalog.mjs`, `test/record.test.mjs`

**Interfaces:**
- Consumes: `parseCsv`, `buildIncludedThemeIds`, `resolveFootprint`, `categoryFor`.
- Produces:
  - `buildSetRecord(raw, ctx) → record` (pure). `raw = {set_num,name,year,theme_id,num_parts,img_url}` (strings); `ctx = {themeName, root, category, footprint, img}`. Returns the §Global-Constraints catalog record.
  - `tools/build-catalog.mjs` writes `data/sets.json`, `data/meta.json`, and `img/sets/*`.

- [ ] **Step 1: Write failing test** `test/record.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSetRecord } from '../tools/record.mjs';

test('builds a normalized catalog record', () => {
  const raw = { set_num: '60316-1', name: 'Police Station', year: '2022',
                theme_id: '61', num_parts: '668', img_url: 'https://x/y.jpg' };
  const rec = buildSetRecord(raw, {
    themeName: 'Police', root: 'City', category: 'police',
    footprint: { w: 48, h: 32, source: 'curated' }, img: 'img/sets/60316-1.jpg',
  });
  assert.deepEqual(rec, {
    set_num: '60316-1', num: '60316', name: 'Police Station', year: 2022,
    theme_id: 61, theme: 'Police', root: 'City', category: 'police',
    pieces: 668, img: 'img/sets/60316-1.jpg',
    footprint: { w: 48, h: 32, source: 'curated' },
  });
});

test('null image is preserved', () => {
  const rec = buildSetRecord(
    { set_num: '1-1', name: 'X', year: '2000', theme_id: '52', num_parts: '10', img_url: '' },
    { themeName: 'City', root: 'City', category: 'city', footprint: { w: 8, h: 8, source: 'estimated' }, img: null });
  assert.equal(rec.img, null);
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/record.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `tools/record.mjs`

```js
export function buildSetRecord(raw, ctx) {
  return {
    set_num: raw.set_num,
    num: raw.set_num.replace(/-\d+$/, ''),
    name: raw.name,
    year: Number(raw.year),
    theme_id: Number(raw.theme_id),
    theme: ctx.themeName,
    root: ctx.root,
    category: ctx.category,
    pieces: Number(raw.num_parts),
    img: ctx.img,
    footprint: ctx.footprint,
  };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test test/record.test.mjs`
Expected: 2 passing.

- [ ] **Step 5: Implement the orchestrator** `tools/build-catalog.mjs`

```js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parseCsv } from './lib/csv.mjs';
import { buildIncludedThemeIds } from './lib/themes.mjs';
import { resolveFootprint } from './lib/footprint.mjs';
import { categoryFor } from './lib/category.mjs';
import { buildSetRecord } from './record.mjs';

const SETS_URL = 'https://cdn.rebrickable.com/media/downloads/sets.csv.gz';
const THEMES_URL = 'https://cdn.rebrickable.com/media/downloads/themes.csv.gz';
const MIN_PARTS = 5;

async function fetchCsvGz(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return parseCsv(gunzipSync(buf).toString('utf8'));
    } catch (e) {
      console.warn(`fetch ${url} attempt ${attempt} failed: ${e.message}`);
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Resolve the root-theme label (City/Town/Trains/Modular) for a theme id.
function rootLabel(themeId, themeById, roots) {
  let id = themeId, guard = 0;
  while (id != null && guard++ < 50) {
    const t = themeById.get(id);
    if (!t) break;
    const parent = t.parent_id === '' ? null : Number(t.parent_id);
    if (parent == null || roots[id]) return roots[id] || t.name;
    id = parent;
  }
  return themeById.get(themeId)?.name || 'City';
}

async function downloadImage(url, setNum) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ext = (url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
    const path = `img/sets/${setNum}.${ext}`;
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    return path;
  } catch {
    return null;
  }
}

async function main() {
  await mkdir('img/sets', { recursive: true });
  await mkdir('data', { recursive: true });

  const include = JSON.parse(await readFile('tools/themes.include.json', 'utf8'));
  const curated = JSON.parse(await readFile('tools/footprints.json', 'utf8'));
  const catMap = JSON.parse(await readFile('tools/category-map.json', 'utf8'));
  const ROOT_LABELS = { 52: 'City', 50: 'Town', 233: 'Trains', 155: 'Modular' };

  console.log('Downloading Rebrickable catalog…');
  const [themeRows, setRows] = await Promise.all([fetchCsvGz(THEMES_URL), fetchCsvGz(SETS_URL)]);
  const themeById = new Map(themeRows.map((t) => [Number(t.id), t]));
  const includedIds = buildIncludedThemeIds(themeRows, include.roots);

  const chosen = setRows.filter(
    (s) => includedIds.has(Number(s.theme_id)) && Number(s.num_parts) >= MIN_PARTS);
  console.log(`Filtered ${chosen.length} sets from ${setRows.length}.`);

  const records = [];
  for (const raw of chosen) {
    const themeId = Number(raw.theme_id);
    const themeName = themeById.get(themeId)?.name || 'City';
    const root = rootLabel(themeId, themeById, ROOT_LABELS);
    const category = categoryFor(themeName, root, catMap);
    const num = raw.set_num.replace(/-\d+$/, '');
    const footprint = resolveFootprint({ num, num_parts: Number(raw.num_parts), category }, curated);
    const img = await downloadImage(raw.img_url, raw.set_num);
    records.push(buildSetRecord(raw, { themeName, root, category, footprint, img }));
  }

  records.sort((a, b) => (b.year - a.year) || a.name.localeCompare(b.name));
  await writeFile('data/sets.json', JSON.stringify(records));
  await writeFile('data/meta.json', JSON.stringify({
    built: new Date().toISOString().slice(0, 10),
    source: 'Rebrickable bulk downloads',
    counts: { sets: records.length },
    attribution: 'Set data & imagery sourced from Rebrickable.',
  }, null, 2));
  console.log(`Wrote data/sets.json (${records.length} sets).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Run the pipeline (integration, network)**

Run: `npm run build:data`
Expected: console prints "Filtered N sets" (N ≈ 1,000–1,500) and "Wrote data/sets.json". `data/sets.json`, `data/meta.json`, and `img/sets/*.jpg` exist. Spot-check with:
`node -e "const s=require('./data/sets.json'); console.log(s.length, s.find(x=>x.num==='10255'))"`
Expected: Assembly Square present with `footprint.source==='curated'`, `w:48,h:32`.

- [ ] **Step 7: Commit**

```bash
git add tools/record.mjs tools/build-catalog.mjs test/record.test.mjs data/ img/
git commit -m "feat(pipeline): orchestrator + generate catalog data"
```

> **Note:** if `img/` is large (>tens of MB), that is acceptable per spec §14. If it ever grows unwieldy, add a `sharp` thumbnail step — out of scope for v1.

---

## Task 7: units.js (stud↔cm)

**Files:**
- Create: `js/units.js`, `test/units.test.mjs`

**Interfaces:**
- Produces: `STUD_CM=0.8`, `BASEPLATE=32`, `studsToCm(studs)→number`, `fmtDims(w,h,unit)→string`, `fmtArea(w,h,unit)→string` (`unit ∈ {'studs','cm'}`).

- [ ] **Step 1: Write failing test** `test/units.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studsToCm, fmtDims, fmtArea, BASEPLATE } from '../js/units.js';

test('stud to cm', () => {
  assert.equal(BASEPLATE, 32);
  assert.equal(studsToCm(32), 25.6);
  assert.equal(studsToCm(10), 8);
});
test('format dims', () => {
  assert.equal(fmtDims(48, 32, 'studs'), '48 × 32 studs');
  assert.equal(fmtDims(32, 32, 'cm'), '25.6 × 25.6 cm');
});
test('format area switches to m² when large', () => {
  assert.equal(fmtArea(10, 10, 'studs'), '100 studs²');
  assert.equal(fmtArea(160, 160, 'cm'), '1.64 m²'); // 128×128cm = 16384cm² → 1.64 m²
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/units.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `js/units.js`

```js
export const STUD_CM = 0.8;
export const BASEPLATE = 32;

export function studsToCm(studs) {
  return Math.round(studs * STUD_CM * 10) / 10;
}

export function fmtDims(w, h, unit = 'studs') {
  if (unit === 'cm') return `${studsToCm(w)} × ${studsToCm(h)} cm`;
  return `${w} × ${h} studs`;
}

export function fmtArea(w, h, unit = 'studs') {
  if (unit === 'cm') {
    const cm2 = studsToCm(w) * studsToCm(h);
    return cm2 >= 10000 ? `${(cm2 / 10000).toFixed(2)} m²` : `${Math.round(cm2)} cm²`;
  }
  return `${w * h} studs²`;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test test/units.test.mjs`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add js/units.js test/units.test.mjs
git commit -m "feat(app): units conversion + formatting"
```

---

## Task 8: geometry.js (extent/overlap/bbox/snap)

**Files:**
- Create: `js/geometry.js`, `test/geometry.test.mjs`

**Interfaces:**
- Tile shape: `{x,y,w,h,rot}`.
- Produces: `extent(tile)→{w,h}`, `overlaps(a,b)→boolean` (edge-touch = false), `bbox(tiles)→{x,y,w,h}` (empty → all-zero), `snap(v,step=1)→number`, `anyOverlaps(tiles)→Set<id>`.

- [ ] **Step 1: Write failing test** `test/geometry.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extent, overlaps, bbox, snap, anyOverlaps } from '../js/geometry.js';

test('extent swaps on 90/270', () => {
  assert.deepEqual(extent({ w: 48, h: 32, rot: 0 }), { w: 48, h: 32 });
  assert.deepEqual(extent({ w: 48, h: 32, rot: 90 }), { w: 32, h: 48 });
});
test('overlap true when intersecting, false when edge-touching', () => {
  const a = { x: 0, y: 0, w: 32, h: 32, rot: 0 };
  assert.equal(overlaps(a, { x: 16, y: 16, w: 32, h: 32, rot: 0 }), true);
  assert.equal(overlaps(a, { x: 32, y: 0, w: 32, h: 32, rot: 0 }), false); // touching
});
test('bbox spans all tiles; empty is zero', () => {
  assert.deepEqual(bbox([]), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(
    bbox([{ x: 0, y: 0, w: 32, h: 32, rot: 0 }, { x: 40, y: 10, w: 16, h: 16, rot: 0 }]),
    { x: 0, y: 0, w: 56, h: 32 });
});
test('snap rounds to step', () => {
  assert.equal(snap(17, 1), 17);
  assert.equal(snap(17, 16), 16);
  assert.equal(snap(25, 16), 32);
});
test('anyOverlaps returns ids of overlapping tiles', () => {
  const ids = anyOverlaps([
    { id: 'a', x: 0, y: 0, w: 32, h: 32, rot: 0 },
    { id: 'b', x: 16, y: 16, w: 32, h: 32, rot: 0 },
    { id: 'c', x: 100, y: 100, w: 8, h: 8, rot: 0 },
  ]);
  assert.deepEqual([...ids].sort(), ['a', 'b']);
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/geometry.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `js/geometry.js`

```js
export function extent(tile) {
  const swap = tile.rot === 90 || tile.rot === 270;
  return { w: swap ? tile.h : tile.w, h: swap ? tile.w : tile.h };
}

export function overlaps(a, b) {
  const ea = extent(a), eb = extent(b);
  return a.x < b.x + eb.w && a.x + ea.w > b.x &&
         a.y < b.y + eb.h && a.y + ea.h > b.y;
}

export function bbox(tiles) {
  if (!tiles.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const e = extent(t);
    minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + e.w); maxY = Math.max(maxY, t.y + e.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function snap(value, step = 1) {
  return Math.round(value / step) * step;
}

export function anyOverlaps(tiles) {
  const ids = new Set();
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (overlaps(tiles[i], tiles[j])) { ids.add(tiles[i].id); ids.add(tiles[j].id); }
    }
  }
  return ids;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test test/geometry.test.mjs`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add js/geometry.js test/geometry.test.mjs
git commit -m "feat(app): geometry (extent/overlap/bbox/snap)"
```

---

## Task 9: storage.js (persistence + import/export)

**Files:**
- Create: `js/storage.js`, `test/storage.test.mjs`

**Interfaces:**
- Produces (pure): `serializeCity({name,units,placed})→city`, `validateCity(obj)→{ok,error?,city?}`, `exportCityJson(city)→string`, `importCityJson(text)→{ok,error?,city?}`.
- Produces (localStorage via `globalThis.localStorage`): `loadCities()→{name:city}`, `saveCity(city)`, `loadCity(name)→city|null`, `currentCityName()→string|null`, `deleteCity(name)`.

- [ ] **Step 1: Write failing test** `test/storage.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeCity, validateCity, exportCityJson, importCityJson,
  saveCity, loadCity, currentCityName,
} from '../js/storage.js';

// in-memory localStorage mock
globalThis.localStorage = (() => {
  let m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
           removeItem: (k) => { delete m[k]; }, clear: () => { m = {}; } };
})();

const placed = [{ id: 'p1', set_num: '10255-1', x: 0, y: 0, w: 48, h: 32, rot: 0 }];

test('serialize stamps app + version', () => {
  const c = serializeCity({ name: 'T', units: 'studs', placed });
  assert.equal(c.app, 'brick-city-planner');
  assert.equal(c.version, 1);
  assert.deepEqual(c.placed, placed);
});
test('validate rejects foreign / malformed', () => {
  assert.equal(validateCity({ app: 'other' }).ok, false);
  assert.equal(validateCity({ app: 'brick-city-planner', version: 2 }).ok, false);
  assert.equal(validateCity({ app: 'brick-city-planner', version: 1, placed: [{}] }).ok, false);
});
test('export → import round-trips', () => {
  const c = serializeCity({ name: 'T', placed });
  const back = importCityJson(exportCityJson(c));
  assert.equal(back.ok, true);
  assert.deepEqual(back.city.placed, placed);
});
test('import rejects non-JSON', () => {
  assert.equal(importCityJson('{nope').ok, false);
});
test('save then load via localStorage', () => {
  saveCity(serializeCity({ name: 'Town A', placed }));
  assert.equal(currentCityName(), 'Town A');
  assert.deepEqual(loadCity('Town A').placed, placed);
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/storage.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `js/storage.js`

```js
const KEY = 'bcp.cities';
const CUR = 'bcp.current';

export function serializeCity({ name, units = 'studs', placed = [] }) {
  return {
    app: 'brick-city-planner', version: 1, name, units, placed,
    updated: new Date().toISOString(),
  };
}

export function validateCity(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid file.' };
  if (obj.app !== 'brick-city-planner') return { ok: false, error: 'Not a Brick City Planner file.' };
  if (obj.version !== 1) return { ok: false, error: `Unsupported version: ${obj.version}.` };
  if (!Array.isArray(obj.placed)) return { ok: false, error: 'Missing placed sets.' };
  for (const p of obj.placed) {
    if (typeof p.set_num !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        !Number.isFinite(p.w) || !Number.isFinite(p.h)) {
      return { ok: false, error: 'A placed set is malformed.' };
    }
  }
  return { ok: true, city: obj };
}

export function exportCityJson(city) {
  return JSON.stringify(city, null, 2);
}

export function importCityJson(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'File is not valid JSON.' }; }
  return validateCity(obj);
}

function store() { return globalThis.localStorage; }

export function loadCities() {
  try { return JSON.parse(store().getItem(KEY)) || {}; } catch { return {}; }
}
export function saveCity(city) {
  const all = loadCities();
  all[city.name] = city;
  try {
    store().setItem(KEY, JSON.stringify(all));
    store().setItem(CUR, city.name);
  } catch (e) { console.warn('Save failed (storage full?):', e.message); }
}
export function loadCity(name) { return loadCities()[name] || null; }
export function currentCityName() { return store().getItem(CUR); }
export function deleteCity(name) {
  const all = loadCities();
  delete all[name];
  store().setItem(KEY, JSON.stringify(all));
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test test/storage.test.mjs`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add js/storage.js test/storage.test.mjs
git commit -m "feat(app): storage + import/export"
```

---

## Task 10: data.js (load & index catalog)

**Files:**
- Create: `js/data.js`, `test/data.test.mjs`

**Interfaces:**
- Produces: `indexByNum(sets)→Map<set_num,record>` (pure), `loadCatalog(url='data/sets.json')→{sets,byNum}` (async, uses `fetch`).

- [ ] **Step 1: Write failing test** `test/data.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexByNum } from '../js/data.js';

test('indexes by set_num', () => {
  const m = indexByNum([{ set_num: 'a-1' }, { set_num: 'b-1' }]);
  assert.equal(m.get('b-1').set_num, 'b-1');
  assert.equal(m.size, 2);
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test test/data.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `js/data.js`

```js
export function indexByNum(sets) {
  const m = new Map();
  for (const s of sets) m.set(s.set_num, s);
  return m;
}

export async function loadCatalog(url = 'data/sets.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
  const sets = await res.json();
  return { sets, byNum: indexByNum(sets) };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test test/data.test.mjs`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add js/data.js test/data.test.mjs
git commit -m "feat(app): catalog loader + index"
```

---

## Task 11: App shell — index.html + css/styles.css (from approved mockup)

**Files:**
- Create: `index.html`, `css/styles.css`
- Reference: approved mockup at `C:\Users\KHALIL~1.LAR\AppData\Local\Temp\claude\C--Windows-System32\b7bba204-c44b-4bd3-9a7e-990664d7c211\scratchpad\planner-mockup.html` (complete HTML+CSS to port).

**Interfaces:**
- Produces: static shell with these element IDs the JS will bind to:
  `#catalog-list`, `#catalog-search`, `#catalog-chips`, `#grid-stage`, `#grid-board`, `#summary`, `#unit-toggle`, `#btn-new`, `#btn-import`, `#btn-export`, `#btn-save`, `#file-import` (hidden `<input type=file>`), `#toast`.

This is a **DOM task — verify in the browser**, no unit test.

- [ ] **Step 1: Create `css/styles.css`** — copy the entire contents of the mockup's `<style>…</style>` block verbatim (tokens, both themes, all component classes). Remove the mockup-only `.banner` rules.

- [ ] **Step 2: Create `index.html`** — port the mockup's body structure, linking the stylesheet and app module, and adding the IDs above. Skeleton:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brick City Planner</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="brand">
        <!-- inline SVG logo from mockup (NOT the LEGO logo) -->
        <div><div class="wordmark">Brick<b>City</b> Planner</div></div>
      </div>
      <div class="toolbar">
        <div class="seg" id="unit-toggle" role="group" aria-label="Units">
          <button class="on" data-unit="studs">studs</button><button data-unit="cm">cm</button>
        </div>
        <button class="btn" id="btn-new">＋ New city</button>
        <button class="btn" id="btn-import">⭳ Import</button>
        <input type="file" id="file-import" accept="application/json" hidden>
        <button class="btn primary" id="btn-export">⭱ Export</button>
      </div>
    </div>

    <div class="grid3">
      <section class="card" aria-label="Set catalog">
        <div class="card-h"><h2>Catalog</h2><span class="count-pill" id="catalog-count"></span></div>
        <div class="search"><span>🔍</span>
          <input id="catalog-search" placeholder="Search sets, e.g. 60316…" aria-label="Search sets"></div>
        <div class="chips" id="catalog-chips"></div>
        <div class="catalog" id="catalog-list"></div>
      </section>

      <section class="card canvas-wrap" aria-label="City grid">
        <div class="card-h"><h2>City grid</h2>
          <span class="muted" id="grid-dims" style="margin-left:auto"></span></div>
        <div class="canvas-tools">
          <button class="btn icon" id="btn-rotate" title="Rotate selected">⟳</button>
          <button class="btn icon" id="btn-delete" title="Delete selected">🗑</button>
          <span class="muted">bold line = baseplate (32 studs)</span>
          <div class="seg" id="zoom-ctrl" style="margin-left:auto">
            <button data-zoom="out">−</button><button class="on" data-zoom="reset">100%</button>
            <button data-zoom="in">＋</button><button data-zoom="fit">Fit</button></div>
        </div>
        <div class="stage" id="grid-stage"><div class="board" id="grid-board"></div></div>
      </section>

      <aside class="card" aria-label="City summary">
        <div class="card-h"><h2>City summary</h2></div>
        <div class="sum" id="summary"></div>
      </aside>
    </div>

    <div class="legal">
      <b>LEGO®</b> is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this site.<br>
      Set data &amp; imagery sourced from <b>Rebrickable</b>. A free, non-commercial fan project — not affiliated with the LEGO Group.
    </div>
  </div>
  <div id="toast" role="status" aria-live="polite"></div>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Add minimal `#toast` styles** to `css/styles.css`

```css
#toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(20px);
  background:var(--ink);color:var(--panel);padding:10px 16px;border-radius:10px;
  font-size:13px;box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:.2s;z-index:50}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
```

- [ ] **Step 4: Create a temporary `js/app.js` stub** so the page loads

```js
console.log('Brick City Planner booting…');
```

- [ ] **Step 5: Verify in browser**

Run: `npm run serve` then open `http://localhost:8080`.
Expected: the three-pane shell renders (empty catalog/grid/summary), top bar + toolbar visible, legal footer present, no console errors, light/dark both styled.

- [ ] **Step 6: Commit**

```bash
git add index.html css/styles.css js/app.js
git commit -m "feat(app): static shell from approved mockup"
```

---

## Task 12: catalog.js (render, search, filter)

**Files:**
- Create: `js/catalog.js`
- Modify: `js/app.js` (wire catalog render + load catalog)

**Interfaces:**
- Consumes: catalog records; `onAdd(set)` callback.
- Produces: `renderCatalog(els, sets, { onAdd }) → { setFilter(text, category) }` where `els = {list, search, chips, count}`. Renders set rows (swatch by `category`, name, num, year, footprint with `≈` when `footprint.source!=='curated'`), category chips, live search over name+num.

DOM task — **verify in browser**.

- [ ] **Step 1: Implement** `js/catalog.js`

```js
const CATS = [
  ['all', 'All', null], ['police', 'Police', 'var(--t-police)'],
  ['fire', 'Fire', 'var(--t-fire)'], ['train', 'Trains', 'var(--t-train)'],
  ['modular', 'Modular', 'var(--t-modular)'], ['city', 'Town', 'var(--t-city)'],
];
const CAT_VAR = {
  police: 'var(--t-police)', fire: 'var(--t-fire)', train: 'var(--t-train)',
  modular: 'var(--t-modular)', city: 'var(--t-city)', road: 'var(--t-road)',
  park: 'var(--t-park)', space: 'var(--t-space)', arctic: 'var(--t-police)',
  harbor: 'var(--t-city)', farm: 'var(--t-park)', airport: 'var(--t-city)', other: 'var(--t-city)',
};

export function catColor(category) { return CAT_VAR[category] || 'var(--t-city)'; }

export function renderCatalog(els, sets, { onAdd }) {
  let text = '', category = 'all';

  els.chips.innerHTML = '';
  for (const [key, label, color] of CATS) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (key === 'all' ? ' on' : '');
    chip.dataset.cat = key;
    chip.innerHTML = (color ? `<i class="dot" style="background:${color}"></i>` : '') + label;
    chip.addEventListener('click', () => {
      category = key;
      els.chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
      draw();
    });
    els.chips.appendChild(chip);
  }

  els.search.addEventListener('input', () => { text = els.search.value.trim().toLowerCase(); draw(); });

  function match(s) {
    if (category !== 'all' && s.category !== category) return false;
    if (!text) return true;
    return s.name.toLowerCase().includes(text) || s.num.includes(text);
  }

  function draw() {
    const shown = sets.filter(match).slice(0, 400); // cap DOM for perf
    els.count.textContent = `${sets.filter(match).length} sets`;
    els.list.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const s of shown) frag.appendChild(row(s));
    els.list.appendChild(frag);
  }

  function row(s) {
    const approx = s.footprint.source !== 'curated';
    const el = document.createElement('div');
    el.className = 'set';
    el.innerHTML = `
      <div class="swatch" style="background:${catColor(s.category)}">${
        s.img ? `<img src="${s.img}" alt="" loading="lazy"
          style="width:100%;height:100%;object-fit:cover"
          onerror="this.remove()">` : ''}</div>
      <div class="set-meta"><div class="set-name" title="${s.name}">${s.name}</div>
        <div class="set-sub"><span>${s.num}</span><span>${s.year || ''}</span>
          <span class="fp${approx ? ' approx' : ''}">${approx ? '≈ ' : ''}${s.footprint.w}×${s.footprint.h}</span>
        </div></div>
      <button class="add" aria-label="Add ${s.name}">＋</button>`;
    el.querySelector('.add').addEventListener('click', () => onAdd(s));
    return el;
  }

  draw();
  return { setFilter(t, c) { text = t; category = c; draw(); } };
}
```

- [ ] **Step 2: Wire in `js/app.js`** (replace stub)

```js
import { loadCatalog } from './data.js';
import { renderCatalog } from './catalog.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    $('catalog-list').innerHTML = `<div class="note">Couldn't load the set catalog. ${e.message}</div>`;
    return;
  }
  renderCatalog(
    { list: $('catalog-list'), search: $('catalog-search'), chips: $('catalog-chips'), count: $('catalog-count') },
    catalog.sets,
    { onAdd: (s) => console.log('add', s.num) }, // grid wired in Task 13
  );
}
boot();
```

- [ ] **Step 3: Verify in browser**

Run: `npm run serve`, open the app.
Expected: catalog fills with real sets (thumbnails or colored swatches), count shows total, chips filter, search narrows by name/number, `≈` shows on estimated footprints. Clicking ＋ logs the set number.

- [ ] **Step 4: Commit**

```bash
git add js/catalog.js js/app.js
git commit -m "feat(app): catalog render + search + filter"
```

---

## Task 13: grid.js A — render grid + place/render tiles

**Files:**
- Create: `js/grid.js`
- Modify: `js/app.js` (init grid; wire catalog `onAdd` → `grid.addSet`)

**Interfaces:**
- Produces a `createGrid(board, { onChange }) → grid` controller with (this task): `addSet(set)`, `getPlaced()`, `setPlaced(arr)`, `render()`. Internal state: `placed[]`, `PX=6` (px per stud). Tiles rendered as `.tile` divs positioned `left/top/width/height = studs*PX`. `onChange()` fires after any mutation.

DOM task — **verify in browser**.

- [ ] **Step 1: Implement** `js/grid.js` (Part A)

```js
import { catColor } from './catalog.js';
import { anyOverlaps, extent } from './geometry.js';

export const PX = 6; // pixels per stud
const DARK_TXT = new Set(['modular', 'park']); // light tile bg → dark text

export function createGrid(board, { onChange = () => {} } = {}) {
  let placed = [];
  let selectedId = null;
  let seq = 1;

  function addSet(set) {
    const id = 'p' + (seq++);
    placed.push({
      id, set_num: set.set_num, name: set.name, category: set.category,
      x: 0, y: 0, w: set.footprint.w, h: set.footprint.h, rot: 0,
      approx: set.footprint.source !== 'curated', img: set.img || null,
    });
    selectedId = id;
    render(); onChange();
  }

  function getPlaced() { return placed; }
  function setPlaced(arr) { placed = arr.map((p) => ({ ...p })); selectedId = null; render(); onChange(); }

  function render() {
    const over = anyOverlaps(placed);
    board.innerHTML = '';
    for (const t of placed) {
      const e = extent(t);
      const el = document.createElement('div');
      el.className = 'tile' + (DARK_TXT.has(t.category) ? ' dark-txt' : '') +
        (over.has(t.id) ? ' warn' : '') + (t.id === selectedId ? ' selected' : '');
      el.style.left = t.x * PX + 'px';
      el.style.top = t.y * PX + 'px';
      el.style.width = e.w * PX + 'px';
      el.style.height = e.h * PX + 'px';
      el.style.background = catColor(t.category);
      el.dataset.id = t.id;
      el.tabIndex = 0;
      el.innerHTML = `
        <div class="tn">${t.name}${t.approx ? ' <span style="opacity:.8;font-weight:400">≈</span>' : ''}</div>
        <div class="tsub"><span>${t.set_num.replace(/-\d+$/, '')}</span><span>${e.w}×${e.h}</span></div>`;
      board.appendChild(el);
    }
  }

  render();
  return { addSet, getPlaced, setPlaced, render, _state: () => ({ placed, selectedId }) };
}
```

- [ ] **Step 2: Add `.tile.selected` style** to `css/styles.css`

```css
.tile.selected{outline:2px solid var(--accent-deep);outline-offset:1px;z-index:6}
```

- [ ] **Step 3: Wire in `js/app.js`**

```js
import { createGrid } from './grid.js';
// …inside boot(), after catalog loads:
const grid = createGrid($('grid-board'), { onChange: () => {/* summary in Task 17 */} });
renderCatalog(/* els */ {…}, catalog.sets, { onAdd: (s) => grid.addSet(s) });
```
(Replace the placeholder `onAdd` from Task 12 with `grid.addSet`.)

- [ ] **Step 4: Verify in browser**

Clicking ＋ on a catalog set drops a color-coded, correctly-sized tile onto the grid at 0,0; multiple adds stack (overlap → red outline). Baseplate gridlines visible behind tiles.

- [ ] **Step 5: Commit**

```bash
git add js/grid.js js/app.js css/styles.css
git commit -m "feat(app): grid render + place tiles"
```

---

## Task 14: grid.js B — select + drag-move with snap + keyboard

**Files:**
- Modify: `js/grid.js`

**Interfaces:**
- Adds: pointer drag to move tiles (snap to stud via `snap`), click-to-select, keyboard (arrows nudge 1 stud, Esc deselect). Movement clamps `x,y ≥ 0`.

DOM task — **verify in browser**.

- [ ] **Step 1: Extend `js/grid.js`** — import `snap`, add interaction. Add inside `createGrid`, and attach in `render()` via event delegation on `board`:

```js
// add to imports:
import { anyOverlaps, extent, snap } from './geometry.js';

// add helper + listeners inside createGrid (after render def):
function select(id) { selectedId = id; render(); }

board.addEventListener('pointerdown', (ev) => {
  const tileEl = ev.target.closest('.tile');
  if (!tileEl) { select(null); return; }
  const id = tileEl.dataset.id;
  select(id);
  const t = placed.find((p) => p.id === id);
  const startX = ev.clientX, startY = ev.clientY, ox = t.x, oy = t.y;
  tileEl.setPointerCapture(ev.pointerId);
  function move(e) {
    t.x = Math.max(0, snap(ox + (e.clientX - startX) / PX));
    t.y = Math.max(0, snap(oy + (e.clientY - startY) / PX));
    render();
  }
  function up() {
    tileEl.removeEventListener('pointermove', move);
    tileEl.removeEventListener('pointerup', up);
    onChange();
  }
  tileEl.addEventListener('pointermove', move);
  tileEl.addEventListener('pointerup', up);
});

board.addEventListener('keydown', (ev) => {
  if (!selectedId) return;
  const t = placed.find((p) => p.id === selectedId);
  if (!t) return;
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
  if (step) { t.x = Math.max(0, t.x + step[0]); t.y = Math.max(0, t.y + step[1]); render(); onChange(); ev.preventDefault(); }
  else if (ev.key === 'Escape') select(null);
});
```

Expose `select` on the returned controller: add `select` to the return object.

- [ ] **Step 2: Verify in browser**

Drag a tile — it follows the pointer and snaps to whole studs, never goes negative. Click selects (yellow outline). Arrow keys nudge the selected tile by 1 stud. Esc deselects.

- [ ] **Step 3: Commit**

```bash
git add js/grid.js
git commit -m "feat(app): grid select + drag-move + keyboard nudge"
```

---

## Task 15: grid.js C — rotate, resize, delete

**Files:**
- Modify: `js/grid.js`, `css/styles.css`
- Modify: `js/app.js` (wire toolbar rotate/delete buttons)

**Interfaces:**
- Adds controller methods: `rotateSelected()`, `deleteSelected()`, `resizeSelected(w,h)`. Rotation cycles `0→90→180→270`. A corner handle on the selected tile drag-resizes `w,h` (snap to stud, min 1). Delete key removes selected.

DOM task — **verify in browser**.

- [ ] **Step 1: Extend `js/grid.js`** — add methods + resize handle. In `render()`, append a handle to the selected tile:

```js
// inside render(), after setting innerHTML, before board.appendChild(el):
if (t.id === selectedId) {
  const h = document.createElement('div');
  h.className = 'resize-handle';
  el.appendChild(h);
}
```

Add methods inside `createGrid`:

```js
function rotateSelected() {
  const t = placed.find((p) => p.id === selectedId); if (!t) return;
  t.rot = (t.rot + 90) % 360; render(); onChange();
}
function deleteSelected() {
  if (!selectedId) return;
  placed = placed.filter((p) => p.id !== selectedId); selectedId = null; render(); onChange();
}
function resizeSelected(w, h) {
  const t = placed.find((p) => p.id === selectedId); if (!t) return;
  t.w = Math.max(1, w); t.h = Math.max(1, h); t.approx = true; render(); onChange();
}
```

Add resize-handle drag (delegated in the existing `pointerdown`, checked before tile-move):

```js
// at the very top of the board 'pointerdown' handler:
if (ev.target.classList.contains('resize-handle')) {
  ev.stopPropagation();
  const t = placed.find((p) => p.id === selectedId);
  const sx = ev.clientX, sy = ev.clientY, ow = t.w, oh = t.h;
  const handle = ev.target;
  handle.setPointerCapture(ev.pointerId);
  const move = (e) => { t.w = Math.max(1, snap(ow + (e.clientX - sx) / PX));
                        t.h = Math.max(1, snap(oh + (e.clientY - sy) / PX)); t.approx = true; render(); };
  const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); onChange(); };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  return;
}
```

Add `Delete`/`Backspace` to the keydown handler:

```js
else if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelected(); ev.preventDefault(); }
else if (ev.key.toLowerCase() === 'r') { rotateSelected(); }
```

Add `rotateSelected, deleteSelected, resizeSelected` to the returned object.

- [ ] **Step 2: Add handle style** to `css/styles.css`

```css
.resize-handle{position:absolute;right:-5px;bottom:-5px;width:14px;height:14px;border-radius:4px;
  background:var(--accent);border:2px solid var(--accent-deep);cursor:nwse-resize;z-index:7}
```

- [ ] **Step 3: Wire toolbar in `js/app.js`**

```js
$('btn-rotate').addEventListener('click', () => grid.rotateSelected());
$('btn-delete').addEventListener('click', () => grid.deleteSelected());
```

- [ ] **Step 4: Verify in browser**

Rotate button (and `R`) rotates a rectangular tile (w/h swap visibly); square modulars unaffected. Corner handle resizes the selected tile and adds a `≈` (approx). Trash button / Delete key removes the selected tile.

- [ ] **Step 5: Commit**

```bash
git add js/grid.js css/styles.css js/app.js
git commit -m "feat(app): rotate + resize + delete tiles"
```

---

## Task 16: grid.js D — pan & zoom

**Files:**
- Modify: `js/grid.js`, `js/app.js`

**Interfaces:**
- Adds: `setZoom(factor)`, `zoomBy(delta)`, `fit()`. Zoom scales the board via CSS `transform: scale()` (clamped 0.25–2). `fit()` frames all placed tiles. Pan via the stage's native scroll (stage is `overflow:auto`) plus wheel-zoom with Ctrl.

DOM task — **verify in browser**.

- [ ] **Step 1: Extend `js/grid.js`**

```js
// state:
let zoom = 1;
const stage = board.parentElement;

function applyZoom() { board.style.transform = `scale(${zoom})`; board.style.transformOrigin = '0 0'; }
function setZoom(z) { zoom = Math.min(2, Math.max(0.25, z)); applyZoom(); }
function zoomBy(d) { setZoom(zoom + d); }
function fit() {
  const b = bbox(placed); // import bbox
  if (!b.w) { setZoom(1); return; }
  const pad = 40;
  const zx = (stage.clientWidth - pad) / (b.w * PX);
  const zy = (stage.clientHeight - pad) / (b.h * PX);
  setZoom(Math.min(2, Math.max(0.25, Math.min(zx, zy))));
  stage.scrollTo(b.x * PX * zoom - 20, b.y * PX * zoom - 20);
}

stage.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault(); zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });
```

Add `bbox` to the geometry import; add `setZoom, zoomBy, fit` to the return object; call `applyZoom()` once at init.

- [ ] **Step 2: Wire zoom controls in `js/app.js`**

```js
$('zoom-ctrl').addEventListener('click', (e) => {
  const z = e.target.dataset.zoom;
  if (z === 'in') grid.zoomBy(0.15);
  else if (z === 'out') grid.zoomBy(-0.15);
  else if (z === 'reset') grid.setZoom(1);
  else if (z === 'fit') grid.fit();
});
```

- [ ] **Step 3: Verify in browser**

＋/− buttons scale the grid; 100% resets; Fit frames the placed city; Ctrl+wheel zooms; the stage scrolls to pan a large city.

- [ ] **Step 4: Commit**

```bash
git add js/grid.js js/app.js
git commit -m "feat(app): grid pan + zoom"
```

---

## Task 17: summary.js (stats + breakdown + warnings)

**Files:**
- Create: `js/summary.js`
- Modify: `js/app.js` (render summary on grid `onChange`)

**Interfaces:**
- Produces: `renderSummary(el, placed, byNum, unit) → void`. Computes: footprint = `bbox(placed)`; total pieces via `byNum`; category counts; overlap count via `anyOverlaps`; estimated-count via `approx`. Uses `units.fmtDims/fmtArea`.

DOM task — **verify in browser**.

- [ ] **Step 1: Implement** `js/summary.js`

```js
import { bbox, anyOverlaps } from './geometry.js';
import { fmtDims, fmtArea, studsToCm } from './units.js';
import { catColor } from './catalog.js';

export function renderSummary(el, placed, byNum, unit = 'studs') {
  const box = bbox(placed);
  const pieces = placed.reduce((n, t) => n + (byNum.get(t.set_num)?.pieces || 0), 0);
  const over = anyOverlaps(placed);
  const overlapCount = over.size ? Math.ceil(over.size / 2) : 0;
  const approxCount = placed.filter((t) => t.approx).length;

  const counts = {};
  for (const t of placed) counts[t.category] = (counts[t.category] || 0) + 1;
  const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = placed.length || 1;

  el.innerHTML = `
    <div class="stat-lead">
      <span class="k">Total footprint</span>
      <span class="v">${box.w} × ${box.h} <small>studs</small></span>
      <span class="mono" style="color:var(--ink-faint);font-size:12px">${
        studsToCm(box.w)} × ${studsToCm(box.h)} cm · ${fmtArea(box.w, box.h, 'cm')}</span>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="k">Sets placed</div><div class="v">${placed.length}</div></div>
      <div class="stat"><div class="k">Total pieces</div><div class="v">${pieces.toLocaleString()}</div></div>
    </div>
    <div>
      <h2 class="sec" style="margin-bottom:8px">By category</h2>
      <div class="breakdown">${cats.map(([c, n]) =>
        `<div class="brow"><i class="dot" style="background:${catColor(c)}"></i>
          <span class="nm">${c[0].toUpperCase() + c.slice(1)}</span><span class="ct">${n}</span></div>`).join('') ||
        '<div class="note">No sets yet — add some from the catalog.</div>'}</div>
      ${cats.length ? `<div class="bar">${cats.map(([c, n]) =>
        `<i style="width:${(n / total * 100).toFixed(1)}%;background:${catColor(c)}"></i>`).join('')}</div>` : ''}
    </div>
    ${overlapCount ? `<div class="alert"><span class="ic">⚠</span>
      <span class="tx"><b>${overlapCount} overlap${overlapCount > 1 ? 's' : ''}.</b> Move a tile to clear it.</span></div>` : ''}
    ${approxCount ? `<div class="note"><span class="approx" style="color:var(--warn)">≈</span>
      <span>${approxCount} set${approxCount > 1 ? 's use' : ' uses'} an <b style="color:var(--ink-soft)">estimated</b> footprint — drag a corner to adjust.</span></div>` : ''}
    <div style="display:flex;gap:8px">
      <button class="btn" id="btn-save" style="flex:1">💾 Save</button>
      <button class="btn primary" id="btn-export2" style="flex:1">⭱ Export</button>
    </div>`;
}
```

- [ ] **Step 2: Wire in `js/app.js`**

```js
import { renderSummary } from './summary.js';
const drawSummary = () => renderSummary($('summary'), grid.getPlaced(), catalog.byNum, unitState);
const grid = createGrid($('grid-board'), { onChange: () => { drawSummary(); autosave(); } });
drawSummary();
```
(Define `let unitState = 'studs'` and a no-op `autosave` for now — real save in Task 18. `#btn-save`/`#btn-export2` are wired in Task 18.)

- [ ] **Step 3: Verify in browser**

Adding/moving/deleting tiles updates footprint (studs + cm + area), sets placed, total pieces, category breakdown bar; overlaps show the warning; resized/estimated sets show the `≈` note.

- [ ] **Step 4: Commit**

```bash
git add js/summary.js js/app.js
git commit -m "feat(app): city summary panel"
```

---

## Task 18: app.js — full wiring (units toggle, save/load, import/export, autosave)

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes all modules. Adds: unit toggle updates `unitState` + re-renders summary + grid dims; New city clears; Save persists via `storage.saveCity(serializeCity(...))`; Export downloads `.json`; Import reads a file → `importCityJson` → `grid.setPlaced`; autosave (debounced) to `bcp.current`; loads current city on boot; `toast(msg)` helper.

DOM task — **verify in browser**.

- [ ] **Step 1: Rewrite `js/app.js`** to the final wiring

```js
import { loadCatalog } from './data.js';
import { renderCatalog } from './catalog.js';
import { createGrid } from './grid.js';
import { renderSummary } from './summary.js';
import {
  serializeCity, saveCity, loadCity, currentCityName, importCityJson, exportCityJson,
} from './storage.js';
import { fmtDims } from './units.js';
import { bbox } from './geometry.js';

const $ = (id) => document.getElementById(id);
let unitState = 'studs';
let cityName = 'Untitled city';
let catalog, grid;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCity(serializeCity({ name: cityName, units: unitState, placed: grid.getPlaced() }));
  }, 600);
}

function drawSummary() { renderSummary($('summary'), grid.getPlaced(), catalog.byNum, unitState); wireSummaryButtons(); }
function drawDims() {
  const b = bbox(grid.getPlaced());
  $('grid-dims').textContent = b.w ? fmtDims(b.w, b.h, unitState) : 'empty';
}
function refresh() { drawSummary(); drawDims(); }

function wireSummaryButtons() {
  const s = $('summary').querySelector('#btn-save');
  const e = $('summary').querySelector('#btn-export2');
  if (s) s.addEventListener('click', doSave);
  if (e) e.addEventListener('click', doExport);
}
function doSave() {
  saveCity(serializeCity({ name: cityName, units: unitState, placed: grid.getPlaced() }));
  toast(`Saved “${cityName}”.`);
}
function doExport() {
  const city = serializeCity({ name: cityName, units: unitState, placed: grid.getPlaced() });
  const blob = new Blob([exportCityJson(city)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${cityName.replace(/[^\w-]+/g, '_')}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('Exported city file.');
}

async function boot() {
  try { catalog = await loadCatalog(); }
  catch (e) { $('catalog-list').innerHTML = `<div class="note">Couldn't load the set catalog. ${e.message}</div>`; return; }

  grid = createGrid($('grid-board'), { onChange: () => { refresh(); autosave(); } });

  renderCatalog(
    { list: $('catalog-list'), search: $('catalog-search'), chips: $('catalog-chips'), count: $('catalog-count') },
    catalog.sets, { onAdd: (s) => grid.addSet(s) });

  // toolbar
  $('unit-toggle').addEventListener('click', (e) => {
    const u = e.target.dataset.unit; if (!u) return;
    unitState = u;
    $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target));
    refresh();
  });
  $('btn-rotate').addEventListener('click', () => grid.rotateSelected());
  $('btn-delete').addEventListener('click', () => grid.deleteSelected());
  $('zoom-ctrl').addEventListener('click', (e) => {
    const z = e.target.dataset.zoom; if (!z) return;
    ({ in: () => grid.zoomBy(0.15), out: () => grid.zoomBy(-0.15),
       reset: () => grid.setZoom(1), fit: () => grid.fit() }[z] || (() => {}))();
  });
  $('btn-new').addEventListener('click', () => {
    if (grid.getPlaced().length && !confirm('Start a new city? Unsaved changes stay in the current autosave.')) return;
    cityName = 'Untitled city'; grid.setPlaced([]); refresh(); toast('New city.');
  });
  $('btn-export').addEventListener('click', doExport);
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const res = importCityJson(await file.text());
    if (!res.ok) { toast(res.error); e.target.value = ''; return; }
    cityName = res.city.name || 'Imported city';
    unitState = res.city.units || 'studs';
    grid.setPlaced(res.city.placed);
    $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === unitState));
    refresh(); toast(`Loaded “${cityName}”.`); e.target.value = '';
  });

  // restore last autosaved city
  const last = currentCityName() && loadCity(currentCityName());
  if (last) { cityName = last.name; unitState = last.units || 'studs'; grid.setPlaced(last.placed); }
  refresh();
}
boot();
```

- [ ] **Step 2: Verify in browser (full loop)**

- Add sets → summary + grid dims update live.
- Unit toggle flips summary/dims between studs and cm.
- Save → reload page → city restored from autosave.
- Export → a `.json` downloads; New city → grid clears; Import that file → city returns.
- Import a garbage file → toast shows a clear error; current city untouched.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(app): full wiring — units, save/load, import/export, autosave"
```

---

## Task 19: Polish — placeholder images, empty states, meta credit

**Files:**
- Modify: `js/grid.js` (tile thumbnail + image-miss fallback), `js/app.js` (load `meta.json` build date into footer), `css/styles.css` (empty-state hint)

**Interfaces:**
- Tiles show a faint set thumbnail when `img` present; colored swatch (existing `.tile::before` stud texture) when absent. Empty grid shows a centered hint. Footer shows build date from `data/meta.json`.

DOM task — **verify in browser**.

- [ ] **Step 1: Add tile thumbnail** in `js/grid.js` `render()` — set a background image layer when `t.img`:

```js
if (t.img) {
  el.style.backgroundImage =
    `linear-gradient(${catColor(t.category)}cc, ${catColor(t.category)}cc), url("${t.img}")`;
  el.style.backgroundSize = 'cover';
  el.style.backgroundBlendMode = 'multiply';
}
```

- [ ] **Step 2: Empty-grid hint** — in `render()`, when `placed.length === 0`, show a hint:

```js
if (!placed.length) {
  board.innerHTML = `<div class="empty-hint">Add sets from the catalog to start your city →</div>`;
  return;
}
```

Add CSS:

```css
.empty-hint{position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-faint);
  font-size:14px;text-align:center;padding:24px}
```

- [ ] **Step 3: Footer build date** — in `js/app.js` `boot()`, after catalog loads:

```js
try {
  const meta = await (await fetch('data/meta.json')).json();
  const l = document.querySelector('.legal');
  l.insertAdjacentHTML('beforeend', `<br><span style="opacity:.7">Catalog snapshot: ${meta.built} · ${meta.counts.sets} sets</span>`);
} catch { /* non-fatal */ }
```

- [ ] **Step 4: Verify in browser**

Tiles with images show a tinted photo; without, the stud-textured swatch. Empty grid shows the hint. Footer shows the snapshot date + set count. Disclaimer still present verbatim.

- [ ] **Step 5: Commit**

```bash
git add js/grid.js js/app.js css/styles.css
git commit -m "feat(app): tile thumbnails, empty state, catalog meta"
```

---

## Task 20: Full verification pass

**Files:** none (verification + any fix commits)

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: all suites pass (csv, themes, footprint, category, record, units, geometry, storage, data, smoke).

- [ ] **Step 2: Manual smoke checklist** (serve, then in browser)

- [ ] Catalog loads real sets; search + each chip filter work.
- [ ] Add / move (snap) / rotate / resize / delete all work.
- [ ] Overlap warning appears and clears.
- [ ] Unit toggle (studs⇄cm) updates summary + grid dims.
- [ ] Save → reload restores; Export → New → Import round-trips.
- [ ] Invalid import shows a clear error without wiping the city.
- [ ] Image-missing sets show placeholder swatch.
- [ ] Light and dark themes both look correct.
- [ ] No console errors.

- [ ] **Step 3: Use the `/verify` skill** to drive the affected flow end-to-end; fix any issues found (commit fixes individually).

- [ ] **Step 4: Commit** (if fixes were made)

```bash
git commit -am "fix: verification-pass corrections"
```

---

## Task 21: Deploy to GitHub Pages + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`** with usage + dev + deploy sections

```markdown
## Develop
- `npm test` — run unit tests
- `npm run build:data` — regenerate `data/sets.json` + images from Rebrickable
- `npm run serve` — serve locally at http://localhost:8080 (ES modules need http)

## Deploy
Hosted on GitHub Pages from `main` (root). Push to deploy.
```

- [ ] **Step 2: Enable GitHub Pages**

Run: `gh api -X POST repos/larikhalil/brick-city-planner/pages -f "source[branch]=main" -f "source[path]=/" 2>/dev/null || gh api repos/larikhalil/brick-city-planner/pages`
Expected: Pages enabled; note the URL `https://larikhalil.github.io/brick-city-planner/`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Verify live**

Open `https://larikhalil.github.io/brick-city-planner/` (allow ~1 min for first build). Expected: app loads, catalog populates, planner works, disclaimer present.

- [ ] **Step 5: Commit** (README)

```bash
git add README.md
git commit -m "docs: usage + deploy instructions"
git push origin main
```

---

## Self-Review (completed by plan author)

**Spec coverage** — every spec section maps to a task:
- Data pipeline (§5) → Tasks 2–6. Data model (§6.1) → Task 6. Layout model (§6.2) → Task 9.
- App modules (§7): units→7, geometry→8, storage→9, data→10, catalog→12, grid→13–16, summary→17, app→18.
- Coordinate system/interaction (§8) → Tasks 7,8,13–16. Error handling (§9) → Tasks 6 (fetch retry, img miss), 9 (validate/storage), 12 (catalog load fail), 18 (import error), 19 (placeholder/empty).
- Legal (§10) → Task 11 (footer) + Global Constraints. Structure (§11) → all. Testing (§12) → Tasks 2–10,20. Deploy (§13) → Task 21.
- Deferred items (price, cm-derived, isometric, PNG) correctly **absent** from tasks.

**Placeholder scan** — no TBD/TODO; every code step shows complete code; CSS port references a real, complete mockup file.

**Type consistency** — checked across tasks: `footprint:{w,h,source}`, placed tile `{id,set_num,x,y,w,h,rot}`, `catColor(category)`, grid controller methods (`addSet/getPlaced/setPlaced/rotateSelected/deleteSelected/resizeSelected/setZoom/zoomBy/fit/select`), `renderCatalog(els,sets,{onAdd})`, `renderSummary(el,placed,byNum,unit)`, storage signatures — all consistent between definition and use.

**Known follow-ups (non-blocking):** verify modular 11371 footprint against a build review; curate more City-set footprints over time; add `sharp` thumbnailing only if `img/` grows large.
```
