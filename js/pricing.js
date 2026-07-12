// Pure cost + buy-link + export helpers. No DOM, no fetch — fully unit-testable.
// The Rebrickable bulk CSV the catalog is built from carries NO price data, so real MSRP is
// only known for the sets seeded in data/prices.json; everything else falls back to a rough
// per-piece estimate (LEGO retail averages ~$0.11/piece), flagged 'est.' in the UI.

export const PIECE_PRICE = 0.11; // $/piece fallback when no real price is known

function round2(n) { return Math.round(n * 100) / 100; }

// Strip Rebrickable's "-1" variant suffix so '60316-1' and '60316' share one price key.
export function baseNum(setNum) {
  return String(setNum).replace(/-\d+$/, '');
}

// Resolve the effective USD price for a set: a manual override wins, then the real MSRP table,
// else null (the caller falls back to the piece estimate). Returns { price, source } where
// source is 'override' | 'msrp' | 'est'.
export function resolvePrice(setNum, { prices = {}, overrides = {} } = {}) {
  const n = baseNum(setNum);
  const ov = overrides[n];
  if (ov != null && ov !== '' && Number.isFinite(+ov)) return { price: +ov, source: 'override' };
  const p = prices[n];
  if (p != null && Number.isFinite(+p)) return { price: +p, source: 'msrp' };
  return { price: null, source: 'est' };
}

// Cost of a placed city, split into what you already own vs. what's still to buy.
//   placed   — the tiles array (each carries set_num; qty is derived by grouping)
//   prices   — { [baseNum]: usdMsrp } real prices
//   owned    — Set/array of bare set numbers already owned (excluded from buyCost)
//   overrides— { [baseNum]: usdManualPrice } per-set manual overrides
//   pieces   — { [baseNum]: pieceCount } used for the estimate fallback
// Returns { ownedCost, buyCost, estimatedCount, estimatedBuyCount, total, lines }.
export function cityCost(placed, { prices = {}, owned = [], overrides = {}, pieces = {} } = {}) {
  const ownedSet = owned instanceof Set ? owned : new Set(owned);
  const groups = new Map();
  for (const t of placed) {
    const n = baseNum(t.set_num);
    const g = groups.get(n) || { num: n, qty: 0 };
    g.qty += 1;
    groups.set(n, g);
  }
  let ownedCost = 0, buyCost = 0, estimatedCount = 0, estimatedBuyCount = 0;
  const lines = [];
  for (const g of groups.values()) {
    const { price, source } = resolvePrice(g.num, { prices, overrides });
    const estimated = price == null;
    const unit = estimated ? round2((pieces[g.num] || 0) * PIECE_PRICE) : price;
    const lineTotal = round2(unit * g.qty);
    const isOwned = ownedSet.has(g.num);
    if (estimated) estimatedCount += 1;
    if (isOwned) {
      ownedCost = round2(ownedCost + lineTotal);
    } else {
      buyCost = round2(buyCost + lineTotal);
      if (estimated) estimatedBuyCount += 1;
    }
    lines.push({ num: g.num, qty: g.qty, unit, lineTotal, source, estimated, owned: isOwned });
  }
  lines.sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true }));
  return {
    ownedCost, buyCost, estimatedCount, estimatedBuyCount,
    total: round2(ownedCost + buyCost), lines,
  };
}

// ---- Round-1 feedback 3b: bundle packs → whole-pack purchases + spare parts --------------------
// Accessory/track/road pieces don't sell individually — they come in PACKS (xtra 40310, Tracks
// 60205, Road Plates 60304…). data/packs.json carries each pack's element-level contents; these
// pure helpers turn placed pack pieces into "buy N boxes of pack X" rows plus the leftover pieces
// per box (the Spare-parts panel).

// A content row's stable identity: LEGO element id when known, else part + colour slug — the same
// id the build bakes into the element record's set_num ('piece-el:<pack>:<id>').
export function contentId(c) {
  return c.element || `${c.part}-${String(c.color || '').replace(/\W+/g, '').toLowerCase()}`;
}

// Which pack supplies each generic placeable piece (piece-track-straight etc.)? When several
// packs carry the same piece (straight rails: 60205, 7499, 9V…), prefer a pack that is still
// sold new, then the one with more of the piece per box.
export function packSupplyIndex(packs) {
  const idx = new Map();
  for (const pack of Object.values(packs || {})) {
    for (const c of pack.contents || []) {
      for (const pieceId of c.supplies || []) {
        const prev = idx.get(pieceId);
        const better = !prev
          || (prev.pack.retired && !pack.retired)
          || (prev.pack.retired === !!pack.retired && c.qty > prev.content.qty);
        if (better) idx.set(pieceId, { pack, content: c });
      }
    }
  }
  return idx;
}

// Partition placed tiles into plain sets vs pack-supplied items and work out how many boxes of
// each pack the layout needs. Returns:
//   plain    — tiles whose purchase is their own set (unchanged path)
//   packRows — [{ set_num, num, name, qty }] one row per pack (qty = boxes to buy)
//   spares   — { [packNum]: { name, retired, needed, used, leftovers: [{ name, color, rgb, qty, element }] } }
export function packRollup(tiles, byNum, packs) {
  const plain = [];
  const used = new Map(); // packNum → Map(contentId → placed count)
  const supplyIdx = packSupplyIndex(packs);
  const bump = (packNum, key) => {
    let m = used.get(packNum);
    if (!m) { m = new Map(); used.set(packNum, m); }
    m.set(key, (m.get(key) || 0) + 1);
  };
  for (const t of tiles) {
    const rec = byNum ? byNum.get(t.set_num) : null;
    const packNum = rec && rec.pack;
    if (packNum && packs && packs[packNum]) {
      const c = (packs[packNum].contents || []).find((c) => String(t.set_num).endsWith(`:${contentId(c)}`));
      if (c) { bump(packNum, contentId(c)); continue; }
    }
    const sup = supplyIdx.get(String(t.set_num)); // generic road/track pieces
    if (sup) { bump(sup.pack.num, contentId(sup.content)); continue; }
    plain.push(t);
  }
  const packRows = [];
  const spares = {};
  for (const [packNum, counts] of used) {
    const pack = packs[packNum];
    // one box covers every element until any single element's per-box qty is exceeded
    let needed = 1;
    for (const c of pack.contents || []) {
      const n = counts.get(contentId(c)) || 0;
      if (n > 0 && c.qty > 0) needed = Math.max(needed, Math.ceil(n / c.qty));
    }
    const leftovers = [];
    let usedCount = 0;
    for (const c of pack.contents || []) {
      const n = counts.get(contentId(c)) || 0;
      usedCount += n;
      const remaining = c.qty * needed - n;
      if (remaining > 0) leftovers.push({ name: c.name, color: c.color, rgb: c.rgb || null, qty: remaining, element: c.element || null });
    }
    packRows.push({ set_num: pack.set_num, num: packNum, name: pack.name, qty: needed });
    spares[packNum] = { name: pack.name, retired: !!pack.retired, needed, used: usedCount, leftovers };
  }
  packRows.sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true }));
  return { plain, packRows, spares };
}

// Retailer buy links for a set. Generic primitive pieces (set_num begins 'piece-') have no
// retail SKU, so they map to a BrickLink part search by name instead. Each link opens in a new
// tab; hrefs are URL-encoded, so they're safe to drop into markup.
export function buyLinks(setNum, name = '') {
  if (String(setNum).startsWith('piece-')) {
    const q = encodeURIComponent(name || setNum);
    return [{ label: 'BrickLink', href: `https://www.bricklink.com/v2/search.page?q=${q}`,
      title: `Find ${name || 'this part'} on BrickLink` }];
  }
  const n = baseNum(setNum);
  const e = encodeURIComponent(n);
  return [
    { label: 'LEGO', href: `https://www.lego.com/en-us/search?q=${e}`, title: `Search ${n} on LEGO.com` },
    { label: 'BrickLink', href: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${e}-1`, title: `${n} on BrickLink` },
    { label: 'Amazon', href: `https://www.amazon.com/s?k=${encodeURIComponent('LEGO ' + n)}`, title: `Search LEGO ${n} on Amazon` },
  ];
}

// BrickLink Wanted-List XML for the given rows ([{ num, qty }]). Generic primitive pieces are
// skipped — BrickLink has no set id for them. Import at bricklink.com › Want › Upload.
export function bricklinkXml(rows) {
  const items = rows
    .filter((r) => !String(r.num).startsWith('piece-'))
    .map((r) => `  <ITEM>\n    <ITEMTYPE>S</ITEMTYPE>\n    <ITEMID>${xmlEsc(baseNum(r.num))}-1</ITEMID>\n    <MINQTY>${Math.max(1, r.qty | 0)}</MINQTY>\n  </ITEM>`)
    .join('\n');
  return `<INVENTORY>\n${items}\n</INVENTORY>\n`;
}
function xmlEsc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// CSV of the set list: set number, name, qty, price (blank when unknown). RFC-4180 quoting.
export function setListCsv(rows) {
  const q = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Set number', 'Name', 'Qty', 'Price (USD)'];
  const body = rows.map((r) => [r.num, r.name, r.qty, r.price == null ? '' : r.price].map(q).join(','));
  return [head.join(','), ...body].join('\r\n') + '\r\n';
}
