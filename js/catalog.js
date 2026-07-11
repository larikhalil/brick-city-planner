const CATS = [
  ['all', 'All', null], ['police', 'Police', 'var(--t-police)'],
  ['fire', 'Fire', 'var(--t-fire)'], ['train', 'Trains', 'var(--t-train)'],
  ['modular', 'Modular', 'var(--t-modular)'], ['city', 'Town', 'var(--t-city)'],
];
const CAT_VAR = {
  police: 'var(--t-police)', fire: 'var(--t-fire)', train: 'var(--t-train)',
  modular: 'var(--t-modular)', city: 'var(--t-city)', road: 'var(--t-road)',
  park: 'var(--t-park)', space: 'var(--t-space)', arctic: 'var(--t-police)',
  harbor: 'var(--t-city)', farm: 'var(--t-park)', airport: 'var(--t-city)', other: 'var(--t-city)',
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
      <div class="swatch" style="background:${catColor(s.category)}">${
        s.img ? `<img src="${s.img}" alt="" loading="lazy"
          style="width:100%;height:100%;object-fit:cover"
          onerror="this.remove()">` : ''}</div>
      <div class="set-meta"><div class="set-name" title="${s.name}">${s.name}</div>
        <div class="set-sub"><span>${s.num}</span><span>${s.year || ''}</span>
          <span class="fp${approx ? ' approx' : ''}">${approx ? '≈ ' : ''}${s.footprint.w}×${s.footprint.h}</span>
        </div></div>
      <button class="add" aria-label="Add ${s.name}">＋</button>`;
    el.querySelector('.add').addEventListener('click', () => onAdd(s));
    return el;
  }

  draw();
  return { setFilter(t, c) { text = t; category = c; draw(); } };
}
