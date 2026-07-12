// End-to-end integration test of createGrid against a minimal DOM mock — exercises the
// selection / undo-redo / clipboard / group / align stack that the pure geometry tests can't.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- tiny DOM mock ----------------------------------------------------------
function parseSel(sel) {
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const idm = sel.match(/\[data-id="([^"]+)"\]/);
  return { classes, dataId: idm ? idm[1] : null };
}
class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this._classes = new Set();
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this._listeners = {};
    this.tabIndex = 0;
  }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classes].join(' '); }
  get classList() {
    const s = this._classes;
    return {
      add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
      toggle: (c, on) => { const has = s.has(c); const want = on === undefined ? !has : on; want ? s.add(c) : s.delete(c); return want; },
    };
  }
  set innerHTML(html) {
    this.children = [];
    if (/class="tlabel"/.test(html)) { const l = new El('div'); l._classes.add('tlabel'); l.parent = this; this.children.push(l); }
    if (/class="empty-hint"/.test(html)) { const l = new El('div'); l._classes.add('empty-hint'); l.parent = this; this.children.push(l); }
  }
  insertAdjacentHTML(_pos, html) {
    const m = html.match(/class="([\w-]+)/);
    const el = new El('div'); if (m) el._classes.add(m[1]); el.parent = this; this.children.push(el);
  }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  _all() { const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(this); return out; }
  _match(el, p) { return p.classes.every((c) => el._classes.has(c)) && (!p.dataId || el.dataset.id === p.dataId); }
  querySelector(sel) { const p = parseSel(sel); return this._all().find((el) => this._match(el, p)) || null; }
  querySelectorAll(sel) { const p = parseSel(sel); return this._all().filter((el) => this._match(el, p)); }
  closest(sel) { const p = parseSel(sel); let n = this; while (n) { if (this._match(n, p)) return n; n = n.parent; } return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: (Number(this.style.width?.replace('px', '')) || 0), height: (Number(this.style.height?.replace('px', '')) || 0) }; }
  setPointerCapture() {} focus() {}
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
}
globalThis.document = { createElement: (t) => new El(t) };
globalThis.window = { addEventListener() {} };

// Shared board/stage factory for the driver tests below.
function makeBoard() {
  const board = new El('div');
  const stage = new El('div'); stage.clientWidth = 800; stage.clientHeight = 600; stage.scrollTo = () => {};
  stage.appendChild(board);
  board.parent = stage;
  Object.defineProperty(board, 'parentElement', { get() { return stage; } });
  return board;
}

// ---- drive it ---------------------------------------------------------------
test('createGrid: place, undo/redo, group, align, copy/paste, duplicate, delete', async () => {
const { createGrid } = await import('../js/grid.js');

const board = new El('div');
const stage = new El('div'); stage.clientWidth = 800; stage.clientHeight = 600; stage.scrollTo = () => {};
stage.appendChild(board);
board.parent = stage; // parentElement
Object.defineProperty(board, 'parentElement', { get() { return stage; } });

let changes = 0, hist = 0, sels = 0;
const g = createGrid(board, { onChange: () => changes++, onHistory: () => hist++, onSelect: () => sels++ });

const mkSet = (n, w, h, layer = 2) => ({ set_num: n, name: 'Set ' + n, category: 'city', kind: 'generic', footprint: { w, h, source: 'curated' }, layer, color: null });

// place three sets
g.addSet(mkSet('a', 16, 16));
g.addSet(mkSet('b', 16, 16));
g.addSet(mkSet('c', 16, 16));
assert.equal(g.getPlaced().length, 3, 'three placed');
assert.equal(g.getSelection().length, 1, 'last placed is selected');

// undo one placement
g.undo();
assert.equal(g.getPlaced().length, 2, 'undo removed a tile');
g.redo();
assert.equal(g.getPlaced().length, 3, 'redo restored it');

// select all + group
g.selectAll();
assert.equal(g.getSelection().length, 3, 'select-all picks everything');
g.groupSelection();
assert.ok(g.getPlaced().every((p) => p.groupId), 'all tiles grouped');
// clicking behaviour: selecting one selects the whole group
g.select(g.getPlaced()[0].id);
assert.equal(g.getSelection().length, 3, 'group selects as a unit');

// align left: all AABB minX equal
g.alignSelection('left');
const minXs = g.getPlaced().map((p) => p.x);
assert.ok(minXs.every((x) => x === minXs[0]), 'align-left lines up x');

// distribute needs 3 (already 3) — no throw
g.distributeSelection('h');

// copy / paste
g.select(g.getPlaced()[0].id); // whole group again
g.copySelection();
const before = g.getPlaced().length;
g.paste();
assert.equal(g.getPlaced().length, before + 3, 'paste added a copy of the group');
assert.equal(g.getSelection().length, 3, 'pasted tiles are selected');
// pasted group has a fresh groupId
const gids = new Set(g.getPlaced().map((p) => p.groupId));
assert.equal(gids.size, 2, 'paste made an independent group');

// duplicate
const n2 = g.getPlaced().length;
g.duplicate();
assert.equal(g.getPlaced().length, n2 + 3, 'duplicate added copies');

// rotate group (no throw) then ungroup
g.rotateSelected();
g.ungroup();
assert.ok(g.getSelection().every((id) => !g.getPlaced().find((p) => p.id === id).groupId), 'ungroup cleared groupId');

// delete selection
const n3 = g.getPlaced().length;
g.deleteSelected();
assert.equal(g.getPlaced().length, n3 - 3, 'delete removed the selection');

// history has depth and jump works
const h = g.getHistory();
assert.ok(h.entries.length > 5 && h.index === h.entries.length - 1, 'history recorded steps');
g.jumpHistory(1);
assert.ok(g.canRedo(), 'jump back enables redo');

// bringForward / sendBackward on a single tile
g.jumpHistory(h.entries.length - 1);
if (g.getPlaced().length) { g.select(g.getPlaced()[0].id); g.bringForward(); g.sendBackward(); }

assert.ok(changes > 0 && hist > 0 && sels > 0, 'callbacks fired');
});

// ---- ACC-4: onAnnounce fires real text on placement / rotate / delete / overlap-detected -----
test('createGrid: onAnnounce announces placement, rotation, delete and newly-detected overlaps', async () => {
const { createGrid } = await import('../js/grid.js');

const board = new El('div');
const stage = new El('div'); stage.clientWidth = 800; stage.clientHeight = 600; stage.scrollTo = () => {};
stage.appendChild(board);
board.parent = stage;
Object.defineProperty(board, 'parentElement', { get() { return stage; } });

const announced = [];
const g = createGrid(board, { onAnnounce: (msg) => announced.push(msg) });
const mkSet = (n, name, w, h) => ({ set_num: n, name, category: 'city', kind: 'generic', footprint: { w, h, source: 'curated' }, layer: 2, color: null });

// placement announces the set name + a row/column pair, in real text (not colour-only)
g.addSet(mkSet('a', 'Fire Station', 16, 16));
assert.ok(announced.some((m) => m.startsWith('Fire Station placed at row') && m.includes('column')), 'placement announced');

// a second set dropped ON TOP of the first (both default to 0,0) is a fresh overlap → announced,
// naming both pieces
announced.length = 0;
g.addSet(mkSet('b', 'Police Station', 16, 16));
assert.ok(announced.some((m) => /Overlap detected between .* and .*/.test(m)), 'new overlap announced');

// rotate announces in plain text, not just a visual outline
announced.length = 0;
g.select(g.getPlaced()[0].id);
g.rotateSelected();
assert.ok(announced.some((m) => /rotated 90 degrees/.test(m)), 'rotation announced');

// delete announces which piece went, by name
announced.length = 0;
const before = g.getPlaced().length;
g.deleteSelected();
assert.equal(g.getPlaced().length, before - 1);
assert.ok(announced.some((m) => m.startsWith('Deleted ')), 'delete announced');

// loading a city that ALREADY has an overlap must not immediately re-announce it (only NEW
// overlaps introduced by a live edit should fire)
announced.length = 0;
g.setPlaced([
  { id: 'p1', set_num: 'x', name: 'X', category: 'city', kind: 'generic', x: 0, y: 0, w: 16, h: 16, rot: 0, layer: 2 },
  { id: 'p2', set_num: 'y', name: 'Y', category: 'city', kind: 'generic', x: 0, y: 0, w: 16, h: 16, rot: 0, layer: 2 },
]);
assert.ok(!announced.some((m) => /Overlap detected/.test(m)), 'pre-existing overlap on load is not announced');
});

// ---- QOL-8: per-tile lock — selectable but not movable/deletable, serialised + undoable -------
test('createGrid: locked tiles resist delete, survive, and undo restores the flag', async () => {
  const { createGrid } = await import('../js/grid.js');
  const g = createGrid(makeBoard());
  const mk = (n, layer = 2) => ({ set_num: n, name: 'Set ' + n, category: 'city', kind: 'generic', footprint: { w: 16, h: 16, source: 'curated' }, layer, color: null });

  g.addSet(mk('a')); g.addSet(mk('b')); g.addSet(mk('c'));
  const idA = g.getPlaced()[0].id;

  // lock tile A
  g.select(idA);
  g.lockSelected();
  assert.equal(g.getPlaced().find((p) => p.id === idA).locked, true, 'tile A is locked');
  assert.equal(g.selectionLockState(), 'locked', 'selection reports as locked');
  assert.ok('locked' in g.getPlaced().find((p) => p.id === idA), 'locked flag present for serialize');

  // select-all then delete: the two unlocked tiles go, the locked one stays
  g.selectAll();
  g.deleteSelected();
  const left = g.getPlaced();
  assert.equal(left.length, 1, 'only the locked tile survives a delete');
  assert.equal(left[0].id, idA, 'the survivor is the locked tile');

  // undo the delete, then undo the lock → flag is cleared again
  g.undo(); // restores the two deleted tiles
  assert.equal(g.getPlaced().length, 3, 'undo restored the deleted tiles');
  g.undo(); // undoes the lock
  assert.equal(g.getPlaced().find((p) => p.id === idA).locked, false, 'undo cleared the lock flag');

  // lock-all-but-selected: pick B, freeze the rest
  const idB = g.getPlaced()[1].id;
  g.select(idB);
  g.lockAllExceptSelected();
  assert.equal(g.getPlaced().find((p) => p.id === idB).locked, false, 'the selection stays unlocked');
  assert.ok(g.getPlaced().filter((p) => p.id !== idB).every((p) => p.locked), 'everything else is locked');
});

// ---- QOL-10: per-layer show-hide + lock (view/interaction prefs, NOT saved/undoable) ----------
test('createGrid: hidden + locked layers are excluded from select/delete but stay in placed[]', async () => {
  const { createGrid } = await import('../js/grid.js');
  const g = createGrid(makeBoard());
  const mk = (n, layer) => ({ set_num: n, name: 'Set ' + n, category: 'city', kind: 'generic', footprint: { w: 16, h: 16, source: 'curated' }, layer, color: null });

  g.addSet(mk('base', 0));   // baseplate layer
  g.addSet(mk('road', 1));   // road layer
  g.addSet(mk('bldg', 2));   // building layer

  // lock the baseplate layer: select-all + delete leaves the baseplate behind
  g.setLayerLocked(0, true);
  g.selectAll();
  g.deleteSelected();
  assert.deepEqual(g.getPlaced().map((p) => p.layer).sort(), [0], 'only the locked-layer tile survived');
  assert.equal(g.getLayerState().locks[0], true, 'layer lock state is reported');

  // re-add two building-layer tiles, hide that layer → selectAll skips them
  g.addSet(mk('b1', 2)); g.addSet(mk('b2', 2));
  g.setLayerVisible(2, false);
  g.select(null);
  g.selectAll();
  assert.ok(g.getSelection().every((id) => (g.getPlaced().find((p) => p.id === id).layer) !== 2), 'hidden layer tiles not selected');
  assert.equal(g.getPlaced().filter((p) => p.layer === 2).length, 2, 'hidden tiles remain in the model');
  assert.equal(g.getLayerState().vis[2], false, 'layer visibility state is reported');
});

// ---- QOL-8/10: the free-rotate handle must obey every lock (no bypass via the rotate grip) -----
test('createGrid: locked / layer-locked / Kid-Mode-frozen tiles never expose a rotate handle', async () => {
  const { createGrid } = await import('../js/grid.js');
  const board = makeBoard();
  const g = createGrid(board);
  const mk = (n, layer = 2) => ({ set_num: n, name: 'Set ' + n, category: 'city', kind: 'generic', footprint: { w: 16, h: 16, source: 'curated' }, layer, color: null });
  const tileEl = (id) => board.querySelector(`.tile[data-id="${id}"]`);

  // control: a plain editable single-selected tile DOES get the handle
  g.addSet(mk('a'));
  const idA = g.getPlaced()[0].id;
  g.select(idA);
  assert.ok(tileEl(idA)?.querySelector('.rotate-handle'), 'editable tile shows the rotate handle');

  // per-tile lock: selecting it must NOT show the handle
  g.lockSelected();
  g.select(idA);
  assert.ok(!tileEl(idA)?.querySelector('.rotate-handle'), 'locked tile hides the rotate handle');
  g.select(idA); g.unlockSelected(); // unlock for the next case
  assert.equal(g.getPlaced().find((p) => p.id === idA).locked, false, 'tile A unlocked again');

  // layer lock: lock the tile's layer, re-select → no handle
  g.setLayerLocked(2, true);
  g.select(idA);
  assert.ok(!tileEl(idA)?.querySelector('.rotate-handle'), 'layer-locked tile hides the rotate handle');
  g.setLayerLocked(2, false);

  // Kid Mode: a pre-existing tile is frozen → no handle
  g.setKidMode(true);
  g.select(idA);
  assert.ok(!tileEl(idA)?.querySelector('.rotate-handle'), 'Kid-Mode-frozen tile hides the rotate handle');
  g.setKidMode(false);
  g.select(idA);
  assert.ok(tileEl(idA)?.querySelector('.rotate-handle'), 'handle returns once every lock is cleared');
});

// ---- QOL-8: Kid Mode freezes the placed layout; only pieces added while on can be edited -------
test('createGrid: Kid Mode freezes existing tiles, keeps newly-added ones editable', async () => {
  const { createGrid } = await import('../js/grid.js');
  const g = createGrid(makeBoard());
  const mk = (n) => ({ set_num: n, name: 'Set ' + n, category: 'city', kind: 'generic', footprint: { w: 16, h: 16, source: 'curated' }, layer: 2, color: null });

  g.addSet(mk('old1')); g.addSet(mk('old2'));
  const frozenIds = g.getPlaced().map((p) => p.id);

  g.setKidMode(true);
  assert.equal(g.getKidMode(), true, 'kid mode on');

  // a piece added while Kid Mode is on is editable; the pre-existing ones are frozen
  g.addSet(mk('fresh'));
  const freshId = g.getPlaced().find((p) => !frozenIds.includes(p.id)).id;

  // select everything and delete → only the fresh piece goes, the frozen layout stays
  g.selectAll();
  g.deleteSelected();
  assert.equal(g.getPlaced().length, 2, 'the two frozen tiles survive');
  assert.ok(g.getPlaced().every((p) => frozenIds.includes(p.id)), 'survivors are the frozen originals');
  assert.ok(!g.getPlaced().some((p) => p.id === freshId), 'the fresh piece was deletable');

  // leaving Kid Mode re-thaws everything
  g.setKidMode(false);
  g.selectAll();
  g.deleteSelected();
  assert.equal(g.getPlaced().length, 0, 'with Kid Mode off, the layout is editable again');
});
