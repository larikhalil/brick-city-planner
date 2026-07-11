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
let gridSize = { w: 128, h: 96, pw: 4, ph: 3 };
let catalog, grid;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
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

function drawSummary() { renderSummary($('summary'), grid.getPlaced(), catalog.byNum, unitState); wireSummaryButtons(); }
function drawDims() {
  const b = bbox(grid.getPlaced());
  $('grid-dims').textContent = b.w ? fmtDims(b.w, b.h, unitState) : 'empty';
}
function refresh() { drawSummary(); drawDims(); drawGridSize(); updateFirstRun(); }

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

function wireSummaryButtons() {
  const s = $('summary').querySelector('#btn-save');
  const e = $('summary').querySelector('#btn-export2');
  const l = $('summary').querySelector('#btn-setlist');
  if (s) s.addEventListener('click', doSave);
  if (e) e.addEventListener('click', doExport);
  if (l) l.addEventListener('click', doExportSetList);
}
// A shopping list of the sets placed: quantity × set number + name, grouped.
function doExportSetList() {
  const placed = grid.getPlaced();
  if (!placed.length) { toast('No sets placed yet.'); return; }
  const counts = new Map();
  for (const t of placed) {
    const num = t.set_num.replace(/-\d+$/, '');
    const e = counts.get(num) || { num, name: t.name, qty: 0 };
    e.qty += 1;
    counts.set(num, e);
  }
  const rows = [...counts.values()].sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true }));
  const lines = [
    `Brick City Planner — set list: ${cityName}`,
    `${rows.length} unique set${rows.length === 1 ? '' : 's'} · ${placed.length} to buy`,
    '',
    ...rows.map((r) => `${String(r.qty).padStart(2)} ×  ${r.num.padEnd(8)} ${r.name}`),
  ];
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${cityName.replace(/[^\w-]+/g, '_')}-setlist.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast('Set list exported.');
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

async function boot() {
  try { catalog = await loadCatalog(); }
  catch (e) { $('catalog-list').innerHTML = `<div class="note">Couldn't load the set catalog. ${e.message}</div>`; return; }

  try {
    const meta = await (await fetch('data/meta.json')).json();
    const l = document.querySelector('.legal');
    l.insertAdjacentHTML('beforeend', `<br><span style="opacity:.7">Catalog snapshot: ${meta.built} · ${meta.counts.sets} sets</span>`);
  } catch { /* non-fatal */ }

  grid = createGrid($('grid-board'), {
    onChange: () => { refresh(); autosave(); },
    onResize: (w, h) => { gridSize = { w, h, pw: w / 32, ph: h / 32 }; drawGridSize(); },
    onHistory: drawHistory,
    onSelect: drawSelection,
  });

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
  $('btn-forward').addEventListener('click', () => grid.bringForward());
  $('btn-back').addEventListener('click', () => grid.sendBackward());

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
    else if (e.key === 'Escape' && !$('shortcuts-backdrop').hidden) { closeShortcuts(); }
  });

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
    if (set) grid.addSetAt(set, e.clientX, e.clientY);
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
}
boot();
