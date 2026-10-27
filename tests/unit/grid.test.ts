import { describe, expect, it } from 'vitest';
import { bilinear, gridIndex, gridPoints, makeGridSpec, nearestTimeIndex, sampleGrid, wrapLon } from '../../src/data/grid';
import { buildUrl, parseGrid, splitModels, parseCoords, type OMLocation } from '../../src/data/openMeteo';
import { timeIndexFor } from '../../src/data/store';
import { parseRadar, radarTileUrl } from '../../src/data/rainviewer';

describe('grid spec', () => {
  it('covers the bounds with a bounded number of points', () => {
    const b = { south: 44, north: 56, west: -2, east: 20 };
    const s = makeGridSpec(b, 150);
    expect(s.nx * s.ny).toBeLessThanOrEqual(220);
    expect(s.lat0).toBeLessThanOrEqual(44);
    expect(s.lon0).toBeLessThanOrEqual(-2);
    expect(s.lat0 + (s.ny - 1) * s.step).toBeGreaterThanOrEqual(56);
    expect(s.lon0 + (s.nx - 1) * s.step).toBeGreaterThanOrEqual(20);
  });

  it('snaps to step multiples so small pans give the same grid', () => {
    const a = makeGridSpec({ south: 44.1, north: 56.1, west: -2.1, east: 20.1 }, 150);
    const b = makeGridSpec({ south: 44.2, north: 56.2, west: -1.9, east: 20.2 }, 150);
    expect(a).toEqual(b);
  });

  it('handles bounds across the antimeridian and clamps latitude', () => {
    const s = makeGridSpec({ south: -89, north: 89, west: 170, east: 200 }, 150);
    const pts = gridPoints(s);
    expect(pts.every((p) => p.lon >= -180 && p.lon <= 180)).toBe(true);
    expect(pts.every((p) => p.lat >= -85 && p.lat <= 85)).toBe(true);
    expect(pts.length).toBe(s.nx * s.ny);
  });

  it('wraps longitudes', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(10)).toBe(10);
  });

  it('computes fractional indices monotonic around the grid', () => {
    const s = { lat0: 40, lon0: 0, step: 1, nx: 11, ny: 11 };
    expect(gridIndex(s, 45, 5)).toEqual([5, 5]);
    expect(gridIndex(s, 40, 360)[0]).toBeCloseTo(0);
    expect(gridIndex(s, 40, -1)[0]).toBeCloseTo(-1); // just west stays negative
    expect(gridIndex(s, 40, -350)[0]).toBeCloseTo(10);
  });
});

describe('interpolation', () => {
  const vals = new Float32Array([0, 10, 20, 30]); // 2x2: row0 = 0,10 row1 = 20,30

  it('interpolates bilinearly', () => {
    expect(bilinear(vals, 2, 2, 0, 0)).toBe(0);
    expect(bilinear(vals, 2, 2, 1, 1)).toBe(30);
    expect(bilinear(vals, 2, 2, 0.5, 0.5)).toBe(15);
    expect(bilinear(vals, 2, 2, 0.5, 0)).toBe(5);
  });

  it('returns NaN outside the grid', () => {
    expect(bilinear(vals, 2, 2, -0.1, 0)).toBeNaN();
    expect(bilinear(vals, 2, 2, 0, 1.1)).toBeNaN();
  });

  it('ignores missing corners', () => {
    const v = new Float32Array([NaN, 10, 20, 30]);
    expect(bilinear(v, 2, 2, 0.5, 0.5)).toBeCloseTo(20);
    expect(bilinear(new Float32Array([NaN, NaN, NaN, 4]), 2, 2, 0, 0)).toBeNaN();
  });

  it('finds nearest time index', () => {
    expect(nearestTimeIndex([0, 3600, 7200], 4000)).toBe(1);
    expect(nearestTimeIndex([0, 3600, 7200], 999999)).toBe(2);
  });
});

function fakeResponse(spec: { nx: number; ny: number }, vars: string[], times: number[]): OMLocation[] {
  const out: OMLocation[] = [];
  for (let i = 0; i < spec.nx * spec.ny; i++) {
    const hourly: any = { time: times };
    for (const v of vars) hourly[v] = times.map((_, t) => (v === 'missing' ? null : i * 10 + t));
    out.push({ latitude: 0, longitude: 0, hourly });
  }
  return out;
}

describe('Open-Meteo parsing', () => {
  it('builds multi-location URLs with model and units', () => {
    const url = new URL(buildUrl({ source: 'base', lats: [1.234, 2], lons: [3, 4.567], vars: ['a', 'b'], days: 5, model: 'icon_seamless' }));
    expect(url.hostname).toBe('api.open-meteo.com');
    expect(url.searchParams.get('latitude')).toBe('1.23,2');
    expect(url.searchParams.get('longitude')).toBe('3,4.57');
    expect(url.searchParams.get('hourly')).toBe('a,b');
    expect(url.searchParams.get('models')).toBe('icon_seamless');
    expect(url.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
  });

  it('omits the model parameter for best match and uses separate hosts', () => {
    expect(new URL(buildUrl({ source: 'base', lats: [1], lons: [1], vars: ['a'], days: 1, model: 'best_match' })).searchParams.has('models')).toBe(false);
    expect(new URL(buildUrl({ source: 'marine', lats: [1], lons: [1], vars: ['a'], days: 1 })).hostname).toBe('marine-api.open-meteo.com');
    const air = new URL(buildUrl({ source: 'air', lats: [1], lons: [1], vars: ['a'], days: 7 }));
    expect(air.hostname).toBe('air-quality-api.open-meteo.com');
    expect(air.searchParams.get('forecast_days')).toBe('5');
  });

  it('parses a multi-location response into a time-major grid with NaN for nulls', () => {
    const spec = { lat0: 0, lon0: 0, step: 1, nx: 3, ny: 2 };
    const g = parseGrid(spec, ['x', 'missing'], fakeResponse(spec, ['x', 'missing'], [100, 3700]));
    expect(g.times).toEqual([100, 3700]);
    expect(Array.from(g.vars.x[0])).toEqual([0, 10, 20, 30, 40, 50]);
    expect(Array.from(g.vars.x[1])).toEqual([1, 11, 21, 31, 41, 51]);
    expect(Number.isNaN(g.vars.missing[0][0])).toBe(true);
    expect(sampleGrid(g, 'x', 0, 0.5, 0.5)).toBeCloseTo(20); // mean of 0,10,30,40
  });

  it('rejects incomplete responses', () => {
    const spec = { lat0: 0, lon0: 0, step: 1, nx: 3, ny: 2 };
    expect(() => parseGrid(spec, ['x'], fakeResponse({ nx: 2, ny: 2 }, ['x'], [0]))).toThrow();
  });

  it('accepts a single-object response for one point', () => {
    const spec = { lat0: 0, lon0: 0, step: 1, nx: 1, ny: 1 };
    const g = parseGrid(spec, ['x'], fakeResponse(spec, ['x'], [0])[0]);
    expect(g.vars.x[0][0]).toBe(0);
  });

  it('splits multi-model responses by suffix and drops empty models', () => {
    const loc: OMLocation = {
      latitude: 0,
      longitude: 0,
      hourly: {
        time: [0, 3600],
        temperature_2m_gfs_seamless: [1, 2],
        wind_speed_10m_gfs_seamless: [3, 4],
        temperature_2m_icon_seamless: [null, null],
      },
    };
    const r = splitModels(loc, ['gfs_seamless', 'icon_seamless']);
    expect(Object.keys(r)).toEqual(['gfs_seamless']);
    expect(r.gfs_seamless.values.temperature_2m).toEqual([1, 2]);
    expect(r.gfs_seamless.values.precipitation).toEqual([null, null]);
  });

  it('matches grid times to timeline times within 90 minutes', () => {
    const g = { spec: { lat0: 0, lon0: 0, step: 1, nx: 1, ny: 1 }, times: [0, 3600], vars: {} };
    expect(timeIndexFor(g, 3500)).toBe(1);
    expect(timeIndexFor(g, 3600 + 6000)).toBe(-1);
    expect(timeIndexFor(g, undefined)).toBe(-1);
  });

  it('parses coordinates typed into search', () => {
    expect(parseCoords('48.1, 11.5')).toEqual({ lat: 48.1, lon: 11.5 });
    expect(parseCoords('48,1 11,5')).toEqual({ lat: 48.1, lon: 11.5 });
    expect(parseCoords('-33.9;18.4')).toEqual({ lat: -33.9, lon: 18.4 });
    expect(parseCoords('Berlin')).toBeNull();
    expect(parseCoords('95, 10')).toBeNull();
  });
});

describe('RainViewer', () => {
  it('combines past and nowcast frames and builds tile URLs', () => {
    const info = parseRadar({ host: 'https://tilecache.rainviewer.com', radar: { past: [{ time: 1, path: '/v2/radar/1' }], nowcast: [{ time: 2, path: '/v2/radar/2' }] } });
    expect(info.frames.map((f) => f.nowcast)).toEqual([false, true]);
    expect(radarTileUrl(info, info.frames[0])).toBe('https://tilecache.rainviewer.com/v2/radar/1/256/{z}/{x}/{y}/2/1_1.png');
    expect(parseRadar({ host: 'h' }).frames).toEqual([]);
  });
});
