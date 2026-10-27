import { $, clear, h } from './dom';
import { state, subscribe, update } from '../state';
import { LAYERS, MODELS, getLayer, modelLabel } from '../layers/definitions';
import { convert, unitLabel } from '../util/units';
import { dayKey, fmtDay, fmtHour, fmtWeekday, nowUnix } from '../util/time';

// ---------- layer menu ----------

export function initLayerMenu(): void {
  const menu = $('#layer-menu');
  // On phones the list is collapsed behind one button showing the active layer.
  const toggle = h('button', { class: 'layer-btn layer-toggle', 'data-testid': 'layer-toggle', 'aria-expanded': 'false' });
  const list = h('div', { class: 'layer-list' });
  menu.append(toggle, list);
  const setExpanded = (on: boolean) => {
    menu.classList.toggle('expanded', on);
    toggle.setAttribute('aria-expanded', String(on));
  };
  toggle.addEventListener('click', () => setExpanded(!menu.classList.contains('expanded')));
  const render = () => {
    const active = getLayer(state.layer);
    clear(toggle);
    toggle.append(h('span', { class: 'ico' }, active.icon), h('span', { class: 'lbl' }, active.label));
    toggle.setAttribute('aria-label', `Ebene wählen, aktiv: ${active.label}`);
    clear(list);
    for (const l of LAYERS) {
      list.appendChild(
        h(
          'button',
          {
            class: `layer-btn${state.layer === l.id ? ' active' : ''}`,
            'data-layer': l.id,
            title: l.label,
            'aria-label': l.label,
            'aria-pressed': state.layer === l.id ? 'true' : 'false',
            onclick: () => {
              setExpanded(false);
              update({ layer: l.id });
            },
          },
          h('span', { class: 'ico' }, l.icon),
          h('span', { class: 'lbl' }, l.label),
        ),
      );
    }
  };
  render();
  subscribe((_, c) => c.has('layer') && render());
}

// ---------- legend ----------

export function initLegend(): void {
  const el = $('#legend');
  const render = () => {
    clear(el);
    const l = getLayer(state.layer);
    if (l.source === 'radar') {
      el.appendChild(h('div', { class: 'title' }, h('span', {}, 'Regenradar'), h('span', {}, 'leicht → stark')));
      el.appendChild(h('div', { class: 'bar', style: 'background:linear-gradient(90deg,#88ddee,#0099cc,#0077aa,#ffee00,#ff9900,#ff4400,#c10000,#ff00ff)' }));
      return;
    }
    if (!l.scale || !l.legend || !l.quantity) return;
    const { scale } = l;
    const span = scale.max - scale.min;
    const grad = scale.stops.map(([v, c]) => `${c.length > 7 ? c.slice(0, 7) : c} ${(((v - scale.min) / span) * 100).toFixed(1)}%`).join(',');
    const unit = unitLabel(l.quantity, state.units);
    el.appendChild(h('div', { class: 'title' }, h('span', {}, l.label), h('span', { 'data-testid': 'legend-unit' }, unit)));
    el.appendChild(h('div', { class: 'bar', style: `background:linear-gradient(90deg,${grad})` }));
    el.appendChild(
      h(
        'div',
        { class: 'ticks' },
        l.legend.map((v) => {
          const c = convert(l.quantity!, v, state.units);
          const txt = Math.abs(c) < 10 && c % 1 !== 0 ? c.toFixed(1) : Math.round(c).toString();
          return h('span', {}, txt.replace('.', ','));
        }),
      ),
    );
  };
  render();
  subscribe((_, c) => (c.has('layer') || c.has('units')) && render());
}

// ---------- model picker ----------

export function initModelPicker(): void {
  const btn = $('#btn-model');
  const menu = $('#model-menu');
  const render = () => {
    const radar = getLayer(state.layer).source === 'radar';
    btn.textContent = radar ? 'RainViewer' : `${modelLabel(state.model)} ▾`;
    btn.toggleAttribute('disabled', radar);
    clear(menu);
    for (const m of MODELS) {
      menu.appendChild(
        h(
          'li',
          {
            role: 'option',
            class: state.model === m.id ? 'active' : '',
            'data-model': m.id,
            'aria-selected': state.model === m.id ? 'true' : 'false',
            onclick: () => {
              update({ model: m.id });
              toggle(false);
            },
          },
          m.label,
          h('small', {}, m.info),
        ),
      );
    }
  };
  const toggle = (open: boolean) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) toggle(false);
  });
  render();
  subscribe((_, c) => (c.has('model') || c.has('layer')) && render());
}

// ---------- timeline ----------

const PLAY_INTERVAL_MS = 700;

export function initTimeline(): void {
  const root = $('#timeline');
  const play = h('button', { class: 'play-btn', 'aria-label': 'Abspielen', 'data-testid': 'play' }, '▶');
  const label = h('div', { class: 'time-label' });
  const days = h('div', { class: 'days' });
  const slider = h('input', {
    class: 'time-slider',
    type: 'range',
    min: 0,
    max: 0,
    step: 1,
    value: 0,
    'aria-label': 'Zeitpunkt',
  }) as HTMLInputElement;
  root.append(play, label, h('div', { class: 'slider-wrap' }, days, slider));

  let timer = 0;

  slider.addEventListener('input', () => update({ timeIndex: Number(slider.value), playing: false }));
  play.addEventListener('click', () => update({ playing: !state.playing }));

  const renderDays = () => {
    clear(days);
    const t = state.times;
    if (!t.length) return;
    // Group consecutive hours per local day; widths proportional to hour count.
    const groups: { key: string; start: number; n: number }[] = [];
    for (const time of t) {
      const k = dayKey(time);
      const g = groups[groups.length - 1];
      if (g && g.key === k) g.n++;
      else groups.push({ key: k, start: time, n: 1 });
    }
    for (const g of groups) {
      const pct = (g.n / t.length) * 100;
      days.appendChild(h('span', { style: `width:${pct}%` }, g.n >= 6 ? fmtWeekday(g.start) : ''));
    }
  };

  const renderLabel = () => {
    clear(label);
    const t = state.times[state.timeIndex];
    if (t === undefined) {
      label.append(h('span', {}, 'Lade Zeitleiste…'));
      return;
    }
    const diffH = Math.round((t - nowUnix()) / 3600);
    const rel = diffH === 0 ? 'jetzt' : diffH > 0 ? `in ${diffH} h` : `vor ${-diffH} h`;
    label.append(h('span', { 'data-testid': 'time-label' }, `${fmtDay(t)} ${fmtHour(t)}`), h('span', { class: 'sub' }, rel));
  };

  const setPlaying = (on: boolean) => {
    play.textContent = on ? '❚❚' : '▶';
    play.setAttribute('aria-label', on ? 'Pause' : 'Abspielen');
    clearInterval(timer);
    if (on) {
      timer = window.setInterval(() => {
        const n = state.times.length;
        if (!n) return;
        update({ timeIndex: (state.timeIndex + 1) % n });
      }, PLAY_INTERVAL_MS);
    }
  };

  subscribe((s, c) => {
    if (c.has('times')) {
      slider.max = String(Math.max(0, s.times.length - 1));
      renderDays();
    }
    if (c.has('times') || c.has('timeIndex')) {
      slider.value = String(s.timeIndex);
      renderLabel();
    }
    if (c.has('playing')) setPlaying(s.playing);
  });
  renderLabel();
}
