export const STUD_CM = 0.8;
export const BASEPLATE = 32;

export function studsToCm(studs) {
  return Math.round(studs * STUD_CM * 10) / 10;
}

export function fmtDims(w, h, unit = 'studs') {
  if (unit === 'cm') return `${studsToCm(w)} × ${studsToCm(h)} cm`;
  return `${Math.round(w)} × ${Math.round(h)} studs`;
}

export function fmtArea(w, h, unit = 'studs') {
  if (unit === 'cm') {
    const cm2 = studsToCm(w) * studsToCm(h);
    return cm2 >= 10000 ? `${(cm2 / 10000).toFixed(2)} m²` : `${Math.round(cm2)} cm²`;
  }
  return `${Math.round(w * h)} studs²`;
}
