import { fetchGrid } from './openMeteo';
import { makeGridSpec, specKey, type Bounds, type Grid, nearestTimeIndex } from './grid';
import type { ModelId, Source } from '../layers/definitions';

type GridSource = Exclude<Source, 'radar'>;

const MAX_CACHE = 16;
const cache = new Map<string, Promise<Grid>>();

function key(source: GridSource, model: ModelId, spec: string): string {
  // Marine and air quality data don't depend on the weather model.
  const m = source === 'base' || source === 'upper' ? model : '-';
  return `${source}|${m}|${spec}`;
}

/** Loads a grid for the bounds, deduplicating requests and caching results. */
export function loadGrid(source: GridSource, bounds: Bounds, model: ModelId, targetPoints: number, maxPoints = 220): Promise<Grid> {
  const spec = makeGridSpec(bounds, targetPoints, maxPoints);
  const k = key(source, model, specKey(spec));
  let p = cache.get(k);
  if (p) {
    cache.delete(k); // move to the end (most recently used)
    cache.set(k, p);
    return p;
  }
  p = fetchGrid(source, spec, model);
  cache.set(k, p);
  p.catch(() => cache.delete(k));
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return p;
}

export function clearCache(): void {
  cache.clear();
}

/**
 * Time index in `grid` for a timeline time, or -1 if the grid has no data within 90 minutes
 * (e.g. air quality only covers 5 days).
 */
export function timeIndexFor(grid: Grid, unix: number | undefined): number {
  if (unix === undefined || !grid.times.length) return -1;
  const i = nearestTimeIndex(grid.times, unix);
  return Math.abs(grid.times[i] - unix) <= 5400 ? i : -1;
}
