import { getJSON } from './http';

export const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json';

export interface RadarFrame {
  time: number; // unix seconds
  path: string;
  nowcast: boolean;
}

export interface RadarInfo {
  host: string;
  frames: RadarFrame[];
}

interface RVResponse {
  host: string;
  radar?: { past?: { time: number; path: string }[]; nowcast?: { time: number; path: string }[] };
}

export function parseRadar(r: RVResponse): RadarInfo {
  const past = (r.radar?.past ?? []).map((f) => ({ ...f, nowcast: false }));
  const now = (r.radar?.nowcast ?? []).map((f) => ({ ...f, nowcast: true }));
  return { host: r.host, frames: [...past, ...now] };
}

export async function fetchRadar(): Promise<RadarInfo> {
  return parseRadar(await getJSON<RVResponse>(RAINVIEWER_URL));
}

/** Tile template: {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png */
export function radarTileUrl(info: RadarInfo, frame: RadarFrame): string {
  return `${info.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}
