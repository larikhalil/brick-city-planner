import { loadCatalog } from './data.js';
import { renderCatalog } from './catalog.js';
import { createGrid } from './grid.js';
import { renderSummary } from './summary.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    $('catalog-list').innerHTML = `<div class="note">Couldn't load the set catalog. ${e.message}</div>`;
    return;
  }
  let unitState = 'studs';
  const autosave = () => {/* real save in Task 18 */};
  const drawSummary = () => renderSummary($('summary'), grid.getPlaced(), catalog.byNum, unitState);
  const grid = createGrid($('grid-board'), { onChange: () => { drawSummary(); autosave(); } });
  renderCatalog(
    { list: $('catalog-list'), search: $('catalog-search'), chips: $('catalog-chips'), count: $('catalog-count') },
    catalog.sets,
    { onAdd: (s) => grid.addSet(s) },
  );
  $('btn-rotate').addEventListener('click', () => grid.rotateSelected());
  $('btn-delete').addEventListener('click', () => grid.deleteSelected());
  $('zoom-ctrl').addEventListener('click', (e) => {
    const z = e.target.dataset.zoom;
    if (z === 'in') grid.zoomBy(0.15);
    else if (z === 'out') grid.zoomBy(-0.15);
    else if (z === 'reset') grid.setZoom(1);
    else if (z === 'fit') grid.fit();
  });
  drawSummary();
}
boot();
