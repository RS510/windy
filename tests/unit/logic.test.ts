import { describe, expect, it } from 'vitest';
import { isolines } from '../../src/map/isolines';
import { bestWindows, rateHour, sectorOf, type Spot } from '../../src/util/spotRating';
import { SCALES, interpolateStops, makeScale, colorAt, parseHex } from '../../src/layers/colorScales';
import { LAYERS, SOURCE_VARS, getLayer } from '../../src/layers/definitions';

describe('isolines', () => {
  it('draws a straight line through a linear field', () => {
    // values increase along x: 0, 10, 20 on 3 rows
    const v = new Float32Array([0, 10, 20, 0, 10, 20, 0, 10, 20]);
    const lines = isolines(v, 3, 3, 5);
    const levels = lines.map((l) => l.level);
    expect(levels).toEqual([5, 10, 15]);
    const l5 = lines[0];
    expect(l5.segments.length).toBe(2);
    for (const [x1, , x2] of l5.segments) {
      expect(x1).toBeCloseTo(0.5, 3);
      expect(x2).toBeCloseTo(0.5, 3);
    }
  });

  it('closes a ring around a maximum', () => {
    const v = new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 0]);
    const [ring] = isolines(v, 3, 3, 5);
    expect(ring.level).toBe(5);
    expect(ring.segments.length).toBe(4);
  });

  it('skips cells with missing data and flat fields', () => {
    expect(isolines(new Float32Array([NaN, NaN, NaN, NaN]), 2, 2, 4)).toEqual([]);
    expect(isolines(new Float32Array([1013, 1013, 1013, 1013]), 2, 2, 4)).toEqual([]);
  });
});

const spot: Spot = { id: 'a', name: 'Test', lat: 0, lon: 0, sport: 'kite', minWind: 6, maxWind: 14, directions: [6, 7] }; // W, NW

describe('spot rating', () => {
  it('rates by speed and direction', () => {
    expect(rateHour(spot, 10, 270, 12)).toBe(2); // good speed, W
    expect(rateHour(spot, 10, 315, 12)).toBe(2); // NW
    expect(rateHour(spot, 10, 0, 12)).toBe(1); // N is adjacent to NW
    expect(rateHour(spot, 10, 90, 12)).toBe(0); // offshore east
    expect(rateHour(spot, 5, 270, 7)).toBe(1); // slightly too little wind
    expect(rateHour(spot, 2, 270, 3)).toBe(0);
    expect(rateHour(spot, null, 270, null)).toBe(0);
  });

  it('downgrades very gusty hours', () => {
    expect(rateHour(spot, 12, 270, 25)).toBe(1);
  });

  it('accepts all directions when none set', () => {
    expect(rateHour({ ...spot, directions: [] }, 10, 90, 10)).toBe(2);
  });

  it('maps degrees to sectors', () => {
    expect(sectorOf(0)).toBe(0);
    expect(sectorOf(350)).toBe(0);
    expect(sectorOf(100)).toBe(2);
    expect(sectorOf(-90)).toBe(6);
  });

  it('finds the longest good windows', () => {
    const t = [0, 1, 2, 3, 4, 5, 6, 7].map((h) => h * 3600);
    const w = bestWindows(t, [2, 2, 0, 2, 2, 2, 1, 2]);
    expect(w[0]).toEqual({ start: 3 * 3600, end: 5 * 3600, hours: 3 });
    expect(w.length).toBe(3);
    expect(bestWindows(t, [0, 0, 0, 0, 0, 0, 0, 0])).toEqual([]);
  });
});

describe('colour scales', () => {
  it('parses hex colours with alpha', () => {
    expect(parseHex('#ff8000')).toEqual([255, 128, 0, 255]);
    expect(parseHex('#00000000')).toEqual([0, 0, 0, 0]);
  });

  it('interpolates between stops and clamps', () => {
    const stops: [number, string][] = [
      [0, '#000000'],
      [10, '#ffffff'],
    ];
    expect(interpolateStops(stops, 5)).toEqual([128, 128, 128, 255]);
    expect(interpolateStops(stops, -5)).toEqual([0, 0, 0, 255]);
    expect(interpolateStops(stops, 50)).toEqual([255, 255, 255, 255]);
  });

  it('colours via lookup table and skips NaN', () => {
    const sc = makeScale([
      [0, '#000000'],
      [1, '#ff0000'],
    ]);
    const out = new Uint8ClampedArray(4);
    expect(colorAt(sc, 1, out, 0)).toBe(true);
    expect(Array.from(out)).toEqual([255, 0, 0, 255]);
    expect(colorAt(sc, NaN, out, 0)).toBe(false);
  });

  it('defines a complete scale for every coloured layer', () => {
    for (const l of LAYERS) {
      if (l.source === 'radar') continue;
      expect(l.scale, l.id).toBeDefined();
      expect(l.variable, l.id).toBeDefined();
      expect(SOURCE_VARS[l.source]).toContain(l.variable);
      if (l.particles) for (const v of l.particles) expect(SOURCE_VARS[l.source === 'upper' ? 'upper' : 'base']).toContain(v);
      expect(l.legend!.length).toBeGreaterThan(2);
    }
    expect(Object.keys(SCALES).length).toBeGreaterThan(5);
    expect(getLayer('nope' as any).id).toBe('wind');
  });
});

import { normalizeLayers, particleLayer, radarOnly, sortLayers, toggleLayerId } from '../../src/layers/definitions';

describe('active layers', () => {
  it('takes over the single layer stored by older versions', () => {
    expect(normalizeLayers(null, 'temp')).toEqual(['temp']);
    expect(normalizeLayers(null, 'bogus')).toEqual(['wind']);
    expect(normalizeLayers(null, null)).toEqual(['wind']);
    expect(normalizeLayers([], 'temp')).toEqual([]); // explicitly empty stays empty
    expect(normalizeLayers(['rain', 'temp', 'x', 'temp'], null)).toEqual(['temp', 'rain']);
  });

  it('toggles layers and keeps drawing order', () => {
    expect(toggleLayerId(['wind'], 'temp')).toEqual(['temp', 'wind']);
    expect(toggleLayerId(['temp', 'wind'], 'temp')).toEqual(['wind']);
    expect(toggleLayerId([], 'clouds')).toEqual(['clouds']);
    expect(sortLayers(['radar', 'clouds', 'temp'])).toEqual(['temp', 'clouds', 'radar']);
  });

  it('runs particles only for wind layers, surface wind first', () => {
    expect(particleLayer(['temp', 'rain'])).toBeUndefined();
    expect(particleLayer(['wind500', 'gust'])!.id).toBe('gust');
    expect(particleLayer(['wind850', 'wind500'])!.id).toBe('wind850');
    expect(radarOnly(['radar'])).toBe(true);
    expect(radarOnly(['radar', 'wind'])).toBe(false);
  });
});

import { splitAtDateLine } from '../../src/map/lines';

describe('border lines', () => {
  it('splits lines that jump across the date line', () => {
    const r = splitAtDateLine({
      type: 'MultiLineString',
      coordinates: [
        [
          [170, 60],
          [179.9, 61],
          [-179.9, 61],
          [-170, 62],
        ],
        [
          [0, 0],
          [1, 1],
        ],
      ],
    });
    expect(r.coordinates).toEqual([
      [
        [170, 60],
        [179.9, 61],
      ],
      [
        [-179.9, 61],
        [-170, 62],
      ],
      [
        [0, 0],
        [1, 1],
      ],
    ]);
  });
});
