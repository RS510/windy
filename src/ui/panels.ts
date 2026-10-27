import { $, clear, h, setOpen } from './dom';
import { state, subscribe, update, uid, type Favorite } from '../state';
import { COMPASS_POINTS, WIND_UNIT_LABEL, convertWind, formatValue, windToMs, type UnitSettings, type WindUnit } from '../util/units';
import { SPORT_DEFAULTS, SPORT_LABEL, type Sport, type Spot } from '../util/spotRating';
import type { Location } from './detailSheet';

const panels = ['#panel-places', '#panel-settings', '#panel-spot'];

export function closePanels(except?: string): void {
  for (const p of panels) if (p !== except) setOpen($(p), false);
}

function head(title: string, onClose: () => void): HTMLElement {
  return h('div', { class: 'panel-head' }, h('h2', {}, title), h('button', { class: 'close-btn', 'aria-label': 'Schließen', onclick: onClose }, '✕'));
}

export function sameLoc(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 0.006 && Math.abs(a.lon - b.lon) < 0.006;
}

// ---------- favourites & spots ----------

export function initPlacesPanel(onOpen: (loc: Location, spot?: Spot) => void): { open: () => void } {
  const el = $('#panel-places');
  const close = () => setOpen(el, false);
  const render = () => {
    clear(el);
    el.append(head('Meine Orte', close));
    const body = h('div', { class: 'panel-body' });
    el.append(body);
    body.append(h('div', { class: 'section-title' }, 'Favoriten'));
    if (!state.favorites.length) body.append(h('div', { class: 'empty' }, 'Noch keine Favoriten. Tippe auf die Karte, öffne die Vorhersage und tippe auf ☆.'));
    else
      body.append(
        h(
          'ul',
          { class: 'list', 'data-testid': 'fav-list' },
          state.favorites.map((f) =>
            h(
              'li',
              {},
              h('span', { style: 'color:var(--accent)' }, '★'),
              h('div', { class: 'grow', onclick: () => { close(); onOpen(f); } }, f.name, h('small', {}, `${f.lat.toFixed(2)}, ${f.lon.toFixed(2)}`)),
              h('button', { class: 'btn danger', 'aria-label': `${f.name} entfernen`, onclick: () => update({ favorites: state.favorites.filter((x) => x.id !== f.id) }) }, 'Entfernen'),
            ),
          ),
        ),
      );
    body.append(h('div', { class: 'section-title' }, 'Spots'));
    if (!state.spots.length) body.append(h('div', { class: 'empty' }, 'Noch keine Spots. Öffne die Vorhersage eines Ortes und tippe auf 🏄, um ihn als Spot mit Wunschwind zu speichern.'));
    else
      body.append(
        h(
          'ul',
          { class: 'list', 'data-testid': 'spot-list' },
          state.spots.map((s) =>
            h(
              'li',
              {},
              h('span', {}, '🏄'),
              h('div', { class: 'grow', onclick: () => { close(); onOpen(s, s); } }, s.name, h('small', {}, `${SPORT_LABEL[s.sport]} · ${formatValue('wind', s.minWind, state.units)} bis ${formatValue('wind', s.maxWind, state.units)}`)),
              h('button', { class: 'btn danger', 'aria-label': `${s.name} löschen`, onclick: () => update({ spots: state.spots.filter((x) => x.id !== s.id) }) }, 'Löschen'),
            ),
          ),
        ),
      );
  };
  subscribe((_, c) => {
    if (el.classList.contains('open') && (c.has('favorites') || c.has('spots') || c.has('units'))) render();
  });
  return {
    open: () => {
      closePanels('#panel-places');
      render();
      setOpen(el, true);
    },
  };
}

export function toggleFavorite(loc: Location): void {
  const existing = state.favorites.find((f) => sameLoc(f, loc));
  if (existing) update({ favorites: state.favorites.filter((f) => f !== existing) });
  else {
    const fav: Favorite = { id: uid(), name: loc.name ?? `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}`, lat: loc.lat, lon: loc.lon };
    update({ favorites: [...state.favorites, fav] });
  }
}

// ---------- spot editor ----------

export function openSpotEditor(loc: Location, spot?: Spot): void {
  const el = $('#panel-spot');
  closePanels('#panel-spot');
  clear(el);
  const u = state.units.wind;
  // Whole numbers except m/s, so defaults like 14 m/s read "50" km/h rather than "50.4".
  const shown = (ms: number) => (u === 'ms' ? Math.round(ms * 10) / 10 : Math.round(convertWind(ms, u)));
  // Max is stored as the upper bound of the chosen Beaufort force; show that force again.
  const shownMax = (ms: number) => (u === 'bft' ? convertWind(Math.max(0, ms - 0.01), u) : shown(ms));
  let sport: Sport = spot?.sport ?? 'kite';
  const dirs = new Set<number>(spot?.directions ?? []);
  const name = h('input', { type: 'text', value: spot?.name ?? loc.name ?? '', maxlength: 60, 'data-testid': 'spot-name' }) as HTMLInputElement;
  const min = h('input', { type: 'text', value: String(shown(spot?.minWind ?? SPORT_DEFAULTS[sport][0])).replace('.', ','), 'data-testid': 'spot-min', inputmode: 'decimal' }) as HTMLInputElement;
  const max = h('input', { type: 'text', value: String(shownMax(spot?.maxWind ?? SPORT_DEFAULTS[sport][1])).replace('.', ','), 'data-testid': 'spot-max', inputmode: 'decimal' }) as HTMLInputElement;
  const error = h('div', { style: 'color:#ff9b8a;margin-top:8px', 'data-testid': 'spot-error' });

  const sportSeg = h('div', { class: 'seg' });
  const renderSport = () => {
    clear(sportSeg);
    (Object.keys(SPORT_LABEL) as Sport[]).forEach((sp) =>
      sportSeg.appendChild(
        h('button', {
          type: 'button',
          class: sp === sport ? 'active' : '',
          'data-sport': sp,
          onclick: () => {
            sport = sp;
            if (!spot) {
              min.value = String(shown(SPORT_DEFAULTS[sp][0])).replace('.', ',');
              max.value = String(shownMax(SPORT_DEFAULTS[sp][1])).replace('.', ',');
            }
            renderSport();
          },
        }, SPORT_LABEL[sp]),
      ),
    );
  };
  renderSport();

  const dirSeg = h('div', { class: 'seg' });
  const renderDirs = () => {
    clear(dirSeg);
    COMPASS_POINTS.forEach((label, i) =>
      dirSeg.appendChild(
        h('button', {
          type: 'button',
          class: dirs.has(i) ? 'active' : '',
          'data-dir': i,
          'aria-pressed': dirs.has(i) ? 'true' : 'false',
          onclick: () => {
            if (dirs.has(i)) dirs.delete(i);
            else dirs.add(i);
            renderDirs();
          },
        }, label),
      ),
    );
  };
  renderDirs();

  const saveSpot = (e: Event) => {
    e.preventDefault();
    const n = name.value.trim();
    const lo = parseFloat(min.value.replace(',', '.'));
    const hi = parseFloat(max.value.replace(',', '.'));
    if (!n) return void (error.textContent = 'Bitte einen Namen eingeben.');
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi <= lo) return void (error.textContent = 'Bitte einen gültigen Windbereich eingeben (Max. größer als Min.).');
    const next: Spot = {
      id: spot?.id ?? uid(),
      name: n,
      lat: spot?.lat ?? loc.lat,
      lon: spot?.lon ?? loc.lon,
      sport,
      minWind: windToMs(lo, u),
      maxWind: u === 'bft' ? windToMs(hi + 1, u) : windToMs(hi, u),
      directions: [...dirs].sort((a, b) => a - b),
    };
    update({ spots: spot ? state.spots.map((s) => (s.id === spot.id ? next : s)) : [...state.spots, next] });
    setOpen(el, false);
  };

  el.append(
    head(spot ? 'Spot bearbeiten' : 'Neuer Spot', () => setOpen(el, false)),
    h(
      'form',
      { class: 'panel-body form', onsubmit: saveSpot, novalidate: true, 'data-testid': 'spot-form' },
      h('div', { class: 'sub', style: 'color:var(--muted)' }, `${(spot ?? loc).lat.toFixed(3)}, ${(spot ?? loc).lon.toFixed(3)}`),
      h('label', {}, 'Name'),
      name,
      h('label', {}, 'Sportart'),
      sportSeg,
      h('div', { class: 'row' }, h('div', {}, h('label', {}, `Wind min. (${WIND_UNIT_LABEL[u]})`), min), h('div', {}, h('label', {}, `Wind max. (${WIND_UNIT_LABEL[u]})`), max)),
      h('label', {}, 'Gute Windrichtungen (woher der Wind kommt, leer = alle)'),
      dirSeg,
      error,
      h(
        'div',
        { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn primary', 'data-testid': 'spot-save' }, 'Speichern'),
        spot
          ? h('button', {
              type: 'button',
              class: 'btn danger',
              onclick: () => {
                update({ spots: state.spots.filter((s) => s.id !== spot.id) });
                setOpen(el, false);
              },
            }, 'Löschen')
          : null,
        h('button', { type: 'button', class: 'btn', onclick: () => setOpen(el, false) }, 'Abbrechen'),
      ),
    ),
  );
  setOpen(el, true);
  if (!name.value) setTimeout(() => name.focus(), 260);
}

// ---------- settings ----------

export function initSettingsPanel(): { open: () => void } {
  const el = $('#panel-settings');
  const close = () => setOpen(el, false);
  const seg = <K extends keyof UnitSettings>(key: K, options: [UnitSettings[K], string][]) =>
    h(
      'div',
      { class: 'seg', 'data-setting': key },
      options.map(([value, label]) =>
        h('button', {
          type: 'button',
          class: state.units[key] === value ? 'active' : '',
          'data-value': String(value),
          onclick: () => update({ units: { ...state.units, [key]: value } }),
        }, label),
      ),
    );
  const render = () => {
    clear(el);
    const particles = h('input', { type: 'checkbox', 'data-testid': 'toggle-particles', checked: state.particles, onchange: (e: Event) => update({ particles: (e.target as HTMLInputElement).checked }) });
    el.append(
      head('Einstellungen', close),
      h(
        'div',
        { class: 'panel-body form' },
        h('label', {}, 'Windgeschwindigkeit'),
        seg('wind', (Object.keys(WIND_UNIT_LABEL) as WindUnit[]).map((k) => [k, WIND_UNIT_LABEL[k]])),
        h('label', {}, 'Temperatur'),
        seg('temp', [['c', '°C'], ['f', '°F']]),
        h('label', {}, 'Niederschlag'),
        seg('precip', [['mm', 'mm'], ['in', 'Zoll']]),
        h('label', {}, 'Luftdruck'),
        seg('pressure', [['hpa', 'hPa'], ['inhg', 'inHg']]),
        h('label', { class: 'toggle' }, h('span', {}, 'Windanimation (Partikel)'), particles),
        h('div', { class: 'section-title' }, 'Über die App'),
        h(
          'p',
          { style: 'color:var(--muted)' },
          'Wetterdaten: Open-Meteo (ECMWF, NOAA GFS, DWD ICON, Météo-France), Wellen: Open-Meteo Marine, Luftqualität: CAMS über Open-Meteo, Radar: RainViewer, Karte: OpenStreetMap / CARTO. Kostenlose Nutzung nur privat und nicht kommerziell. Alle Angaben ohne Gewähr.',
        ),
      ),
    );
  };
  subscribe((_, c) => {
    if (el.classList.contains('open') && (c.has('units') || c.has('particles'))) render();
  });
  return {
    open: () => {
      closePanels('#panel-settings');
      render();
      setOpen(el, true);
    },
  };
}
