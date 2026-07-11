import { loadCatalog } from './data.js';
import { renderCatalog } from './catalog.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    $('catalog-list').innerHTML = `<div class="note">Couldn't load the set catalog. ${e.message}</div>`;
    return;
  }
  renderCatalog(
    { list: $('catalog-list'), search: $('catalog-search'), chips: $('catalog-chips'), count: $('catalog-count') },
    catalog.sets,
    { onAdd: (s) => console.log('add', s.num) }, // grid wired in Task 13
  );
}
boot();
