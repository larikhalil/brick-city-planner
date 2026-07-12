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
