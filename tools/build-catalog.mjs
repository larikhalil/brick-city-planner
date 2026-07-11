import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { parseCsv } from './lib/csv.mjs';
import { buildIncludedThemeIds } from './lib/themes.mjs';
import { resolveFootprint } from './lib/footprint.mjs';
import { categoryFor } from './lib/category.mjs';
import { buildSetRecord } from './record.mjs';

const SETS_URL = 'https://cdn.rebrickable.com/media/downloads/sets.csv.gz';
const THEMES_URL = 'https://cdn.rebrickable.com/media/downloads/themes.csv.gz';
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
  const ext = (url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
  const path = `img/sets/${setNum}.${ext}`;
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

  // Downloads images with bounded concurrency (pool of IMAGE_CONCURRENCY) instead of one-at-a-time,
  // to keep the run within CI/shell time limits. Output is identical in shape/content to the
  // sequential version: same records, same image paths, img:null on miss.
  const records = await mapWithConcurrency(chosen, IMAGE_CONCURRENCY, async (raw) => {
    const themeId = Number(raw.theme_id);
    const themeName = themeById.get(themeId)?.name || 'City';
    const root = rootLabel(themeId, themeById, ROOT_LABELS);
    const num = raw.set_num.replace(/-\d+$/, '');
    const isBaseplate = BASEPLATE_NUMS.has(num);
    const category = isBaseplate ? 'baseplate' : categoryFor(themeName, root, catMap);
    const footprint = isBaseplate
      ? { w: 32, h: 32, source: 'curated' }
      : resolveFootprint({ num, num_parts: Number(raw.num_parts), category }, curated);
    const img = await downloadImage(raw.img_url, raw.set_num);
    const rec = buildSetRecord(raw, { themeName, root, category, footprint, img });
    if (isBaseplate) { rec.ground = true; rec.color = baseplateColor(raw.name); }
    return rec;
  });

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
