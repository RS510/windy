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
    label: 'Temperatur',
    icon: '🌡️',
    source: 'base',
    variable: 'temperature_2m',
    quantity: 'temp',
    scale: SCALES.temp,
    legend: [-20, -10, 0, 10, 20, 30, 40],
    particles: WIND10,
  },
  {
    id: 'rain',
    label: 'Regen',
    icon: '🌧️',
    source: 'base',
    variable: 'precipitation',
    quantity: 'precip',
    scale: SCALES.precip,
    legend: [0.1, 0.5, 1, 2, 4, 8, 15, 30],
    particles: WIND10,
  },
  {
    id: 'clouds',
    label: 'Wolken',
    icon: '☁️',
    source: 'base',
    variable: 'cloud_cover',
    quantity: 'percent',
    scale: SCALES.clouds,
    legend: [0, 20, 40, 60, 80, 100],
    particles: WIND10,
  },
  {
    id: 'pressure',
    label: 'Luftdruck',
    icon: '🧭',
    source: 'base',
    variable: 'pressure_msl',
    quantity: 'pressure',
    scale: SCALES.pressure,
    legend: [970, 985, 1000, 1013, 1025, 1040],
    particles: WIND10,
    isolines: { variable: 'pressure_msl', interval: 4 },
  },
  {
    id: 'humidity',
    label: 'Luftfeuchte',
    icon: '💧',
    source: 'base',
    variable: 'relative_humidity_2m',
    quantity: 'percent',
    scale: SCALES.humidity,
    legend: [0, 20, 40, 60, 80, 100],
    particles: WIND10,
  },
  {
    id: 'wind850',
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
    label: 'Wellen',
    icon: '🌊',
    source: 'marine',
    variable: 'wave_height',
    quantity: 'length',
    scale: SCALES.waves,
    legend: [0, 0.5, 1, 2, 3, 4, 6, 8],
    particles: WIND10,
    extra: [
      ['wave_period', 'period', 'Periode'],
      ['wave_direction', 'direction', 'Richtung'],
    ],
  },
  {
    id: 'pm25',
    label: 'Feinstaub PM2.5',
    icon: '🏭',
    source: 'air',
    variable: 'pm2_5',
    quantity: 'concentration',
    scale: SCALES.pm25,
    legend: [0, 10, 20, 25, 50, 75],
    particles: WIND10,
  },
  {
    id: 'ozone',
    label: 'Ozon',
    icon: '🟣',
    source: 'air',
    variable: 'ozone',
    quantity: 'concentration',
    scale: SCALES.ozone,
    legend: [0, 50, 100, 130, 180, 240],
    particles: WIND10,
  },
  {
    id: 'radar',
    label: 'Regenradar',
    icon: '📡',
    source: 'radar',
  },
];

export function getLayer(id: LayerId): LayerDef {
  return LAYERS.find((l) => l.id === id) ?? LAYERS[0];
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
