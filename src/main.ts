import './styles.css';
import L from 'leaflet';
import { createMap } from './map/mapView';
import { FieldLayer } from './map/fieldLayer';
import { ParticleLayer } from './map/particleLayer';
import { RadarLayer } from './map/radarLayer';
import { state, subscribe, update, currentTime } from './state';
import { getLayer } from './layers/definitions';
import { loadGrid, timeIndexFor } from './data/store';
import { nearestTimeIndex, sampleGrid, type Bounds, type Grid } from './data/grid';
import { fetchRadar } from './data/rainviewer';
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

const view = load<{ c: [number, number]; z: number }>('view', { c: [50.5, 10], z: 5 });
const map = createMap($('#map'), view.c, view.z);
const field = new FieldLayer(map);
const particles = new ParticleLayer(map);
const radar = new RadarLayer(map);
particles.setEnabled(state.particles);

const grids: { base?: Grid; extra?: Grid } = {};
let forecastTimes: number[] = [];
let loadSeq = 0;

const isMobile = () => window.innerWidth < 700;

function paddedBounds(): Bounds {
  const b = map.getBounds();
  const latPad = (b.getNorth() - b.getSouth()) * 0.12;
  const lonPad = (b.getEast() - b.getWest()) * 0.12;
  return { south: b.getSouth() - latPad, north: b.getNorth() + latPad, west: b.getWest() - lonPad, east: b.getEast() + lonPad };
}

/** Loads the grids needed for the current view, layer and model, then renders. */
async function refresh(): Promise<void> {
  const seq = ++loadSeq;
  const layer = getLayer(state.layer);
  const bounds = paddedBounds();
  const points = isMobile() ? 140 : 190;
  try {
    const basePromise = loadGrid('base', bounds, state.model, points);
    const extraSource = layer.source === 'upper' || layer.source === 'marine' || layer.source === 'air' ? layer.source : null;
    const extraPromise = extraSource ? loadGrid(extraSource, bounds, state.model, points) : Promise.resolve(undefined);
    const [base, extra] = await withLoading(Promise.all([basePromise, extraPromise]));
    if (seq !== loadSeq) return;
    grids.base = base;
    grids.extra = extra;
    hideBanner('grid');
    setForecastTimes(base.times);
    render();
  } catch (e) {
    if (seq !== loadSeq) return;
    showBanner(`Wetterdaten konnten nicht geladen werden: ${(e as Error).message}`, { retry: refresh, id: 'grid' });
  }
}

function setForecastTimes(times: number[]): void {
  const same = times.length === forecastTimes.length && times.every((t, i) => t === forecastTimes[i]);
  if (same) return;
  const selected = currentTime();
  forecastTimes = times;
  if (getLayer(state.layer).source === 'radar') return;
  update({ times, timeIndex: nearestTimeIndex(times, selected ?? nowUnix()) });
}

function render(): void {
  const layer = getLayer(state.layer);
  const t = currentTime();
  if (layer.source === 'radar') {
    field.set(null);
    radar.show(state.timeIndex);
    // Particles keep showing the current surface wind under the radar.
    const base = grids.base;
    const bt = base ? nearestTimeIndex(base.times, nowUnix()) : -1;
    particles.set(base && bt >= 0 ? { grid: base, speedVar: 'wind_speed_10m', dirVar: 'wind_direction_10m', t: bt } : null);
  } else {
    const grid = layer.source === 'base' ? grids.base : grids.extra;
    const ti = grid ? timeIndexFor(grid, t) : -1;
    field.set(grid && ti >= 0 && layer.variable && layer.scale ? { grid, variable: layer.variable, t: ti, scale: layer.scale, iso: layer.isolines } : null);
    if (grid && ti < 0 && layer.source === 'air') showBanner('Luftqualität ist nur für die nächsten 5 Tage verfügbar.', { info: true, id: 'range' });
    else hideBanner('range');
    const pGrid = layer.source === 'upper' ? grids.extra : grids.base;
    const pt = pGrid ? timeIndexFor(pGrid, t) : -1;
    particles.set(pGrid && pt >= 0 && layer.particles ? { grid: pGrid, speedVar: layer.particles[0], dirVar: layer.particles[1], t: pt } : null);
  }
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

async function enterRadar(): Promise<void> {
  try {
    const info = await withLoading(fetchRadar());
    if (getLayer(state.layer).source !== 'radar') return;
    radar.setInfo(info);
    if (!info.frames.length) throw new Error('keine Radarbilder verfügbar');
    const lastPast = Math.max(0, info.frames.filter((f) => !f.nowcast).length - 1);
    update({ times: info.frames.map((f) => f.time), timeIndex: lastPast });
    hideBanner('radar');
    render();
  } catch (e) {
    showBanner(`Regenradar konnte nicht geladen werden: ${(e as Error).message}`, { retry: enterRadar, id: 'radar' });
  }
}

function leaveRadar(): void {
  radar.setInfo(null);
  hideBanner('radar');
  update({ times: forecastTimes, timeIndex: nearestTimeIndex(forecastTimes, nowUnix()) });
}

// ---------- popup ----------

let popupLoc: L.LatLng | null = null;
const popup = L.popup({ autoPan: true, closeButton: true, maxWidth: 260, autoPanPaddingTopLeft: [10, 70], autoPanPaddingBottomRight: [60, 150] });
popup.on('remove', () => (popupLoc = null));

function popupContent(ll: L.LatLng): HTMLElement {
  const layer = getLayer(state.layer);
  const t = currentTime();
  const u = state.units;
  const base = grids.base;
  const bt = base ? timeIndexFor(base, layer.source === 'radar' ? nowUnix() : t) : -1;
  const sample = (g: Grid | undefined, ti: number, v: string) => (g && ti >= 0 ? sampleGrid(g, v, ti, ll.lat, ll.lng) : NaN);
  const b = (v: string) => sample(base, bt, v);
  const extraT = grids.extra ? timeIndexFor(grids.extra, t) : -1;
  let main = '';
  if (layer.variable && layer.quantity) {
    const g = layer.source === 'base' ? base : grids.extra;
    const ti = layer.source === 'base' ? bt : extraT;
    main = formatValue(layer.quantity, sample(g, ti, layer.variable), u);
  }
  const rows: [string, string][] = [
    ['Wind', `${formatValue('wind', b('wind_speed_10m'), u)} ${compass(b('wind_direction_10m'))}`],
    ['Böen', formatValue('wind', b('wind_gusts_10m'), u)],
    ['Temperatur', formatValue('temp', b('temperature_2m'), u)],
    ['Regen', `${formatValue('precip', b('precipitation'), u)}/h`],
  ];
  for (const [v, q, label] of layer.extra ?? []) rows.push([label, formatValue(q, sample(grids.extra, extraT, v), u)]);
  const loc: Location = { lat: ll.lat, lon: wrap(ll.lng) };
  return h(
    'div',
    { 'data-testid': 'popup' },
    h('div', { class: 'pp-coords' }, `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`),
    main ? h('div', { class: 'pp-main', 'data-testid': 'popup-main' }, main) : null,
    main ? h('div', { class: 'pp-coords' }, layer.label) : null,
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

function openPopup(ll: L.LatLng): void {
  popupLoc = ll;
  popup.setLatLng(ll).setContent(popupContent(ll)).openOn(map);
}

function updatePopup(): void {
  if (popupLoc && map.hasLayer(popup)) popup.setContent(popupContent(popupLoc));
}

map.on('click', (e: L.LeafletMouseEvent) => {
  closePanels();
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
  const t = getLayer(state.layer).source === 'radar' ? nowUnix() : currentTime() ?? nowUnix();
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

initLayerMenu();
initLegend();
initModelPicker();
initTimeline();

const places = initPlacesPanel((loc, spot) => {
  map.flyTo([loc.lat, loc.lon], Math.max(map.getZoom(), 8));
  sheet.open(loc, spot ? 'spot' : 'forecast');
});
const settings = initSettingsPanel();
$('#btn-places').addEventListener('click', () => places.open());
$('#btn-settings').addEventListener('click', () => settings.open());

initSearch((p) => {
  map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 9));
  map.once('moveend', () => openPopup(L.latLng(p.lat, p.lon)));
  sheet.open({ lat: p.lat, lon: p.lon, name: p.name });
});

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
  if (c.has('layer')) {
    const radarNow = getLayer(s.layer).source === 'radar';
    if (radarNow) {
      update({ playing: false });
      enterRadar();
    } else if (radar.frames.length || s.times !== forecastTimes) {
      leaveRadar();
    }
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
if (getLayer(state.layer).source === 'radar') enterRadar();
if (!navigator.onLine) showBanner('Keine Internetverbindung. Angezeigt werden zuletzt geladene Daten.', { info: true, id: 'offline' });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support unavailable */
    });
  });
}

// Small debug/test hook (read-only use).
(window as any).__windblick = { map, state, particles };
