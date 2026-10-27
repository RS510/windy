export type Sport = 'kite' | 'windsurf' | 'surf' | 'sail' | 'other';

export const SPORT_LABEL: Record<Sport, string> = {
  kite: 'Kitesurfen',
  windsurf: 'Windsurfen',
  surf: 'Wellenreiten',
  sail: 'Segeln',
  other: 'Sonstiges',
};

/** Sensible default wind ranges in m/s per sport. */
export const SPORT_DEFAULTS: Record<Sport, [number, number]> = {
  kite: [6, 14],
  windsurf: [7, 16],
  surf: [0, 6],
  sail: [3, 10],
  other: [3, 10],
};

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sport: Sport;
  minWind: number; // m/s
  maxWind: number; // m/s
  /** Allowed wind directions as compass sector indices 0..7 (N, NO, O, …). Empty = all. */
  directions: number[];
}

export type Rating = 0 | 1 | 2; // 0 schlecht, 1 mittel, 2 gut

export const RATING_LABEL = ['schlecht', 'mittel', 'gut'];
export const RATING_COLOR = ['#d4572e', '#e0b23f', '#3cc27a'];

export function sectorOf(deg: number): number {
  return Math.round((((deg % 360) + 360) % 360) / 45) % 8;
}

function sectorDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 8;
  return Math.min(d, 8 - d);
}

/** Rates one hour for a spot from wind speed, direction and gusts (all m/s / degrees). */
export function rateHour(spot: Spot, speed: number | null, dir: number | null, gust: number | null): Rating {
  if (speed === null || !Number.isFinite(speed)) return 0;
  const { minWind, maxWind } = spot;
  let speedScore: Rating;
  if (speed >= minWind && speed <= maxWind) speedScore = 2;
  else if (speed >= minWind * 0.8 && speed <= maxWind * 1.2) speedScore = 1;
  else speedScore = 0;

  let dirScore: Rating = 2;
  if (spot.directions.length && dir !== null && Number.isFinite(dir)) {
    const s = sectorOf(dir);
    const dist = Math.min(...spot.directions.map((d) => sectorDistance(d, s)));
    dirScore = dist === 0 ? 2 : dist === 1 ? 1 : 0;
  }

  let r = Math.min(speedScore, dirScore) as Rating;
  // Very gusty conditions are uncomfortable or dangerous for wind sports.
  if (r > 0 && gust !== null && Number.isFinite(gust) && spot.sport !== 'surf' && gust > maxWind * 1.5) {
    r = (r - 1) as Rating;
  }
  return r;
}

export interface Window {
  start: number;
  end: number; // unix seconds of last good hour
  hours: number;
}

/** Longest consecutive daylight-agnostic runs of "gut" hours, best first. */
export function bestWindows(times: number[], ratings: Rating[], max = 3): Window[] {
  const out: Window[] = [];
  let start = -1;
  for (let i = 0; i <= ratings.length; i++) {
    const good = i < ratings.length && ratings[i] === 2;
    if (good && start < 0) start = i;
    if (!good && start >= 0) {
      out.push({ start: times[start], end: times[i - 1], hours: i - start });
      start = -1;
    }
  }
  return out.sort((a, b) => b.hours - a.hours || a.start - b.start).slice(0, max);
}
