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
import { resolvePrice, baseNum, bricklinkXml, setListCsv, buyLinks, packRollup } from './pricing.js';
import { pushRecent } from './lists.js';
import { esc } from './util.js';
import { TERRAIN_TYPES, isCitySet, isPhysical } from './objects.js';
import { computeLayout, fitScale, drawScene } from './export-image.js';
import { fitProjection, drawIsoScene } from './isometric.js';
import { checkCity } from './buildcheck.js';
import { isCoarsePointer, deleteNeedsConfirm } from './pointer.js';

const $ = (id) => document.getElementById(id);
// Wave 6 (touch): is the current input device a coarse (finger/pen) pointer? Used to gate the
// touch-only delete tap-confirm below. Falls back to false where matchMedia is unavailable.
const coarseMedia = () => { try { return matchMedia('(pointer:coarse)').matches; } catch { return false; } };

// Wave 6 (touch delete-safety): a finger's first tap on the delete button only ARMS a confirm (see
// wiring in boot); a second tap within the window commits. These hold that armed state so a stray
// tap can't nuke a piece. Inert for a mouse (deleteNeedsConfirm is false on a fine pointer).
let deleteArmed = false;
let deleteArmTimer = null;
function disarmDelete() {
  if (!deleteArmed) return;
  deleteArmed = false;
  clearTimeout(deleteArmTimer);
  $('btn-delete')?.classList.remove('armed');
}
let unitState = 'studs';
let cityName = 'Untitled city';
let gridSize = { w: 128, h: 96, pw: 4, ph: 3 };
let catalog, grid, catalogUI;
let prices = {}; // real MSRPs from data/prices.json (keyed by bare set number)
let packs = {}; // bundle-pack contents from data/packs.json (round-1 feedback 3b; keyed by bare pack number)
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
  closeSheets(); // Wave 6: picking a set dismisses the mobile catalog sheet so the board is visible
}

// PLAN-7: "Custom baseplate…" — prompt for a size in studs and drop a generic ground-layer plate.
// Goes through placeSet() like any catalog set, so it inherits selection/undo/snap for free; the
// per-size snap grid (geometry.plateGridSnap) makes it tile flush with its own kind. A single "32"
// means a square. Sizes are clamped to a sane 4–256-stud range (≈8 baseplates) so a typo can't
// spawn a monster tile.
function addCustomBaseplate() {
  const raw = prompt('Custom baseplate size in studs — width × height (e.g. 40 × 24, or 32 for a square):', '32 × 32');
  if (raw === null) return; // cancelled
  const clamp = (n) => Math.min(256, Math.max(4, Math.round(n)));
  const two = raw.match(/(\d+(?:\.\d+)?)\s*[×x*,\s]\s*(\d+(?:\.\d+)?)/);
  const one = raw.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  let w, h;
  if (two) { w = clamp(+two[1]); h = clamp(+two[2]); }
  else if (one) { w = h = clamp(+one[1]); }
  else { toast('Enter a size like “48 × 32” or “32”.'); return; }
  const set = {
    set_num: 'custom-baseplate', name: `Baseplate — ${w}×${h}`,
    category: 'baseplate', kind: 'baseplate', layer: 0, color: 'var(--g-green)', img: null,
    footprint: { w, h, source: 'curated' },
  };
  placeSet(set);
  toast(`Placed a ${w}×${h} baseplate.`);
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
// Inline-SVG icons for the two buttons whose glyph changes with state (theme + lock). Everything
// else is static SVG in index.html; these two are swapped here so the icon set stays consistent.
const ICON = {
  moon: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>',
  sun: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  unlocked: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7.5A4 4 0 0 1 15.5 6"/></svg>',
  locked: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};
function syncThemeButton() {
  const btn = $('btn-theme'); if (!btn) return;
  const isDark = effectiveTheme() === 'dark';
  btn.innerHTML = isDark ? ICON.sun : ICON.moon;
  btn.setAttribute('aria-pressed', String(isDark));
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  btn.title = label; btn.setAttribute('aria-label', label);
}
function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { console.warn('Could not save theme:', e.message); }
  document.documentElement.setAttribute('data-theme', next);
  syncThemeButton();
  if (isoOpen) renderIso(); // PLAN-12: repaint the 3D preview on the new palette
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

// ---- PLAN-8: realistic scale-reference overlay toggle -------------------------------------------
// A faint minifig/car/door silhouette set + 10/50/100-stud ruler drawn over the board (grid.js owns
// the SVG). Hidden by default, persisted per browser like the theme / colorblind toggles.
const SCALEREF_KEY = 'bcp.scaleRef';
function getScaleRef() { try { return localStorage.getItem(SCALEREF_KEY) === '1'; } catch { return false; } }
function syncScaleRefButton(on) {
  const btn = $('btn-scaleref'); if (!btn) return;
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('on', on);
  const label = on ? 'Hide scale reference' : 'Show scale reference (minifig / car / ruler)';
  btn.title = label; btn.setAttribute('aria-label', label);
}
function toggleScaleRef() {
  const next = !getScaleRef();
  try { localStorage.setItem(SCALEREF_KEY, next ? '1' : '0'); } catch (e) { console.warn('Could not save scale-reference setting:', e.message); }
  grid.setScaleRef(next);
  syncScaleRefButton(next);
  toast(next ? 'Scale reference on — silhouettes + ruler are true stud scale.' : 'Scale reference off.');
}

// ---- Round-1 feedback: 🧲 magnetic-snapping toggle ----------------------------------------------
// Edge magnetism is handy for flush placement but must never forbid in-between positions; the
// geometry side is already tamed (2-stud edge pull), this toggle turns the magnet off entirely.
// Hold Alt while dragging for a one-off bypass. Persisted per browser, default ON.
const SNAP_KEY = 'bcp.snap';
function getSnapPref() { try { return localStorage.getItem(SNAP_KEY) !== '0'; } catch { return true; } }
function syncSnapButton(on) {
  const btn = $('btn-snap'); if (!btn) return;
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('on', on);
  const label = on ? 'Magnetic snapping on — hold Alt while dragging to bypass' : 'Magnetic snapping off — pieces place on any stud';
  btn.title = label; btn.setAttribute('aria-label', label);
}
function toggleSnapPref() {
  const next = !getSnapPref();
  try { localStorage.setItem(SNAP_KEY, next ? '1' : '0'); } catch (e) { console.warn('Could not save snapping setting:', e.message); }
  grid.setSnapEnabled(next);
  syncSnapButton(next);
  toast(next ? 'Magnetic snapping on. Hold Alt while dragging to bypass.' : 'Magnetic snapping off — pieces place on any stud.');
}

// ---- QOL-10 / QOL-8: per-layer show-hide + lock, and Kid Mode ---------------------------------
// layerVis / layerLocks are view + interaction prefs (localStorage); Kid Mode is per browser
// session (sessionStorage). All three are kept OUT of placed[]/undo and out of the saved city —
// only the per-tile `locked` flag lives in the model (handled inside grid.js). The grid holds the
// authoritative copy; app.js mirrors it for persistence + the Layers menu UI.
const LAYERVIS_KEY = 'bcp.layerVis', LAYERLOCK_KEY = 'bcp.layerLocks', KID_KEY = 'bcp.kidMode';
// The stacking layers, in paint order — `layer` matches tile.layer. Extend here if a terrain layer
// is ever added; the Layers menu is built straight off this list.
const LAYERS = [
  { layer: 0, name: 'Baseplates', icon: '🟩' },
  { layer: 1, name: 'Roads & tracks', icon: '🛣️' },
  { layer: 2, name: 'Buildings & props', icon: '🏢' },
];
let layerVis = { 0: true, 1: true, 2: true };
let layerLocks = { 0: false, 1: false, 2: false };
let kidMode = false;
function loadLayerPrefs() {
  try { const v = JSON.parse(localStorage.getItem(LAYERVIS_KEY)); if (v && typeof v === 'object') for (const l of LAYERS) if (v[l.layer] === false) layerVis[l.layer] = false; } catch { /* defaults */ }
  try { const k = JSON.parse(localStorage.getItem(LAYERLOCK_KEY)); if (k && typeof k === 'object') for (const l of LAYERS) if (k[l.layer] === true) layerLocks[l.layer] = true; } catch { /* defaults */ }
}
function saveLayerVis() { try { localStorage.setItem(LAYERVIS_KEY, JSON.stringify(layerVis)); } catch (e) { console.warn('Could not save layer visibility:', e.message); } }
function saveLayerLocks() { try { localStorage.setItem(LAYERLOCK_KEY, JSON.stringify(layerLocks)); } catch (e) { console.warn('Could not save layer locks:', e.message); } }
const layerName = (layer) => LAYERS.find((l) => l.layer === layer)?.name || `Layer ${layer}`;

function buildLayersMenu() {
  const menu = $('layers-menu');
  menu.textContent = '';
  for (const l of LAYERS) {
    const vis = layerVis[l.layer] !== false, locked = !!layerLocks[l.layer];
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.innerHTML = `<span class="lr-name">${esc(l.icon)} ${esc(l.name)}</span>
      <button class="lr-btn" type="button" role="menuitemcheckbox" data-lv="${l.layer}" aria-checked="${vis}"
        aria-label="${vis ? 'Hide' : 'Show'} ${esc(l.name)} layer" title="${vis ? 'Hide' : 'Show'} layer">${vis ? '👁' : '🙈'}</button>
      <button class="lr-btn" type="button" role="menuitemcheckbox" data-ll="${l.layer}" aria-checked="${locked}"
        aria-label="${locked ? 'Unlock' : 'Lock'} ${esc(l.name)} layer" title="${locked ? 'Unlock' : 'Lock'} layer">${locked ? '🔒' : '🔓'}</button>`;
    row.querySelector('[data-lv]').addEventListener('click', () => toggleLayerVis(l.layer));
    row.querySelector('[data-ll]').addEventListener('click', () => toggleLayerLock(l.layer));
    menu.appendChild(row);
  }
  const foot = document.createElement('button');
  foot.className = 'layer-foot'; foot.type = 'button';
  foot.textContent = '🔒 Lock all but selection';
  foot.title = 'Lock every tile except the current selection';
  foot.addEventListener('click', () => { grid.lockAllExceptSelected(); toast('Locked everything except the selection.'); });
  menu.appendChild(foot);
}
function toggleLayerVis(layer) {
  layerVis[layer] = layerVis[layer] === false;
  saveLayerVis();
  grid.setLayerVisible(layer, layerVis[layer]);
  buildLayersMenu(); updateLayersButton();
  toast(`${layerName(layer)} ${layerVis[layer] ? 'shown' : 'hidden'}.`);
}
function toggleLayerLock(layer) {
  layerLocks[layer] = !layerLocks[layer];
  saveLayerLocks();
  grid.setLayerLocked(layer, layerLocks[layer]);
  buildLayersMenu(); updateLayersButton();
  toast(`${layerName(layer)} layer ${layerLocks[layer] ? 'locked' : 'unlocked'}.`);
}
function updateLayersButton() {
  const btn = $('btn-layers'); if (!btn) return;
  const anyHidden = LAYERS.some((l) => layerVis[l.layer] === false);
  const anyLocked = LAYERS.some((l) => layerLocks[l.layer]);
  btn.classList.toggle('active', anyHidden || anyLocked);
  const bits = [anyHidden ? 'some layers hidden' : '', anyLocked ? 'some layers locked' : ''].filter(Boolean);
  btn.setAttribute('aria-label', bits.length ? `Layers — ${bits.join(', ')}` : 'Layers');
}
function openLayersMenu() { buildLayersMenu(); $('layers-menu').hidden = false; $('btn-layers').setAttribute('aria-expanded', 'true'); }
function closeLayersMenu() { $('layers-menu').hidden = true; $('btn-layers').setAttribute('aria-expanded', 'false'); }

// The toolbar lock button reflects (and toggles) the current selection's lock state.
function drawLockButton() {
  const btn = $('btn-lock'); if (!btn || !grid) return;
  const state = grid.selectionLockState(); // 'none' | 'unlocked' | 'locked' | 'mixed'
  btn.disabled = state === 'none';
  const locked = state === 'locked';
  btn.innerHTML = locked ? ICON.locked : ICON.unlocked;
  btn.setAttribute('aria-pressed', String(locked));
  const label = state === 'none' ? 'Lock or unlock selected' : (locked ? 'Unlock selected' : 'Lock selected');
  btn.title = `${label} (L)`; btn.setAttribute('aria-label', label);
}

// Kid Mode: freeze the placed layout, bump control sizes and hide the advanced controls (via the
// `data-kidmode` attribute the CSS keys off). Persisted per browser session.
function loadKidMode() { try { return sessionStorage.getItem(KID_KEY) === '1'; } catch { return false; } }
function applyKidMode(on) {
  kidMode = !!on;
  document.documentElement.toggleAttribute('data-kidmode', kidMode);
  const btn = $('btn-kid');
  if (btn) {
    btn.setAttribute('aria-pressed', String(kidMode));
    btn.classList.toggle('on', kidMode);
    btn.setAttribute('aria-label', kidMode ? 'Turn off Kid Mode' : 'Turn on Kid Mode');
  }
}
function toggleKidMode() {
  applyKidMode(!kidMode);
  try { sessionStorage.setItem(KID_KEY, kidMode ? '1' : '0'); } catch { /* private browsing */ }
  grid.setKidMode(kidMode);
  drawSelection(grid.getSelection());
  toast(kidMode ? 'Kid Mode on — the layout is frozen; add and arrange new pieces.' : 'Kid Mode off.');
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
        approx: building.footprint.source === 'estimated', img: building.img || null,
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
    { prices, owned, overrides, packs, onToggleOwn: toggleOwned, onSetPrice: setPriceOverride,
      wishlist, onPromoteWishlist: promoteWishlist, onRemoveWishlist: toggleWishlist,
      onFind: findSetOnGrid, onDelete: deleteSetFromGrid, onFindCat: findCatOnGrid });
  wireSummaryButtons();
}
// Click a "Sets & ownership" row's name → select every placed tile of that set and scroll the grid
// to centre them (grid.focusIds also refreshes the toolbar via onSelect). Makes it easy to locate a
// specific set — e.g. a retired/discontinued one — in a big city.
function findSetOnGrid(num) {
  const ids = grid.getPlaced().filter((t) => baseNum(t.set_num) === num).map((t) => t.id);
  if (!ids.length) { toast('None of that set is on the grid.'); return; }
  grid.focusIds(ids);
  toast(ids.length === 1 ? 'Found it — selected on the grid.' : `Found ${ids.length} — all selected.`);
}
// The row's 🗑 button → delete every placed tile of that set (undoable with Ctrl+Z).
function deleteSetFromGrid(num) {
  const ids = grid.getPlaced().filter((t) => baseNum(t.set_num) === num).map((t) => t.id);
  if (!ids.length) return;
  grid.focusIds(ids); grid.deleteSelected();
}
// Click a "By category" row → select every placed tile of that category and scroll to them.
function findCatOnGrid(cat) {
  const ids = grid.getPlaced().filter((t) => t.category === cat).map((t) => t.id);
  if (!ids.length) { toast('None of that category is on the grid.'); return; }
  grid.focusIds(ids);
}
function drawDims() {
  // Measure the same physical set the summary's 'Total footprint' does (sets + custom blocks, but
  // NOT terrain paint or sticky notes) so the topbar readout and the summary can never diverge.
  const b = bbox(grid.getPlaced().filter(isPhysical));
  $('grid-dims').textContent = b.w ? fmtDims(b.w, b.h, unitState) : 'No sets yet';
}
function refresh() { drawSummary(); drawDims(); drawGridSize(); updateFirstRun(); drawCityLabel(); updateCheckButton(); }

// ---- Wave 6 (mobile): catalog / summary bottom-sheets -----------------------------------------
// On a phone the catalog and summary aren't columns — they're bottom-sheets toggled from the fixed
// bottom bar. A body class drives the pure-CSS slide + scrim (see styles.css ≤760px); this JS only
// flips that class, keeps each FAB's aria-expanded honest, and closes the sheet on pick / scrim /
// ✕ / Esc. It's inert on desktop, where the bar + scrim are display:none and the panels are their
// normal left/right columns — so the mouse experience is completely untouched.
function updateSheetBtns() {
  const cls = document.body.classList;
  $('m-catalog')?.setAttribute('aria-expanded', String(cls.contains('sheet-catalog')));
  $('m-summary')?.setAttribute('aria-expanded', String(cls.contains('sheet-summary')));
}
function openSheet(name) {
  const cls = document.body.classList;
  const already = cls.contains('sheet-' + name);
  cls.remove('sheet-catalog', 'sheet-summary'); // only one sheet open at a time
  if (!already) cls.add('sheet-' + name);        // tapping the active FAB again closes it
  updateSheetBtns();
}
function closeSheets() {
  document.body.classList.remove('sheet-catalog', 'sheet-summary');
  updateSheetBtns();
}
function sheetsOpen() {
  return document.body.classList.contains('sheet-catalog')
    || document.body.classList.contains('sheet-summary');
}
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
  disarmDelete();   // Wave 6: any selection change cancels a pending touch delete-confirm
  drawLockButton(); // keep the toolbar lock button in step with the selection
  const dup = $('btn-dup'); if (dup) dup.disabled = ids.length === 0; // Duplicate needs a selection
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
  q('#btn-shoplist')?.addEventListener('click', openShopDialog);
}

// Unique sets still to buy (owned sets excluded, like every export). Rows carry a resolved USD
// price — a manual override or real MSRP when known, else null (unknown). Sorted by set number.
// Round-1 feedback 3b: placed pack pieces (plants, lamps, track segments…) roll up into whole-pack
// rows first — you buy the box, not the element.
function buildBuyRows() {
  const cityTiles = grid.getPlaced().filter(isCitySet); // terrain / notes / custom blocks aren't purchasable
  const { plain, packRows } = packRollup(cityTiles, catalog.byNum, packs);
  const counts = new Map();
  for (const t of plain) {
    const num = baseNum(t.set_num);
    if (owned.has(num)) continue; // already own it → not on the shopping list
    const e = counts.get(num) || { num, set_num: t.set_num, name: t.name, qty: 0 };
    e.qty += 1;
    counts.set(num, e);
  }
  for (const pr of packRows) {
    const num = baseNum(pr.set_num);
    if (owned.has(num)) continue;
    const e = counts.get(num) || { num, set_num: pr.set_num, name: pr.name, qty: 0 };
    e.qty += pr.qty; // boxes needed, not pieces placed
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

// ---- PLAN-4: high-resolution PNG export + presentation mode ------------------------------------
// The scene is drawn from the placed[] model straight onto an offscreen <canvas> (never a DOM
// screenshot) so it stays crisp at 1×/2×/4×. The layout maths AND the ctx-only drawing live in
// export-image.js; this file just owns the <canvas>, image preloading, the dialog and the download.
// The pngScale/pngClean/pngCard/pngEdge below are the dialog's state.
let pngScale = 2, pngClean = false, pngCard = true, pngEdge = 'bottom';

// Load every distinct thumbnail URL into a decoded <img> so the canvas can drawImage() the building
// photos synchronously. A failed/aborted load is dropped (the tile falls back to a tinted box), so
// one broken image never blocks the whole export.
function preloadImages(urls) {
  const uniq = [...new Set(urls.filter(Boolean))];
  return Promise.all(uniq.map((u) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res([u, im]);
    im.onerror = () => res(null);
    im.decoding = 'async'; im.src = u;
  }))).then((pairs) => new Map(pairs.filter(Boolean)));
}

// Sets / pieces / footprint for the title card — same rules the summary uses (terrain + notes carry
// no pieces and don't count toward the footprint).
function exportStats(tiles) {
  const sets = tiles.filter(isCitySet);
  const pieces = sets.reduce((n, t) => n + (catalog.byNum.get(t.set_num)?.pieces || 0), 0);
  const physical = tiles.filter(isPhysical);
  const b = bbox(physical);
  return { setCount: sets.length, pieces, w: Math.round(b.w), h: Math.round(b.h) };
}

// Render the whole city to a fresh canvas and return it. Only currently-visible layers are drawn
// (a hidden layer is invisible on the board, so it's absent from the export too).
async function renderCityCanvas({ scale, presentation, titleCard, cardEdge }) {
  const drawn = grid.getPlaced().filter((t) => layerVis[t.layer ?? 2] !== false);
  const tiles = drawn.length ? drawn : grid.getPlaced();
  const box = bbox(tiles);
  const opts = { titleCard, cardEdge };
  const safeScale = fitScale(box, scale, opts);
  const layout = computeLayout(box, { ...opts, scale: safeScale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width));
  canvas.height = Math.max(1, Math.round(layout.height));
  const ctx = canvas.getContext('2d');

  const imgs = await preloadImages(tiles.filter((t) => t.kind === 'building').map((t) => t.img));
  drawScene(ctx, {
    tiles, layout, box, imgs, presentation, titleCard,
    stats: exportStats(tiles), name: cityName,
  });
  return { canvas, scale: safeScale, requested: scale };
}

async function doExportPng() {
  if (!grid.getPlaced().length) { toast('Add some sets before exporting an image.'); return; }
  toast('Rendering image…');
  let out;
  try { out = await renderCityCanvas({ scale: pngScale, presentation: pngClean, titleCard: pngCard, cardEdge: pngEdge }); }
  catch (e) { console.warn('PNG export failed:', e.message); toast('Could not render the image.'); return; }
  out.canvas.toBlob((blob) => {
    if (!blob) { toast('Could not render the image.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    toast(out.scale < out.requested
      ? `Image exported at ${out.scale}× (clamped from ${out.requested}× to fit).`
      : `Image exported at ${out.scale}×.`);
  }, 'image/png');
}

// ---- PLAN-4: export-image dialog -----------------------------------------------------------
// A small modal to pick resolution + the presentation / title-card options, with a live estimate of
// the output pixel size (via the same fitScale/computeLayout the render uses).
function syncPngDialog() {
  $('png-scale')?.querySelectorAll('button').forEach((b) => {
    const on = +b.dataset.scale === pngScale;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
  $('png-edge')?.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.edge === pngEdge;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
  const clean = $('png-clean'), card = $('png-card'), edgeRow = $('png-edge-row');
  if (clean) clean.checked = pngClean;
  if (card) card.checked = pngCard;
  if (edgeRow) edgeRow.hidden = !pngCard;
  const note = $('png-note');
  if (note) {
    // Mirror renderCityCanvas's fallback: when every visible layer is hidden the render measures
    // ALL placed tiles, so the size estimate must too (else it shows a tiny box for a full export).
    const vis = grid.getPlaced().filter((t) => layerVis[t.layer ?? 2] !== false);
    const box = bbox(vis.length ? vis : grid.getPlaced());
    const opts = { titleCard: pngCard, cardEdge: pngEdge };
    const s = fitScale(box, pngScale, opts);
    const l = computeLayout(box, { ...opts, scale: s });
    note.textContent = grid.getPlaced().length
      ? `Output ≈ ${Math.round(l.width)} × ${Math.round(l.height)} px${s < pngScale ? ` (clamped to ${s}× to stay printable)` : ''}.`
      : 'Add some sets first — there is nothing to export yet.';
  }
}
function openPngDialog() {
  syncPngDialog();
  $('png-backdrop').hidden = false;
  $('btn-png')?.setAttribute('aria-expanded', 'true');
  $('png-close')?.focus();
}
function closePngDialog() {
  $('png-backdrop').hidden = true;
  $('btn-png')?.setAttribute('aria-expanded', 'false');
  $('btn-png')?.focus();
}

// ---- Round-1 feedback: one Shopping-list button + format chooser --------------------------------
// The three sibling export buttons (.txt / .csv / BrickLink .xml) confused users — same list,
// three formats. One button now opens a small chooser dialog; each choice downloads via the
// UNCHANGED doExport* handlers below. Last-used format is remembered per browser.
const SHOPFMT_KEY = 'bcp.shopfmt';
let shopFmt = 'txt';
function loadShopFmt() {
  try {
    const v = localStorage.getItem(SHOPFMT_KEY);
    if (v === 'txt' || v === 'csv' || v === 'xml') shopFmt = v;
  } catch { /* default stands */ }
}
function saveShopFmt() {
  try { localStorage.setItem(SHOPFMT_KEY, shopFmt); } catch (e) { console.warn('Could not save shopping-list format:', e.message); }
}
function syncShopDialog() {
  $('shop-modal')?.querySelectorAll('button[data-fmt]').forEach((b) => {
    const on = b.dataset.fmt === shopFmt;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
}
function openShopDialog() {
  // Nothing to buy → keep the toast-instead-of-open behaviour the old buttons had.
  if (!buildBuyRows().length) { toast(grid.getPlaced().length ? 'Every placed set is marked owned.' : 'No sets placed yet.'); return; }
  syncShopDialog();
  $('shop-backdrop').hidden = false;
  ($('shop-modal').querySelector('button[data-fmt].on') || $('shop-close'))?.focus();
}
function closeShopDialog() {
  $('shop-backdrop').hidden = true;
  $('btn-shoplist')?.focus(); // fresh node after a summary re-render still carries the id
}

// ---- PLAN-12: read-only 3D / isometric preview -------------------------------------------------
// A full-stage overlay renders the current city as extruded blocks on a plain <canvas>, using the
// pure projection maths in isometric.js (world studs → iso screen, painter's depth sort). No editing
// happens in this mode — "← Back to 2D" (or Esc) returns to the primary top-down board. The scene is
// drawn straight from the placed[] model, honouring the same visible-layer filter as the PNG export.
let isoOpen = false;
// Round-1 feedback: camera yaw for the rotatable 3D view. Session-scoped (like isoOpen), driven by
// the ⟳ button (90° steps) and by horizontal drag on the canvas; pitch stays fixed.
let isoYaw = 0;
let isoDragging = false;
const ISO_QT = Math.PI / 2;

// The tiles the preview draws: only currently-visible layers (a hidden layer is invisible on the
// board, so it's absent from the 3D view too), with the same all-hidden fallback the export uses.
function isoTiles() {
  const drawn = grid.getPlaced().filter((t) => layerVis[t.layer ?? 2] !== false);
  return drawn.length ? drawn : grid.getPlaced();
}

// Size the canvas to the stage viewport (device-pixel-sharp), fit the whole city into it and paint.
function renderIso() {
  if (!isoOpen) return;
  const stage = $('grid-stage'), canvas = $('iso-canvas');
  if (!stage || !canvas) return;
  const cssW = Math.max(1, stage.clientWidth), cssH = Math.max(1, stage.clientHeight);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  const tiles = isoTiles();
  const dark = effectiveTheme() === 'dark';
  const proj = fitProjection(tiles, { width: canvas.width, height: canvas.height, pad: 34 * dpr, yaw: isoYaw });
  drawIsoScene(ctx, {
    tiles, proj, width: canvas.width, height: canvas.height,
    bg: dark ? '#1a2130' : '#eef2f8', dark,
  });
}

function openIso() {
  if (!grid.getPlaced().length) { toast('Add some sets before opening the 3D preview.'); return; }
  isoOpen = true;
  $('iso-overlay').hidden = false;
  $('btn-iso')?.setAttribute('aria-pressed', 'true');
  $('btn-iso')?.classList.add('on');
  renderIso();
  $('iso-back')?.focus();
  announce('3D isometric preview opened. This view is read-only.');
}
function closeIso() {
  if (!isoOpen) return;
  isoOpen = false;
  isoDragging = false; // Esc mid-drag: a stale flag must never eat the first pointerdown next open
  $('iso-overlay').hidden = true;
  $('btn-iso')?.setAttribute('aria-pressed', 'false');
  $('btn-iso')?.classList.remove('on');
  $('btn-iso')?.focus();
}
function toggleIso() { isoOpen ? closeIso() : openIso(); }

// ⟳ button: snap to the NEXT clean 90° multiple (composes with drag — an odd dragged angle rounds
// to the nearest quarter first, then advances one quarter; four clicks always return to start).
function rotateIso() {
  isoYaw = ((Math.round(isoYaw / ISO_QT) + 1) * ISO_QT) % (2 * Math.PI);
  if (isoYaw < 0) isoYaw += 2 * Math.PI;
  renderIso();
  announce(`3D view rotated to ${Math.round((isoYaw * 180) / Math.PI)} degrees.`);
}

// ---- PLAN-3: buildability checker ("Check my city") --------------------------------------------
// Runs the pure checkCity() scan over the live grid and renders a click-to-zoom results list. The
// glue here is deliberately thin — all the detection logic lives in buildcheck.js. Each row jumps
// the board to the offending tile(s) via grid.focusIds() (select + centre in view).
const CHECK_GLYPH = { error: '✕', warn: '!', info: 'i' };
function buildCheckList(report) {
  const list = $('check-list');
  list.textContent = '';
  if (report.ok) {
    list.innerHTML = `<div class="chk-empty"><span class="big" aria-hidden="true">✅</span>
      <b>All clear</b><span>No buildability problems found — your city is ready to build.</span></div>`;
    return;
  }
  for (const it of report.issues) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'chk-row ' + it.severity;
    row.innerHTML = `<span class="ic" aria-hidden="true">${CHECK_GLYPH[it.severity] || '!'}</span>` +
      `<span class="msg">${esc(it.message)}</span><span class="go" aria-hidden="true">→</span>`;
    row.addEventListener('click', () => { grid.focusIds(it.ids); closeCheck(); });
    list.appendChild(row);
  }
}
function runCityCheck() {
  const report = checkCity(grid.getPlaced());
  const s = $('check-summary');
  if (report.ok) {
    s.textContent = 'Scanned your whole city — everything checks out. 🎉';
  } else {
    const { error, warn, info } = report.counts;
    const bits = [];
    if (error) bits.push(`${error} ${error === 1 ? 'error' : 'errors'}`);
    if (warn) bits.push(`${warn} ${warn === 1 ? 'warning' : 'warnings'}`);
    if (info) bits.push(`${info} to review`);
    const n = report.issues.length;
    s.textContent = `Found ${n} ${n === 1 ? 'thing' : 'things'} to look at — ${bits.join(', ')}. Click a row to jump to it.`;
  }
  buildCheckList(report);
  openCheck();
}
// Toolbar affordance: tint the 🩺 button when the live city has any problems (recomputed on every
// refresh), so the checker advertises itself without the user having to open it.
function updateCheckButton() {
  const btn = $('btn-check');
  if (!btn || !grid) return;
  const report = checkCity(grid.getPlaced());
  const n = report.issues.length;
  btn.classList.toggle('has-issues', n > 0);
  const label = n ? `Check my city — ${n} ${n === 1 ? 'issue' : 'issues'} found` : 'Check my city';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
function openCheck() {
  $('check-backdrop').hidden = false;
  $('btn-check')?.setAttribute('aria-expanded', 'true');
  $('check-close')?.focus();
}
function closeCheck() {
  $('check-backdrop').hidden = true;
  $('btn-check')?.setAttribute('aria-expanded', 'false');
  $('btn-check')?.focus();
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
  grid.setScaleUnit(unitState); // PLAN-8: ruler labels follow the loaded city's unit
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
  grid.setScaleUnit(unitState); // PLAN-8: ruler labels follow the loaded city's unit
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
  grid.setScaleUnit(unitState); // PLAN-8: ruler labels follow the loaded city's unit
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
  try { catalog = await loadCatalog(); prices = catalog.prices || {}; packs = catalog.packs || {}; }
  catch (e) { $('catalog-list').innerHTML = `<div class="note">Couldn't load the set catalog. ${e.message}</div>`; return; }
  loadOwned();
  loadOverrides();
  loadShopFmt();
  loadFavorites();
  loadWishlist();
  loadRecent();
  loadLayerPrefs();
  kidMode = loadKidMode();

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
    onAnnounce: announce,
    onWarn: toast, // PLAN-10: radius-mismatch hard-warn surfaces as a toast
    onMode: drawToolMode,
    onRequestEdit: editObject,
    // QOL-8/10 view + interaction prefs, restored from local/session storage.
    layerVis, layerLocks, kidMode,
    // PLAN-8 scale-reference overlay, restored from localStorage (unit follows the toolbar toggle).
    scaleRef: getScaleRef(), scaleUnit: unitState,
    // 🧲 magnetic snapping, restored from localStorage (default on).
    snapEnabled: getSnapPref(),
  });
  applyKidMode(kidMode); // stamp the DOM attribute + button state (grid already has the flag)
  syncScaleRefButton(getScaleRef()); // reflect the restored overlay state on the toolbar button
  syncSnapButton(getSnapPref()); // reflect the restored snapping state on the toolbar button
  buildTerrainBar();

  catalogUI = renderCatalog(
    { list: $('catalog-list'), search: $('catalog-search'), chips: $('catalog-chips'),
      count: $('catalog-count'), sort: $('catalog-sort'), viewToggle: $('catalog-view'),
      legacy: $('catalog-legacy'), rail: $('catalog-rail') },
    catalog.sets, {
      onAdd: (s) => placeSet(s), onAddAt: (s, x, y) => placeSet(s, x, y), isOwned, onToggleOwn: toggleOwned,
      isFavorite, onToggleFavorite: toggleFavorite, getFavorites,
      isWishlisted, onToggleWishlist: toggleWishlist, getRecent,
    });

  // PLAN-7: "Custom baseplate…" action under the catalog chips.
  $('btn-custom-baseplate')?.addEventListener('click', addCustomBaseplate);

  // UI-3 / ACC-2c: theme + colorblind-safe toggles. The <head> inline script already stamped an
  // explicit stored choice pre-paint; this just syncs the buttons' icon/label/pressed state and
  // (for theme) keeps them in sync if the OS preference changes live while no explicit choice is set.
  syncThemeButton();
  applyCbSafe(getCbSafe());
  $('btn-theme')?.addEventListener('click', toggleTheme);
  $('btn-cbsafe')?.addEventListener('click', toggleCbSafe);
  $('btn-scaleref')?.addEventListener('click', toggleScaleRef);
  $('btn-snap')?.addEventListener('click', toggleSnapPref);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!getStoredTheme()) syncThemeButton(); }); }
  catch { /* older browsers without addEventListener on MediaQueryList — the button just won't live-sync */ }

  // Wave 6 (mobile): bottom-bar FABs open/close the catalog & summary sheets; the scrim and each
  // sheet's ✕ close it. All no-ops on desktop (the bar + scrim are display:none there).
  $('m-catalog')?.addEventListener('click', () => openSheet('catalog'));
  $('m-summary')?.addEventListener('click', () => openSheet('summary'));
  $('sheet-scrim')?.addEventListener('click', closeSheets);
  document.querySelectorAll('[data-sheet-close]').forEach((b) => b.addEventListener('click', closeSheets));

  // toolbar
  $('unit-toggle').addEventListener('click', (e) => {
    const u = e.target.dataset.unit; if (!u) return;
    unitState = u;
    $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target));
    grid.setScaleUnit(unitState); // PLAN-8: keep the ruler's labels on the current unit
    refresh();
  });
  $('btn-rotate').addEventListener('click', () => grid.rotateSelected());
  $('btn-dup')?.addEventListener('click', () => grid.duplicate()); // visible Duplicate (also Ctrl+D)
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
  // Wave 6 (touch): guard delete on a finger/pen so a stray tap can't nuke a piece — the first tap
  // arms ("Tap delete again"), a second within the window commits; a mouse still deletes on one
  // click (desktop unchanged). Reuses the toast + the grid's own undo, no modal. The pointerdown
  // records the real input device so a hybrid touchscreen laptop's MOUSE clicks stay immediate too.
  let delPressCoarse = false;
  $('btn-delete').addEventListener('pointerdown', (e) => {
    delPressCoarse = isCoarsePointer(e.pointerType, coarseMedia());
  });
  $('btn-delete').addEventListener('click', () => {
    if (!grid.getSelection().length) { disarmDelete(); return; } // nothing to delete → nothing to arm
    if (deleteNeedsConfirm(delPressCoarse, deleteArmed)) {
      deleteArmed = true;
      $('btn-delete').classList.add('armed');
      toast('Tap delete again to remove.');
      clearTimeout(deleteArmTimer);
      deleteArmTimer = setTimeout(disarmDelete, 2600);
      return;
    }
    disarmDelete();
    grid.deleteSelected();
  });

  // QOL-8: lock/unlock the selection + Kid Mode freeze-layout
  $('btn-lock').addEventListener('click', () => grid.toggleLockSelected());
  $('btn-kid').addEventListener('click', toggleKidMode);

  // Collapsible catalog / summary panels (desktop): collapse either to a thin rail so the city grid
  // gets more room to play in. State persists per browser.
  function setPanelCollapsed(which, collapsed) {
    const grid = document.querySelector('.grid3'); if (!grid) return;
    grid.classList.toggle(which === 'cat' ? 'cat-collapsed' : 'sum-collapsed', collapsed);
    try { localStorage.setItem('bcp.collapse.' + which, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }
  document.querySelectorAll('[data-collapse]').forEach((b) =>
    b.addEventListener('click', () => setPanelCollapsed(b.dataset.collapse, true)));
  document.querySelectorAll('[data-expand]').forEach((b) =>
    b.addEventListener('click', () => setPanelCollapsed(b.dataset.expand, false)));
  for (const which of ['cat', 'sum']) {
    try { if (localStorage.getItem('bcp.collapse.' + which) === '1') setPanelCollapsed(which, true); } catch { /* ignore */ }
  }

  // QOL-10: Layers show-hide/lock menu
  updateLayersButton();
  $('btn-layers').addEventListener('click', (e) => {
    e.stopPropagation();
    $('layers-menu').hidden ? openLayersMenu() : closeLayersMenu();
  });
  document.addEventListener('click', (e) => {
    if (!$('layers-menu').hidden && !e.target.closest('.layers-group')) closeLayersMenu();
  });

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
      if (isoOpen) closeIso();
      else if (!$('shortcuts-backdrop').hidden) closeShortcuts();
      else if (!$('check-backdrop').hidden) closeCheck();
      else if (!$('png-backdrop').hidden) closePngDialog();
      else if (!$('shop-backdrop').hidden) closeShopDialog();
      else if (!$('templates-backdrop').hidden) closeTemplatesMenu();
      else if (!$('cities-backdrop').hidden) closeCitiesMenu();
      else if (!$('layers-menu').hidden) { closeLayersMenu(); $('btn-layers').focus(); }
      else if (sheetsOpen()) closeSheets(); // Wave 6: Esc dismisses an open mobile catalog/summary sheet
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

  // PLAN-3: buildability checker
  $('btn-check')?.addEventListener('click', runCityCheck);
  $('check-close')?.addEventListener('click', closeCheck);
  $('check-backdrop')?.addEventListener('click', (e) => { if (e.target === $('check-backdrop')) closeCheck(); });
  $('check-modal')?.addEventListener('keydown', (e) => trapTabKey(e, $('check-modal')));

  // PLAN-4: PNG export dialog
  $('btn-png')?.addEventListener('click', openPngDialog);
  $('png-close')?.addEventListener('click', closePngDialog);
  $('png-cancel')?.addEventListener('click', closePngDialog);
  $('png-backdrop')?.addEventListener('click', (e) => { if (e.target === $('png-backdrop')) closePngDialog(); });
  $('png-modal')?.addEventListener('keydown', (e) => trapTabKey(e, $('png-modal')));
  $('png-scale')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scale]'); if (!b) return;
    pngScale = +b.dataset.scale; syncPngDialog();
  });
  $('png-edge')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-edge]'); if (!b) return;
    pngEdge = b.dataset.edge; syncPngDialog();
  });
  $('png-clean')?.addEventListener('change', (e) => { pngClean = e.target.checked; });
  $('png-card')?.addEventListener('change', (e) => { pngCard = e.target.checked; syncPngDialog(); });
  $('png-go')?.addEventListener('click', () => { closePngDialog(); doExportPng(); });

  // Round-1 feedback: shopping-list format chooser dialog
  $('shop-close')?.addEventListener('click', closeShopDialog);
  $('shop-backdrop')?.addEventListener('click', (e) => { if (e.target === $('shop-backdrop')) closeShopDialog(); });
  $('shop-modal')?.addEventListener('keydown', (e) => trapTabKey(e, $('shop-modal')));
  $('shop-modal')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fmt]'); if (!b) return;
    shopFmt = b.dataset.fmt; saveShopFmt(); closeShopDialog();
    ({ txt: doExportSetList, csv: doExportCsv, xml: doExportBricklink })[shopFmt]?.();
  });

  // PLAN-12: 3D / isometric preview overlay (read-only)
  $('btn-iso')?.addEventListener('click', toggleIso);
  $('iso-back')?.addEventListener('click', closeIso);
  // Coalesce a resize storm into at most one iso repaint per frame (mirrors grid.js's cullRaf) —
  // renderIso() re-sizes the canvas and runs an O(n log n) sort + full extruded-scene draw, so we
  // never want it firing on every raw resize event.
  let isoResizeRaf = 0;
  window.addEventListener('resize', () => {
    if (!isoOpen || isoResizeRaf) return;
    isoResizeRaf = requestAnimationFrame(() => { isoResizeRaf = 0; if (isoOpen) renderIso(); });
  });
  // Round-1 feedback: rotate the 3D view — ⟳ button (90° steps) + horizontal drag on the canvas
  // (smooth yaw, fixed pitch). Pointer events for mouse/touch parity; repaints are rAF-coalesced
  // like the resize handler above so a move storm costs one render per frame.
  $('iso-rotate')?.addEventListener('click', rotateIso);
  const isoCanvas = $('iso-canvas');
  let isoDragX = 0, isoDragYaw = 0, isoDragRaf = 0;
  isoCanvas?.addEventListener('pointerdown', (e) => {
    if (!isoOpen) return;
    isoDragging = true;
    isoDragX = e.clientX; isoDragYaw = isoYaw;
    try { isoCanvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  isoCanvas?.addEventListener('pointermove', (e) => {
    if (!isoDragging || !isoOpen) return;
    // ~0.56°/px → a full turn in ~640 px of drag. Vertical motion is ignored (pitch fixed).
    isoYaw = (isoDragYaw + (e.clientX - isoDragX) * (Math.PI / 320)) % (2 * Math.PI);
    if (isoYaw < 0) isoYaw += 2 * Math.PI;
    if (!isoDragRaf) isoDragRaf = requestAnimationFrame(() => { isoDragRaf = 0; if (isoOpen) renderIso(); });
  });
  const isoDragEnd = () => { isoDragging = false; };
  isoCanvas?.addEventListener('pointerup', isoDragEnd);
  isoCanvas?.addEventListener('pointercancel', isoDragEnd);

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
    grid.setScaleUnit(unitState); // PLAN-8: ruler labels follow the loaded city's unit
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
      grid.setScaleUnit(unitState); // PLAN-8: ruler labels follow the loaded city's unit
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
