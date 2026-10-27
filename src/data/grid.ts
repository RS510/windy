// Regular lat/lon grid of forecast values, filled from Open-Meteo multi-location requests.

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GridSpec {
  lat0: number; // southernmost latitude
  lon0: number; // westernmost longitude (may be outside -180..180, it is unwrapped)
  step: number; // degrees between points
  nx: number;
  ny: number;
}

export interface Grid {
  spec: GridSpec;
  times: number[]; // unix seconds (UTC)
  /** vars[name][timeIndex] = values row-major (y * nx + x), NaN where missing. */
  vars: Record<string, Float32Array[]>;
}

const NICE_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15];

/**
 * Builds a grid covering the bounds with about `targetPoints` points. Steps are rounded to
 * "nice" values and the origin snapped to multiples of the step, so small pans reuse the cache.
 */
export function makeGridSpec(b: Bounds, targetPoints = 150, maxPoints = 220): GridSpec {
  const south = Math.max(-85, b.south);
  const north = Math.min(85, b.north);
  const latSpan = Math.max(0.2, north - south);
  const lonSpan = Math.max(0.2, Math.min(360, b.east - b.west));
  const raw = Math.sqrt((latSpan * lonSpan) / targetPoints);
  let stepIdx = NICE_STEPS.findIndex((s) => s >= raw);
  if (stepIdx < 0) stepIdx = NICE_STEPS.length - 1;
  for (;;) {
    const step = NICE_STEPS[stepIdx];
    const lat0 = Math.max(-85, Math.floor(south / step) * step);
    const lon0 = Math.floor(b.west / step) * step;
    const ny = Math.min(Math.ceil((Math.min(85, Math.ceil(north / step) * step) - lat0) / step) + 1, Math.floor(170 / step) + 1);
    const nx = Math.min(Math.ceil((Math.ceil(b.east / step) * step - lon0) / step) + 1, Math.floor(360 / step) + 1);
    if (nx * ny <= maxPoints || stepIdx === NICE_STEPS.length - 1) {
      return { lat0: round(lat0), lon0: round(lon0), step, nx, ny };
    }
    stepIdx++;
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function specKey(s: GridSpec): string {
  return `${s.lat0},${s.lon0},${s.step},${s.nx},${s.ny}`;
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Points of the grid in request order (row by row from south). Longitudes wrapped to -180..180. */
export function gridPoints(s: GridSpec): { lat: number; lon: number }[] {
  const pts: { lat: number; lon: number }[] = [];
  for (let y = 0; y < s.ny; y++) {
    for (let x = 0; x < s.nx; x++) {
      pts.push({ lat: round(s.lat0 + y * s.step), lon: round(wrapLon(s.lon0 + x * s.step)) });
    }
  }
  return pts;
}

/** Fractional grid index for a coordinate, handling longitude wrap. */
export function gridIndex(s: GridSpec, lat: number, lon: number): [number, number] {
  // Wrap into a 360° window centred on the grid, so points just west of it stay slightly
  // negative (outside) instead of jumping to the far east side. Keeps screen mapping monotonic.
  const span = (s.nx - 1) * s.step;
  const low = -(360 - span) / 2;
  let dx = lon - s.lon0 - low;
  dx = ((dx % 360) + 360) % 360 + low;
  return [dx / s.step, (lat - s.lat0) / s.step];
}

/** Bilinear interpolation that tolerates NaN corners (renormalises over available ones). */
export function bilinear(values: ArrayLike<number>, nx: number, ny: number, fx: number, fy: number): number {
  if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return NaN;
  const x0 = Math.min(Math.floor(fx), nx - 2 < 0 ? 0 : nx - 2);
  const y0 = Math.min(Math.floor(fy), ny - 2 < 0 ? 0 : ny - 2);
  const x1 = Math.min(x0 + 1, nx - 1);
  const y1 = Math.min(y0 + 1, ny - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = values[y0 * nx + x0];
  const v10 = values[y0 * nx + x1];
  const v01 = values[y1 * nx + x0];
  const v11 = values[y1 * nx + x1];
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  let sum = 0;
  let wsum = 0;
  if (!Number.isNaN(v00)) {
    sum += v00 * w00;
    wsum += w00;
  }
  if (!Number.isNaN(v10)) {
    sum += v10 * w10;
    wsum += w10;
  }
  if (!Number.isNaN(v01)) {
    sum += v01 * w01;
    wsum += w01;
  }
  if (!Number.isNaN(v11)) {
    sum += v11 * w11;
    wsum += w11;
  }
  // Require a reasonable share of real data so coastlines don't smear far over land/sea.
  return wsum > 0.25 ? sum / wsum : NaN;
}

export function sampleGrid(g: Grid, name: string, t: number, lat: number, lon: number): number {
  const series = g.vars[name];
  if (!series || !series[t]) return NaN;
  const [fx, fy] = gridIndex(g.spec, lat, lon);
  return bilinear(series[t], g.spec.nx, g.spec.ny, fx, fy);
}

/** Index of the time step closest to `unix` seconds. */
export function nearestTimeIndex(times: number[], unix: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i] - unix);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
