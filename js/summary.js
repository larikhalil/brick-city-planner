import { bbox, anyOverlaps } from './geometry.js';
import { fmtDims, fmtArea, studsToCm } from './units.js';
import { catColor } from './catalog.js';
import { esc } from './util.js';
import { cityCost, baseNum, packRollup } from './pricing.js';
import { isCitySet, isPhysical } from './objects.js';

// opts: { prices, owned, overrides, packs, onToggleOwn, wishlist, onPromoteWishlist, onRemoveWishlist }
// — all app/localStorage state, never part of the placed[]/undo model. Omitting them keeps the
// summary working (empty maps / no toggles).
export function renderSummary(el, placed, byNum, unit = 'studs', opts = {}) {
  const {
    prices = {}, owned = new Set(), overrides = {}, packs = {}, onToggleOwn = null, onSetPrice = null,
    wishlist = new Set(), onPromoteWishlist = null, onRemoveWishlist = null,
    onFind = null, onDelete = null, onFindCat = null, // click a summary row → find on grid / delete
  } = opts;
  const ownedSet = owned instanceof Set ? owned : new Set(owned);

  // Terrain fills, sticky notes and custom MOC blocks aren't catalog sets — they carry no price,
  // piece count or category, so every purchasing/inventory figure below is computed over the real
  // sets only. Footprint spans the physical objects (sets + custom blocks, but not paint/notes).
  const sets = placed.filter(isCitySet);
  const physical = placed.filter(isPhysical);

  const box = bbox(physical);
  const pieces = sets.reduce((n, t) => n + (byNum.get(t.set_num)?.pieces || 0), 0);
  const over = anyOverlaps(placed);
  const overlapCount = over.size ? Math.ceil(over.size / 2) : 0;
  const approxCount = sets.filter((t) => t.approx).length;

  // Round-1 feedback 3b: placed pack pieces (plants, lamps, track segments…) roll up into whole
  // PACK purchases — one fake placed entry per box needed, the same trick the wishlist uses.
  const { plain, packRows, spares } = packRollup(sets, byNum, packs);
  const costTiles = plain.concat(packRows.flatMap((pr) => Array.from({ length: pr.qty }, () => ({ set_num: pr.set_num }))));

  // Per-set piece counts feed the cost estimate fallback for sets with no known price.
  const pieceMap = {};
  for (const t of costTiles) pieceMap[baseNum(t.set_num)] = byNum.get(t.set_num)?.pieces || 0;
  const cost = cityCost(costTiles, { prices, owned: ownedSet, overrides, pieces: pieceMap });
  const money = (n) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const counts = {};
  for (const t of sets) counts[t.category] = (counts[t.category] || 0) + 1;
  const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sets.length || 1;

  // Unique sets, richest info first, for the owned/buy list. A friendly name comes from the
  // catalog when we have it (placed tiles carry only the raw name).
  const nameOf = (num) => {
    const t = placed.find((p) => baseNum(p.set_num) === num);
    return byNum.get(t?.set_num)?.name || t?.name || byNum.get(`${num}-1`)?.name || num;
  };
  // Round-1 feedback 2a: catalog record for a bare set number (to badge retired sets in the lists).
  // Pack rows have no placed tile of their own, so fall back to the '<num>-1' catalog record.
  const recOf = (num) => byNum.get(placed.find((p) => baseNum(p.set_num) === num)?.set_num) || byNum.get(`${num}-1`);
  const retBadge = (rec) => (rec?.retired
    ? ' <span class="ret" title="Retired — LEGO no longer sells this new; budget for second-hand prices">Retired</span>' : '');

  // ---- PLAN-6: wishlist — saved-to-buy-later, entirely separate from the grid budget above.
  // Reuses cityCost() (one fake "placed" entry per wishlisted set, qty always 1) rather than a
  // parallel cost function. Rebrickable set numbers are 1:1 with their bare number in this
  // catalog (no two variants of the same set coexist), so baseNum → exact set_num is safe here.
  const wishlistSet = wishlist instanceof Set ? wishlist : new Set(wishlist);
  const wishNums = [...wishlistSet].filter((n) => byNum.has(n));
  const numToExact = new Map(wishNums.map((n) => [baseNum(n), n]));
  const wishPieces = {};
  for (const n of wishNums) wishPieces[baseNum(n)] = byNum.get(n)?.pieces || 0;
  const wishCost = cityCost(wishNums.map((n) => ({ set_num: n })), { prices, overrides, pieces: wishPieces });
  const wishRows = wishCost.lines
    .map((ln) => ({ ...ln, exact: numToExact.get(ln.num), set: byNum.get(numToExact.get(ln.num)) }))
    .filter((r) => r.set);
  // renderSummary rebuilds innerHTML wholesale on every grid change (a tile move, autosave tick,
  // etc.) — remember whether the wishlist <details> was left open so it doesn't keep snapping shut.
  const wishOpen = el.querySelector('.wishlist-panel')?.open;
  const sparesOpen = el.querySelector('.spares-panel')?.open;

  // Round-1 feedback 3b: spare parts — what's left in each pack after placing what you used.
  const spareEntries = Object.entries(spares);
  const spareCount = spareEntries.reduce((n, [, s]) => n + s.leftovers.reduce((m, l) => m + l.qty, 0), 0);
  const sparesHtml = spareEntries.length ? `
    <details class="spares-panel"${sparesOpen ? ' open' : ''}>
      <summary>🧩 Spare parts <span class="count-pill">${spareCount}</span></summary>
      <div class="spares-body">
        ${spareEntries.map(([num, s]) => `
          <div class="sp-pack"><b>${esc(s.name)}</b>
            <span class="sp-note">${esc(num)} · ${s.needed > 1 ? `needs ${s.needed} packs` : 'one pack covers this'}${
              s.retired ? ' · <span class="ret" title="Retired — LEGO no longer sells this pack new; find it second-hand">Retired</span>' : ''}</span></div>
          ${s.leftovers.map((l) => `<div class="sp-row">
            <i class="dot" style="background:${l.rgb ? '#' + esc(l.rgb) : 'var(--line-2)'}"></i>
            <span class="sp-qty">${l.qty}×</span>
            <span class="sp-name">${esc(l.name)} (${esc(l.color)})</span>
            ${l.element ? `<span class="sp-el">El. ${esc(l.element)}</span>` : ''}
          </div>`).join('')}
        `).join('')}
        <div class="note">Left over after what you placed — buying the packs in the budget covers all of it.</div>
      </div>
    </details>` : '';

  el.innerHTML = `
    <div class="stat-lead">
      <span class="k">Total footprint</span>
      <span class="v">${Math.round(box.w)} × ${Math.round(box.h)} <small>studs</small></span>
      <span class="mono" style="color:var(--ink-faint);font-size:12px">${
        studsToCm(box.w)} × ${studsToCm(box.h)} cm · ${fmtArea(box.w, box.h, 'cm')}</span>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="k">Sets placed</div><div class="v">${sets.length}</div></div>
      <div class="stat"><div class="k">Total pieces</div><div class="v">${pieces.toLocaleString()}</div></div>
    </div>
    ${sets.length ? `<div class="budget">
      <div class="bud-row buy"><span class="k">Still to buy</span><span class="v">${money(cost.buyCost)}</span></div>
      <div class="bud-row own"><span class="k">Already own</span><span class="v">${cost.ownedCost > 0 ? `${money(0)} <s>${money(cost.ownedCost)}</s>` : money(0)}</span></div>
      <div class="bud-note">${cost.estimatedBuyCount
        ? `${cost.estimatedBuyCount} of the to-buy set${cost.estimatedBuyCount > 1 ? 's are' : ' is'} <b style="color:var(--warn)">estimated</b> (~$0.11/piece)`
        : `Real retail prices where known`}</div>
    </div>` : ''}
    <div>
      <h2 class="sec" style="margin-bottom:8px">By category</h2>
      <div class="breakdown">${cats.map(([c, n]) =>
        `<button class="brow" data-findcat="${esc(c)}" title="Find all ${esc(c)} sets on the grid"><i class="dot" style="background:${catColor(c)}"></i>
          <span class="nm">${esc(c[0].toUpperCase() + c.slice(1))}</span><span class="ct">${n}</span></button>`).join('') ||
        '<div class="note">No sets yet — add some from the catalog.</div>'}</div>
      ${cats.length ? `<div class="bar">${cats.map(([c, n]) =>
        `<i data-cat="${esc(c)}" title="${esc(c)}" style="width:${(n / total * 100).toFixed(1)}%;background:${catColor(c)}"></i>`).join('')}</div>` : ''}
    </div>
    ${cost.lines.length ? `<div>
      <h2 class="sec" style="margin-bottom:8px">Sets &amp; ownership</h2>
      <div class="own-list">${cost.lines.map((ln) => {
        const src = ln.owned ? 'owned' : (ln.estimated ? 'est.' : (ln.source === 'override' ? 'yours' : 'MSRP'));
        return `<div class="orow${ln.owned ? ' is-owned' : ''}">
          <button class="own sm" data-num="${esc(ln.num)}" aria-pressed="${ln.owned}"
            aria-label="Toggle owned for ${esc(ln.num)}" title="${ln.owned ? 'You own this' : 'Mark as owned'}">${ln.owned ? '★' : '☆'}</button>
          <button class="on" data-find="${esc(ln.num)}" title="Find on the grid — select &amp; jump to ${esc(nameOf(ln.num))}">${esc(nameOf(ln.num))}</button>${retBadge(recOf(ln.num))}
          <span class="oq">×${ln.qty}</span>
          <button class="op ${ln.owned ? 'zero' : ''}" data-num="${esc(ln.num)}" data-price
            title="Set your own price for ${esc(ln.num)}" aria-label="Set price for ${esc(ln.num)}">${
            ln.owned ? '$0' : money(ln.lineTotal)}<i>${src}</i></button>
          <button class="orow-del" data-del="${esc(ln.num)}" title="Delete all of this set from the grid"
            aria-label="Delete ${esc(nameOf(ln.num))} from the grid"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12"/></svg></button>
        </div>`;
      }).join('')}</div>
    </div>` : ''}
    ${overlapCount ? `<div class="alert"><span class="ic">⚠</span>
      <span class="tx"><b>${overlapCount} overlap${overlapCount > 1 ? 's' : ''}.</b> Move a tile to clear it.</span></div>` : ''}
    ${approxCount ? `<div class="note"><span class="approx" style="color:var(--warn)">≈</span>
      <span>${approxCount} set${approxCount > 1 ? 's show' : ' shows'} an <b style="color:var(--ink-soft)">estimated</b> footprint.</span></div>` : ''}
    <details class="wishlist-panel"${wishOpen ? ' open' : ''}>
      <summary>🛒 Wishlist <span class="count-pill">${wishRows.length}</span>
        ${wishRows.length ? `<span class="wish-total">${money(wishCost.total)}</span>` : ''}</summary>
      <div class="wish-body">${wishRows.length ? wishRows.map((r) => {
        const src = r.estimated ? 'est.' : (r.source === 'override' ? 'yours' : 'MSRP');
        return `<div class="wrow">
          <span class="wn" title="${esc(r.set.name)}">${esc(r.set.name)}</span>${retBadge(r.set)}
          <span class="wp">${money(r.lineTotal)}<i>${src}</i></span>
          <button class="wbtn promote" data-num="${esc(r.exact)}" title="Place on grid"
            aria-label="Place ${esc(r.set.name)} on grid">➕</button>
          <button class="wbtn remove" data-num="${esc(r.exact)}" title="Remove from wishlist"
            aria-label="Remove ${esc(r.set.name)} from wishlist">✕</button>
        </div>`;
      }).join('') : '<div class="note">Star sets with 🛒 in the catalog to save them here — independent of the grid budget.</div>'}${
      wishRows.some((r) => r.set.retired)
        ? '<div class="note">⚠ Retired sets can\'t be bought from LEGO — prices shown are MSRP-era estimates.</div>' : ''}</div>
    </details>
    ${sparesHtml}
    <div style="display:flex;gap:8px">
      <button class="btn" id="btn-save" style="flex:1">💾 Save</button>
      <button class="btn primary" id="btn-export2" style="flex:1">⭱ Export</button>
    </div>
    <div class="export-grid">
      <button class="btn" id="btn-shoplist" aria-haspopup="dialog"
        title="Download the sets still to buy — simple list, spreadsheet or BrickLink import (owned excluded)">⭱ Shopping list</button>
    </div>`;

  // Owned toggles in the per-set list. One delegated handler on the fresh list node (property
  // assignment, so re-rendering never stacks listeners); the app persists + re-renders.
  const list = el.querySelector('.own-list');
  if (list) {
    list.onclick = (e) => {
      const del = e.target.closest('.orow-del');
      if (del && del.dataset.del) { onDelete?.(del.dataset.del); return; }
      const find = e.target.closest('.on[data-find]');
      if (find && find.dataset.find) { onFind?.(find.dataset.find); return; }
      const own = e.target.closest('.own');
      if (own && own.dataset.num) { onToggleOwn?.(own.dataset.num); return; }
      const price = e.target.closest('[data-price]');
      if (price && price.dataset.num) onSetPrice?.(price.dataset.num);
    };
  }
  const bd = el.querySelector('.breakdown');
  if (bd) bd.onclick = (e) => { const b = e.target.closest('.brow[data-findcat]'); if (b) onFindCat?.(b.dataset.findcat); };
  const wpanel = el.querySelector('.wishlist-panel');
  if (wpanel) {
    wpanel.onclick = (e) => {
      const promote = e.target.closest('.promote');
      if (promote && promote.dataset.num) { onPromoteWishlist?.(promote.dataset.num); return; }
      const remove = e.target.closest('.remove');
      if (remove && remove.dataset.num) onRemoveWishlist?.(remove.dataset.num);
    };
  }
}
