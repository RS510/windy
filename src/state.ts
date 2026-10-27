import type { LayerId, ModelId } from './layers/definitions';
import { MODELS, normalizeLayers } from './layers/definitions';
import { DEFAULT_UNITS, type UnitSettings } from './util/units';
import type { Spot } from './util/spotRating';
import { load, save } from './util/storage';

export interface Favorite {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface AppState {
  /** Active map layers (any number, may be empty), in drawing order. */
  layers: LayerId[];
  model: ModelId;
  /** Forecast hours available on the timeline (unix seconds). */
  times: number[];
  timeIndex: number;
  playing: boolean;
  units: UnitSettings;
  favorites: Favorite[];
  spots: Spot[];
  particles: boolean;
}

type Key = keyof AppState;
type Listener = (s: AppState, changed: Set<Key>) => void;

const PERSISTED: Key[] = ['layers', 'model', 'units', 'favorites', 'spots', 'particles'];

function initial(): AppState {
  const model = load<ModelId>('model', 'best_match');
  return {
    layers: normalizeLayers(load<unknown>('layers', null), load<unknown>('layer', null)),
    model: MODELS.some((m) => m.id === model) ? model : 'best_match',
    times: [],
    timeIndex: 0,
    playing: false,
    units: { ...DEFAULT_UNITS, ...load<Partial<UnitSettings>>('units', {}) },
    favorites: load<Favorite[]>('favorites', []),
    spots: load<Spot[]>('spots', []),
    particles: load<boolean>('particles', true),
  };
}

export const state: AppState = initial();
const listeners: Listener[] = [];

export function subscribe(fn: Listener): void {
  listeners.push(fn);
}

export function update(patch: Partial<AppState>): void {
  const changed = new Set<Key>();
  for (const k of Object.keys(patch) as Key[]) {
    if (state[k] !== patch[k]) {
      (state as any)[k] = patch[k];
      changed.add(k);
      if (PERSISTED.includes(k)) save(k, state[k]);
    }
  }
  if (!changed.size) return;
  for (const l of listeners) l(state, changed);
}

export function currentTime(): number | undefined {
  return state.times[state.timeIndex];
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
