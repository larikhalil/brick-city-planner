import { bbox, anyOverlaps } from './geometry.js';
import { fmtDims, fmtArea, studsToCm } from './units.js';
import { catColor } from './catalog.js';
import { esc } from './util.js';

export function renderSummary(el, placed, byNum, unit = 'studs') {
  const box = bbox(placed);
  const pieces = placed.reduce((n, t) => n + (byNum.get(t.set_num)?.pieces || 0), 0);
  const over = anyOverlaps(placed);
  const overlapCount = over.size ? Math.ceil(over.size / 2) : 0;
  const approxCount = placed.filter((t) => t.approx).length;

  const counts = {};
  for (const t of placed) counts[t.category] = (counts[t.category] || 0) + 1;
  const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = placed.length || 1;

  el.innerHTML = `
    <div class="stat-lead">
      <span class="k">Total footprint</span>
      <span class="v">${Math.round(box.w)} × ${Math.round(box.h)} <small>studs</small></span>
      <span class="mono" style="color:var(--ink-faint);font-size:12px">${
        studsToCm(box.w)} × ${studsToCm(box.h)} cm · ${fmtArea(box.w, box.h, 'cm')}</span>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="k">Sets placed</div><div class="v">${placed.length}</div></div>
      <div class="stat"><div class="k">Total pieces</div><div class="v">${pieces.toLocaleString()}</div></div>
    </div>
    <div>
      <h2 class="sec" style="margin-bottom:8px">By category</h2>
      <div class="breakdown">${cats.map(([c, n]) =>
        `<div class="brow"><i class="dot" style="background:${catColor(c)}"></i>
          <span class="nm">${esc(c[0].toUpperCase() + c.slice(1))}</span><span class="ct">${n}</span></div>`).join('') ||
        '<div class="note">No sets yet — add some from the catalog.</div>'}</div>
      ${cats.length ? `<div class="bar">${cats.map(([c, n]) =>
        `<i style="width:${(n / total * 100).toFixed(1)}%;background:${catColor(c)}"></i>`).join('')}</div>` : ''}
    </div>
    ${overlapCount ? `<div class="alert"><span class="ic">⚠</span>
      <span class="tx"><b>${overlapCount} overlap${overlapCount > 1 ? 's' : ''}.</b> Move a tile to clear it.</span></div>` : ''}
    ${approxCount ? `<div class="note"><span class="approx" style="color:var(--warn)">≈</span>
      <span>${approxCount} set${approxCount > 1 ? 's use' : ' uses'} an <b style="color:var(--ink-soft)">estimated</b> footprint — drag a corner to adjust.</span></div>` : ''}
    <div style="display:flex;gap:8px">
      <button class="btn" id="btn-save" style="flex:1">💾 Save</button>
      <button class="btn primary" id="btn-export2" style="flex:1">⭱ Export</button>
    </div>
    <button class="btn" id="btn-setlist" style="width:100%;margin-top:8px" title="Download a shopping list of the sets you've placed">🧾 Export set list (.txt)</button>`;
}
