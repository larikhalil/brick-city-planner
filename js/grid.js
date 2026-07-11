import { catColor } from './catalog.js';
import { anyOverlaps, extent, snap } from './geometry.js';

export const PX = 6; // pixels per stud
const DARK_TXT = new Set(['modular', 'park']); // light tile bg → dark text

export function createGrid(board, { onChange = () => {} } = {}) {
  let placed = [];
  let selectedId = null;
  let seq = 1;

  function addSet(set) {
    const id = 'p' + (seq++);
    placed.push({
      id, set_num: set.set_num, name: set.name, category: set.category,
      x: 0, y: 0, w: set.footprint.w, h: set.footprint.h, rot: 0,
      approx: set.footprint.source !== 'curated', img: set.img || null,
    });
    selectedId = id;
    render(); onChange();
  }

  function getPlaced() { return placed; }
  function setPlaced(arr) {
    placed = arr.map((p) => ({ ...p }));
    for (const p of placed) {
      const n = parseInt(String(p.id).replace(/^p/, ''), 10);
      if (Number.isFinite(n) && n >= seq) seq = n + 1;
    }
    selectedId = null;
    render();
    onChange();
  }

  function render() {
    const over = anyOverlaps(placed);
    board.innerHTML = '';
    for (const t of placed) {
      const e = extent(t);
      const el = document.createElement('div');
      el.className = 'tile' + (DARK_TXT.has(t.category) ? ' dark-txt' : '') +
        (over.has(t.id) ? ' warn' : '') + (t.id === selectedId ? ' selected' : '');
      el.style.left = t.x * PX + 'px';
      el.style.top = t.y * PX + 'px';
      el.style.width = e.w * PX + 'px';
      el.style.height = e.h * PX + 'px';
      el.style.background = catColor(t.category);
      el.dataset.id = t.id;
      el.tabIndex = 0;
      el.innerHTML = `
        <div class="tn">${t.name}${t.approx ? ' <span style="opacity:.8;font-weight:400">≈</span>' : ''}</div>
        <div class="tsub"><span>${t.set_num.replace(/-\d+$/, '')}</span><span>${e.w}×${e.h}</span></div>`;
      board.appendChild(el);
    }
  }

  function select(id) { selectedId = id; render(); }

  board.addEventListener('pointerdown', (ev) => {
    const tileEl = ev.target.closest('.tile');
    if (!tileEl) { select(null); return; }
    const id = tileEl.dataset.id;
    select(id);
    const t = placed.find((p) => p.id === id);
    const startX = ev.clientX, startY = ev.clientY, ox = t.x, oy = t.y;
    tileEl.setPointerCapture(ev.pointerId);
    function move(e) {
      t.x = Math.max(0, snap(ox + (e.clientX - startX) / PX));
      t.y = Math.max(0, snap(oy + (e.clientY - startY) / PX));
      render();
    }
    function up() {
      tileEl.removeEventListener('pointermove', move);
      tileEl.removeEventListener('pointerup', up);
      onChange();
    }
    tileEl.addEventListener('pointermove', move);
    tileEl.addEventListener('pointerup', up);
  });

  board.addEventListener('keydown', (ev) => {
    if (!selectedId) return;
    const t = placed.find((p) => p.id === selectedId);
    if (!t) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (step) { t.x = Math.max(0, t.x + step[0]); t.y = Math.max(0, t.y + step[1]); render(); onChange(); ev.preventDefault(); }
    else if (ev.key === 'Escape') select(null);
  });

  render();
  return { addSet, getPlaced, setPlaced, render, select, _state: () => ({ placed, selectedId }) };
}
