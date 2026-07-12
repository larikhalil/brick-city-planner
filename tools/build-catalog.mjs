import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { parseCsv } from './lib/csv.mjs';
import { buildIncludedThemeIds } from './lib/themes.mjs';
import { resolveFootprint, estimateFootprint } from './lib/footprint.mjs';
import { categoryFor } from './lib/category.mjs';
import { collectSignal, emptySignal, deriveFootprint, plateFloor } from './lib/derive.mjs';
import { resolveRetired, indexAvailability } from './lib/availability.mjs';
import { buildPack, elementRecords } from './lib/packs.mjs';
import { buildSetRecord } from './record.mjs';

const DL = 'https://cdn.rebrickable.com/media/downloads/';
const SETS_URL = `${DL}sets.csv.gz`;
const THEMES_URL = `${DL}themes.csv.gz`;
// Inventory-side bulk files (round-1 feedback: derived footprints + pack contents). Cached in
// tools/.cache because inventory_parts is ~14 MB — delete the cache to force a refresh.
const INVENTORY_FILES = ['inventories', 'inventory_parts', 'parts', 'colors', 'elements'];
const CACHE_DIR = 'tools/.cache';
const MIN_PARTS = 5;
const IMAGE_CONCURRENCY = 12; // controller-authorized: bounded-concurrency pool instead of strictly sequential downloads
const THUMB_SIZE = 256; // fit within THUMB_SIZE x THUMB_SIZE, no enlargement

// LEGO Classic 32x32 baseplates — the "ground" of a city. They live in the Classic
// theme (which we otherwise exclude, as it's mostly generic brick boxes), so we pull
// these specific set numbers by allowlist and tag them as ground tiles.
const BASEPLATE_NUMS = new Set(['10699', '10700', '10701', '10714', '11010', '11023', '11024', '11025', '11026']);

function baseplateColor(name) {
  const n = name.toLowerCase();
  if (n.includes('green')) return 'var(--g-green)';
  if (n.includes('blue')) return 'var(--g-blue)';
  if (n.includes('gray') || n.includes('grey')) return 'var(--g-gray)';
  if (n.includes('sand')) return 'var(--g-sand)';
  if (n.includes('white')) return 'var(--g-white)';
  return 'var(--g-gray)';
}

// Road-plate / train-track infrastructure. These sets are only 2-4 pieces, so they'd
// be dropped by MIN_PARTS — we keep them (in included themes) because they're the
// streets and rails a city planner needs.
const INFRA_RE = /road plates?|road baseplate|t-junction|crossroad|cross[- ]?road|straight (and|&|road)|curve (and|&)|curved road|straight rails?|curved rails?|straight track|curved track|switch tracks?|train tracks?|level crossing|flexible.*track|\btracks?\b|\brails\b/i;
const ROAD_RE = /road plate|road baseplate|cross[- ]?road|t-?junction|straight (and|&) (t-|crossroad)|curve (and|&) crossroad/i;
const TRACK_RE = /train track|\brails?\b|switch track|level crossing|crossover|flexible (track|rail)|straight (track|rails)|curved (track|rails)|monorail|points \(switch|\btracks?\b/i;
const PARK_RE = /\bpark\b|garden|playground|fountain|plaza|botanic/i;
const BUILDING_RE = /police|fire|hospital|station|store|shop|\bhouse\b|hotel|bank|market|hall|office|garage|restaurant|cafe|café|cinema|museum|school|library|headquarters|\bhq\b|apartment|building|tower|\bcenter\b|\bcentre\b|barn|warehouse|factory|prison|jail|academy|diner|bakery|pizzeria|dealership|depot|terminal|arena|stadium|lighthouse|windmill|castle|temple|church|firehouse/i;
const VEHICLE_RE = /\bcar\b|truck|\bvan\b|bike|motorcycle|helicopter|\bplane\b|airplane|\bboat\b|\bship\b|\bbus\b|\btram\b|buggy|racer|racing|\batv\b|quad|\bjet\b|chopper|ambulance|dozer|excavator|loader|crane|mixer|tractor|forklift|speedboat|submarine|\brover\b|drone|scooter|kart|\bcart\b|wagon|dump|hauler|transporter|\btrain\b|locomotive|patrol|cruiser|\bunit\b/i;

// Classify a set into a shape 'kind' and stacking 'layer' (0 baseplate, 1 road/track, 2 building).
function classify(name, category, isBaseplate) {
  const n = (name || '').toLowerCase();
  if (isBaseplate) return { kind: 'baseplate', layer: 0 };
  if (ROAD_RE.test(n)) return { kind: 'road', layer: 1 };
  // "track"/"rails" is also used by race/ramp/off-road vehicle sets — exclude those.
  if (TRACK_RE.test(n) && !/race|ramp|off[- ]?road|stunt|monster/.test(n)) return { kind: 'track', layer: 1 };
  if (PARK_RE.test(n) || category === 'park') return { kind: 'park', layer: 2 };
  if (BUILDING_RE.test(n) || category === 'modular') return { kind: 'building', layer: 2 };
  if (VEHICLE_RE.test(n)) return { kind: 'vehicle', layer: 2 };
  return { kind: 'generic', layer: 2 };
}

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

// Same, but keep the .gz on disk (tools/.cache) so re-runs skip the download — the inventory
// files are big and change rarely. Delete tools/.cache to force a refresh.
async function fetchCsvGzCached(name) {
  const path = `${CACHE_DIR}/${name}.csv.gz`;
  if (existsSync(path)) return parseCsv(gunzipSync(await readFile(path)).toString('utf8'));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${DL}${name}.csv.gz`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(path, buf);
      return parseCsv(gunzipSync(buf).toString('utf8'));
    } catch (e) {
      console.warn(`fetch ${name}.csv.gz attempt ${attempt} failed: ${e.message}`);
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

async function downloadImage(url, setNum, dir = 'img/sets') {
  if (!url) return null;
  const ext = (url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const path = `${dir}/${setNum}.${ext}`;
  // Incremental: keep already-downloaded (already-thumbnailed) images so re-runs only
  // fetch new sets. Delete img/sets to force a full refresh.
  if (existsSync(path)) return path;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    // Thumbnail to fit within THUMB_SIZE x THUMB_SIZE (no enlargement of smaller
    // source images); the output encoder is chosen from the destination extension.
    const thumb = await sharp(bytes)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    await writeFile(path, thumb);
    return path;
  } catch {
    return null;
  }
}

// Run `worker(item, index)` over `items` with at most `limit` in flight at once.
// Results are returned in the same order as `items` (order-preserving, like Promise.all).
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(runners);
  return results;
}

async function main() {
  await mkdir('img/sets', { recursive: true });
  await mkdir('img/parts', { recursive: true });
  await mkdir('data', { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const include = JSON.parse(await readFile('tools/themes.include.json', 'utf8'));
  const curated = JSON.parse(await readFile('tools/footprints.json', 'utf8'));
  const catMap = JSON.parse(await readFile('tools/category-map.json', 'utf8'));
  const availability = indexAvailability(JSON.parse(await readFile('tools/availability.json', 'utf8')));
  const packsInclude = JSON.parse(await readFile('tools/packs.include.json', 'utf8')).packs;
  const ROOT_LABELS = { 52: 'City', 50: 'Town', 233: 'Trains', 155: 'Modular' };

  console.log('Downloading Rebrickable catalog…');
  const [themeRows, setRows] = await Promise.all([fetchCsvGz(THEMES_URL), fetchCsvGz(SETS_URL)]);
  const themeById = new Map(themeRows.map((t) => [Number(t.id), t]));
  const includedIds = buildIncludedThemeIds(themeRows, include.roots);

  const chosen = setRows.filter((s) => {
    if (!includedIds.has(Number(s.theme_id))) return false;
    if (Number(s.num_parts) >= MIN_PARTS) return true;
    return INFRA_RE.test(s.name); // keep small road/track infrastructure sets
  });
  console.log(`Filtered ${chosen.length} sets from ${setRows.length}.`);

  // Add allowlisted baseplates (ground tiles) even though their Classic theme is excluded.
  const chosenNums = new Set(chosen.map((s) => s.set_num));
  let baseplateCount = 0;
  for (const s of setRows) {
    const base = s.set_num.replace(/-\d+$/, '');
    if (BASEPLATE_NUMS.has(base) && !chosenNums.has(s.set_num)) {
      chosen.push(s); chosenNums.add(s.set_num); baseplateCount++;
    }
  }
  console.log(`+ ${baseplateCount} baseplates.`);

  // Round-1 feedback 3a: pull the accessory/bundle packs (xtra, VIP add-ons, track/road packs)
  // in by allowlist — most live in themes the catalog otherwise excludes.
  const PACK_NUMS = new Set(packsInclude);
  let packCount = 0;
  for (const s of setRows) {
    const base = s.set_num.replace(/-\d+$/, '');
    if (PACK_NUMS.has(base) && !chosenNums.has(s.set_num) && /-1$/.test(s.set_num)) {
      chosen.push(s); chosenNums.add(s.set_num); packCount++;
    }
  }
  console.log(`+ ${packCount} accessory/bundle packs.`);

  // ---- Inventory join (round-1 feedback 3b + 4): per-set footprint signals + pack contents ----
  console.log('Downloading Rebrickable inventories (cached in tools/.cache)…');
  const [invRows, invPartRows, partRows, colorRows, elementRows] = [
    await fetchCsvGzCached('inventories'),
    await fetchCsvGzCached('inventory_parts'),
    await fetchCsvGzCached('parts'),
    await fetchCsvGzCached('colors'),
    await fetchCsvGzCached('elements'),
  ];
  // latest inventory version per chosen set
  const invBySet = new Map();
  for (const inv of invRows) {
    if (!chosenNums.has(inv.set_num)) continue;
    const cur = invBySet.get(inv.set_num);
    if (!cur || Number(inv.version) > Number(cur.version)) invBySet.set(inv.set_num, inv);
  }
  const setByInvId = new Map([...invBySet.values()].map((i) => [i.id, i.set_num]));
  const partByNum = new Map(partRows.map((p) => [p.part_num, p]));
  const colorById = new Map(colorRows.map((c) => [c.id, c]));
  // part+color → LEGO element id (newest id wins — that's what current instructions print)
  const elementByKey = new Map();
  for (const e of elementRows) {
    const key = `${e.part_num}:${e.color_id}`;
    const prev = elementByKey.get(key);
    if (!prev || Number(e.element_id) > Number(prev)) elementByKey.set(key, e.element_id);
  }
  // one signal bag per set + raw content rows for the packs
  const signals = new Map(); // set_num → derive.mjs signal
  const packRows = new Map(); // pack set_num → joined content rows
  const packSetNums = new Set([...PACK_NUMS].map((n) => `${n}-1`));
  for (const ip of invPartRows) {
    const setNum = setByInvId.get(ip.inventory_id);
    if (!setNum) continue;
    const part = partByNum.get(ip.part_num);
    if (!part) continue;
    if (ip.is_spare !== 'True') {
      let sig = signals.get(setNum);
      if (!sig) { sig = emptySignal(); signals.set(setNum, sig); }
      collectSignal(sig, { partNum: ip.part_num, partName: part.name, partCatId: part.part_cat_id, quantity: ip.quantity });
    }
    if (packSetNums.has(setNum)) {
      const color = colorById.get(ip.color_id);
      let rows = packRows.get(setNum);
      if (!rows) { rows = []; packRows.set(setNum, rows); }
      rows.push({
        partNum: ip.part_num, partName: part.name, partCatId: part.part_cat_id,
        colorId: ip.color_id, colorName: color?.name || 'Unknown', colorRgb: color?.rgb || null,
        quantity: ip.quantity, isSpare: ip.is_spare === 'True',
        imgUrl: ip.img_url || null,
        element: elementByKey.get(`${ip.part_num}:${ip.color_id}`) || null,
      });
    }
  }
  console.log(`Inventories joined: ${signals.size} sets with signals, ${packRows.size} packs with contents.`);

  // Downloads images with bounded concurrency (pool of IMAGE_CONCURRENCY) instead of one-at-a-time,
  // to keep the run within CI/shell time limits. Output is identical in shape/content to the
  // sequential version: same records, same image paths, img:null on miss.
  // Footprint precedence (round-1 feedback 4): curated (researched real sizes) → derived from the
  // inventory (baseplates / road plates / train & vehicle bases) → piece-count estimate, raised to
  // at least the largest plate the set stands on. Only true estimates keep the '≈' treatment.
  function footprintFor(raw, num, cls, themeCategory) {
    if (curated[num]) return { ...curated[num], source: 'curated' };
    if (cls.kind === 'baseplate') return { w: 32, h: 32, source: 'curated' }; // allowlisted classics default
    if (cls.kind === 'road') return { w: 32, h: 32, source: 'curated' };
    if (cls.kind === 'track') return { w: 8, h: 32, source: 'curated' };
    const sig = signals.get(raw.set_num);
    const derived = deriveFootprint(sig, { kind: cls.kind });
    if (derived) return { ...derived, source: 'derived' };
    const est = estimateFootprint({ num_parts: Number(raw.num_parts), category: themeCategory });
    const floor = plateFloor(sig);
    if (floor && floor.w * floor.h > est.w * est.h) return { ...floor, source: 'derived' };
    return { ...est, source: 'estimated' };
  }

  const records = await mapWithConcurrency(chosen, IMAGE_CONCURRENCY, async (raw) => {
    const themeId = Number(raw.theme_id);
    const themeName = themeById.get(themeId)?.name || 'City';
    const root = rootLabel(themeId, themeById, ROOT_LABELS);
    const num = raw.set_num.replace(/-\d+$/, '');
    const isBaseplate = BASEPLATE_NUMS.has(num);
    const isPack = PACK_NUMS.has(num);
    const themeCategory = categoryFor(themeName, root, catMap);
    const cls = classify(raw.name, themeCategory, isBaseplate);
    // Infrastructure uses its shape as the filter category; accessory packs (that aren't already
    // road/track products) get their own 'pack' category; others keep the theme category.
    const category = (cls.kind === 'baseplate' || cls.kind === 'road' || cls.kind === 'track')
      ? cls.kind : (isPack ? 'pack' : themeCategory);
    const footprint = footprintFor(raw, num, cls, themeCategory);
    const retired = resolveRetired(num, Number(raw.year), availability);
    const img = await downloadImage(raw.img_url, raw.set_num);
    const rec = buildSetRecord(raw, { themeName, root, category, footprint, img, retired });
    rec.kind = cls.kind;
    rec.layer = cls.layer;
    if (isBaseplate) rec.color = baseplateColor(raw.name);
    else if (cls.kind === 'road') rec.color = 'var(--road)';
    else if (cls.kind === 'track') rec.color = 'var(--track)';
    else if (cls.kind === 'park') rec.color = 'var(--t-park)';
    return rec;
  });

  records.sort((a, b) => (b.year - a.year) || a.name.localeCompare(b.name));

  // ---- Round-1 feedback 3a/3b: data/packs.json + placeable element records -------------------
  const recordByNum = new Map(records.map((r) => [r.num, r]));
  const packs = {};
  const elementRecs = [];
  for (const packNum of packsInclude) {
    const packRecord = recordByNum.get(packNum);
    const rows = packRows.get(`${packNum}-1`);
    if (!packRecord || !rows || !rows.length) {
      console.warn(`pack ${packNum}: ${packRecord ? 'no inventory rows' : 'not in the catalog'} — skipped`);
      continue;
    }
    const pack = buildPack(packRecord, rows);
    packs[packNum] = pack;
    // emit a placeable record per content piece, downloading its part photo as the thumbnail
    const contentImg = new Map(pack.contents.map((c) => [c, c.img]));
    const recs = elementRecords(pack, contentImg);
    for (const rec of recs) {
      if (rec.img) rec.img = await downloadImage(rec.img, `${pack.num}-${rec.num}`.replace(/[^\w.-]+/g, '_'), 'img/parts');
      elementRecs.push(rec);
    }
  }
  // strip the bulky img urls out of packs.json (the records carry the local thumbs)
  for (const p of Object.values(packs)) for (const c of p.contents) delete c.img;
  records.push(...elementRecs); // appended AFTER the year sort so real sets keep leading the catalog

  await writeFile('data/packs.json', JSON.stringify(packs));
  console.log(`Wrote data/packs.json (${Object.keys(packs).length} packs, ${elementRecs.length} placeable elements).`);

  await writeFile('data/sets.json', JSON.stringify(records));
  await writeFile('data/meta.json', JSON.stringify({
    built: new Date().toISOString().slice(0, 10),
    source: 'Rebrickable bulk downloads',
    counts: { sets: records.length, packs: Object.keys(packs).length },
    attribution: 'Set data & imagery sourced from Rebrickable.',
  }, null, 2));
  console.log(`Wrote data/sets.json (${records.length} records).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
