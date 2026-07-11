import { loadCatalog } from './data.js';
import { renderCatalog } from './catalog.js';
import { createGrid } from './grid.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    $('catalog-list').innerHTML = `<div class="note">Couldn't load the set catalog. ${e.message}</div>`;
    return;
  }
  const grid = createGrid($('grid-board'), { onChange: () => {/* summary in Task 17 */} });
  renderCatalog(
    { list: $('catalog-list'), search: $('catalog-search'), chips: $('catalog-chips'), count: $('catalog-count') },
    catalog.sets,
    { onAdd: (s) => grid.addSet(s) },
  );
}
boot();
