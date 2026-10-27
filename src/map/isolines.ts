export interface Isoline {
  level: number;
  /** Line segments in grid coordinates: [x1, y1, x2, y2]. */
  segments: [number, number, number, number][];
}

/** Marching squares over a regular grid. Cells touching missing values are skipped. */
export function isolines(values: ArrayLike<number>, nx: number, ny: number, interval: number): Isoline[] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < nx * ny; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || max - min < 1e-9) return [];
  const out: Isoline[] = [];
  let first = Math.ceil(min / interval) * interval;
  if (first <= min) first += interval; // a level equal to the minimum would only trace the edge
  for (let level = first; level <= max; level += interval) {
    const segments: Isoline['segments'] = [];
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const a = values[y * nx + x]; // bottom-left (grid y grows north)
        const b = values[y * nx + x + 1];
        const c = values[(y + 1) * nx + x + 1];
        const d = values[(y + 1) * nx + x];
        if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue;
        // Avoid ambiguity with values exactly on the level.
        const l = level + 1e-7;
        const code = (a > l ? 1 : 0) | (b > l ? 2 : 0) | (c > l ? 4 : 0) | (d > l ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const t = (p: number, q: number) => (l - p) / (q - p);
        const eBottom: [number, number] = [x + t(a, b), y];
        const eRight: [number, number] = [x + 1, y + t(b, c)];
        const eTop: [number, number] = [x + t(d, c), y + 1];
        const eLeft: [number, number] = [x, y + t(a, d)];
        const add = (p: [number, number], q: [number, number]) => segments.push([p[0], p[1], q[0], q[1]]);
        switch (code) {
          case 1:
          case 14:
            add(eLeft, eBottom);
            break;
          case 2:
          case 13:
            add(eBottom, eRight);
            break;
          case 3:
          case 12:
            add(eLeft, eRight);
            break;
          case 4:
          case 11:
            add(eRight, eTop);
            break;
          case 6:
          case 9:
            add(eBottom, eTop);
            break;
          case 7:
          case 8:
            add(eLeft, eTop);
            break;
          case 5: {
            // Saddle: decide by the cell centre value.
            const centre = (a + b + c + d) / 4;
            if (centre > l) {
              add(eLeft, eTop);
              add(eBottom, eRight);
            } else {
              add(eLeft, eBottom);
              add(eRight, eTop);
            }
            break;
          }
          case 10: {
            const centre = (a + b + c + d) / 4;
            if (centre > l) {
              add(eLeft, eBottom);
              add(eRight, eTop);
            } else {
              add(eLeft, eTop);
              add(eBottom, eRight);
            }
            break;
          }
        }
      }
    }
    if (segments.length) out.push({ level, segments });
  }
  return out;
}
