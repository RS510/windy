// All raw data is stored in base units: m/s, °C, mm, hPa, m, µg/m³, %.

export type WindUnit = 'kmh' | 'ms' | 'kt' | 'bft' | 'mph';
export type TempUnit = 'c' | 'f';
export type PrecipUnit = 'mm' | 'in';
export type PressureUnit = 'hpa' | 'inhg';

export interface UnitSettings {
  wind: WindUnit;
  temp: TempUnit;
  precip: PrecipUnit;
  pressure: PressureUnit;
}

export const DEFAULT_UNITS: UnitSettings = { wind: 'kmh', temp: 'c', precip: 'mm', pressure: 'hpa' };

export const WIND_UNIT_LABEL: Record<WindUnit, string> = {
  kmh: 'km/h',
  ms: 'm/s',
  kt: 'kn',
  bft: 'Bft',
  mph: 'mph',
};
export const TEMP_UNIT_LABEL: Record<TempUnit, string> = { c: '°C', f: '°F' };
export const PRECIP_UNIT_LABEL: Record<PrecipUnit, string> = { mm: 'mm', in: 'in' };
export const PRESSURE_UNIT_LABEL: Record<PressureUnit, string> = { hpa: 'hPa', inhg: 'inHg' };

// Upper bounds (m/s) of Beaufort 0..11; above the last value is 12.
const BEAUFORT_LIMITS = [0.5, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

export function msToBeaufort(ms: number): number {
  for (let i = 0; i < BEAUFORT_LIMITS.length; i++) {
    if (ms < BEAUFORT_LIMITS[i]) return i;
  }
  return 12;
}

/** Lower bound (m/s) of a Beaufort force, used when converting user input back. */
export function beaufortToMs(bft: number): number {
  const b = Math.max(0, Math.min(12, Math.round(bft)));
  return b === 0 ? 0 : BEAUFORT_LIMITS[b - 1];
}

export function convertWind(ms: number, unit: WindUnit): number {
  switch (unit) {
    case 'kmh':
      return ms * 3.6;
    case 'ms':
      return ms;
    case 'kt':
      return ms * 1.943844;
    case 'mph':
      return ms * 2.236936;
    case 'bft':
      return msToBeaufort(ms);
  }
}

export function windToMs(value: number, unit: WindUnit): number {
  switch (unit) {
    case 'kmh':
      return value / 3.6;
    case 'ms':
      return value;
    case 'kt':
      return value / 1.943844;
    case 'mph':
      return value / 2.236936;
    case 'bft':
      return beaufortToMs(value);
  }
}

export function convertTemp(c: number, unit: TempUnit): number {
  return unit === 'c' ? c : c * 1.8 + 32;
}

export function convertPrecip(mm: number, unit: PrecipUnit): number {
  return unit === 'mm' ? mm : mm / 25.4;
}

export function convertPressure(hpa: number, unit: PressureUnit): number {
  return unit === 'hpa' ? hpa : hpa * 0.0295299830714;
}

export type Quantity =
  | 'wind'
  | 'temp'
  | 'precip'
  | 'pressure'
  | 'percent'
  | 'length'
  | 'concentration'
  | 'period'
  | 'direction';

export function convert(q: Quantity, v: number, u: UnitSettings): number {
  switch (q) {
    case 'wind':
      return convertWind(v, u.wind);
    case 'temp':
      return convertTemp(v, u.temp);
    case 'precip':
      return convertPrecip(v, u.precip);
    case 'pressure':
      return convertPressure(v, u.pressure);
    default:
      return v;
  }
}

export function unitLabel(q: Quantity, u: UnitSettings): string {
  switch (q) {
    case 'wind':
      return WIND_UNIT_LABEL[u.wind];
    case 'temp':
      return TEMP_UNIT_LABEL[u.temp];
    case 'precip':
      return PRECIP_UNIT_LABEL[u.precip];
    case 'pressure':
      return PRESSURE_UNIT_LABEL[u.pressure];
    case 'percent':
      return '%';
    case 'length':
      return 'm';
    case 'concentration':
      return 'µg/m³';
    case 'period':
      return 's';
    case 'direction':
      return '°';
  }
}

function decimals(q: Quantity, u: UnitSettings): number {
  if (q === 'precip') return u.precip === 'in' ? 2 : 1;
  if (q === 'pressure') return u.pressure === 'inhg' ? 2 : 0;
  if (q === 'length') return 1;
  if (q === 'wind') return u.wind === 'ms' ? 1 : 0;
  return 0;
}

/** Formats a base-unit value in the user's unit, e.g. "23 km/h". Returns "–" for missing data. */
export function formatValue(q: Quantity, v: number | null | undefined, u: UnitSettings, withUnit = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  if (q === 'direction') return `${compass(v)} ${Math.round(v)}°`;
  const c = convert(q, v, u);
  const s = c.toLocaleString('de-DE', {
    minimumFractionDigits: decimals(q, u),
    maximumFractionDigits: decimals(q, u),
    useGrouping: false,
  });
  return withUnit ? `${s} ${unitLabel(q, u)}` : s;
}

const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

/** Meteorological direction (where the wind comes from) to compass text. */
export function compass(deg: number): string {
  if (!Number.isFinite(deg)) return '–';
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

export const COMPASS_POINTS = COMPASS;

/** Wind from speed + meteorological direction to u (east) / v (north) components. */
export function toUV(speed: number, dirDeg: number): [number, number] {
  const r = (dirDeg * Math.PI) / 180;
  return [-speed * Math.sin(r), -speed * Math.cos(r)];
}

export function fromUV(u: number, v: number): [number, number] {
  const speed = Math.hypot(u, v);
  let dir = (Math.atan2(-u, -v) * 180) / Math.PI;
  if (dir < 0) dir += 360;
  return [speed, dir];
}
