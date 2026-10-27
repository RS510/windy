import { getJSON } from './http';
import { gridPoints, type Grid, type GridSpec } from './grid';
import type { ModelId, Source } from '../layers/definitions';
import { SOURCE_VARS } from '../layers/definitions';

export const ENDPOINTS = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  marine: 'https://marine-api.open-meteo.com/v1/marine',
  air: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
};

/** Shape of one location in an Open-Meteo response (timeformat=unixtime). */
export interface OMLocation {
  latitude: number;
  longitude: number;
  elevation?: number;
  hourly?: { time: number[]; [variable: string]: (number | null)[] };
  hourly_units?: Record<string, string>;
}

export const GRID_DAYS = 5;
export const POINT_DAYS = 7;

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function sourceEndpoint(source: Exclude<Source, 'radar'>): string {
  return source === 'marine' ? ENDPOINTS.marine : source === 'air' ? ENDPOINTS.air : ENDPOINTS.forecast;
}

export interface QueryOptions {
  source: Exclude<Source, 'radar'>;
  lats: number[];
  lons: number[];
  vars: string[];
  days: number;
  model?: ModelId | string;
}

export function buildUrl(o: QueryOptions): string {
  const p = new URLSearchParams();
  p.set('latitude', o.lats.map(fmt).join(','));
  p.set('longitude', o.lons.map(fmt).join(','));
  p.set('hourly', o.vars.join(','));
  p.set('timeformat', 'unixtime');
  p.set('timezone', 'GMT');
  p.set('forecast_days', String(o.source === 'air' ? Math.min(o.days, 5) : o.days));
  if (o.source === 'base' || o.source === 'upper') {
    p.set('wind_speed_unit', 'ms');
    if (o.model && o.model !== 'best_match') p.set('models', o.model);
  } else if (o.source === 'marine') {
    p.set('length_unit', 'metric');
  }
  return `${sourceEndpoint(o.source)}?${p.toString()}`;
}

export function asArray(r: OMLocation | OMLocation[]): OMLocation[] {
  return Array.isArray(r) ? r : [r];
}

function toFloat(arr: (number | null)[] | undefined, len: number): Float32Array {
  const out = new Float32Array(len).fill(NaN);
  if (!arr) return out;
  for (let i = 0; i < len && i < arr.length; i++) {
    const v = arr[i];
    out[i] = v === null || v === undefined ? NaN : v;
  }
  return out;
}

/** Converts an Open-Meteo multi-location response into a Grid (time-major arrays). */
export function parseGrid(spec: GridSpec, vars: string[], resp: OMLocation | OMLocation[]): Grid {
  const locs = asArray(resp);
  const n = spec.nx * spec.ny;
  if (locs.length !== n) throw new Error(`Gitter unvollständig (${locs.length}/${n})`);
  const times = locs[0].hourly?.time ?? [];
  const nt = times.length;
  const out: Record<string, Float32Array[]> = {};
  for (const v of vars) {
    const series: Float32Array[] = [];
    for (let t = 0; t < nt; t++) series.push(new Float32Array(n).fill(NaN));
    for (let i = 0; i < n; i++) {
      const col = toFloat(locs[i].hourly?.[v] as (number | null)[] | undefined, nt);
      for (let t = 0; t < nt; t++) series[t][i] = col[t];
    }
    out[v] = series;
  }
  return { spec, times: [...times], vars: out };
}

export async function fetchGrid(source: Exclude<Source, 'radar'>, spec: GridSpec, model: ModelId): Promise<Grid> {
  const pts = gridPoints(spec);
  const vars = SOURCE_VARS[source];
  const url = buildUrl({
    source,
    lats: pts.map((p) => p.lat),
    lons: pts.map((p) => p.lon),
    vars,
    days: GRID_DAYS,
    model,
  });
  const resp = await getJSON<OMLocation | OMLocation[]>(url);
  return parseGrid(spec, vars, resp);
}

// ---------- point forecasts ----------

export interface Series {
  time: number[];
  values: Record<string, (number | null)[]>;
  elevation?: number;
}

export const POINT_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'precipitation_probability',
  'cloud_cover',
  'pressure_msl',
  'relative_humidity_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'weather_code',
];

function toSeries(loc: OMLocation, vars: string[]): Series {
  const time = loc.hourly?.time ?? [];
  const values: Record<string, (number | null)[]> = {};
  for (const v of vars) values[v] = (loc.hourly?.[v] as (number | null)[] | undefined) ?? time.map(() => null);
  return { time, values, elevation: loc.elevation };
}

export async function fetchPoint(lat: number, lon: number, model: ModelId): Promise<Series> {
  const url = buildUrl({ source: 'base', lats: [lat], lons: [lon], vars: POINT_VARS, days: POINT_DAYS, model });
  return toSeries(asArray(await getJSON<OMLocation>(url))[0], POINT_VARS);
}

export const COMPARE_VARS = ['temperature_2m', 'wind_speed_10m', 'wind_gusts_10m', 'precipitation', 'wind_direction_10m'];

/** Several models in one request; Open-Meteo suffixes each variable with `_<model>`. */
export async function fetchModels(lat: number, lon: number, models: ModelId[]): Promise<Record<string, Series>> {
  const p = new URLSearchParams({
    latitude: fmt(lat),
    longitude: fmt(lon),
    hourly: COMPARE_VARS.join(','),
    models: models.join(','),
    timeformat: 'unixtime',
    timezone: 'GMT',
    forecast_days: String(POINT_DAYS),
    wind_speed_unit: 'ms',
  });
  const loc = asArray(await getJSON<OMLocation>(`${ENDPOINTS.forecast}?${p}`))[0];
  return splitModels(loc, models);
}

export function splitModels(loc: OMLocation, models: string[]): Record<string, Series> {
  const out: Record<string, Series> = {};
  const time = loc.hourly?.time ?? [];
  for (const m of models) {
    const values: Record<string, (number | null)[]> = {};
    let any = false;
    for (const v of COMPARE_VARS) {
      const arr = loc.hourly?.[`${v}_${m}`] as (number | null)[] | undefined;
      values[v] = arr ?? time.map(() => null);
      if (arr && arr.some((x) => x !== null)) any = true;
    }
    if (any) out[m] = { time, values };
  }
  return out;
}

export async function fetchMarinePoint(lat: number, lon: number): Promise<Series> {
  const vars = ['wave_height', 'wave_direction', 'wave_period', 'wind_wave_height', 'swell_wave_height', 'swell_wave_direction', 'swell_wave_period'];
  const url = buildUrl({ source: 'marine', lats: [lat], lons: [lon], vars, days: POINT_DAYS });
  return toSeries(asArray(await getJSON<OMLocation>(url))[0], vars);
}

export async function fetchAirPoint(lat: number, lon: number): Promise<Series> {
  const vars = ['european_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide'];
  const url = buildUrl({ source: 'air', lats: [lat], lons: [lon], vars, days: 5 });
  return toSeries(asArray(await getJSON<OMLocation>(url))[0], vars);
}

/** Wind series for many spots in one request. */
export async function fetchSpots(points: { lat: number; lon: number }[], model: ModelId): Promise<Series[]> {
  if (!points.length) return [];
  const vars = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];
  const url = buildUrl({
    source: 'base',
    lats: points.map((p) => p.lat),
    lons: points.map((p) => p.lon),
    vars,
    days: POINT_DAYS,
    model,
  });
  return asArray(await getJSON<OMLocation | OMLocation[]>(url)).map((l) => toSeries(l, vars));
}

// ---------- geocoding ----------

export interface Place {
  name: string;
  lat: number;
  lon: number;
  detail: string;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const p = new URLSearchParams({ name: q, count: '8', language: 'de', format: 'json' });
  const r = await getJSON<{ results?: any[] }>(`${ENDPOINTS.geocoding}?${p}`);
  return (r.results ?? []).map((x) => ({
    name: x.name,
    lat: x.latitude,
    lon: x.longitude,
    detail: [x.admin1, x.country].filter(Boolean).join(', '),
  }));
}

/** Parses "48.1, 11.5" style coordinate input. */
export function parseCoords(q: string): { lat: number; lon: number } | null {
  const m = q.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lon = parseFloat(m[2].replace(',', '.'));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
