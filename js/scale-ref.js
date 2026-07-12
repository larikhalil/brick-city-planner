// PLAN-8: realistic scale reference overlay.
// Pure tick/label maths + an SVG builder for a faint, non-interactive board overlay that shows
// (a) true-stud-scale silhouettes of everyday LEGO things (a minifig, a car, a door) so a builder
// can eyeball human scale, and (b) a ruler / scale bar with 10 / 50 / 100-stud tick marks that
// honours the current unit toggle (studs / cm). No DOM, no deps beyond units + esc — grid.js owns
// the element lifecycle (it appends the returned markup into the board, in stud coordinates, so the
// whole overlay scales with zoom for free).
import { studsToCm } from './units.js';
import { esc } from './util.js';

// The ruler carries a labelled tick at each of these stud counts (0 is drawn but never labelled).
export const RULER_TICKS = [10, 50, 100];

// Everyday minifig-scale reference footprints, top-down, in studs. Deliberately approximate — these
// are a human-scale gut-check, NOT exact parts: a standing minifig prints on ~1×1 studs, a City car
// is ~4 studs wide × 8 long, a doorway frame is 1 stud wide × 4 studs of opening.
export const SCALE_REFS = [
  { key: 'minifig', label: 'Minifig', w: 1, h: 2 },
  { key: 'car', label: 'Car', w: 4, h: 8 },
  { key: 'door', label: 'Door', w: 1, h: 4 },
];

// Unit-aware label for a stud count. cm reuses the same rounding as every other dimension readout.
export function tickLabel(studs, unit = 'studs') {
  return unit === 'cm' ? `${studsToCm(studs)} cm` : `${studs} studs`;
}

// Pure ruler maths: each labelled tick's stud offset, pixel offset (from the bar's zero) and label.
// pxPerStud mirrors grid.js's PX so the caller can lay the ticks out in board pixels.
export function rulerTicks(unit = 'studs', pxPerStud = 6) {
  return RULER_TICKS.map((s) => ({ studs: s, x: s * pxPerStud, label: tickLabel(s, unit) }));
}

// The ruler spans 0 → this many studs (its longest labelled tick).
export function rulerSpanStuds() {
  return Math.max(...RULER_TICKS);
}

// ---- SVG overlay --------------------------------------------------------------------------------
// Build the full overlay markup for a gridW×gridH-stud board (both in studs). Everything is drawn in
// board pixels (studs × px) inside a <svg> the size of the board; colour + faintness come from CSS
// (.scale-ref-overlay in styles.css) so it stays theme-aware in light/dark. Non-interactive.
export function scaleRefSVG({ gridW, gridH, unit = 'studs', px = 6 } = {}) {
  const W = gridW * px, H = gridH * px;
  const pad = 8 * px; // inset the whole cluster ~8 studs from the board's top-left corner
  const span = rulerSpanStuds();

  // --- ruler / scale bar ---
  const barY = pad;
  const barX0 = pad;
  const barX1 = pad + span * px;
  let ruler = `<line class="sr-rule" x1="${barX0}" y1="${barY}" x2="${barX1}" y2="${barY}"/>`;
  // Minor ticks every 10 studs give the bar its ruled feel; labelled ticks stand taller.
  const labelled = new Set(RULER_TICKS);
  for (let s = 0; s <= span; s += 10) {
    const x = barX0 + s * px;
    const major = labelled.has(s);
    const len = major ? 9 : 5;
    ruler += `<line class="sr-tick" x1="${x}" y1="${barY}" x2="${x}" y2="${barY - len}"/>`;
  }
  for (const t of rulerTicks(unit, px)) {
    const x = barX0 + t.x;
    ruler += `<text class="sr-label" x="${x}" y="${barY - 13}" text-anchor="middle">${esc(t.label)}</text>`;
  }

  // --- silhouettes: a labelled row of true-scale footprints under the ruler ---
  let shapes = '';
  let cx = pad; // walking left→right, spacing each footprint by its own width + a gutter
  const rowTop = barY + 6 * px; // drop below the ruler + its labels
  const gutter = 3 * px;
  for (const r of SCALE_REFS) {
    const w = r.w * px, h = r.h * px;
    if (r.key === 'car') {
      // rounded body + two windows so it reads as a car, not just a rectangle
      shapes += `<rect class="sr-shape" x="${cx}" y="${rowTop}" width="${w}" height="${h}" rx="${px}"/>` +
        `<rect class="sr-shape-detail" x="${cx + w * 0.18}" y="${rowTop + h * 0.16}" width="${w * 0.64}" height="${h * 0.22}" rx="2"/>` +
        `<rect class="sr-shape-detail" x="${cx + w * 0.18}" y="${rowTop + h * 0.62}" width="${w * 0.64}" height="${h * 0.22}" rx="2"/>`;
    } else if (r.key === 'minifig') {
      // head circle + body so a single stud reads as a person
      shapes += `<rect class="sr-shape" x="${cx}" y="${rowTop + h * 0.4}" width="${w}" height="${h * 0.6}" rx="2"/>` +
        `<circle class="sr-shape" cx="${cx + w / 2}" cy="${rowTop + h * 0.24}" r="${Math.max(w, h) * 0.22}"/>`;
    } else {
      // door: frame outline with a leaf line
      shapes += `<rect class="sr-shape sr-shape-open" x="${cx}" y="${rowTop}" width="${w}" height="${h}" rx="1"/>` +
        `<line class="sr-shape-detail" x1="${cx}" y1="${rowTop + h * 0.5}" x2="${cx + w}" y2="${rowTop + h * 0.5}"/>`;
    }
    shapes += `<text class="sr-shape-label" x="${cx + w / 2}" y="${rowTop + h + 12}" text-anchor="middle">${esc(r.label)}</text>`;
    cx += Math.max(w, 4 * px) + gutter;
  }

  return `<svg class="scale-ref-overlay" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${ruler}${shapes}</svg>`;
}
