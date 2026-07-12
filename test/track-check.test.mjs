// PLAN-11: track continuity / loop-closure validator + buffer stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTrack, isTrack, isBufferStop, MATE_EPS, ADJACENT } from '../js/track-check.js';
import { trackPorts, tileWorldPorts } from '../js/geometry.js';

const pieces = JSON.parse(readFileSync(new URL('../data/pieces.json', import.meta.url)));
const byNum = new Map(pieces.map((p) => [p.set_num, p]));

// A 16×16 track tile helper.
const T = (id, x, y, rot = 0, name = 'Track — Straight', extra = {}) =>
  ({ id, x, y, w: 16, h: 16, rot, kind: 'track', name, layer: 1, ...extra });

// ---- data: the buffer-stop end-cap piece ----------------------------------------------------
test('pieces.json ships a buffer-stop end-cap track piece flagged bufferStop', () => {
  const bs = byNum.get('piece-track-buffer-stop');
  assert.ok(bs, 'piece-track-buffer-stop present');
  assert.equal(bs.kind, 'track');
  assert.equal(bs.bufferStop, true);
  assert.match(bs.name, /buffer/i);
});

test('a buffer-stop tile exposes exactly ONE coupling port (its terminal face)', () => {
  const ports = trackPorts(T('c', 0, 0, 0, 'Track — Buffer Stop'));
  assert.equal(ports.length, 1, 'a terminal end-cap has a single opening');
});

// ---- predicates ----------------------------------------------------------------------------
test('isTrack / isBufferStop predicates', () => {
  assert.equal(isTrack(T('a', 0, 0)), true);
  assert.equal(isTrack({ kind: 'building' }), false);
  assert.equal(isTrack(null), false);
  assert.equal(isBufferStop(T('a', 0, 0, 0, 'Track — Straight', { bufferStop: true })), true);
  assert.equal(isBufferStop(T('a', 0, 0, 0, 'Track — Buffer Stop')), true, 'name alone reads as a stop');
  assert.equal(isBufferStop(T('a', 0, 0)), false);
  assert.equal(isBufferStop(null), false);
});

// ---- closed loop passes --------------------------------------------------------------------
test('a closed loop of four curves passes with no gaps, no open ends, one closed component', () => {
  // Found geometrically: four Curve (Right) R40 pieces in a 2×2 block at rot 0/90/270/180 form a
  // ring whose eight ports all mate. (Verified against tileWorldPorts.)
  const loop = [
    T('TL', 0, 0, 0, 'Track — Curve (Right) R40', { radius: 'R40' }),
    T('TR', 16, 0, 90, 'Track — Curve (Right) R40', { radius: 'R40' }),
    T('BL', 0, 16, 270, 'Track — Curve (Right) R40', { radius: 'R40' }),
    T('BR', 16, 16, 180, 'Track — Curve (Right) R40', { radius: 'R40' }),
  ];
  const r = checkTrack(loop);
  assert.equal(r.ok, true, 'continuity sound');
  assert.equal(r.complete, true, 'nothing dangles');
  assert.deepEqual(r.gaps, []);
  assert.deepEqual(r.openEnds, []);
  assert.deepEqual(r.bufferStops, []);
  assert.equal(r.components.length, 1, 'one connected run');
  assert.equal(r.components[0].closed, true, 'it is a closed loop');
  assert.equal(r.components[0].portCount, 8);
  assert.equal(r.components[0].matedCount, 8);
});

// ---- a 2-stud gap is flagged ---------------------------------------------------------------
test('a 2-stud gap between two collinear straights is flagged (not a clean open end)', () => {
  const r = checkTrack([T('a', 0, 0), T('b', 18, 0)]); // 2-stud gap between a.R (x16) and b.L (x18)
  assert.equal(r.ok, false, 'a gap breaks continuity');
  assert.ok(r.gaps.length >= 1, 'the near-but-unmated ports are gaps');
  const g = r.gaps.find((x) => x.tileId === 'a' && x.port === 1);
  assert.ok(g, 'the facing R port of a is reported');
  assert.equal(g.reason, 'too-far', 'ports face each other but sit 2 studs apart');
  assert.equal(g.dist, 2);
  assert.equal(g.near.tileId, 'b');
  // the two OUTER ends (nothing near them) are plain open ends, not gaps
  assert.ok(r.openEnds.some((o) => o.tileId === 'a' && o.port === 0));
  assert.ok(r.openEnds.some((o) => o.tileId === 'b' && o.port === 1));
});

test('mis-facing but adjacent ports read as a "not-facing" gap', () => {
  // two parallel straights 2 studs apart: their left openings sit near each other but BOTH face
  // -x (same direction), so they can't join — a "not-facing" gap, not a real mate.
  const r = checkTrack([T('a', 0, 0), T('b', 0, 2)]);
  const g = r.gaps.find((x) => x.reason === 'not-facing');
  assert.ok(g, 'a near pair that does not face each other is a not-facing gap');
});

// ---- a buffer-stopped spur is NOT flagged --------------------------------------------------
test('an open-ended spur IS a loose end; the SAME spur capped by a buffer stop is NOT', () => {
  // Bare spur: a lone straight — both ends dangle (this is what the checker warns about).
  const bare = checkTrack([T('s', 0, 0)]);
  assert.equal(bare.ok, true, 'no misalignment');
  assert.equal(bare.complete, false, 'but it dangles');
  assert.equal(bare.openEnds.length, 2, 'both ends are loose');
  assert.equal(bare.bufferStops.length, 0);

  // Same spur, flagged as an intentional buffer-stopped terminal: its ends are no longer errors.
  const capped = checkTrack([T('s', 0, 0, 0, 'Track — Straight', { bufferStop: true })]);
  assert.equal(capped.ok, true);
  assert.equal(capped.complete, true, 'an intentional terminal counts as complete');
  assert.deepEqual(capped.openEnds, [], 'capped ends are NOT loose ends');
  assert.equal(capped.bufferStops.length, 2, 'they are recorded as intentional stops');
});

test('a buffer-stop end-cap PIECE placed over a spur end mates it (that end is no longer loose)', () => {
  // A straight whose right opening is at (16,8); a buffer-stop end-cap rotated to face it.
  const str = T('str', 0, 0);
  const cap = T('cap', 16, 0, 90, 'Track — Buffer Stop', { bufferStop: true });
  // sanity: the cap's single world port coincides with the straight's R port and faces back
  const [capPort] = tileWorldPorts(cap);
  assert.ok(Math.hypot(capPort.x - 16, capPort.y - 8) < MATE_EPS, 'cap port lands on the spur end');
  const r = checkTrack([str, cap]);
  assert.deepEqual(r.gaps, [], 'a capped end is not a gap');
  // the capped (right) end is mated away; only the far LEFT end of the straight remains open
  assert.ok(!r.openEnds.some((o) => o.tileId === 'str' && o.port === 1), 'right end mated by the cap');
  assert.ok(r.openEnds.some((o) => o.tileId === 'str' && o.port === 0), 'left end still open in isolation');
  const comp = r.components.find((c) => c.tileIds.includes('cap'));
  assert.equal(comp.matedCount, 2, 'the cap↔spur join is counted');
});

// ---- a switch's unused diverging exit is an open end, NOT a gap -----------------------------
test("a switch connected on its through route does not flag its open diverging port as a gap", () => {
  // A switch's diverging port sits only ~4.74 studs (h·tan16.5°) from its own through-route joint.
  // When a straight continues the through line, that straight's port mates the switch's through
  // opening — the still-open diverging port must read as a plain open end, not a spurious gap.
  for (const side of ['Right', 'Left']) {
    const r = checkTrack([T('SW', 0, 0, 0, `Track — Switch (${side})`), T('ST', 0, -16, 90)]);
    assert.deepEqual(r.gaps, [], `${side} switch: no gap for the unused diverging exit`);
    assert.equal(r.ok, true, `${side} switch: continuity is sound`);
    assert.ok(r.openEnds.some((o) => o.tileId === 'SW'), `${side} switch: diverging exit is a loose end`);
    const comp = r.components.find((c) => c.tileIds.includes('SW'));
    assert.ok(comp.matedCount >= 2, 'the through-route join is counted');
  }
});

// ---- robustness ----------------------------------------------------------------------------
test('non-track tiles are ignored; an empty / all-building city is trivially complete', () => {
  const r = checkTrack([
    { id: 'b1', x: 0, y: 0, w: 8, h: 8, rot: 0, kind: 'building', name: 'House' },
    { id: 't1', x: 40, y: 40, w: 8, h: 8, rot: 0, kind: 'terrain', name: 'Grass' },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.equal(r.trackCount, 0);
  assert.deepEqual(r.components, []);
  // no input at all is also safe
  assert.equal(checkTrack([]).complete, true);
  assert.equal(checkTrack(undefined).complete, true);
});

test('two straights joined end-to-end mate cleanly into one open-ended run', () => {
  const r = checkTrack([T('a', 0, 0), T('b', 16, 0)]); // a.R (16,8) meets b.L (16,8)
  assert.deepEqual(r.gaps, [], 'a flush join is not a gap');
  assert.equal(r.openEnds.length, 2, 'the two far ends dangle');
  assert.equal(r.components.length, 1, 'they form one run');
  assert.equal(r.components[0].matedCount, 2, 'the middle join mated');
  assert.equal(r.components[0].closed, false, 'an open-ended run is not a loop');
});

test('MATE_EPS / ADJACENT constants keep a sub-stud join together but flag a 2-stud gap', () => {
  assert.ok(MATE_EPS < 0.5 && MATE_EPS > 0, 'mate tolerance is under half a stud');
  assert.ok(ADJACENT > 2, 'a 2-stud gap is within the "looks adjacent" radius');
});
