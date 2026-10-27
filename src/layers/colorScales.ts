export type RGBA = [number, number, number, number];
export type Stop = [number, string]; // value in base unit, CSS hex colour (#rrggbb or #rrggbbaa)

export interface ColorScale {
  stops: Stop[];
  /** Precomputed lookup table for fast colouring. */
  lut: Uint8ClampedArray;
  min: number;
  max: number;
}

const LUT_SIZE = 256;

export function parseHex(hex: string): RGBA {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

export function makeScale(stops: Stop[]): ColorScale {
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  const min = sorted[0][0];
  const max = sorted[sorted.length - 1][0];
  const lut = new Uint8ClampedArray(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const v = min + ((max - min) * i) / (LUT_SIZE - 1);
    const c = interpolateStops(sorted, v);
    lut.set(c, i * 4);
  }
  return { stops: sorted, lut, min, max };
}

export function interpolateStops(stops: Stop[], v: number): RGBA {
  if (v <= stops[0][0]) return parseHex(stops[0][1]);
  const last = stops[stops.length - 1];
  if (v >= last[0]) return parseHex(last[1]);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const t = (v - v0) / (v1 - v0);
      const a = parseHex(c0);
      const b = parseHex(c1);
      return [0, 1, 2, 3].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as RGBA;
    }
  }
  return parseHex(last[1]);
}

/** Writes the colour for `v` into `out` at `offset`; returns false for NaN. */
export function colorAt(scale: ColorScale, v: number, out: Uint8ClampedArray, offset: number): boolean {
  if (Number.isNaN(v)) return false;
  let i = Math.round(((v - scale.min) / (scale.max - scale.min)) * (LUT_SIZE - 1));
  if (i < 0) i = 0;
  else if (i >= LUT_SIZE) i = LUT_SIZE - 1;
  const o = i * 4;
  out[offset] = scale.lut[o];
  out[offset + 1] = scale.lut[o + 1];
  out[offset + 2] = scale.lut[o + 2];
  out[offset + 3] = scale.lut[o + 3];
  return true;
}

// Colour ramps loosely inspired by common meteorological map styles. Values in base units.
export const SCALES = {
  wind: makeScale([
    [0, '#6271b7'],
    [2, '#39619f'],
    [4, '#4a94a9'],
    [6, '#4d8d7b'],
    [8, '#53a553'],
    [10, '#359f35'],
    [12, '#a79d51'],
    [14, '#9f7f3a'],
    [17, '#a16c5c'],
    [20, '#813a4e'],
    [25, '#af5088'],
    [30, '#754a93'],
    [40, '#6d61a3'],
  ]),
  upperWind: makeScale([
    [0, '#6271b7'],
    [5, '#39619f'],
    [10, '#4a94a9'],
    [15, '#4d8d7b'],
    [20, '#53a553'],
    [30, '#a79d51'],
    [40, '#9f7f3a'],
    [50, '#a16c5c'],
    [60, '#813a4e'],
    [75, '#af5088'],
    [90, '#754a93'],
  ]),
  temp: makeScale([
    [-40, '#e2d7f0'],
    [-30, '#9b7fc2'],
    [-20, '#6a4ea8'],
    [-10, '#3f5ab0'],
    [-5, '#3a7dbf'],
    [0, '#4fa3c9'],
    [5, '#5bb39a'],
    [10, '#7cbf5a'],
    [15, '#c2c94a'],
    [20, '#e0b23f'],
    [25, '#e08a36'],
    [30, '#d4572e'],
    [35, '#b52a2a'],
    [45, '#6e1420'],
  ]),
  precip: makeScale([
    [0, '#00000000'],
    [0.1, '#3a6fa833'],
    [0.5, '#3f8fd0aa'],
    [1, '#33a9d6dd'],
    [2, '#3cc27aee'],
    [4, '#e4d23aff'],
    [8, '#e6812eff'],
    [15, '#d23b3bff'],
    [30, '#b03ec0ff'],
  ]),
  clouds: makeScale([
    [0, '#00000000'],
    [20, '#6e758022'],
    [50, '#9aa1ac77'],
    [80, '#c8ccd2bb'],
    [100, '#e8eaeedd'],
  ]),
  pressure: makeScale([
    [960, '#7a3f9a'],
    [980, '#3f5ab0'],
    [995, '#3a8bbf'],
    [1005, '#4fae9a'],
    [1013, '#7cbf5a'],
    [1020, '#c9c24a'],
    [1030, '#e08a36'],
    [1045, '#c4442e'],
  ]),
  humidity: makeScale([
    [0, '#a5683a'],
    [30, '#c9a04a'],
    [50, '#8fb85a'],
    [70, '#4fae9a'],
    [85, '#3a8bbf'],
    [100, '#2c4fa8'],
  ]),
  waves: makeScale([
    [0, '#3b5bb5'],
    [0.5, '#3a7dbf'],
    [1, '#3fa6b8'],
    [2, '#4fae7a'],
    [3, '#b8c24a'],
    [4, '#e0a23f'],
    [6, '#d4572e'],
    [8, '#a52a5a'],
    [12, '#6b2a8a'],
  ]),
  pm25: makeScale([
    [0, '#4fae7a'],
    [10, '#9cc44a'],
    [20, '#e0c23f'],
    [25, '#e0a23f'],
    [50, '#d4572e'],
    [75, '#a52a5a'],
    [150, '#6b2a6a'],
  ]),
  ozone: makeScale([
    [0, '#3a7dbf'],
    [50, '#4fae7a'],
    [100, '#c9c24a'],
    [130, '#e0a23f'],
    [180, '#d4572e'],
    [240, '#8a2a6a'],
  ]),
} satisfies Record<string, ColorScale>;
