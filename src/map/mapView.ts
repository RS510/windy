import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export function createMap(el: HTMLElement, center: [number, number], zoom: number): L.Map {
  const map = L.map(el, {
    center,
    zoom,
    minZoom: 3,
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

  // Basemap above the weather field, blended with "screen": its near-black areas vanish,
  // coastlines, borders and labels stay visible on top of the colours.
  const basePane = map.createPane('basemap');
  basePane.style.zIndex = '300';
  basePane.style.mixBlendMode = 'screen';
  basePane.style.pointerEvents = 'none';
  L.tileLayer(TILE_URL, {
    pane: 'basemap',
    subdomains: 'abcd',
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> | Wetter: <a href="https://open-meteo.com/">Open-Meteo</a>',
  }).addTo(map);

  const radarPane = map.createPane('radar');
  radarPane.style.zIndex = '260';
  radarPane.style.pointerEvents = 'none';

  return map;
}
