import { esc } from './util.js';
import { schematicSVG } from './schematic.js';

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

export function renderCatalog(els, sets, { onAdd }) {
  let text = '', category = 'all';

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

  function match(s) {
    if (category !== 'all' && s.category !== category) return false;
    if (!text) return true;
    return s.name.toLowerCase().includes(text) || s.num.includes(text);
  }

  function draw() {
    const shown = sets.filter(match).slice(0, 400); // cap DOM for perf
    els.count.textContent = `${sets.filter(match).length} sets`;
    els.list.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const s of shown) frag.appendChild(row(s));
    els.list.appendChild(frag);
  }

  function row(s) {
    const approx = s.footprint.source !== 'curated';
    const el = document.createElement('div');
    el.className = 'set';
    el.innerHTML = `
      <div class="swatch" style="background:${s.color || catColor(s.category)}">${
        s.img ? `<img src="${s.img}" alt="" loading="lazy"
          style="width:100%;height:100%;object-fit:cover"
          onerror="this.remove()">` : schematicSVG(s.kind, s.footprint, s.name)}</div>
      <div class="set-meta"><div class="set-name" title="${esc(s.name)}">${esc(s.name)}</div>
        <div class="set-sub"><span>${esc(s.num)}</span><span>${s.year || ''}</span>
          <span class="fp${approx ? ' approx' : ''}">${approx ? '≈ ' : ''}${s.footprint.w}×${s.footprint.h}</span>
        </div></div>
      <button class="add" aria-label="Add ${esc(s.name)}">＋</button>`;
    el.querySelector('.add').addEventListener('click', () => onAdd(s));
    return el;
  }

  draw();
  return {
    setFilter(t, c) {
      text = t;
      category = c;
      els.search.value = t;
      els.chips.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip.dataset.cat === c));
      draw();
    },
  };
}
