import { loadCatalog } from './data.js';
import { renderCatalog, catColor } from './catalog.js';
import { createGrid } from './grid.js';
import { renderSummary } from './summary.js';
import {
  serializeCity, validateCity, saveCity, loadCity, currentCityName, importCityJson, exportCityJson,
  loadCities, deleteCity, renameCity,
} from './storage.js';
import { encodeCity, decodeCity } from './share.js';
import { fmtDims } from './units.js';
import { bbox } from './geometry.js';
import { resolvePrice, baseNum, bricklinkXml, setListCsv, buyLinks } from './pricing.js';
import { pushRecent } from './lists.js';
import { esc } from './util.js';
import { TERRAIN_TYPES, isCitySet } from './objects.js';

const $ = (id) => document.getElementById(id);
let unitState = 'studs';
let cityName = 'Untitled city';
let gridSize = { w: 128, h: 96, pw: 4, ph: 3 };
let catalog, grid, catalogUI;
let prices = {}; // real MSRPs from data/prices.json (keyed by bare set number)
let templates = []; // curated starter cities from data/templates.json (QOL-6)
let sharedCity = null; // decoded+validated payload from a '#d=' share link, pending user confirm (QOL-5b)

// ---- Ownership + price overrides: app/localStorage state, OUTSIDE placed[]/undo -------------
// 'bcp.owned'  — a set of bare set numbers the user already owns (excluded from buy cost + exports)
// 'bcp.prices' — per-set manual USD price overrides { [bareNum]: number }
const OWNED_KEY = 'bcp.owned', OVERRIDES_KEY = 'bcp.prices';
let owned = new Set();
let overrides = {};
function loadOwned() {
  try { const a = JSON.parse(localStorage.getItem(OWNED_KEY)); owned = new Set(Array.isArray(a) ? a : []); }
  catch { owned = new Set(); }
}
function saveOwned() {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify([...owned])); }
  catch (e) { console.warn('Could not save owned list:', e.message); }
}
function loadOverrides() {
  try { const o = JSON.parse(localStorage.getItem(OVERRIDES_KEY)); overrides = (o && typeof o === 'object') ? o : {}; }
  catch { overrides = {}; }
}
function saveOverrides() {
  try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)); }
  catch (e) { console.warn('Could not save price overrides:', e.message); }
}
// Prompt for a manual USD price for a set (blank/0 clears it, falling back to MSRP or the estimate).
function setPriceOverride(setNum) {
  const n = baseNum(setNum);
  const cur = overrides[n] != null ? String(overrides[n]) : '';
  const input = prompt(`Your price for set ${n} (USD). Leave blank to clear.`, cur);
  if (input === null) return; // cancelled
  const trimmed = input.trim();
  if (trimmed === '') { delete overrides[n]; }
  else {
    const v = parseFloat(trimmed);
    if (!Number.isFinite(v) || v < 0) { toast('Enter a positive number, or leave blank to clear.'); return; }
    overrides[n] = Math.round(v * 100) / 100;
  }
  saveOverrides();
  drawSummary();
  toast(overrides[n] != null ? `Price set: $${overrides[n]}` : 'Price override cleared.');
}
const isOwned = (setNum) => owned.has(baseNum(setNum));
// Flip a set's owned flag; persist and refresh both the summary and the catalog stars.
function toggleOwned(setNum) {
  const n = baseNum(setNum);
  if (owned.has(n)) owned.delete(n); else owned.add(n);
  saveOwned();
  drawSummary();
  catalogUI?.refresh();
  return owned.has(n);
}

// ---- QOL-7 / PLAN-6: favorites, wishlist + recently-placed rail — app/localStorage state,
// OUTSIDE placed[]/undo. Three separate star-ish affordances, kept unambiguous on purpose:
//   'bcp.owned'      ☆/★ — sets you already own (see above; excluded from buy cost)
//   'bcp.favorites'  ♡/♥ — quick re-place pins shown in the rail above the catalog list
//   'bcp.wishlist'   🛒  — saved-to-buy-later, its own subtotal in the summary panel
//   'bcp.recent'     (no toggle) — last ~8 distinct sets placed on the grid, newest first
// All keyed by the catalog's full set_num (e.g. '60316-1'), not the bare number — these are
// catalog-row concerns, not "do I own any variant of this set" like 'owned' is.
const FAV_KEY = 'bcp.favorites', WISH_KEY = 'bcp.wishlist', RECENT_KEY = 'bcp.recent';
const MAX_RECENT = 8;
let favorites = new Set();
let wishlist = new Set();
let recent = [];
function loadFavorites() {
  try { const a = JSON.parse(localStorage.getItem(FAV_KEY)); favorites = new Set(Array.isArray(a) ? a : []); }
  catch { favorites = new Set(); }
}
function saveFavorites() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...favorites])); }
  catch (e) { console.warn('Could not save favorites:', e.message); }
}
function loadWishlist() {
  try { const a = JSON.parse(localStorage.getItem(WISH_KEY)); wishlist = new Set(Array.isArray(a) ? a : []); }
  catch { wishlist = new Set(); }
}
function saveWishlist() {
  try { localStorage.setItem(WISH_KEY, JSON.stringify([...wishlist])); }
  catch (e) { console.warn('Could not save wishlist:', e.message); }
}
function loadRecent() {
  try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); recent = Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; }
  catch { recent = []; }
}
function saveRecent() {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); }
  catch (e) { console.warn('Could not save recent list:', e.message); }
}
const isFavorite = (setNum) => favorites.has(setNum);
const isWishlisted = (setNum) => wishlist.has(setNum);
const getFavorites = () => [...favorites];
const getRecent = () => recent.slice();
// Favoriting only affects the rail above the catalog — no summary impact, so a cheap rail-only
// redraw is all that's needed (keeps catalog scroll/search state untouched).
function toggleFavorite(setNum) {
  if (favorites.has(setNum)) favorites.delete(setNum); else favorites.add(setNum);
  saveFavorites();
  catalogUI?.refreshRail();
  return favorites.has(setNum);
}
// Wishlisting shows up in the summary panel's own subtotal, and every catalog row needs its
// 🛒 button kept in sync (toggled from either the row itself or the summary's ✕) — same
// full-refresh treatment as toggleOwned above.
function toggleWishlist(setNum) {
  if (wishlist.has(setNum)) wishlist.delete(setNum); else wishlist.add(setNum);
  saveWishlist();
  drawSummary();
  catalogUI?.refresh();
  return wishlist.has(setNum);
}
// "Place on grid" from the wishlist panel — adds a copy, same path as every other placement.
// Deliberately does NOT remove the wishlist entry: you may want several of the same set.
function promoteWishlist(setNum) {
  const set = catalog?.byNum?.get(setNum);
  if (!set) { toast('That set is no longer in the catalog.'); return; }
  placeSet(set);
  toast(`Placed “${set.name}” on the grid.`);
}
// Every placement (catalog ＋ button, drag-drop, or a rail click) funnels through here so the
// "recently used" rail always reflects reality.
function placeSet(set, clientX, clientY) {
  if (clientX == null) grid.addSet(set); else grid.addSetAt(set, clientX, clientY);
  recent = pushRecent(recent, set.set_num, MAX_RECENT);
  saveRecent();
  catalogUI?.refreshRail();
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---- ACC-4: ARIA live region for granular editing events -------------------------------------
// A tiny FIFO queue: two announcements landing in the same tick (e.g. "placed" immediately
// followed by an overlap check finding a clash) mustn't stomp each other before a screen reader
// gets to read the first one, so each message gets its own beat before the next is written.
let announceQueue = [];
let announceBusy = false;
function pumpAnnounce() {
  if (announceBusy || !announceQueue.length) return;
  announceBusy = true;
  const el = $('sr-announcer');
  const msg = announceQueue.shift();
  if (el) {
    // Clear first, then set on the next frame — some screen readers won't re-announce identical
    // text written straight over itself (e.g. two consecutive "Deleted 1 item." in a row).
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = msg; });
  }
  setTimeout(() => { announceBusy = false; pumpAnnounce(); }, 350);
}
function announce(msg) {
  if (!msg) return;
  announceQueue.push(msg);
  pumpAnnounce();
}

// ---- UI-3: dark-mode toggle --------------------------------------------------------------------
// No stored choice → follow the OS live (css/styles.css's plain `@media (prefers-color-scheme)`
// block does that on its own); an explicit toggle stamps data-theme on <html> and persists it.
// See the inline <head> script in index.html for the pre-paint stamp that avoids a flash.
const THEME_KEY = 'bcp.theme';
function getStoredTheme() {
  try { const t = localStorage.getItem(THEME_KEY); return (t === 'dark' || t === 'light') ? t : null; }
  catch { return null; }
}
function effectiveTheme() {
  const stored = getStoredTheme();
  if (stored) return stored;
  try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}
function syncThemeButton() {
  const btn = $('btn-theme'); if (!btn) return;
  const isDark = effectiveTheme() === 'dark';
  btn.textContent = isDark ? '☀' : '🌙';
  btn.setAttribute('aria-pressed', String(isDark));
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  btn.title = label; btn.setAttribute('aria-label', label);
}
function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { console.warn('Could not save theme:', e.message); }
  document.documentElement.setAttribute('data-theme', next);
  syncThemeButton();
  toast(next === 'dark' ? 'Dark mode on.' : 'Light mode on.');
}

// ---- ACC-2c: colorblind-safe theme toggle -------------------------------------------------------
const CBSAFE_KEY = 'bcp.cbSafe';
function getCbSafe() { try { return localStorage.getItem(CBSAFE_KEY) === '1'; } catch { return false; } }
function syncCbSafeButton(on) {
  const btn = $('btn-cbsafe'); if (!btn) return;
  btn.setAttribute('aria-pressed', String(on));
  const label = on ? 'Turn off colorblind-safe patterns' : 'Turn on colorblind-safe patterns';
  btn.title = label; btn.setAttribute('aria-label', label);
}
function applyCbSafe(on) {
  if (on) document.documentElement.setAttribute('data-cbsafe', 'true');
  else document.documentElement.removeAttribute('data-cbsafe');
  syncCbSafeButton(on);
}
function toggleCbSafe() {
  const next = !getCbSafe();
  try { localStorage.setItem(CBSAFE_KEY, next ? '1' : '0'); } catch (e) { console.warn('Could not save colorblind-safe setting:', e.message); }
  applyCbSafe(next);
  toast(next ? 'Colorblind-safe patterns on.' : 'Colorblind-safe patterns off.');
}

// ---- QOL-9: autosave status pill --------------------------------------------
function setSaveStatus(saving) {
  const el = $('save-status');
  if (!el) return;
  el.classList.toggle('saving', saving);
  el.querySelector('.lbl').textContent = saving ? 'Saving…' : 'All changes saved';
}

// The current city as a plain object for saving/exporting (includes the table size).
function citySnapshot() {
  const g = grid.getGrid();
  return { name: cityName, units: unitState, placed: grid.getPlaced(), grid: { w: g.w, h: g.h } };
}
// Reflect the canvas size in the toolbar: baseplate steppers + a studs/cm readout.
function drawGridSize() {
  $('gs-w').textContent = gridSize.pw;
  $('gs-h').textContent = gridSize.ph;
  $('canvas-size').textContent = `Canvas ${fmtDims(gridSize.w, gridSize.h, unitState)}`;
}

let saveTimer = null;
function autosave() {
  setSaveStatus(true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCity(serializeCity(citySnapshot()));
    setSaveStatus(false);
  }, 600);
}
function flushAutosave() {
  clearTimeout(saveTimer);
  saveCity(serializeCity(citySnapshot()));
  setSaveStatus(false);
}

// ---- UI-1: first-run guided empty state -------------------------------------
const FIRST_RUN_KEY = 'bcp.firstRunSeen';
function updateFirstRun() {
  const el = $('first-run');
  if (!el || !grid) return;
  const seen = sessionStorage.getItem(FIRST_RUN_KEY) === '1';
  const empty = grid.getPlaced().length === 0;
  const show = empty && !seen;
  el.hidden = !show;
  $('catalog-search')?.closest('.search')?.classList.toggle('pulse', show);
}
// Dismissed by the ✕, by loading the sample city, or automatically once a tile is placed —
// and never shown again for the rest of this browser session.
function dismissFirstRun() {
  try { sessionStorage.setItem(FIRST_RUN_KEY, '1'); } catch { /* private browsing, ignore */ }
  updateFirstRun();
}
// A tiny hardcoded starter city: one baseplate, two straight roads snapped end-to-end, and a
// building — just enough to show how sets connect together.
function buildSampleCity() {
  const building = catalog?.sets?.find((s) => s.kind === 'building' && s.footprint.w <= 32 && s.footprint.h <= 32);
  const tiles = [
    { id: 'p1', set_num: 'sample-baseplate', name: 'Baseplate', category: 'baseplate', kind: 'baseplate',
      x: 0, y: 0, w: 64, h: 96, rot: 0, approx: false, img: null, layer: 0, z: 0, color: 'var(--g-green)' },
    { id: 'p2', set_num: 'piece-road-straight', name: 'Road — Straight', category: 'road', kind: 'road',
      x: 0, y: 0, w: 32, h: 32, rot: 0, approx: false, img: null, layer: 1, z: 1, color: 'var(--road)' },
    { id: 'p3', set_num: 'piece-road-straight', name: 'Road — Straight', category: 'road', kind: 'road',
      x: 32, y: 0, w: 32, h: 32, rot: 0, approx: false, img: null, layer: 1, z: 1, color: 'var(--road)' },
  ];
  tiles.push(building
    ? { id: 'p4', set_num: building.set_num, name: building.name, category: building.category, kind: building.kind,
        x: 4, y: 36, w: building.footprint.w, h: building.footprint.h, rot: 0,
        approx: building.footprint.source !== 'curated', img: building.img || null,
        layer: building.layer ?? 2, z: building.layer ?? 2, color: building.color || null }
    : { id: 'p4', set_num: 'sample-building', name: 'City Building', category: 'city', kind: 'building',
        x: 4, y: 36, w: 16, h: 16, rot: 0, approx: false, img: null, layer: 2, z: 2, color: null });
  return tiles;
}
function loadSampleCity() {
  cityName = 'Sample city';
  grid.setPlaced(buildSampleCity());
  refresh();
  autosave();
  dismissFirstRun();
  toast('Loaded a sample city.');
}

// ---- UI-2: shortcuts & gestures modal ----------------------------------------
function openShortcuts() {
  $('shortcuts-backdrop').hidden = false;
  $('btn-help')?.setAttribute('aria-expanded', 'true');
  $('shortcuts-close')?.focus();
}
function closeShortcuts() {
  $('shortcuts-backdrop').hidden = true;
  $('btn-help')?.setAttribute('aria-expanded', 'false');
  $('btn-help')?.focus();
}
function toggleShortcuts() { $('shortcuts-backdrop').hidden ? openShortcuts() : closeShortcuts(); }

function drawSummary() {
  renderSummary($('summary'), grid.getPlaced(), catalog.byNum, unitState,
    { prices, owned, overrides, onToggleOwn: toggleOwned, onSetPrice: setPriceOverride,
      wishlist, onPromoteWishlist: promoteWishlist, onRemoveWishlist: toggleWishlist });
  wireSummaryButtons();
}
function drawDims() {
  const b = bbox(grid.getPlaced());
  $('grid-dims').textContent = b.w ? fmtDims(b.w, b.h, unitState) : 'empty';
}
function refresh() { drawSummary(); drawDims(); drawGridSize(); updateFirstRun(); drawCityLabel(); }
// ---- QOL-5c: keep the topbar's current-city label in sync ---------------------
function drawCityLabel() {
  const el = $('city-name-text');
  if (el) el.textContent = cityName;
}

// Reflect undo/redo availability on the toolbar and rebuild the history dropdown.
function drawHistory() {
  const u = $('btn-undo'), r = $('btn-redo'), h = $('btn-history');
  if (!u || !grid) return; // onHistory can fire during grid init, before `grid` is assigned
  u.disabled = !grid.canUndo();
  r.disabled = !grid.canRedo();
  const { entries } = grid.getHistory();
  h.disabled = entries.length <= 1;
  if (!$('history-menu').hidden) buildHistoryMenu();
}
function buildHistoryMenu() {
  const menu = $('history-menu');
  const { entries, index } = grid.getHistory();
  menu.textContent = '';
  // newest first, so the current and recent states sit at the top
  for (let i = entries.length - 1; i >= 0; i--) {
    const b = document.createElement('button');
    b.className = 'hist-item' + (i === index ? ' on' : '');
    b.setAttribute('role', 'menuitem');
    b.textContent = entries[i];
    b.addEventListener('click', () => { grid.jumpHistory(i); closeHistoryMenu(); });
    menu.appendChild(b);
  }
}
function openHistoryMenu() {
  buildHistoryMenu();
  $('history-menu').hidden = false;
  $('btn-history').setAttribute('aria-expanded', 'true');
}
function closeHistoryMenu() {
  $('history-menu').hidden = true;
  $('btn-history').setAttribute('aria-expanded', 'false');
}

// Show the align/distribute/group bar only when a multi-selection is live.
function drawSelection(ids = []) {
  const bar = $('align-bar');
  if (!bar) return;
  bar.hidden = ids.length < 2;
  if (!bar.hidden) {
    $('ab-count').textContent = `${ids.length} selected`;
    // Distribute needs 3+ tiles to do anything — disable it below that so the buttons don't no-op.
    bar.querySelectorAll('[data-dist]').forEach((b) => { b.disabled = ids.length < 3; });
  }
}

// ---- MOTION-3 / UI-5: canvas tools (terrain paint / notes / custom blocks) -------------------
// Build the floating terrain-type palette once, straight from TERRAIN_TYPES (single source of
// truth with the tile fills) plus an eraser. Clicking a swatch sets the active terrain paint.
function buildTerrainBar() {
  const bar = $('terrain-bar');
  if (!bar) return;
  const swatch = (key, label, color) =>
    `<button class="tb-swatch" type="button" data-terrain="${esc(key)}" aria-pressed="false" title="${esc(label)}">` +
    `<i style="background:${color}"></i>${esc(label)}</button>`;
  bar.innerHTML = '<span class="tb-lbl">Terrain</span>' +
    TERRAIN_TYPES.map((t) => swatch(t.key, t.label, t.color)).join('') +
    '<span class="ab-sep" aria-hidden="true"></span>' +
    '<button class="tb-swatch erase" type="button" data-terrain="erase" aria-pressed="false" title="Erase terrain">⌫ Erase</button>';
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-terrain]'); if (!b) return;
    grid.setTerrainType(b.dataset.terrain);
  });
}
// Reflect the live tool mode + terrain paint on the toolbar: highlight the active tool button,
// show the terrain palette only in terrain mode, and mark the chosen swatch.
function drawToolMode(mode, terrainType) {
  $('tool-mode')?.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const bar = $('terrain-bar');
  if (bar) {
    bar.hidden = mode !== 'terrain';
    bar.querySelectorAll('button[data-terrain]').forEach((b) => {
      const on = b.dataset.terrain === terrainType;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
}
// Prompt-based editor for a note's text or a custom block's label + dimensions (UI-5). Grid.js
// calls this on creation and on double-click; we patch the tile back through grid.updateTile so
// the change is a normal undoable/serializable step.
function editObject(tile) {
  if (tile.kind === 'note') {
    const txt = prompt('Note text:', tile.text || '');
    if (txt !== null) grid.updateTile(tile.id, { text: txt });
    return;
  }
  if (tile.kind === 'custom') {
    const label = prompt('Label for this block:', tile.name || 'MOC');
    if (label === null) return;
    const dims = prompt('Size in studs (width × height):', `${tile.w} × ${tile.h}`);
    const patch = { name: label.trim() || 'MOC' };
    if (dims !== null) {
      const m = dims.match(/(\d+(?:\.\d+)?)\s*[×x*,\s]\s*(\d+(?:\.\d+)?)/);
      if (m) { patch.w = Math.round(+m[1]); patch.h = Math.round(+m[2]); }
      else if (dims.trim() !== '') { toast('Couldn’t read those dimensions — kept the old size.'); }
    }
    grid.updateTile(tile.id, patch);
  }
}

function wireSummaryButtons() {
  const q = (id) => $('summary').querySelector(id);
  q('#btn-save')?.addEventListener('click', doSave);
  q('#btn-export2')?.addEventListener('click', doExport);
  q('#btn-setlist')?.addEventListener('click', doExportSetList);
  q('#btn-csv')?.addEventListener('click', doExportCsv);
  q('#btn-bricklink')?.addEventListener('click', doExportBricklink);
}

// Unique sets still to buy (owned sets excluded, like every export). Rows carry a resolved USD
// price — a manual override or real MSRP when known, else null (unknown). Sorted by set number.
function buildBuyRows() {
  const counts = new Map();
  for (const t of grid.getPlaced()) {
    if (!isCitySet(t)) continue; // terrain / notes / custom blocks aren't purchasable sets
    const num = baseNum(t.set_num);
    if (owned.has(num)) continue; // already own it → not on the shopping list
    const e = counts.get(num) || { num, set_num: t.set_num, name: t.name, qty: 0 };
    e.qty += 1;
    counts.set(num, e);
  }
  return [...counts.values()]
    .map((r) => ({ ...r, price: resolvePrice(r.set_num, { prices, overrides }).price }))
    .sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true }));
}
// Trigger a client-side file download from a string blob.
function download(text, filename, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
const safeName = () => cityName.replace(/[^\w-]+/g, '_');

// A shopping list of the sets to buy: quantity × set number + name + retailer links, grouped.
function doExportSetList() {
  const rows = buildBuyRows();
  if (!rows.length) { toast(grid.getPlaced().length ? 'Every placed set is marked owned.' : 'No sets placed yet.'); return; }
  const toBuy = rows.reduce((n, r) => n + r.qty, 0);
  const lines = [
    `Brick City Planner — set list: ${cityName}`,
    `${rows.length} unique set${rows.length === 1 ? '' : 's'} · ${toBuy} to buy`,
    '',
  ];
  for (const r of rows) {
    const price = r.price != null ? `  $${r.price.toFixed(2)}` : '';
    lines.push(`${String(r.qty).padStart(2)} ×  ${r.num.padEnd(8)} ${r.name}${price}`);
    lines.push('        ' + buyLinks(r.set_num, r.name).map((l) => `${l.label} ${l.href}`).join('  ·  '));
  }
  download(lines.join('\r\n') + '\r\n', `${safeName()}-setlist.txt`, 'text/plain');
  toast('Set list exported.');
}
// CSV of the same buy list: set number, name, qty, price.
function doExportCsv() {
  const rows = buildBuyRows();
  if (!rows.length) { toast(grid.getPlaced().length ? 'Every placed set is marked owned.' : 'No sets placed yet.'); return; }
  download(setListCsv(rows), `${safeName()}-setlist.csv`, 'text/csv');
  toast('CSV exported.');
}
// BrickLink Wanted-List XML of the buy list (generic road/track pieces are skipped by the writer).
function doExportBricklink() {
  const rows = buildBuyRows();
  if (!rows.length) { toast(grid.getPlaced().length ? 'Every placed set is marked owned.' : 'No sets placed yet.'); return; }
  const xml = bricklinkXml(rows);
  if (!/<ITEM>/.test(xml)) { toast('Only generic pieces placed — nothing to add to a BrickLink list.'); return; }
  download(xml, `${safeName()}-wanted.xml`, 'application/xml');
  toast('BrickLink wanted list exported.');
}
function doSave() {
  clearTimeout(saveTimer);
  saveCity(serializeCity(citySnapshot()));
  setSaveStatus(false);
  toast(`Saved “${cityName}”.`);
}
function doExport() {
  const city = serializeCity(citySnapshot());
  const blob = new Blob([exportCityJson(city)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${cityName.replace(/[^\w-]+/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast('Exported city file.');
}

// ---- QOL-5/6: tiny keyboard focus trap shared by the templates + cities modals ---------------
// (the shortcuts modal predates this and only focuses in/out on open/close — left as-is.)
function focusableIn(container) {
  return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex !== -1);
}
function trapTabKey(e, container) {
  if (e.key !== 'Tab') return;
  const items = focusableIn(container);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
}

// ---- QOL-6: starter-templates gallery ------------------------------------------------------
// A tiny top-down schematic of a template's layout, built straight from its placed[] tiles —
// no thumbnail images to ship or keep in sync.
function templateThumbSVG(tpl) {
  const g = tpl.grid;
  const rects = [...tpl.placed]
    .sort((a, b) => (a.layer ?? 2) - (b.layer ?? 2))
    .map((t) => `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="1.5" fill="${esc(t.color || catColor(t.category))}"/>`)
    .join('');
  return `<svg viewBox="0 0 ${g.w} ${g.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rects}</svg>`;
}
function buildTemplatesMenu() {
  const list = $('templates-list');
  list.textContent = '';
  if (!templates.length) { list.innerHTML = '<div class="note">Templates failed to load.</div>'; return; }
  for (const tpl of templates) {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    card.innerHTML = `<div class="tpl-thumb">${templateThumbSVG(tpl)}</div>
      <div class="tpl-name">${esc(tpl.name)}</div>
      <div class="tpl-desc">${esc(tpl.description || '')}</div>
      <div class="tpl-meta">${tpl.placed.length} set${tpl.placed.length === 1 ? '' : 's'} · ${fmtDims(tpl.grid.w, tpl.grid.h, unitState)}</div>
      <button class="btn primary" type="button">Use this template</button>`;
    card.querySelector('button').addEventListener('click', () => loadTemplate(tpl));
    list.appendChild(card);
  }
}
function openTemplatesMenu() {
  buildTemplatesMenu();
  $('templates-backdrop').hidden = false;
  $('btn-templates').setAttribute('aria-expanded', 'true');
  $('templates-close').focus();
}
function closeTemplatesMenu() {
  $('templates-backdrop').hidden = true;
  $('btn-templates').setAttribute('aria-expanded', 'false');
  $('btn-templates').focus();
}
// Overwrite guard mirrors "New city": only prompts when there's actually something to lose —
// the current work is autosaved under its own name first regardless, so it's never truly lost.
function loadTemplate(tpl) {
  if (grid.getPlaced().length && !confirm(`Start "${tpl.name}"? This replaces the current grid.`)) return;
  flushAutosave();
  cityName = tpl.name;
  unitState = 'studs';
  grid.setPlaced(tpl.placed, tpl.grid);
  $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === unitState));
  refresh();
  dismissFirstRun();
  closeTemplatesMenu();
  autosave();
  toast(`Loaded “${tpl.name}”.`);
}

// ---- QOL-5c: named saves — "My cities" menu (save-as / load / rename / delete) ---------------
function buildCitiesMenu() {
  const cities = loadCities();
  const names = Object.keys(cities).sort((a, b) => new Date(cities[b].updated || 0) - new Date(cities[a].updated || 0));
  const list = $('cities-list');
  list.textContent = '';
  if (!names.length) { list.innerHTML = '<div class="note">No saved cities yet — use “💾 Save as” to create one.</div>'; return; }
  for (const name of names) {
    const c = cities[name];
    const isCurrent = name === cityName;
    const when = c.updated ? new Date(c.updated).toLocaleString() : '—';
    const row = document.createElement('div');
    row.className = 'city-row' + (isCurrent ? ' current' : '');
    row.innerHTML = `<div class="cr-meta">
        <div class="cr-name">${esc(name)}${isCurrent ? '<span class="pill">open</span>' : ''}</div>
        <div class="cr-sub">${(c.placed || []).length} tile${(c.placed || []).length === 1 ? '' : 's'} · ${esc(when)}</div>
      </div>
      <div class="cr-actions">
        <button class="btn icon sm" data-act="load" title="Load this city" aria-label="Load ${esc(name)}">📂</button>
        <button class="btn icon sm" data-act="rename" title="Rename" aria-label="Rename ${esc(name)}">✎</button>
        <button class="btn icon sm" data-act="delete" title="Delete" aria-label="Delete ${esc(name)}">🗑</button>
      </div>`;
    row.querySelector('[data-act="load"]').addEventListener('click', () => loadSavedCity(name));
    row.querySelector('[data-act="rename"]').addEventListener('click', () => renameSavedCity(name));
    row.querySelector('[data-act="delete"]').addEventListener('click', () => deleteSavedCity(name));
    list.appendChild(row);
  }
}
function openCitiesMenu() {
  buildCitiesMenu();
  $('cities-backdrop').hidden = false;
  $('btn-cities').setAttribute('aria-expanded', 'true');
  $('btn-city-name').setAttribute('aria-expanded', 'true');
  $('cities-close').focus();
}
function closeCitiesMenu() {
  $('cities-backdrop').hidden = true;
  $('btn-cities').setAttribute('aria-expanded', 'false');
  $('btn-city-name').setAttribute('aria-expanded', 'false');
  $('btn-cities').focus();
}
// Switching saved cities never loses work: the city you're leaving gets flushed to its own
// slot first (same pattern Import already uses), then the picked one takes over the grid.
function loadSavedCity(name) {
  const c = loadCity(name);
  if (!c) { toast('That saved city is gone.'); buildCitiesMenu(); return; }
  flushAutosave();
  cityName = c.name || name;
  unitState = c.units || 'studs';
  grid.setPlaced(c.placed, c.grid);
  $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === unitState));
  refresh();
  closeCitiesMenu();
  toast(`Loaded “${cityName}”.`);
}
function renameSavedCity(oldName) {
  const input = prompt('Rename city:', oldName);
  if (input === null) return; // cancelled
  const next = input.trim();
  if (!next) { toast('Name cannot be blank.'); return; }
  if (next === oldName) return;
  // Renaming some OTHER saved city onto the name of the city currently open in the grid would
  // silently clobber that name's on-disk slot while leaving the live in-memory grid untouched —
  // the two would go out of sync. Refuse rather than risk data loss; the user can save/switch first.
  if (next === cityName && oldName !== cityName) {
    toast(`Can't rename onto your currently-open city — save or switch away from “${cityName}” first.`);
    return;
  }
  const cities = loadCities();
  if (cities[next] && !confirm(`“${next}” already exists. Overwrite it?`)) return;
  if (!renameCity(oldName, next)) { toast('Rename failed.'); return; }
  if (cityName === oldName) { cityName = next; drawCityLabel(); } // renaming the open city
  buildCitiesMenu();
  toast(`Renamed to “${next}”.`);
}
function deleteSavedCity(name) {
  if (!confirm(`Delete saved city “${name}”? This can't be undone.`)) return;
  deleteCity(name);
  buildCitiesMenu();
  toast(`Deleted “${name}”.`);
}
function doSaveAs() {
  const input = prompt('Save this city as:', cityName === 'Untitled city' ? '' : cityName);
  if (input === null) return; // cancelled
  const name = input.trim();
  if (!name) { toast('Name cannot be blank.'); return; }
  const cities = loadCities();
  if (cities[name] && name !== cityName && !confirm(`“${name}” already exists. Overwrite it?`)) return;
  cityName = name;
  clearTimeout(saveTimer);
  saveCity(serializeCity(citySnapshot()));
  setSaveStatus(false);
  drawCityLabel();
  toast(`Saved as “${name}”.`);
}

// ---- QOL-5a: compressed share link -------------------------------------------------------
async function doShare() {
  const city = serializeCity(citySnapshot());
  let payload;
  try { payload = await encodeCity(city); }
  catch (e) { console.warn('Could not build a share link:', e.message); toast('Could not build a share link.'); return; }
  const url = `${location.origin}${location.pathname}#d=${payload}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied to clipboard.');
  } catch {
    // Clipboard API can be blocked (permissions / non-secure context) — fall back to a manual copy.
    prompt('Copy this share link:', url);
  }
}

// ---- QOL-5b: opening a shared '#d=' link — read-only-first, confirm before overwriting -------
// Decodes + shape-validates eagerly at boot so the banner can show immediately, but never
// touches the live grid until the user explicitly opts in via the banner's confirm button.
async function checkSharedHash() {
  const hash = location.hash;
  if (!hash.startsWith('#d=')) return;
  const payload = hash.slice(3);
  let obj = null;
  try { obj = await decodeCity(payload); } catch { obj = null; }
  const res = obj ? validateCity(obj) : { ok: false };
  history.replaceState(null, '', location.pathname + location.search); // consume the hash either way
  if (!res.ok) { toast('That share link looks invalid or corrupted.'); return; }
  sharedCity = res.city;
  $('shared-banner-name').textContent = sharedCity.name || 'Untitled city';
  $('shared-banner').hidden = false;
}
function importSharedCity() {
  if (!sharedCity) return;
  flushAutosave();
  cityName = sharedCity.name || 'Shared city';
  unitState = sharedCity.units || 'studs';
  grid.setPlaced(sharedCity.placed, sharedCity.grid);
  $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === unitState));
  refresh();
  dismissFirstRun();
  autosave();
  dismissSharedBanner();
  toast(`Imported “${cityName}”.`);
}
function dismissSharedBanner() {
  $('shared-banner').hidden = true;
  sharedCity = null;
}

async function boot() {
  try { catalog = await loadCatalog(); prices = catalog.prices || {}; }
  catch (e) { $('catalog-list').innerHTML = `<div class="note">Couldn't load the set catalog. ${e.message}</div>`; return; }
  loadOwned();
  loadOverrides();
  loadFavorites();
  loadWishlist();
  loadRecent();

  try {
    const meta = await (await fetch('data/meta.json')).json();
    const l = document.querySelector('.legal');
    l.insertAdjacentHTML('beforeend', `<br><span style="opacity:.7">Catalog snapshot: ${meta.built} · ${meta.counts.sets} sets</span>`);
  } catch { /* non-fatal */ }

  try {
    const res = await fetch('data/templates.json');
    templates = res.ok ? await res.json() : [];
  } catch { templates = []; } // non-fatal — the "Templates" button just shows an empty gallery

  grid = createGrid($('grid-board'), {
    onChange: () => { refresh(); autosave(); },
    onResize: (w, h) => { gridSize = { w, h, pw: w / 32, ph: h / 32 }; drawGridSize(); },
    onHistory: drawHistory,
    onSelect: drawSelection,
    onMode: drawToolMode,
    onRequestEdit: editObject,
    onAnnounce: announce,
  });
  buildTerrainBar();

  catalogUI = renderCatalog(
    { list: $('catalog-list'), search: $('catalog-search'), chips: $('catalog-chips'),
      count: $('catalog-count'), sort: $('catalog-sort'), viewToggle: $('catalog-view'), rail: $('catalog-rail') },
    catalog.sets, {
      onAdd: (s) => placeSet(s), isOwned, onToggleOwn: toggleOwned,
      isFavorite, onToggleFavorite: toggleFavorite, getFavorites,
      isWishlisted, onToggleWishlist: toggleWishlist, getRecent,
    });

  // UI-3 / ACC-2c: theme + colorblind-safe toggles. The <head> inline script already stamped an
  // explicit stored choice pre-paint; this just syncs the buttons' icon/label/pressed state and
  // (for theme) keeps them in sync if the OS preference changes live while no explicit choice is set.
  syncThemeButton();
  applyCbSafe(getCbSafe());
  $('btn-theme')?.addEventListener('click', toggleTheme);
  $('btn-cbsafe')?.addEventListener('click', toggleCbSafe);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!getStoredTheme()) syncThemeButton(); }); }
  catch { /* older browsers without addEventListener on MediaQueryList — the button just won't live-sync */ }

  // toolbar
  $('unit-toggle').addEventListener('click', (e) => {
    const u = e.target.dataset.unit; if (!u) return;
    unitState = u;
    $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target));
    refresh();
  });
  $('btn-rotate').addEventListener('click', () => grid.rotateSelected());
  $('btn-forward').addEventListener('click', () => grid.bringForward());
  $('btn-back').addEventListener('click', () => grid.sendBackward());

  // Canvas tool switcher: pointer / paint-terrain / add-note / draw-block (MOTION-3 / UI-5)
  $('tool-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    grid.setMode(b.dataset.mode);
  });

  // Undo / redo + history dropdown
  $('btn-undo').addEventListener('click', () => grid.undo());
  $('btn-redo').addEventListener('click', () => grid.redo());
  $('btn-history').addEventListener('click', (e) => {
    e.stopPropagation();
    $('history-menu').hidden ? openHistoryMenu() : closeHistoryMenu();
  });
  document.addEventListener('click', (e) => {
    if (!$('history-menu').hidden && !e.target.closest('.hist-group')) closeHistoryMenu();
  });

  // Align / distribute / group floating bar
  $('align-bar').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.align) grid.alignSelection(b.dataset.align);
    else if (b.dataset.dist) grid.distributeSelection(b.dataset.dist);
    else if (b.dataset.grp === 'group') grid.groupSelection();
    else if (b.dataset.grp === 'ungroup') grid.ungroup();
  });

  // Table-size stepper: ± one baseplate per axis.
  $('grid-size').addEventListener('click', (e) => {
    const a = e.target.dataset.gs; if (!a) return;
    const { pw, ph } = gridSize;
    const next = { wdec: [pw - 1, ph], winc: [pw + 1, ph], hdec: [pw, ph - 1], hinc: [pw, ph + 1] }[a];
    if (next) grid.setGridPlates(next[0], next[1]);
  });
  $('btn-delete').addEventListener('click', () => grid.deleteSelected());

  // First-run tips (UI-1)
  $('fr-close')?.addEventListener('click', dismissFirstRun);
  $('btn-sample')?.addEventListener('click', loadSampleCity);

  // Shortcuts modal (UI-2)
  $('btn-help')?.addEventListener('click', toggleShortcuts);
  $('shortcuts-close')?.addEventListener('click', closeShortcuts);
  $('shortcuts-backdrop')?.addEventListener('click', (e) => { if (e.target === $('shortcuts-backdrop')) closeShortcuts(); });
  document.addEventListener('keydown', (e) => {
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); toggleShortcuts(); }
    else if (e.key === 'Escape') {
      if (!$('shortcuts-backdrop').hidden) closeShortcuts();
      else if (!$('templates-backdrop').hidden) closeTemplatesMenu();
      else if (!$('cities-backdrop').hidden) closeCitiesMenu();
      else if (grid?.getMode?.() && grid.getMode() !== 'select') grid.setMode('select'); // leave a tool
    }
  });

  // Templates gallery (QOL-6)
  $('btn-templates').addEventListener('click', openTemplatesMenu);
  $('templates-close').addEventListener('click', closeTemplatesMenu);
  $('templates-backdrop').addEventListener('click', (e) => { if (e.target === $('templates-backdrop')) closeTemplatesMenu(); });
  $('templates-modal').addEventListener('keydown', (e) => trapTabKey(e, $('templates-modal')));

  // Named saves — "My cities" + Save as (QOL-5c)
  $('btn-save-as').addEventListener('click', doSaveAs);
  $('btn-cities').addEventListener('click', openCitiesMenu);
  $('btn-city-name').addEventListener('click', openCitiesMenu);
  $('cities-close').addEventListener('click', closeCitiesMenu);
  $('cities-backdrop').addEventListener('click', (e) => { if (e.target === $('cities-backdrop')) closeCitiesMenu(); });
  $('cities-modal').addEventListener('keydown', (e) => trapTabKey(e, $('cities-modal')));

  // Share link + shared-city banner (QOL-5a/b)
  $('btn-share').addEventListener('click', doShare);
  $('shared-import').addEventListener('click', importSharedCity);
  $('shared-dismiss').addEventListener('click', dismissSharedBanner);

  // Drag a catalog item onto the grid to drop it there.
  const gstage = $('grid-stage');
  gstage.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('text/bcp-set')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  gstage.addEventListener('drop', (e) => {
    const num = e.dataTransfer.getData('text/bcp-set');
    if (!num) return;
    e.preventDefault();
    const set = catalog.byNum.get(num);
    if (set) placeSet(set, e.clientX, e.clientY);
  });
  $('zoom-ctrl').addEventListener('click', (e) => {
    const z = e.target.dataset.zoom; if (!z) return;
    ({ in: () => grid.zoomBy(0.15), out: () => grid.zoomBy(-0.15),
       reset: () => grid.setZoom(1), fit: () => grid.fit() }[z] || (() => {}))();
  });
  $('btn-new').addEventListener('click', () => {
    if (grid.getPlaced().length && !confirm('Start a new city? This clears the current grid.')) return;
    cityName = 'Untitled city'; grid.setPlaced([]); refresh(); toast('New city.');
  });
  $('btn-export').addEventListener('click', doExport);
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const res = importCityJson(await file.text());
    if (!res.ok) { toast(res.error); e.target.value = ''; return; }
    flushAutosave();
    cityName = res.city.name || 'Imported city';
    unitState = res.city.units || 'studs';
    grid.setPlaced(res.city.placed, res.city.grid);
    $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === unitState));
    refresh(); toast(`Loaded “${cityName}”.`); e.target.value = '';
  });

  // restore last autosaved city
  try {
    const last = currentCityName() && loadCity(currentCityName());
    if (last && Array.isArray(last.placed)) {
      cityName = last.name || 'Untitled city';
      unitState = last.units || 'studs';
      grid.setPlaced(last.placed, last.grid);
      $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === unitState));
    }
  } catch (err) {
    console.warn('Could not restore saved city:', err.message);
  }
  refresh();
  drawHistory();
  drawSelection(grid.getSelection());

  // Shared '#d=' link, if any — shown as a banner on top of whatever just loaded above; the
  // live grid is only touched if/when the user clicks "Import into my planner" (QOL-5b).
  await checkSharedHash();
}
boot();
