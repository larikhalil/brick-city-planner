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
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCity(serializeCity(citySnapshot()));
  }, 600);
}
function flushAutosave() {
  clearTimeout(saveTimer);
  saveCity(serializeCity(citySnapshot()));
}

function drawSummary() { renderSummary($('summary'), grid.getPlaced(), catalog.byNum, unitState); wireSummaryButtons(); }
function drawDims() {
  const b = bbox(grid.getPlaced());
  $('grid-dims').textContent = b.w ? fmtDims(b.w, b.h, unitState) : 'empty';
}
function refresh() { drawSummary(); drawDims(); drawGridSize(); }

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
  saveCity(serializeCity(citySnapshot()));
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

  // Table-size stepper: ± one baseplate per axis.
  $('grid-size').addEventListener('click', (e) => {
    const a = e.target.dataset.gs; if (!a) return;
    const { pw, ph } = gridSize;
    const next = { wdec: [pw - 1, ph], winc: [pw + 1, ph], hdec: [pw, ph - 1], hinc: [pw, ph + 1] }[a];
    if (next) grid.setGridPlates(next[0], next[1]);
  });
  $('btn-delete').addEventListener('click', () => grid.deleteSelected());

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
}
boot();
