import { SCALES, type ColorScale } from './colorScales';
import type { Quantity } from '../util/units';

export type Source = 'base' | 'upper' | 'marine' | 'air' | 'radar';

export type LayerId =
  | 'wind'
  | 'gust'
  | 'temp'
  | 'rain'
  | 'clouds'
  | 'pressure'
  | 'humidity'
  | 'wind850'
  | 'wind500'
  | 'waves'
  | 'pm25'
  | 'ozone'
  | 'radar';

export interface LayerDef {
  id: LayerId;
  /** Drawing order when several layers are active: lower is drawn first (below). */
  order: number;
  /** Opacity of this layer's colours within the field canvas. */
  alpha?: number;
  label: string;
  icon: string;
  source: Source;
  /** Variable coloured on the map. */
  variable?: string;
  quantity?: Quantity;
  scale?: ColorScale;
  /** Values shown in the legend (base units). */
  legend?: number[];
  /** Variables used for the particle animation: [speed, direction]. */
  particles?: [string, string];
  isolines?: { variable: string; interval: number };
  /** Extra values shown in the point popup: [variable, quantity, label]. */
  extra?: [string, Quantity, string][];
}

export const BASE_VARS = [
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'temperature_2m',
  'precipitation',
  'cloud_cover',
  'pressure_msl',
  'relative_humidity_2m',
];
export const UPPER_VARS = ['wind_speed_850hPa', 'wind_direction_850hPa', 'wind_speed_500hPa', 'wind_direction_500hPa'];
export const MARINE_VARS = ['wave_height', 'wave_direction', 'wave_period'];
export const AIR_VARS = ['pm2_5', 'ozone'];

export const SOURCE_VARS: Record<Exclude<Source, 'radar'>, string[]> = {
  base: BASE_VARS,
  upper: UPPER_VARS,
  marine: MARINE_VARS,
  air: AIR_VARS,
};

const WIND10: [string, string] = ['wind_speed_10m', 'wind_direction_10m'];

export const LAYERS: LayerDef[] = [
  {
    id: 'wind',
    order: 20,
    label: 'Wind',
    icon: '💨',
    source: 'base',
    variable: 'wind_speed_10m',
    quantity: 'wind',
    scale: SCALES.wind,
    legend: [0, 3, 6, 10, 15, 20, 30],
    particles: WIND10,
  },
  {
    id: 'gust',
    order: 21,
    label: 'Böen',
    icon: '🌬️',
    source: 'base',
    variable: 'wind_gusts_10m',
    quantity: 'wind',
    scale: SCALES.wind,
    legend: [0, 5, 10, 15, 20, 30, 40],
    particles: WIND10,
  },
  {
    id: 'temp',
    order: 10,
    label: 'Temperatur',
    icon: '🌡️',
    source: 'base',
    variable: 'temperature_2m',
    quantity: 'temp',
    scale: SCALES.temp,
    legend: [-20, -10, 0, 10, 20, 30, 40],
  },
  {
    id: 'rain',
    alpha: 1,
    order: 41,
    label: 'Regen',
    icon: '🌧️',
    source: 'base',
    variable: 'precipitation',
    quantity: 'precip',
    scale: SCALES.precip,
    legend: [0.1, 0.5, 1, 2, 4, 8, 15, 30],
  },
  {
    id: 'clouds',
    alpha: 1,
    order: 40,
    label: 'Wolken',
    icon: '☁️',
    source: 'base',
    variable: 'cloud_cover',
    quantity: 'percent',
    scale: SCALES.clouds,
    legend: [0, 20, 40, 60, 80, 100],
  },
  {
    id: 'pressure',
    order: 12,
    label: 'Luftdruck',
    icon: '🧭',
    source: 'base',
    variable: 'pressure_msl',
    quantity: 'pressure',
    scale: SCALES.pressure,
    legend: [970, 985, 1000, 1013, 1025, 1040],
    isolines: { variable: 'pressure_msl', interval: 4 },
  },
  {
    id: 'humidity',
    order: 11,
    label: 'Luftfeuchte',
    icon: '💧',
    source: 'base',
    variable: 'relative_humidity_2m',
    quantity: 'percent',
    scale: SCALES.humidity,
    legend: [0, 20, 40, 60, 80, 100],
  },
  {
    id: 'wind850',
    order: 22,
    label: 'Wind 850 hPa',
    icon: '⛰️',
    source: 'upper',
    variable: 'wind_speed_850hPa',
    quantity: 'wind',
    scale: SCALES.upperWind,
    legend: [0, 10, 20, 30, 45, 60],
    particles: ['wind_speed_850hPa', 'wind_direction_850hPa'],
  },
  {
    id: 'wind500',
    order: 23,
    label: 'Wind 500 hPa',
    icon: '✈️',
    source: 'upper',
    variable: 'wind_speed_500hPa',
    quantity: 'wind',
    scale: SCALES.upperWind,
    legend: [0, 15, 30, 45, 60, 80],
    particles: ['wind_speed_500hPa', 'wind_direction_500hPa'],
  },
  {
    id: 'waves',
    order: 30,
    label: 'Wellen',
    icon: '🌊',
    source: 'marine',
    variable: 'wave_height',
    quantity: 'length',
    scale: SCALES.waves,
    legend: [0, 0.5, 1, 2, 3, 4, 6, 8],
    extra: [
      ['wave_period', 'period', 'Periode'],
      ['wave_direction', 'direction', 'Richtung'],
    ],
  },
  {
    id: 'pm25',
    order: 31,
    label: 'Feinstaub PM2.5',
    icon: '🏭',
    source: 'air',
    variable: 'pm2_5',
    quantity: 'concentration',
    scale: SCALES.pm25,
    legend: [0, 10, 20, 25, 50, 75],
  },
  {
    id: 'ozone',
    order: 32,
    label: 'Ozon',
    icon: '🟣',
    source: 'air',
    variable: 'ozone',
    quantity: 'concentration',
    scale: SCALES.ozone,
    legend: [0, 50, 100, 130, 180, 240],
  },
  {
    id: 'radar',
    order: 50,
    label: 'Regenradar',
    icon: '📡',
    source: 'radar',
  },
];

export function getLayer(id: LayerId): LayerDef {
  return LAYERS.find((l) => l.id === id) ?? LAYERS[0];
}

export const WIND_LAYERS: LayerId[] = ['wind', 'gust', 'wind850', 'wind500'];

/** Unique, known layer ids sorted by drawing order. */
export function sortLayers(ids: LayerId[]): LayerId[] {
  return [...new Set(ids)].filter((id) => LAYERS.some((l) => l.id === id)).sort((a, b) => getLayer(a).order - getLayer(b).order);
}

/** Adds or removes a layer from the active set. */
export function toggleLayerId(ids: LayerId[], id: LayerId): LayerId[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : sortLayers([...ids, id]);
}

/**
 * Restores the active layers from storage. Older versions stored a single `layer`,
 * which is taken over once; without anything stored the app starts with wind.
 */
export function normalizeLayers(stored: unknown, legacy: unknown): LayerId[] {
  if (Array.isArray(stored)) return sortLayers(stored as LayerId[]);
  if (typeof legacy === 'string' && LAYERS.some((l) => l.id === legacy)) return [legacy as LayerId];
  return ['wind'];
}

/** Layer whose wind drives the particle animation: 10 m wind first, then 850, then 500 hPa. */
export function particleLayer(ids: LayerId[]): LayerDef | undefined {
  const order: LayerId[] = ['wind', 'gust', 'wind850', 'wind500'];
  const id = order.find((x) => ids.includes(x));
  return id ? getLayer(id) : undefined;
}

export function radarOnly(ids: LayerId[]): boolean {
  return ids.length === 1 && ids[0] === 'radar';
}

export type ModelId = 'best_match' | 'ecmwf_ifs025' | 'gfs_seamless' | 'icon_seamless' | 'meteofrance_seamless';

export const MODELS: { id: ModelId; label: string; info: string }[] = [
  { id: 'best_match', label: 'Auto', info: 'Bestes Modell je Ort' },
  { id: 'ecmwf_ifs025', label: 'ECMWF', info: 'Europäisch, global 25 km' },
  { id: 'gfs_seamless', label: 'GFS', info: 'USA (NOAA), global' },
  { id: 'icon_seamless', label: 'ICON', info: 'Deutscher Wetterdienst, bis 2 km' },
  { id: 'meteofrance_seamless', label: 'AROME', info: 'Météo-France, bis 1,5 km' },
];

export const COMPARE_MODELS: ModelId[] = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'meteofrance_seamless'];

export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}
