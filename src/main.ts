import './styles.css';
import { safe } from './errors';
import L from 'leaflet';
import { createMap, worldZoom } from './map/mapView';
import { FieldLayer, type FieldData } from './map/fieldLayer';
import { ParticleLayer } from './map/particleLayer';
import { RadarLayer } from './map/radarLayer';
import { BordersLayer } from './map/borders';
import { state, subscribe, update, currentTime } from './state';
import { getLayer, particleLayer, radarOnly } from './layers/definitions';
import { loadGrid, timeIndexFor } from './data/store';
import { nearestTimeIndex, sampleGrid, type Bounds, type Grid } from './data/grid';
import { fetchRadar, type RadarInfo } from './data/rainviewer';
import { fetchSpots, type Series } from './data/openMeteo';
import { initLayerMenu, initLegend, initModelPicker, initTimeline } from './ui/controls';
import { initSearch } from './ui/search';
import { hideBanner, showBanner, withLoading } from './ui/feedback';
import { DetailSheet, type Location } from './ui/detailSheet';
import { closePanels, initPlacesPanel, initSettingsPanel, openSpotEditor, sameLoc, toggleFavorite } from './ui/panels';
import { $, h } from './ui/dom';
import { compass, formatValue } from './util/units';
import { load, save } from './util/storage';
import { nowUnix } from './util/time';
import { RATING_COLOR, RATING_LABEL, rateHour, type Spot } from './util/spotRating';

// ---------- map & layers ----------

const firstView = { c: [25, 10] as [number, number], z: worldZoom(window.innerWidth) };
const view = load<{ c: [number, number]; z: number }>('view', firstView);
const map = createMap($('#map'), view.c, view.z);
const field = new FieldLayer(map);
const particles = new ParticleLayer(map);
const radar = new RadarLayer(map);
const borders = safe('Ländergrenzen', () => new BordersLayer(map));
particles.setEnabled(state.particles);

type GridSource = 'base' | 'upper' | 'marine' | 'air';
const grids: Partial<Record<GridSource, Grid>> = {};
let forecastTimes: number[] = [];
let radarInfo: RadarInfo | null = null;
let loadSeq = 0;

const isMobile = () => window.innerWidth < 700;
const activeLayers = () => state.layers.map(getLayer);

function paddedBounds(): Bounds {
  const b = map.getBounds();
  const latPad = (b.getNorth() - b.getSouth()) * 0.12;
  const lonPad = (b.getEast() - b.getWest()) * 0.12;
  return { south: b.getSouth() - latPad, north: b.getNorth() + latPad, west: b.getWest() - lonPad, east: b.getEast() + lonPad };
}

/** Loads the grids needed for the current view, active layers and model, then renders. */
async function refresh(): Promise<void> {
  const seq = ++loadSeq;
  const bounds = paddedBounds();
  // A finer grid when the whole earth is visible, otherwise one cell would span ~20°.
  const world = map.getZoom() <= 2;
  const points = world ? 350 : isMobile() ? 140 : 190;
  const maxPoints = world ? 450 : 220;
  // Surface data is always needed for the popup values and the time line.
  const sources = new Set<GridSource>(['base']);
  for (const l of activeLayers()) if (l.source !== 'radar') sources.add(l.source);
  try {
    const list = [...sources];
    const loaded = await withLoading(Promise.all(list.map((src) => loadGrid(src, bounds, state.model, points, maxPoints))));
    if (seq !== loadSeq) return;
    for (const k of Object.keys(grids) as GridSource[]) delete grids[k];
    list.forEach((src, i) => (grids[src] = loaded[i]));
    hideBanner('grid');
    forecastTimes = grids.base!.times;
    syncTimeline();
    render();
  } catch (e) {
    if (seq !== loadSeq) return;
    showBanner(`Wetterdaten konnten nicht geladen werden: ${(e as Error).message}`, { retry: refresh, id: 'grid' });
  }
}

/**
 * The time line shows radar frames when the radar is the only active layer, otherwise the
 * forecast hours. The selected moment is kept as close as possible when switching.
 */
function syncTimeline(): void {
  const radarTimes = radarInfo?.frames.map((f) => f.time) ?? [];
  const wantRadar = radarOnly(state.layers) && radarTimes.length > 0;
  const times = wantRadar ? radarTimes : forecastTimes;
  if (times === state.times || (times.length === state.times.length && times.every((t, i) => t === state.times[i]))) return;
  let index: number;
  if (wantRadar) index = Math.max(0, radarInfo!.frames.filter((f) => !f.nowcast).length - 1);
  else index = nearestTimeIndex(times, state.times === radarTimes || !currentTime() ? nowUnix() : currentTime()!);
  update({ times, timeIndex: index, playing: wantRadar ? false : state.playing });
}

function render(): void {
  const layers = activeLayers();
  const t = currentTime();
  const radarTimeline = radarOnly(state.layers) && radarInfo !== null;

  // Colour fields of all active layers, drawn in their fixed order.
  const fields: FieldData[] = [];
  let outOfRange = false;
  for (const l of layers) {
    if (l.source === 'radar' || !l.variable || !l.scale) continue;
    const grid = grids[l.source];
    const ti = grid ? timeIndexFor(grid, t) : -1;
    if (grid && ti < 0) outOfRange = true;
    if (grid && ti >= 0) fields.push({ grid, variable: l.variable, t: ti, scale: l.scale, alpha: l.alpha, iso: l.isolines });
  }
  field.set(fields);
  if (outOfRange) showBanner('Luftqualität ist nur für die nächsten 5 Tage verfügbar.', { info: true, id: 'range' });
  else hideBanner('range');

  // Radar: follows the time line when shown alone, otherwise shows the newest frame.
  if (state.layers.includes('radar') && radarInfo) {
    const lastPast = Math.max(0, radarInfo.frames.filter((f) => !f.nowcast).length - 1);
    radar.show(radarTimeline ? state.timeIndex : lastPast);
  }

  // Wind particles only for wind layers.
  const pl = particleLayer(state.layers);
  const pGrid = pl ? grids[pl.source as GridSource] : undefined;
  const pt = pGrid ? timeIndexFor(pGrid, radarTimeline ? nowUnix() : t) : -1;
  particles.set(pl?.particles && pGrid && pt >= 0 ? { grid: pGrid, speedVar: pl.particles[0], dirVar: pl.particles[1], t: pt } : null);

  updateSpotMarkers();
  updatePopup();
}

map.on('movestart', () => particles.pause());
map.on('zoomstart', () => {
  field.show(false);
  particles.pause();
});
map.on('zoomend', () => field.show(true));
let refreshTimer = 0;
map.on('moveend', () => {
  field.redraw();
  particles.rebuild();
  const c = map.getCenter();
  save('view', { c: [Math.round(c.lat * 100) / 100, Math.round(c.lng * 100) / 100], z: map.getZoom() });
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, 250);
});
window.addEventListener('resize', () => {
  map.invalidateSize();
  field.redraw();
  particles.rebuild();
});

// ---------- radar ----------

async function loadRadar(): Promise<void> {
  try {
    const info = await withLoading(fetchRadar());
    if (!state.layers.includes('radar')) return;
    if (!info.frames.length) throw new Error('keine Radarbilder verfügbar');
    radarInfo = info;
    radar.setInfo(info);
    hideBanner('radar');
    syncTimeline();
    render();
  } catch (e) {
    showBanner(`Regenradar konnte nicht geladen werden: ${(e as Error).message}`, { retry: loadRadar, id: 'radar' });
  }
}

function dropRadar(): void {
  radarInfo = null;
  radar.setInfo(null);
  hideBanner('radar');
}

// ---------- popup ----------

let popupLoc: L.LatLng | null = null;
let popupName: string | undefined;
const popup = L.popup({ autoPan: true, closeButton: true, maxWidth: 260, autoPanPaddingTopLeft: [10, 70], autoPanPaddingBottomRight: [60, 150] });
popup.on('remove', () => (popupLoc = null));

function popupContent(ll: L.LatLng, name?: string): HTMLElement {
  const t = currentTime();
  const u = state.units;
  const radarTimeline = radarOnly(state.layers) && radarInfo !== null;
  const sample = (src: GridSource, v: string, time = t) => {
    const g = grids[src];
    const ti = g ? timeIndexFor(g, time) : -1;
    return g && ti >= 0 ? sampleGrid(g, v, ti, ll.lat, ll.lng) : NaN;
  };
  const b = (v: string) => sample('base', v, radarTimeline ? nowUnix() : t);
  const mains: [string, string][] = [];
  const extras: [string, string][] = [];
  for (const l of [...activeLayers()].reverse()) {
    if (l.source === 'radar' || !l.variable || !l.quantity) continue;
    mains.push([l.label, formatValue(l.quantity, sample(l.source, l.variable), u)]);
    for (const [v, q, label] of l.extra ?? []) extras.push([label, formatValue(q, sample(l.source, v), u)]);
  }
  const rows: [string, string][] = [
    ['Wind', `${formatValue('wind', b('wind_speed_10m'), u)} ${compass(b('wind_direction_10m'))}`],
    ['Böen', formatValue('wind', b('wind_gusts_10m'), u)],
    ['Temperatur', formatValue('temp', b('temperature_2m'), u)],
    ['Regen', `${formatValue('precip', b('precipitation'), u)}/h`],
    ...extras,
  ];
  const loc: Location = { lat: ll.lat, lon: wrap(ll.lng), name };
  return h(
    'div',
    { 'data-testid': 'popup' },
    name ? h('div', { class: 'pp-name', 'data-testid': 'popup-name' }, name) : null,
    h('div', { class: 'pp-coords' }, `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`),
    mains.length ? h('div', { class: 'pp-main', 'data-testid': 'popup-main' }, mains[0][1]) : null,
    mains.length ? h('div', { class: 'pp-coords' }, mains[0][0]) : null,
    mains.slice(1).map(([k, v]) => h('div', { class: 'pp-row pp-layer' }, k, h('b', {}, v))),
    rows.map(([k, v]) => h('div', { class: 'pp-row' }, k, h('b', {}, v))),
    h(
      'div',
      { class: 'pp-actions' },
      h('button', { class: 'btn primary', 'data-testid': 'popup-forecast', onclick: () => sheet.open(loc) }, 'Vorhersage ›'),
      h('button', { class: 'btn', 'aria-label': 'Als Spot speichern', onclick: () => openSpotEditor(loc) }, '🏄 Spot'),
    ),
  );
}

function wrap(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function openPopup(ll: L.LatLng, name?: string): void {
  popupLoc = ll;
  popupName = name;
  popup.setLatLng(ll).setContent(popupContent(ll, name)).openOn(map);
}

function updatePopup(): void {
  if (popupLoc && map.hasLayer(popup)) popup.setContent(popupContent(popupLoc, popupName));
}

map.on('click', (e: L.LeafletMouseEvent) => {
  closePanels();
  layerMenu.collapse();
  openPopup(e.latlng);
});

// ---------- detail sheet, favourites, spots ----------

const sheet = new DetailSheet({
  isFavorite: (loc) => state.favorites.some((f) => sameLoc(f, loc)),
  toggleFavorite,
  spotAt: (loc) => state.spots.find((s) => sameLoc(s, loc)),
  editSpot: (loc, spot) => openSpotEditor(loc, spot),
});

const markerLayer = L.layerGroup().addTo(map);
let spotSeries: Series[] = [];
let spotSeq = 0;

async function loadSpotForecasts(): Promise<void> {
  const seq = ++spotSeq;
  const spots = state.spots;
  if (!spots.length) {
    spotSeries = [];
    renderMarkers();
    return;
  }
  try {
    const data = await fetchSpots(spots, state.model);
    if (seq !== spotSeq) return;
    spotSeries = data;
  } catch {
    if (seq !== spotSeq) return;
    spotSeries = []; // markers then show without a rating
  }
  renderMarkers();
}

const spotMarkers: { spot: Spot; marker: L.Marker; series?: Series }[] = [];

function renderMarkers(): void {
  markerLayer.clearLayers();
  spotMarkers.length = 0;
  for (const f of state.favorites) {
    if (state.spots.some((s) => sameLoc(s, f))) continue;
    L.marker([f.lat, f.lon], { icon: L.divIcon({ className: '', html: '<div class="fav-marker">★</div>', iconSize: [20, 20], iconAnchor: [10, 10] }), title: f.name, keyboard: false })
      .on('click', () => sheet.open(f))
      .addTo(markerLayer);
  }
  state.spots.forEach((spot, i) => {
    const marker = L.marker([spot.lat, spot.lon], {
      icon: L.divIcon({ className: '', html: '<div class="spot-marker" data-testid="spot-marker">🏄</div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
      title: spot.name,
      keyboard: false,
    })
      .on('click', () => sheet.open(spot, 'spot'))
      .addTo(markerLayer);
    spotMarkers.push({ spot, marker, series: spotSeries[i] });
  });
  updateSpotMarkers();
}

function updateSpotMarkers(): void {
  const t = radarOnly(state.layers) && radarInfo ? nowUnix() : currentTime() ?? nowUnix();
  for (const { spot, marker, series } of spotMarkers) {
    const el = marker.getElement()?.querySelector<HTMLElement>('.spot-marker');
    if (!el) continue;
    let label = 'keine Daten';
    let color = '#555';
    if (series && series.time.length) {
      const i = nearestTimeIndex(series.time, t);
      const v = series.values;
      const r = rateHour(spot, v.wind_speed_10m[i], v.wind_direction_10m[i], v.wind_gusts_10m[i]);
      color = RATING_COLOR[r];
      label = `${RATING_LABEL[r]}, ${formatValue('wind', v.wind_speed_10m[i], state.units)} ${compass(v.wind_direction_10m[i] ?? NaN)}`;
      el.dataset.rating = String(r);
    }
    el.style.background = color;
    marker.unbindTooltip().bindTooltip(`${spot.name}: ${label}`, { className: 'spot-tip', direction: 'top', offset: [0, -10] });
  }
}

// ---------- UI wiring ----------

const layerMenu = safe('Ebenen', initLayerMenu, { collapse: () => {} });
safe('Legende', initLegend);
safe('Modellwahl', initModelPicker);
safe('Zeitleiste', initTimeline);

const places = safe(
  'Meine Orte',
  () =>
    initPlacesPanel((loc, spot) => {
      map.flyTo([loc.lat, loc.lon], Math.max(map.getZoom(), 8));
      sheet.open(loc, spot ? 'spot' : 'forecast');
    }),
  { open: () => {} },
);
const settings = safe('Einstellungen', initSettingsPanel, { open: () => {} });
$('#btn-places').addEventListener('click', () => places.open());
$('#btn-settings').addEventListener('click', () => settings.open());

// Search only moves the map and shows the small popup; the forecast opens from there.
safe('Suche', () =>
  initSearch((p) => {
    sheet.close();
    map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 9), { duration: 1.2 });
    map.once('moveend', () => openPopup(L.latLng(p.lat, p.lon), p.name));
  }),
);

$('#btn-locate').addEventListener('click', () => {
  if (!('geolocation' in navigator)) return showBanner('Standortbestimmung wird von diesem Gerät nicht unterstützt.');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      map.flyTo(ll, Math.max(map.getZoom(), 9));
      map.once('moveend', () => openPopup(ll));
    },
    (err) =>
      showBanner(
        err.code === err.PERMISSION_DENIED
          ? 'Standortzugriff verweigert. Erlaube ihn in den iPhone Einstellungen → Datenschutz → Ortungsdienste → Safari.'
          : 'Standort konnte nicht bestimmt werden.',
      ),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
  );
});

subscribe((s, c) => {
  if (c.has('layers')) {
    const wantRadar = s.layers.includes('radar');
    if (wantRadar && !radarInfo) loadRadar();
    if (!wantRadar && radarInfo) dropRadar();
    syncTimeline();
    render();
    refresh();
    return;
  }
  if (c.has('model')) {
    refresh();
    loadSpotForecasts();
    return;
  }
  if (c.has('spots')) loadSpotForecasts();
  if (c.has('favorites')) renderMarkers();
  if (c.has('particles')) particles.setEnabled(s.particles);
  if (c.has('timeIndex') || c.has('times')) render();
  else if (c.has('units')) {
    updatePopup();
    updateSpotMarkers();
  }
});

window.addEventListener('offline', () => showBanner('Keine Internetverbindung. Angezeigt werden zuletzt geladene Daten.', { info: true, id: 'offline' }));
window.addEventListener('online', () => {
  hideBanner('offline');
  refresh();
});

// Start
renderMarkers();
refresh();
loadSpotForecasts();
if (state.layers.includes('radar')) loadRadar();
if (!navigator.onLine) showBanner('Keine Internetverbindung. Angezeigt werden zuletzt geladene Daten.', { info: true, id: 'offline' });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {
      /* offline support unavailable */
    });
    // When an updated version takes over, reload once so the new code runs.
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

// Small debug/test hook (read-only use).
(window as any).__windblick = { map, state, particles, borders };
