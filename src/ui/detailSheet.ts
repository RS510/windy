import { $, clear, h, setOpen } from './dom';
import { state, subscribe, currentTime } from '../state';
import {
  fetchAirPoint,
  fetchMarinePoint,
  fetchModels,
  fetchPoint,
  type Series,
} from '../data/openMeteo';
import { COMPARE_MODELS, modelLabel } from '../layers/definitions';
import { compass, formatValue, type UnitSettings } from '../util/units';
import { dayKey, fmtDay, fmtDayHour, fmtHour, fmtWeekday, nowUnix } from '../util/time';
import { buildLineChart, buildMeteogram, weatherIcon, weatherText } from './meteogram';
import { nearestTimeIndex } from '../data/grid';
import { RATING_COLOR, RATING_LABEL, SPORT_LABEL, bestWindows, rateHour, type Spot } from '../util/spotRating';

export interface Location {
  lat: number;
  lon: number;
  name?: string;
}

type Tab = 'forecast' | 'models' | 'waves' | 'air' | 'spot';

interface Hooks {
  isFavorite: (loc: Location) => boolean;
  toggleFavorite: (loc: Location) => void;
  spotAt: (loc: Location) => Spot | undefined;
  editSpot: (loc: Location, spot?: Spot) => void;
}

const MODEL_COLORS: Record<string, string> = {
  ecmwf_ifs025: '#e8a33c',
  gfs_seamless: '#4fa3e0',
  icon_seamless: '#7fd17f',
  meteofrance_seamless: '#d17fc4',
};

export class DetailSheet {
  private el = $('#sheet');
  private loc: Location | null = null;
  private tab: Tab = 'forecast';
  private cache = new Map<string, Promise<any>>();
  private body!: HTMLElement;
  private renderSeq = 0;

  constructor(private hooks: Hooks) {
    subscribe((_, c) => {
      if (!this.isOpen()) return;
      if (c.has('units') || c.has('model') || c.has('spots') || c.has('favorites')) this.render();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
  }

  isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  open(loc: Location, tab: Tab = 'forecast'): void {
    this.loc = { ...loc, lat: Math.round(loc.lat * 1000) / 1000, lon: Math.round(loc.lon * 1000) / 1000 };
    this.tab = tab === 'spot' && !this.hooks.spotAt(this.loc) ? 'forecast' : tab;
    setOpen(this.el, true);
    this.render();
  }

  close(): void {
    setOpen(this.el, false);
  }

  /** Caches requests per location (and model where relevant); failed requests are retried next time. */
  private cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = `${key}|${this.loc!.lat},${this.loc!.lon}`;
    let p = this.cache.get(k);
    if (!p) {
      p = fn();
      this.cache.set(k, p);
      p.catch(() => this.cache.delete(k));
    }
    return p;
  }

  private render(): void {
    const loc = this.loc;
    if (!loc) return;
    clear(this.el);
    const spot = this.hooks.spotAt(loc);
    const fav = this.hooks.isFavorite(loc);
    const title = spot?.name ?? loc.name ?? 'Gewählter Ort';
    this.el.append(
      h(
        'div',
        { class: 'panel-head' },
        h('div', { style: 'flex:1;min-width:0' }, h('h2', { 'data-testid': 'sheet-title' }, title), h('div', { class: 'sub', 'data-testid': 'sheet-sub' }, `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`)),
        h(
          'button',
          {
            class: 'icon-btn',
            title: fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten',
            'aria-label': fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten',
            'aria-pressed': fav ? 'true' : 'false',
            'data-testid': 'fav-toggle',
            style: fav ? 'color:var(--accent)' : '',
            onclick: () => this.hooks.toggleFavorite({ ...loc, name: spot?.name ?? loc.name }),
          },
          fav ? '★' : '☆',
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            title: spot ? 'Spot bearbeiten' : 'Als Spot speichern',
            'aria-label': spot ? 'Spot bearbeiten' : 'Als Spot speichern',
            'data-testid': 'spot-edit',
            onclick: () => this.hooks.editSpot({ ...loc, name: spot?.name ?? loc.name }, spot),
          },
          '🏄',
        ),
        h('button', { class: 'close-btn', 'aria-label': 'Schließen', onclick: () => this.close() }, '✕'),
      ),
    );
    const tabs: [Tab, string][] = [
      ['forecast', 'Vorhersage'],
      ['models', 'Modelle'],
      ['waves', 'Wellen'],
      ['air', 'Luft'],
    ];
    if (spot) tabs.unshift(['spot', 'Spot']);
    this.el.append(
      h(
        'div',
        { class: 'tabs', role: 'tablist' },
        tabs.map(([id, label]) =>
          h(
            'button',
            {
              role: 'tab',
              class: this.tab === id ? 'active' : '',
              'aria-selected': this.tab === id ? 'true' : 'false',
              'data-tab': id,
              onclick: () => {
                this.tab = id;
                this.render();
              },
            },
            label,
          ),
        ),
      ),
    );
    this.body = h('div', { class: 'panel-body', 'data-testid': 'sheet-body' });
    this.el.append(this.body);
    const seq = ++this.renderSeq;
    const body = this.body;
    body.append(h('div', { class: 'empty' }, 'Lade Vorhersage…'));
    const done = (fn: () => void) => () => {
      if (seq !== this.renderSeq) return; // a newer render replaced this one
      clear(body);
      fn();
    };
    const fail = (e: Error) => {
      if (seq !== this.renderSeq) return;
      clear(body);
      body.append(
        h('div', { class: 'empty', 'data-testid': 'sheet-error' }, `Daten konnten nicht geladen werden: ${e.message}`),
        h('button', { class: 'btn', onclick: () => this.render() }, 'Erneut versuchen'),
      );
    };
    const u = state.units;
    switch (this.tab) {
      case 'forecast':
        this.cached(`f|${state.model}`, () => fetchPoint(loc.lat, loc.lon, state.model))
          .then((d) => done(() => this.renderForecast(body, d, u))())
          .catch(fail);
        break;
      case 'models':
        this.cached('m', () => fetchModels(loc.lat, loc.lon, COMPARE_MODELS))
          .then((d) => done(() => this.renderModels(body, d, u))())
          .catch(fail);
        break;
      case 'waves':
        this.cached('w', () => fetchMarinePoint(loc.lat, loc.lon))
          .then((d) => done(() => this.renderWaves(body, d, u))())
          .catch(fail);
        break;
      case 'air':
        this.cached('a', () => fetchAirPoint(loc.lat, loc.lon))
          .then((d) => done(() => this.renderAir(body, d))())
          .catch(fail);
        break;
      case 'spot':
        this.cached(`f|${state.model}`, () => fetchPoint(loc.lat, loc.lon, state.model))
          .then((d) => done(() => this.renderSpot(body, d, spot!, u))())
          .catch(fail);
        break;
    }
  }

  private renderForecast(body: HTMLElement, d: Series, u: UnitSettings): void {
    const v = d.values;
    const t = currentTime() ?? nowUnix();
    const i = nearestTimeIndex(d.time, t);
    body.append(
      h('div', { class: 'section-title' }, `${fmtDayHour(d.time[i])} · Modell ${modelLabel(state.model)}`),
      h(
        'div',
        { class: 'summary', 'data-testid': 'summary' },
        card(`${weatherIcon(v.weather_code[i])} ${formatValue('temp', v.temperature_2m[i], u)}`, weatherText(v.weather_code[i]) || 'Temperatur'),
        card(formatValue('wind', v.wind_speed_10m[i], u), `Wind aus ${compass(v.wind_direction_10m[i] ?? NaN)}`, 'summary-wind'),
        card(formatValue('wind', v.wind_gusts_10m[i], u), 'Böen'),
        card(formatValue('precip', v.precipitation[i], u), 'Niederschlag/h'),
        card(formatValue('percent', v.cloud_cover[i], u), 'Wolken'),
        card(formatValue('pressure', v.pressure_msl[i], u), 'Luftdruck'),
        d.elevation !== undefined ? card(`${Math.round(d.elevation)} m`, 'Höhe ü. NN') : null,
      ),
      h('div', { class: 'section-title' }, 'Stündlich'),
      h('div', { class: 'chart-scroll' }, buildMeteogram(d, u)),
      h('div', { class: 'legend-inline' }, h('span', {}, h('i', { style: 'background:#7fd17f' }), 'Wind'), h('span', {}, h('i', { style: 'background:#d1a07f' }), 'Böen (gestrichelt)'), h('span', {}, h('i', { style: 'background:rgba(232,163,60,.5)' }), 'Gefühlte Temp.')),
      h('div', { class: 'section-title' }, 'Tage'),
      dailyTable(d, u),
    );
  }

  private renderModels(body: HTMLElement, d: Record<string, Series>, u: UnitSettings): void {
    const models = Object.keys(d);
    if (!models.length) {
      body.append(h('div', { class: 'empty' }, 'Für diesen Ort liefern die Modelle keine Daten.'));
      return;
    }
    const time = d[models[0]].time;
    const lines = (variable: string) => models.map((m) => ({ label: modelLabel(m), color: MODEL_COLORS[m] ?? '#fff', values: d[m].values[variable] }));
    body.append(
      h('div', { class: 'legend-inline', 'data-testid': 'model-legend' }, models.map((m) => h('span', {}, h('i', { style: `background:${MODEL_COLORS[m]}` }), modelLabel(m)))),
      h('div', { class: 'chart-scroll' }, buildLineChart(time, lines('temperature_2m'), 'temp', u, 'Temperatur')),
      h('div', { class: 'chart-scroll' }, buildLineChart(time, lines('wind_speed_10m'), 'wind', u, 'Wind')),
      h('div', { class: 'chart-scroll' }, buildLineChart(time, lines('wind_gusts_10m'), 'wind', u, 'Böen')),
      h('div', { class: 'chart-scroll' }, buildLineChart(time, lines('precipitation'), 'precip', u, 'Regen', 90)),
      h('div', { class: 'section-title' }, 'Tageswerte je Modell (Max. Temp. / Max. Wind / Regen)'),
      modelTable(d, u),
    );
  }

  private renderWaves(body: HTMLElement, d: Series, u: UnitSettings): void {
    const hasData = d.values.wave_height.some((x) => x !== null);
    if (!hasData) {
      body.append(h('div', { class: 'empty', 'data-testid': 'no-marine' }, 'Keine Meeresdaten für diesen Ort (vermutlich an Land). Tippe auf eine Stelle im Meer.'));
      return;
    }
    const i = nearestTimeIndex(d.time, currentTime() ?? nowUnix());
    const v = d.values;
    body.append(
      h(
        'div',
        { class: 'summary' },
        card(formatValue('length', v.wave_height[i], u), 'Wellenhöhe', 'wave-height'),
        card(formatValue('period', v.wave_period[i], u), 'Periode'),
        card(formatValue('direction', v.wave_direction[i], u), 'Richtung'),
        card(formatValue('length', v.swell_wave_height[i], u), 'Dünung'),
      ),
      h(
        'div',
        { class: 'chart-scroll' },
        buildLineChart(
          d.time,
          [
            { label: 'Wellen', color: '#4fa3e0', values: v.wave_height },
            { label: 'Dünung', color: '#7fd1c4', values: v.swell_wave_height, dashed: true },
            { label: 'Windsee', color: '#cfd6df', values: v.wind_wave_height, dashed: true },
          ],
          'length',
          u,
          'Höhe',
        ),
      ),
      h('div', { class: 'legend-inline' }, h('span', {}, h('i', { style: 'background:#4fa3e0' }), 'Gesamt'), h('span', {}, h('i', { style: 'background:#7fd1c4' }), 'Dünung'), h('span', {}, h('i', { style: 'background:#cfd6df' }), 'Windsee')),
      h('div', { class: 'chart-scroll' }, buildLineChart(d.time, [{ label: 'Periode', color: '#e8a33c', values: v.wave_period }], 'period', u, 'Periode', 80)),
    );
  }

  private renderAir(body: HTMLElement, d: Series): void {
    const v = d.values;
    if (!v.pm2_5.some((x) => x !== null)) {
      body.append(h('div', { class: 'empty' }, 'Keine Luftqualitätsdaten für diesen Ort.'));
      return;
    }
    const i = nearestTimeIndex(d.time, currentTime() ?? nowUnix());
    const aqi = v.european_aqi[i];
    const u = state.units;
    body.append(
      h(
        'div',
        { class: 'summary' },
        card(aqi === null ? '–' : `${Math.round(aqi)} · ${aqiText(aqi)}`, 'Europ. Luftindex', 'aqi'),
        card(formatValue('concentration', v.pm2_5[i], u), 'PM2.5'),
        card(formatValue('concentration', v.pm10[i], u), 'PM10'),
        card(formatValue('concentration', v.ozone[i], u), 'Ozon'),
        card(formatValue('concentration', v.nitrogen_dioxide[i], u), 'NO₂'),
      ),
      h(
        'div',
        { class: 'chart-scroll' },
        buildLineChart(
          d.time,
          [
            { label: 'PM2.5', color: '#e8a33c', values: v.pm2_5 },
            { label: 'PM10', color: '#d1a07f', values: v.pm10, dashed: true },
            { label: 'NO₂', color: '#d17fc4', values: v.nitrogen_dioxide },
          ],
          'concentration',
          u,
          'Partikel / NO₂',
        ),
      ),
      h('div', { class: 'chart-scroll' }, buildLineChart(d.time, [{ label: 'Ozon', color: '#4fa3e0', values: v.ozone }], 'concentration', u, 'Ozon', 90)),
      h('div', { class: 'legend-inline' }, h('span', {}, h('i', { style: 'background:#e8a33c' }), 'PM2.5'), h('span', {}, h('i', { style: 'background:#d1a07f' }), 'PM10'), h('span', {}, h('i', { style: 'background:#d17fc4' }), 'NO₂'), h('span', {}, h('i', { style: 'background:#4fa3e0' }), 'Ozon')),
    );
  }

  private renderSpot(body: HTMLElement, d: Series, spot: Spot, u: UnitSettings): void {
    const v = d.values;
    const ratings = d.time.map((_, i) => rateHour(spot, v.wind_speed_10m[i], v.wind_direction_10m[i], v.wind_gusts_10m[i]));
    const windows = bestWindows(d.time, ratings);
    const dirs = spot.directions.length ? spot.directions.map((x) => ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][x]).join(', ') : 'alle';
    body.append(
      h('div', { class: 'section-title' }, `${SPORT_LABEL[spot.sport]} · ${formatValue('wind', spot.minWind, u)} bis ${formatValue('wind', spot.maxWind, u)} · Richtung: ${dirs}`),
      h('div', { class: 'section-title' }, 'Beste Zeitfenster'),
      windows.length
        ? h(
            'ul',
            { class: 'list', 'data-testid': 'spot-windows' },
            windows.map((w) => h('li', {}, h('span', { class: 'dot', style: `background:${RATING_COLOR[2]}` }), h('div', { class: 'grow' }, `${fmtDay(w.start)} ${fmtHour(w.start)} bis ${dayKey(w.start) === dayKey(w.end + 3600) ? '' : `${fmtDay(w.end + 3600)} `}${fmtHour(w.end + 3600)}`, h('small', {}, `${w.hours} Stunden gute Bedingungen`)))),
          )
        : h('div', { class: 'empty', 'data-testid': 'spot-windows' }, 'In den nächsten Tagen keine guten Bedingungen erwartet.'),
      h('div', { class: 'section-title' }, 'Bewertung pro Stunde'),
    );
    // One strip per day.
    const days = new Map<string, number[]>();
    d.time.forEach((t, i) => {
      const k = dayKey(t);
      if (!days.has(k)) days.set(k, []);
      days.get(k)!.push(i);
    });
    for (const idx of days.values()) {
      body.append(
        h('div', { style: 'display:flex;align-items:center;gap:8px' },
          h('span', { style: 'width:70px;color:var(--muted);font-size:12px' }, fmtDay(d.time[idx[0]])),
          h(
            'div',
            { class: 'rating-strip', style: 'flex:1', 'data-testid': 'rating-strip' },
            idx.map((i) => h('span', { style: `background:${RATING_COLOR[ratings[i]]}`, title: `${fmtHour(d.time[i])}: ${RATING_LABEL[ratings[i]]}, ${formatValue('wind', v.wind_speed_10m[i], u)} aus ${compass(v.wind_direction_10m[i] ?? NaN)}`, 'data-rating': ratings[i] })),
          ),
        ),
      );
    }
    body.append(h('div', { class: 'legend-inline', style: 'margin-top:8px' }, [2, 1, 0].map((r) => h('span', {}, h('i', { style: `background:${RATING_COLOR[r]}` }), RATING_LABEL[r]))));
  }
}

function card(value: string, label: string, testid?: string): HTMLElement {
  return h('div', { class: 'card', 'data-testid': testid }, h('b', {}, value), h('small', {}, label));
}

function aqiText(v: number): string {
  if (v <= 20) return 'gut';
  if (v <= 40) return 'ordentlich';
  if (v <= 60) return 'mäßig';
  if (v <= 80) return 'schlecht';
  if (v <= 100) return 'sehr schlecht';
  return 'extrem';
}

function groupDays(time: number[]): number[][] {
  const out: number[][] = [];
  let key = '';
  time.forEach((t, i) => {
    const k = dayKey(t);
    if (k !== key) {
      out.push([]);
      key = k;
    }
    out[out.length - 1].push(i);
  });
  return out;
}

function stat(vals: (number | null)[], idx: number[], fn: 'max' | 'min' | 'sum'): number | null {
  const xs = idx.map((i) => vals[i]).filter((x): x is number => x !== null && Number.isFinite(x));
  if (!xs.length) return null;
  if (fn === 'sum') return xs.reduce((a, b) => a + b, 0);
  return fn === 'max' ? Math.max(...xs) : Math.min(...xs);
}

function dailyTable(d: Series, u: UnitSettings): HTMLElement {
  const v = d.values;
  const rows = groupDays(d.time).map((idx) => {
    // Most severe weather code of the day as its symbol.
    const code = stat(v.weather_code, idx, 'max');
    return h(
      'tr',
      {},
      h('td', {}, `${fmtWeekday(d.time[idx[0]])} ${weatherIcon(code)}`),
      h('td', {}, `${formatValue('temp', stat(v.temperature_2m, idx, 'max'), u, false)}° / ${formatValue('temp', stat(v.temperature_2m, idx, 'min'), u, false)}°`),
      h('td', {}, formatValue('precip', stat(v.precipitation, idx, 'sum'), u)),
      h('td', {}, formatValue('wind', stat(v.wind_speed_10m, idx, 'max'), u)),
      h('td', {}, formatValue('wind', stat(v.wind_gusts_10m, idx, 'max'), u)),
    );
  });
  return h(
    'div',
    { class: 'table-wrap' },
    h('table', { class: 'data', 'data-testid': 'daily-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tag'), h('th', {}, 'Max/Min'), h('th', {}, 'Regen'), h('th', {}, 'Wind'), h('th', {}, 'Böen'))), h('tbody', {}, rows)),
  );
}

function modelTable(d: Record<string, Series>, u: UnitSettings): HTMLElement {
  const models = Object.keys(d);
  const days = groupDays(d[models[0]].time);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'data', 'data-testid': 'model-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Tag'), models.map((m) => h('th', {}, modelLabel(m))))),
      h(
        'tbody',
        {},
        days.map((idx) =>
          h(
            'tr',
            {},
            h('td', {}, fmtWeekday(d[models[0]].time[idx[0]])),
            models.map((m) => {
              const v = d[m].values;
              return h('td', {}, `${formatValue('temp', stat(v.temperature_2m, idx, 'max'), u)} / ${formatValue('wind', stat(v.wind_speed_10m, idx, 'max'), u)} / ${formatValue('precip', stat(v.precipitation, idx, 'sum'), u)}`);
            }),
          ),
        ),
      ),
    ),
  );
}
