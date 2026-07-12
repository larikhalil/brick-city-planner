import { esc } from './util.js';
import { schematicSVG } from './schematic.js';
import { buyLinks, PIECE_PRICE } from './pricing.js';

const CATS = [
  ['all', 'All', null], ['baseplate', 'Baseplates', 'var(--g-green)'],
  ['road', 'Roads', 'var(--road)'], ['track', 'Tracks', 'var(--track)'],
  ['police', 'Police', 'var(--t-police)'],
  ['fire', 'Fire', 'var(--t-fire)'], ['train', 'Trains', 'var(--t-train)'],
  ['modular', 'Modular', 'var(--t-modular)'], ['city', 'Town', 'var(--t-city)'],
];
const CAT_VAR = {
  police: 'var(--t-police)', fire: 'var(--t-fire)', train: 'var(--t-train)',
  modular: 'var(--t-modular)', city: 'var(--t-city)',
  park: 'var(--t-park)', space: 'var(--t-space)', arctic: 'var(--t-police)',
  harbor: 'var(--t-city)', farm: 'var(--t-park)', airport: 'var(--t-city)',
  baseplate: 'var(--g-gray)', road: 'var(--road)', track: 'var(--track)', other: 'var(--t-city)',
};

export function catColor(category) { return CAT_VAR[category] || 'var(--t-city)'; }

// Effective price used only for sorting: real MSRP when known, else the rough piece estimate,
// so every set has a comparable number.
function sortPrice(s) { return Number.isFinite(s.price) ? s.price : (s.pieces || 0) * PIECE_PRICE; }

const SORTS = {
  default: null, // keep the catalog's natural (build) order
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
  'price-asc': (a, b) => sortPrice(a) - sortPrice(b),
  'price-desc': (a, b) => sortPrice(b) - sortPrice(a),
  'pieces-desc': (a, b) => (b.pieces || 0) - (a.pieces || 0),
  'year-desc': (a, b) => (b.year || 0) - (a.year || 0),
};

const VIEW_KEY = 'bcp.catView';

export function renderCatalog(els, sets, {
  onAdd, isOwned = () => false, onToggleOwn = () => {},
  isFavorite = () => false, onToggleFavorite = () => {}, getFavorites = () => [],
  isWishlisted = () => false, onToggleWishlist = () => {},
  getRecent = () => [],
} = {}) {
  let text = '', category = 'all', sort = 'default';
  const byNum = new Map(sets.map((s) => [s.set_num, s])); // for resolving rail thumbnails

  // ---- UI-4: list/grid view toggle, remembered in localStorage ----------------
  let view = 'list';
  try { view = localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { view = 'list'; }
  function applyView() {
    els.list.classList.toggle('view-grid', view === 'grid');
    els.viewToggle?.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  els.viewToggle?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    view = b.dataset.view;
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* private browsing, ignore */ }
    applyView();
  });

  els.chips.innerHTML = '';
  for (const [key, label, color] of CATS) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (key === 'all' ? ' on' : '');
    chip.dataset.cat = key;
    chip.innerHTML = (color ? `<i class="dot" style="background:${color}"></i>` : '') + label;
    chip.addEventListener('click', () => {
      category = key;
      els.chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
      draw();
    });
    els.chips.appendChild(chip);
  }

  els.search.addEventListener('input', () => { text = els.search.value.trim().toLowerCase(); draw(); });
  els.sort?.addEventListener('change', () => { sort = els.sort.value; draw(); });

  function match(s) {
    if (category !== 'all' && s.category !== category) return false;
    if (!text) return true;
    return s.name.toLowerCase().includes(text) || s.num.includes(text);
  }

  function draw() {
    let filtered = sets.filter(match);
    const cmp = SORTS[sort];
    if (cmp) filtered = filtered.slice().sort(cmp);
    const shown = filtered.slice(0, 400); // cap DOM for perf
    els.count.textContent = `${filtered.length} sets`;
    const scroll = els.list.scrollTop; // preserve scroll position across in-place refreshes (owned/wishlist toggles)
    els.list.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const s of shown) frag.appendChild(row(s));
    els.list.appendChild(frag);
    els.list.scrollTop = scroll;
  }

  // Small "own this" star + retailer buy links live on every row. Owned state is app/localStorage
  // state (never part of the placed[]/undo model), so toggling only re-styles the button and
  // notifies the app — no redraw, so scroll position is kept.
  function priceLabel(s) {
    if (Number.isFinite(s.price)) return `<span class="price" title="Known retail price">$${s.price.toFixed(2)}</span>`;
    const est = Math.round((s.pieces || 0) * PIECE_PRICE);
    return est ? `<span class="price est" title="Estimated (~$${PIECE_PRICE}/piece)">≈$${est}</span>` : '';
  }
  function buyLinksHtml(s) {
    return buyLinks(s.set_num, s.name).map((l) =>
      `<a class="buy" href="${esc(l.href)}" target="_blank" rel="noopener" title="${esc(l.title)}">${esc(l.label)}</a>`).join('');
  }

  function row(s) {
    const approx = s.footprint.source !== 'curated';
    const owned = !!isOwned(s.set_num);
    const faved = !!isFavorite(s.set_num);
    const wished = !!isWishlisted(s.set_num);
    const el = document.createElement('div');
    el.className = 'set' + (owned ? ' owned' : '');
    el.innerHTML = `
      <div class="swatch" style="background:${s.color || catColor(s.category)}">${
        s.img ? `<img src="${s.img}" alt="" loading="lazy" draggable="false"
          style="width:100%;height:100%;object-fit:cover"
          onerror="this.remove()">` : schematicSVG(s.kind, s.footprint, s.name)}</div>
      <div class="set-meta"><div class="set-name" title="${esc(s.name)}">${esc(s.name)}</div>
        <div class="set-sub"><span>${esc(s.num)}</span><span>${s.year || ''}</span>
          <span class="fp${approx ? ' approx' : ''}">${approx ? '≈ ' : ''}${s.footprint.w}×${s.footprint.h}</span>
          ${priceLabel(s)}
        </div>
        <div class="buys">${buyLinksHtml(s)}</div>
      </div>
      <div class="set-actions">
        <button class="own" aria-label="Mark ${esc(s.name)} as owned" aria-pressed="${owned}"
          title="I own this set">${owned ? '★' : '☆'}</button>
        <button class="fav" aria-label="${faved ? 'Remove' : 'Add'} ${esc(s.name)} ${faved ? 'from' : 'to'} favorites"
          aria-pressed="${faved}" title="Favorite — quick re-place from the rail above">${faved ? '♥' : '♡'}</button>
        <button class="wish" aria-label="${wished ? 'Remove' : 'Add'} ${esc(s.name)} ${wished ? 'from' : 'to'} wishlist"
          aria-pressed="${wished}" title="Wishlist — save to buy later, see the summary panel">🛒</button>
        <button class="add" aria-label="Add ${esc(s.name)}">＋</button>
      </div>`;
    el.querySelector('.add').addEventListener('click', () => onAdd(s));
    const star = el.querySelector('.own');
    star.addEventListener('click', () => {
      const now = onToggleOwn(s.set_num);
      star.setAttribute('aria-pressed', String(now));
      star.textContent = now ? '★' : '☆';
      el.classList.toggle('owned', now);
    });
    // Favorite (♡/♥) is distinct from "owned" (☆/★) — favoriting just pins the set to the
    // rail above for quick one-click re-placement. Purely a catalog/rail concern, so only the
    // rail needs to redraw (never the summary).
    const fav = el.querySelector('.fav');
    fav.addEventListener('click', () => {
      const now = onToggleFavorite(s.set_num);
      fav.setAttribute('aria-pressed', String(now));
      fav.textContent = now ? '♥' : '♡';
      fav.setAttribute('aria-label', `${now ? 'Remove' : 'Add'} ${s.name} ${now ? 'from' : 'to'} favorites`);
      drawRail();
    });
    // Wishlist (🛒) is distinct again — saved-to-buy-later, tracked in its own panel with its
    // own subtotal in the summary card. Its state lives entirely outside the catalog, so the app
    // owns the redraw (drawSummary + a full catalog refresh to keep every row's button in sync).
    const wish = el.querySelector('.wish');
    wish.addEventListener('click', () => {
      const now = onToggleWishlist(s.set_num);
      wish.setAttribute('aria-pressed', String(now));
      wish.setAttribute('aria-label', `${now ? 'Remove' : 'Add'} ${s.name} ${now ? 'from' : 'to'} wishlist`);
    });
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/bcp-set', s.set_num);
      e.dataTransfer.effectAllowed = 'copy';
    });
    return el;
  }

  // ---- QOL-7: recently-used + favorites rail, pinned above the catalog list -----------------
  // Both strips place another copy of a set with one click via the same onAdd path as the
  // catalog rows and drag-drop. Recent is app-owned (tracks placements); favorites is the ♡/♥
  // toggle on each row above.
  function railItem(setNum) {
    const s = byNum.get(setNum);
    if (!s) return null; // stale reference (catalog changed) — skip rather than crash
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rail-item';
    b.title = `${s.name} (${s.num}) — click to place another`;
    b.setAttribute('aria-label', `Place another ${s.name}`);
    b.innerHTML = `<span class="swatch" style="background:${s.color || catColor(s.category)}">${
      s.img ? `<img src="${s.img}" alt="" loading="lazy" draggable="false"
        style="width:100%;height:100%;object-fit:cover" onerror="this.remove()">`
        : schematicSVG(s.kind, s.footprint, s.name)}</span>`;
    b.addEventListener('click', () => onAdd(s));
    return b;
  }
  function railStrip(label, nums) {
    if (!nums.length) return null;
    const sec = document.createElement('div');
    sec.className = 'rail-sec';
    const lbl = document.createElement('span');
    lbl.className = 'rail-lbl';
    lbl.textContent = label;
    const strip = document.createElement('div');
    strip.className = 'rail-strip';
    for (const n of nums) { const it = railItem(n); if (it) strip.appendChild(it); }
    sec.append(lbl, strip);
    return sec;
  }
  function drawRail() {
    if (!els.rail) return;
    const recentNums = getRecent().filter((n) => byNum.has(n));
    const favNums = getFavorites().filter((n) => byNum.has(n));
    els.rail.innerHTML = '';
    els.rail.hidden = !recentNums.length && !favNums.length;
    if (els.rail.hidden) return;
    const frag = document.createDocumentFragment();
    const recentSec = railStrip('Recent', recentNums);
    const favSec = railStrip('♥ Favorites', favNums);
    if (recentSec) frag.appendChild(recentSec);
    if (favSec) frag.appendChild(favSec);
    els.rail.appendChild(frag);
  }

  applyView();
  draw();
  drawRail();
  return {
    setFilter(t, c) {
      text = t;
      category = c;
      els.search.value = t;
      els.chips.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip.dataset.cat === c));
      draw();
    },
    refresh: draw, // re-render rows (e.g. after owned/wishlist state changes elsewhere)
    refreshRail: drawRail, // cheap redraw of just the recent/favorites rail
  };
}
