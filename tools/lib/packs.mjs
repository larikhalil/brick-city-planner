// Round-1 feedback (items 3a/3b): accessory/bundle packs. From a pack's Rebrickable inventory we
// build (a) data/packs.json — the element-level contents (element id, part name, colour, qty, plan
// size) that drive the runtime Spare-parts panel and whole-pack buy math — and (b) one placeable
// catalog record per distinct content piece (kind 'decor'), so a builder can drop a single plant
// or street lamp on the grid and the app knows which pack supplies it.
// Pure functions (no fs/fetch) — unit-tested in test/packs.test.mjs.

// Plan-view stud size of a single part, from its name. Most accessory pieces are 1x1 plants/props;
// "NxM" in the name is the honest signal when present. Height-like third dims ("1 x 4 x 2") are
// ignored — the first two numbers are the plan.
export function partPlan(partName, partNum = '') {
  const name = partName || '';
  if (partNum === '69958' || String(partNum).startsWith('69958')) return { w: 16, h: 16 };
  const road = name.match(/^Baseplate Road (\d+) x (\d+)/i) || name.match(/^Baseplate (\d+) x (\d+)/i);
  if (road) return { w: Number(road[1]), h: Number(road[2]) };
  if (/^Train Track|^Track /i.test(name)) return { w: 16, h: 8 }; // one straight-ish rail segment
  const m = name.match(/(\d+)\s*x\s*(\d+)/);
  if (m) {
    const w = Math.min(Number(m[1]), 32), h = Math.min(Number(m[2]), 32);
    if (w >= 1 && h >= 1) return { w, h };
  }
  return { w: 1, h: 1 }; // minifig props, plants, animals — a stud each
}

// Which generic placeable piece (data/pieces.json id) a pack part satisfies, if any — this is how
// placing "Track — Straight" pieces rolls up into "buy N × 60205 Tracks" and leftovers become
// spare parts. Curve parts are chirality-free (one part serves Left and Right pieces).
export function suppliesFor(partName) {
  const n = (partName || '').toLowerCase();
  if (!/train.*track|track.*train|^track /.test(n) && !/baseplate road/.test(n)) return null;
  if (/ground throw|lever/.test(n)) return null; // switch LEVERS aren't switches
  if (/baseplate road/.test(n)) {
    if (/straight/.test(n)) return ['piece-road-straight'];
    if (/curve/.test(n)) return ['piece-road-curve-left', 'piece-road-curve-right'];
    if (/t[- ]?junction/.test(n)) return ['piece-road-tjunction'];
    if (/cross/.test(n)) return ['piece-road-cross'];
    return null;
  }
  if (/switch|point/.test(n)) {
    if (/left/.test(n)) return ['piece-track-switch-left'];
    if (/right/.test(n)) return ['piece-track-switch-right'];
    return ['piece-track-switch-left', 'piece-track-switch-right'];
  }
  if (/cross/.test(n)) return ['piece-track-cross'];
  if (/buffer/.test(n)) return ['piece-track-buffer-stop'];
  if (/curved|curve/.test(n)) return ['piece-track-curve-left', 'piece-track-curve-right'];
  if (/straight/.test(n)) return ['piece-track-straight'];
  return null;
}

// A stable, baseNum-proof set_num for a placeable pack element. Colons (not hyphens) keep
// pricing.js baseNum() from truncating it, and the 'piece-' prefix keeps the existing
// generic-piece guards (BrickLink XML skip, search-only buy links) correct for free.
export function elementSetNum(packNum, element) { return `piece-el:${packNum}:${element}`; }

// Build one pack's data/packs.json entry + its placeable element records.
//   packRecord: the pack's own catalog record ({ num, set_num, name, year, img, retired })
//   rows: joined inventory rows [{ partNum, partName, partCatId, colorId, colorName, colorRgb,
//         quantity, isSpare, imgUrl, element }] (element = LEGO element id string or null)
export function buildPack(packRecord, rows) {
  const contents = [];
  const byKey = new Map(); // part:color → merged row (inventories sometimes split the same part)
  for (const r of rows) {
    if (r.isSpare) continue; // official spare studs aren't part of the designed contents
    const key = `${r.partNum}:${r.colorId}`;
    const qty = Number(r.quantity) || 0;
    if (byKey.has(key)) { byKey.get(key).qty += qty; continue; }
    const plan = partPlan(r.partName, r.partNum);
    const entry = {
      element: r.element || null,
      part: r.partNum,
      name: r.partName,
      color: r.colorName,
      rgb: r.colorRgb || null,
      qty,
      w: plan.w,
      h: plan.h,
      img: r.imgUrl || null,
    };
    const supplies = suppliesFor(r.partName);
    if (supplies) entry.supplies = supplies;
    byKey.set(key, entry);
    contents.push(entry);
  }
  contents.sort((a, b) => (b.qty - a.qty) || a.name.localeCompare(b.name));
  return {
    num: packRecord.num,
    set_num: packRecord.set_num,
    name: packRecord.name,
    year: packRecord.year,
    retired: !!packRecord.retired,
    img: packRecord.img || null,
    contents,
  };
}

// Placeable catalog records for a pack's contents. Track/road parts that map onto the existing
// generic pieces are SKIPPED (the pieces already exist; duplicating them as decor would fork the
// snapping/geometry). Everything else becomes a 1-per-element 'decor' record — except modern
// 16x16 road plates (part 69958), which place as real road (ground) tiles.
// `img` starts as the REMOTE part-photo url; the build step downloads it and swaps in the local
// thumbnail path.
export function elementRecords(pack, contentImg = new Map()) {
  const out = [];
  for (const c of pack.contents) {
    if (c.supplies) continue;
    const id = c.element || `${c.part}-${(c.color || '').replace(/\W+/g, '').toLowerCase()}`;
    const isRoadPlate = String(c.part).startsWith('69958');
    const rec = {
      set_num: elementSetNum(pack.num, id),
      num: c.element || c.part,
      name: `${c.name} (${c.color})`,
      year: pack.year,
      theme_id: 0,
      theme: pack.name,
      root: 'City',
      category: isRoadPlate ? 'road' : 'pack',
      pieces: 1,
      img: contentImg.get(c) ?? null,
      footprint: { w: c.w, h: c.h, source: 'curated' },
      kind: isRoadPlate ? 'road' : 'decor',
      layer: isRoadPlate ? 1 : 2,
      retired: !!pack.retired,
      pack: pack.num,
      part: c.part,
      element: c.element || null,
    };
    if (isRoadPlate) rec.color = 'var(--road)';
    out.push(rec);
  }
  return out;
}
