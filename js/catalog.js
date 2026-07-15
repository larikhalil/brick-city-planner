import { esc } from './util.js';
import { schematicSVG } from './schematic.js';
import { buyLinks, PIECE_PRICE } from './pricing.js';
import { isCoarsePointer } from './pointer.js';

const CATS = [
  ['all', 'All', null], ['baseplate', 'Baseplates', 'var(--g-green)'],
  ['road', 'Roads', 'var(--road)'], ['track', 'Tracks', 'var(--track)'],
  ['police', 'Police', 'var(--t-police)'],
  ['fire', 'Fire', 'var(--t-fire)'], ['train', 'Trains', 'var(--t-train)'],
  ['modular', 'Modular', 'var(--t-modular)'], ['city', 'Town', 'var(--t-city)'],
  ['pack', 'Packs', 'var(--t-park)'], // round-1 feedback 3a: accessory-pack pieces (plants, lamps…)
];
const CAT_VAR = {
  police: 'var(--t-police)', fire: 'var(--t-fire)', train: 'var(--t-train)',
  modular: 'var(--t-modular)', city: 'var(--t-city)',
  park: 'var(--t-park)', space: 'var(--t-space)', arctic: 'var(--t-police)',
  harbor: 'var(--t-city)', farm: 'var(--t-park)', airport: 'var(--t-city)',
  baseplate: 'var(--g-green)', road: 'var(--road)', track: 'var(--track)',
  pack: 'var(--t-park)', other: 'var(--t-city)',
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
const LEGACY_KEY = 'bcp.catLegacy'; // round-1 feedback 2b: include retired sets? default OFF

// Pure filter predicate (exported for tests): the Legacy gate first — with legacy off, retired
// sets are hidden (records without the flag, e.g. pieces.json primitives, always pass) — then
// category equality AND name/number substring match. The ~700 individual pack elements (kind
// 'decor') only surface under their own Packs chip or via search, so browsing All stays about
// real sets.
export function matchesFilter(s, { text = '', category = 'all', legacy = false } = {}) {
  if (!legacy && s.retired) return false;
  if (category === 'all' && !text && s.kind === 'decor') return false;
  if (category !== 'all' && s.category !== category) return false;
  if (!text) return true;
  return s.name.toLowerCase().includes(text) || s.num.includes(text);
}

export function renderCatalog(els, sets, {
  onAdd, onAddAt = null, isOwned = () => false, onToggleOwn = () => {},
  isFavorite = () => false, onToggleFavorite = () => {}, getFavorites = () => [],
  isWishlisted = () => false, onToggleWishlist = () => {},
  getRecent = () => [],
} = {}) {
  let text = '', category = 'all', sort = 'default';
  // 2b: Legacy toggle — OFF by default so the catalog shows only sets you can still buy new.
  let legacy = false;
  try { legacy = localStorage.getItem(LEGACY_KEY) === '1'; } catch { /* default stands */ }
  const byNum = new Map(sets.map((s) => [s.set_num, s])); // for resolving rail thumbnails

  // ---- Wave 6 (mobile/touch): finger/pen catalog→canvas drag, ALONGSIDE the mouse HTML5 DnD -----
  // HTML5 drag-and-drop never fires for touch, so a finger gets its own Pointer-Events path: press
  // the set's thumbnail (its `touch-action:none` swatch, so the gesture isn't stolen as a scroll),
  // a floating ghost follows the finger, and on release we hit-test the drop point and hand off to
  // the SAME onAddAt(set, clientX, clientY) the mouse `drop` handler uses. Released off the board it
  // just cancels — the per-row '＋' tap-to-add stays as the always-available fallback. Mouse pointers
  // are ignored here entirely (isCoarsePointer=false), so the desktop drag experience is untouched.
  const coarseMedia = () => { try { return matchMedia('(pointer:coarse)').matches; } catch { return false; } };
  function startTouchDrag(s, ev, handle) {
    if (!onAddAt) return; // no drop sink wired → fall back to the '＋' button / HTML5 DnD only
    ev.preventDefault();
    // Mobile only: the catalog is a bottom-sheet whose panel (z56) + scrim (z55) blanket the
    // viewport, so #grid-stage sits BEHIND them and document.elementFromPoint at drop can never
    // reach the board. Flag the drag on <body> for the duration: the ≤760px CSS slides the sheet
    // out of the way + drops the scrim's pointer-events, revealing the board both visually and as
    // the topmost hit-test target. setPointerCapture keeps the drag alive as the panel slides away.
    // Inert at ≥761px (no such rule), so a wide-screen touch device is unaffected.
    document.body.classList.add('bcp-dragging-set');
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = handle.innerHTML; // reuse the thumbnail art (img or schematic)
    const move = (x, y) => { ghost.style.left = x + 'px'; ghost.style.top = y + 'px'; };
    move(ev.clientX, ev.clientY);
    document.body.appendChild(ghost);
    try { handle.setPointerCapture(ev.pointerId); } catch { /* capture unsupported — events still bubble */ }
    function mv(e) {
      if (e.pointerId !== ev.pointerId) return;
      e.preventDefault();
      move(e.clientX, e.clientY);
    }
    function done(e, drop) {
      if (e.pointerId !== ev.pointerId) return;
      handle.removeEventListener('pointermove', mv);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      ghost.remove(); // remove BEFORE hit-testing so elementFromPoint sees the board, not the ghost
      // Hit-test WHILE bcp-dragging-set is still applied (scrim pointer-events:none, panel slid off),
      // otherwise the scrim (inset:0, z55) reappears over the board and steals elementFromPoint.
      let onBoard = false;
      if (drop) {
        const over = document.elementFromPoint?.(e.clientX, e.clientY);
        onBoard = !!(over && over.closest && over.closest('#grid-stage'));
      }
      document.body.classList.remove('bcp-dragging-set'); // now restore the sheet (slides back if not dropped)
      if (onBoard) onAddAt(s, e.clientX, e.clientY);
    }
    function up(e) { done(e, true); }
    function cancel(e) { done(e, false); }
    handle.addEventListener('pointermove', mv);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
  }

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
    const chip = document.createElement('button'); // a real button: pointer cursor, no text-select, keyboard-operable
    chip.type = 'button';
    chip.className = 'chip' + (key === 'all' ? ' on' : '');
    chip.dataset.cat = key;
    chip.setAttribute('aria-pressed', key === 'all' ? 'true' : 'false');
    chip.innerHTML = (color ? `<i class="dot" style="background:${color}"></i>` : '') + label;
    chip.addEventListener('click', () => {
      category = key;
      els.chips.querySelectorAll('.chip').forEach((c) => {
        const on = c === chip; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on));
      });
      draw();
    });
    els.chips.appendChild(chip);
  }

  els.search.addEventListener('input', () => { text = els.search.value.trim().toLowerCase(); draw(); });
  els.sort?.addEventListener('change', () => { sort = els.sort.value; draw(); });
  // 2b: Legacy checkbox — persisted like the view toggle above.
  if (els.legacy) els.legacy.checked = legacy;
  els.legacy?.addEventListener('change', () => {
    legacy = els.legacy.checked;
    try { localStorage.setItem(LEGACY_KEY, legacy ? '1' : '0'); } catch { /* private browsing, ignore */ }
    draw();
  });

  function match(s) { return matchesFilter(s, { text, category, legacy }); }

  function draw() {
    hidePop(); // a re-render invalidates whatever row the preview belonged to
    let filtered = sets.filter(match);
    const cmp = SORTS[sort];
    if (cmp) filtered = filtered.slice().sort(cmp);
    const shown = filtered.slice(0, 400); // cap DOM for perf
    // With Legacy off, say how many retired sets the current search/category is hiding — that's
    // how users discover the toggle.
    const hidden = legacy ? 0
      : sets.filter((s) => matchesFilter(s, { text, category, legacy: true })).length - filtered.length;
    // Two-line block: the live count, then (if any) how many retired sets the Legacy toggle hides.
    // Kept as its own lines so it never wraps mid-phrase or spills out of the panel header.
    els.count.innerHTML = `<b>${filtered.length} sets</b>` +
      (hidden > 0 ? `<small>${hidden.toLocaleString()} retired hidden</small>` : '');
    const scroll = els.list.scrollTop; // preserve scroll position across in-place refreshes (owned/wishlist toggles)
    els.list.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const s of shown) frag.appendChild(row(s));
    els.list.appendChild(frag);
    els.list.scrollTop = scroll;
  }

  // ---- 5b: enlarged hover preview (mouse only) -------------------------------------------------
  // One shared fixed-position node (pattern: .drag-ghost); pointer-events:none so it can never
  // steal the hover. Touch is excluded — a coarse-pointer press on the swatch already starts the
  // drag ghost, and the bigger swatches are the touch answer.
  let pop = null;
  const finePointer = () => { try { return matchMedia('(hover:hover) and (pointer:fine)').matches; } catch { return false; } };
  function hidePop() { pop?.remove(); pop = null; }
  els.list.addEventListener('mouseover', (e) => {
    if (!finePointer()) return;
    const rowEl = e.target.closest?.('.set');
    const img = rowEl?.querySelector('.swatch img');
    if (!rowEl || !img) { hidePop(); return; }
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'thumb-pop';
      pop.setAttribute('aria-hidden', 'true');
      document.body.appendChild(pop);
    }
    pop.innerHTML = `<img src="${esc(img.getAttribute('src'))}" alt="">`;
    const r = rowEl.getBoundingClientRect();
    pop.style.top = Math.max(8, Math.min(r.top, (window.innerHeight || 600) - 244)) + 'px';
    pop.style.left = (r.right + 10) + 'px';
  });
  els.list.addEventListener('mouseleave', hidePop);
  els.list.addEventListener('scroll', hidePop, { passive: true });
  els.list.addEventListener('dragstart', hidePop, true); // don't let the popup shadow a mouse drag

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
    const approx = s.footprint.source === 'estimated'; // derived (inventory-based) sizes are trusted
    const owned = !!isOwned(s.set_num);
    const faved = !!isFavorite(s.set_num);
    const wished = !!isWishlisted(s.set_num);
    const el = document.createElement('div');
    el.className = 'set' + (owned ? ' owned' : '');
    // Keep a trailing " — 48×48" size as one non-breaking unit so the title never wraps mid-phrase
    // leaving a dangling em dash ("Baseplate —" / "48×48").
    const nameHtml = esc(s.name).replace(/ — (.+)$/, ' <span class="nm-dim">— $1</span>');
    el.innerHTML = `
      <div class="swatch${s.img ? ' has-img' : ''}" data-cat="${esc(s.category)}" style="background:${s.color || catColor(s.category)}">${
        s.img ? `<img src="${s.img}" alt="" loading="lazy" draggable="false"
          style="width:100%;height:100%;object-fit:contain"
          onerror="this.remove()">` : schematicSVG(s.kind, s.footprint, s.name)}</div>
      <div class="set-meta"><div class="set-name" title="${esc(s.name)}${s.year ? ` (${s.year})` : ''}">${nameHtml}</div>
        <div class="set-sub"><span class="set-num">${esc(s.num)}${s.year ? ` · ${s.year}` : ''}</span>
          ${s.retired ? '<span class="ret" title="Retired set — LEGO no longer sells it new; find it second-hand (BrickLink / Amazon)">Retired</span>' : ''}
          <span class="fp${approx ? ' approx' : ''}">${approx ? '≈ ' : ''}${s.footprint.w}×${s.footprint.h}</span>
          ${priceLabel(s)}
        </div>
        <div class="buys">${buyLinksHtml(s)}</div>
        <div class="set-actions">
        <button class="own" aria-label="Mark ${esc(s.name)} as owned" aria-pressed="${owned}"
          title="I own this set"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 2.3 4.9 5.4.7-4 3.8 1 5.4L12 16.9 7.3 19.6l1-5.4-4-3.8 5.4-.7Z"/></svg></button>
        <button class="fav" aria-label="${faved ? 'Remove' : 'Add'} ${esc(s.name)} ${faved ? 'from' : 'to'} favorites"
          aria-pressed="${faved}" title="Favorite — quick re-place from the rail above"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.6-7-9.6A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 3.4c0 5-7 9.6-7 9.6Z"/></svg></button>
        <button class="wish" aria-label="${wished ? 'Remove' : 'Add'} ${esc(s.name)} ${wished ? 'from' : 'to'} wishlist"
          aria-pressed="${wished}" title="Wishlist — save to buy later, see the summary panel"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h2l1.6 9.4a1.5 1.5 0 0 0 1.5 1.2h7.2a1.5 1.5 0 0 0 1.5-1.2L20 8H7"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg></button>
        <button class="add" aria-label="Add ${esc(s.name)}" title="Add to the grid"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button>
        </div>
      </div>`;
    el.querySelector('.add').addEventListener('click', () => onAdd(s));
    const star = el.querySelector('.own');
    star.addEventListener('click', () => {
      const now = onToggleOwn(s.set_num);
      star.setAttribute('aria-pressed', String(now)); // filled-star state is CSS-driven off aria-pressed
      el.classList.toggle('owned', now);
    });
    // Favorite (♡/♥) is distinct from "owned" (☆/★) — favoriting just pins the set to the
    // rail above for quick one-click re-placement. Purely a catalog/rail concern, so only the
    // rail needs to redraw (never the summary).
    const fav = el.querySelector('.fav');
    fav.addEventListener('click', () => {
      const now = onToggleFavorite(s.set_num);
      fav.setAttribute('aria-pressed', String(now)); // filled-heart state is CSS-driven off aria-pressed
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
    // Wave 6: a finger/pen press on the thumbnail starts the custom touch drag (see startTouchDrag).
    // Gated to coarse pointers so a mouse keeps using the HTML5 DnD above unchanged; gated to the
    // swatch so the rest of the row (name, buy links, ☆/♥/🛒/＋ buttons) stays tappable and the
    // catalog list still scrolls under a finger everywhere except the grab handle.
    const swatch = el.querySelector('.swatch');
    swatch?.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return; // primary contact only
      if (!isCoarsePointer(e.pointerType, coarseMedia())) return; // mouse → leave HTML5 DnD alone
      startTouchDrag(s, e, swatch);
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
    b.innerHTML = `<span class="swatch${s.img ? ' has-img' : ''}" data-cat="${esc(s.category)}" style="background:${s.color || catColor(s.category)}">${
      s.img ? `<img src="${s.img}" alt="" loading="lazy" draggable="false"
        style="width:100%;height:100%;object-fit:contain" onerror="this.remove()">`
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
      els.chips.querySelectorAll('.chip').forEach((chip) => {
        const on = chip.dataset.cat === c; chip.classList.toggle('on', on); chip.setAttribute('aria-pressed', String(on));
      });
      draw();
    },
    refresh: draw, // re-render rows (e.g. after owned/wishlist state changes elsewhere)
    refreshRail: drawRail, // cheap redraw of just the recent/favorites rail
  };
}
