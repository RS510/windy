import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
export const LABELS_URL = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';

/**
 * Start zoom showing (nearly) the whole width of the earth. Rounded rather than floored so
 * phones start at zoom 1 instead of a tiny strip; zooming out to 0 shows everything.
 */
export function worldZoom(width: number): number {
  return Math.max(0, Math.round(Math.log2(width / 256)));
}

export function createMap(el: HTMLElement, center: [number, number], zoom: number): L.Map {
  const map = L.map(el, {
    center,
    zoom,
    minZoom: 0,
    maxZoom: 11,
    worldCopyJump: true,
    zoomControl: false,
    attributionControl: true,
    maxBounds: [
      [-89, -Infinity],
      [89, Infinity],
    ] as any,
    maxBoundsViscosity: 1,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.setPosition('topleft');

  // Layer order, bottom to top: base map (land, coastlines, borders) → weather colours
  // (semi-transparent, pane 250) → radar (260) → isobars (380) → place names (400) → particles.
  L.tileLayer(TILE_URL, {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> | Wetter: <a href="https://open-meteo.com/">Open-Meteo</a>',
  }).addTo(map);

  const radarPane = map.createPane('radar');
  radarPane.style.zIndex = '260';
  radarPane.style.pointerEvents = 'none';

  const labelPane = map.createPane('labels');
  labelPane.style.zIndex = '400';
  labelPane.style.pointerEvents = 'none';
  L.tileLayer(LABELS_URL, { pane: 'labels', subdomains: 'abcd', maxZoom: 19, className: 'label-tiles' }).addTo(map);

  return map;
}
