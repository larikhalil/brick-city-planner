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
function flushAutosave() {
  clearTimeout(saveTimer);
  saveCity(serializeCity({ name: cityName, units: unitState, placed: grid.getPlaced() }));
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
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
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
    grid.setPlaced(res.city.placed);
    $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === unitState));
    refresh(); toast(`Loaded “${cityName}”.`); e.target.value = '';
  });

  // restore last autosaved city
  try {
    const last = currentCityName() && loadCity(currentCityName());
    if (last && Array.isArray(last.placed)) {
      cityName = last.name || 'Untitled city';
      unitState = last.units || 'studs';
      grid.setPlaced(last.placed);
      $('unit-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === unitState));
    }
  } catch (err) {
    console.warn('Could not restore saved city:', err.message);
  }
  refresh();
}
boot();
