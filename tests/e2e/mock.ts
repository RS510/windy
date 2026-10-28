import type { BrowserContext, Page, Route } from '@playwright/test';
import { deflateSync } from 'node:zlib';

// Deterministic synthetic weather that follows the documented Open-Meteo response format:
// a low pressure system near the North Sea, moving east over time.

export interface MockOptions {
  failForecast?: boolean;
  failGeocoding?: boolean;
  /** Start like a first-time user (no stored map view). */
  freshView?: boolean;
  /** Simulate a failing primary tile server (CARTO). */
  failTiles?: boolean;
  /** Collected request URLs for assertions. */
  requests?: string[];
}

const MODEL_FACTOR: Record<string, number> = {
  best_match: 1,
  ecmwf_ifs025: 1,
  gfs_seamless: 1.15,
  icon_seamless: 0.9,
  meteofrance_seamless: 1.05,
};

function startOfDayUTC(): number {
  return Math.floor(Date.now() / 86400000) * 86400;
}

function cyclone(lat: number, lon: number, hour: number) {
  const cLat = 56;
  const cLon = -4 + hour * 0.15;
  const dy = (lat - cLat) * 111;
  const dx = (lon - cLon) * 111 * Math.cos((lat * Math.PI) / 180);
  const d = Math.hypot(dx, dy) + 1;
  // Counter-clockwise circulation (northern hemisphere), with some inflow.
  const tangential = Math.atan2(dy, dx) + Math.PI / 2 + 0.3;
  const vx = Math.cos(tangential);
  const vy = Math.sin(tangential);
  const speed = 3 + 17 * Math.exp(-((d - 350) ** 2) / (2 * 300 ** 2));
  const u = vx * speed;
  const v = vy * speed;
  let dir = (Math.atan2(-u, -v) * 180) / Math.PI;
  if (dir < 0) dir += 360;
  const pressure = 1022 - 32 * Math.exp(-(d ** 2) / (2 * 450 ** 2));
  const rain = Math.max(0, 6 * Math.exp(-((d - 200) ** 2) / (2 * 150 ** 2)) - 0.3);
  return { speed, dir, pressure, rain, d };
}

function isLand(lat: number, lon: number): boolean {
  // Very rough: continental Europe south of 54°N and east of 3°E counts as land.
  return lat < 54 && lon > 3 && lon < 40;
}

function value(variable: string, lat: number, lon: number, t: number, model: string): number | null {
  const hour = (t - startOfDayUTC()) / 3600;
  const f = MODEL_FACTOR[model] ?? 1;
  const c = cyclone(lat, lon, hour);
  const diurnal = Math.sin(((hour % 24) - 9) / 24 * 2 * Math.PI);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  switch (variable) {
    case 'wind_speed_10m':
      return r1(c.speed * f);
    case 'wind_direction_10m':
      return Math.round(c.dir);
    case 'wind_gusts_10m':
      return r1(c.speed * f * 1.5 + 2);
    case 'temperature_2m':
      return r1((22 - 0.55 * (lat - 35) + 4 * diurnal) * (f > 1 ? 1.05 : f < 1 ? 0.95 : 1));
    case 'apparent_temperature':
      return r1(20 - 0.55 * (lat - 35) + 4 * diurnal - c.speed * 0.3);
    case 'precipitation':
      return r1(c.rain * f);
    case 'precipitation_probability':
      return Math.min(100, Math.round(c.rain * 25));
    case 'cloud_cover':
      return Math.min(100, Math.round(20 + 80 * Math.exp(-(c.d ** 2) / (2 * 500 ** 2))));
    case 'pressure_msl':
      return r1(c.pressure);
    case 'relative_humidity_2m':
      return Math.min(100, Math.round(55 + 40 * Math.exp(-(c.d ** 2) / (2 * 500 ** 2))));
    case 'weather_code':
      return c.rain > 3 ? 63 : c.rain > 0.5 ? 61 : c.d < 600 ? 3 : 1;
    case 'wind_speed_850hPa':
    case 'wind_direction_850hPa':
    case 'wind_speed_500hPa':
    case 'wind_direction_500hPa': {
      const lvl = variable.includes('850') ? 2 : 3.5;
      if (variable.includes('direction')) return Math.round((c.dir + 20) % 360);
      return r1(c.speed * lvl * f);
    }
    case 'wave_height':
    case 'wind_wave_height':
    case 'swell_wave_height':
      if (isLand(lat, lon)) return null;
      return r1((variable === 'wave_height' ? 0.25 : 0.15) * c.speed + 0.3);
    case 'wave_direction':
    case 'swell_wave_direction':
      return isLand(lat, lon) ? null : Math.round(c.dir);
    case 'wave_period':
    case 'swell_wave_period':
      return isLand(lat, lon) ? null : r1(4 + c.speed * 0.3);
    case 'pm2_5':
      return r1(6 + 18 * Math.exp(-((lat - 51) ** 2 + (lon - 10) ** 2) / 20));
    case 'pm10':
      return r1(10 + 22 * Math.exp(-((lat - 51) ** 2 + (lon - 10) ** 2) / 20));
    case 'ozone':
      return r1(60 + 40 * diurnal + lat * 0.2);
    case 'nitrogen_dioxide':
      return r1(8 + 10 * Math.exp(-((lat - 50) ** 2 + (lon - 8) ** 2) / 4));
    case 'european_aqi':
      return Math.round(20 + 25 * Math.exp(-((lat - 51) ** 2 + (lon - 10) ** 2) / 20));
    default:
      return null;
  }
}

function forecastResponse(url: URL, kind: 'forecast' | 'marine' | 'air') {
  const lats = url.searchParams.get('latitude')!.split(',').map(Number);
  const lons = url.searchParams.get('longitude')!.split(',').map(Number);
  const vars = url.searchParams.get('hourly')!.split(',');
  const days = Number(url.searchParams.get('forecast_days') ?? 7);
  const modelsParam = url.searchParams.get('models') ?? 'best_match';
  const models = modelsParam.split(',');
  const start = startOfDayUTC();
  const time = Array.from({ length: days * 24 }, (_, i) => start + i * 3600);
  const locs = lats.map((lat, i) => {
    const lon = lons[i];
    const hourly: Record<string, unknown> = { time };
    const units: Record<string, string> = { time: 'unixtime' };
    for (const v of vars) {
      if (models.length > 1) {
        for (const m of models) hourly[`${v}_${m}`] = time.map((t) => value(v, lat, lon, t, m));
      } else {
        hourly[v] = time.map((t) => value(v, lat, lon, t, models[0]));
      }
      units[v] = '';
    }
    return {
      latitude: lat,
      longitude: lon,
      generationtime_ms: 0.5,
      utc_offset_seconds: 0,
      timezone: 'GMT',
      timezone_abbreviation: 'GMT',
      elevation: kind === 'forecast' ? (isLand(lat, lon) ? 320 : 0) : undefined,
      hourly_units: units,
      hourly,
    };
  });
  // Open-Meteo returns an object for one location and an array for several.
  return locs.length === 1 ? locs[0] : locs;
}

// ---------- PNG helper ----------

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function png(size: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel(x, y);
      raw.set(p, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Dark tile with a light diagonal "coastline" so the screen blend is visible.
const BASE_TILE = png(256, (x, y) => (Math.abs(x - y) < 2 ? [180, 180, 180, 255] : [12, 12, 14, 255]));
// Label tile: transparent with a light "text" bar, as place names are drawn over the colours.
const LABEL_TILE = png(256, (x, y) => (y > 120 && y < 132 && x > 90 && x < 170 ? [235, 235, 235, 255] : [0, 0, 0, 0]));
const RADAR_TILE = png(256, (x, y) => ((x - 128) ** 2 + (y - 128) ** 2 < 90 ** 2 ? [40, 140, 230, 200] : [0, 0, 0, 0]));

// ---------- routing ----------

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
}

export async function installMocks(target: Page | BrowserContext, opts: MockOptions = {}): Promise<void> {
  const log = (u: string) => opts.requests?.push(u);
  await target.route(/^https:\/\/api\.open-meteo\.com\/v1\/forecast/, (route) => {
    log(route.request().url());
    if (opts.failForecast) return json(route, { error: true, reason: 'Testfehler: Server nicht erreichbar' }, 500);
    return json(route, forecastResponse(new URL(route.request().url()), 'forecast'));
  });
  await target.route(/^https:\/\/marine-api\.open-meteo\.com\//, (route) => {
    log(route.request().url());
    return json(route, forecastResponse(new URL(route.request().url()), 'marine'));
  });
  await target.route(/^https:\/\/air-quality-api\.open-meteo\.com\//, (route) => {
    log(route.request().url());
    return json(route, forecastResponse(new URL(route.request().url()), 'air'));
  });
  await target.route(/^https:\/\/geocoding-api\.open-meteo\.com\//, (route) => {
    log(route.request().url());
    if (opts.failGeocoding) return json(route, { error: true, reason: 'Testfehler' }, 500);
    const name = (new URL(route.request().url()).searchParams.get('name') ?? '').toLowerCase();
    const db = [
      { name: 'Berlin', latitude: 52.52437, longitude: 13.41053, country: 'Deutschland', admin1: 'Berlin' },
      { name: 'Bern', latitude: 46.94809, longitude: 7.44744, country: 'Schweiz', admin1: 'Bern' },
      { name: 'Sankt Peter-Ording', latitude: 54.30363, longitude: 8.64138, country: 'Deutschland', admin1: 'Schleswig-Holstein' },
      { name: 'Tarifa', latitude: 36.01393, longitude: -5.60695, country: 'Spanien', admin1: 'Andalusien' },
    ];
    const results = db.filter((p) => p.name.toLowerCase().startsWith(name.slice(0, 3)));
    return json(route, results.length ? { results, generationtime_ms: 1 } : { generationtime_ms: 1 });
  });
  await target.route(/^https:\/\/api\.rainviewer\.com\//, (route) => {
    log(route.request().url());
    const now = Math.floor(Date.now() / 600000) * 600;
    const past = Array.from({ length: 13 }, (_, i) => ({ time: now - (12 - i) * 600, path: `/v2/radar/${now - (12 - i) * 600}` }));
    const nowcast = Array.from({ length: 3 }, (_, i) => ({ time: now + (i + 1) * 600, path: `/v2/radar/nowcast_${i}` }));
    return json(route, { version: '2.0', generated: now, host: 'https://tilecache.rainviewer.com', radar: { past, nowcast }, satellite: { infrared: [] } });
  });
  await target.route(/^https:\/\/tilecache\.rainviewer\.com\//, (route) => {
    log(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: RADAR_TILE, headers: { 'access-control-allow-origin': '*' } });
  });
  await target.route(/^https:\/\/server\.arcgisonline\.com\//, (route) => {
    log(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: BASE_TILE, headers: { 'access-control-allow-origin': '*' } });
  });
  await target.route(/^https:\/\/[a-d]\.basemaps\.cartocdn\.com\//, (route) =>
    opts.failTiles ? route.abort('connectionrefused') : route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: route.request().url().includes('only_labels') ? LABEL_TILE : BASE_TILE,
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
}
