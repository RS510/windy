import { $, clear, h } from './dom';
import { parseCoords, searchPlaces, type Place } from '../data/openMeteo';
import { showBanner } from './feedback';

/** Search box with debounced geocoding; calls `onSelect` with the chosen place. */
export function initSearch(onSelect: (p: Place) => void): void {
  const input = $('#search-input') as HTMLInputElement;
  const list = $('#search-results');
  let results: Place[] = [];
  let active = -1;
  let timer = 0;
  let seq = 0;
  let dirty = false; // input changed since the last results

  const close = () => {
    list.classList.remove('open');
    active = -1;
  };

  const choose = (p: Place) => {
    close();
    input.value = p.name;
    input.blur();
    onSelect(p);
  };

  const render = () => {
    clear(list);
    if (!results.length) {
      list.appendChild(h('li', { class: 'empty' }, 'Keine Treffer'));
    }
    results.forEach((p, i) => {
      list.appendChild(
        h(
          'li',
          {
            role: 'option',
            class: i === active ? 'active' : '',
            onmousedown: (e: Event) => e.preventDefault(), // keep focus until click completes
            onclick: () => choose(p),
          },
          p.name,
          p.detail ? h('small', {}, p.detail) : null,
        ),
      );
    });
    list.classList.add('open');
  };

  const run = async (q: string, pickFirst = false) => {
    dirty = false;
    const coords = parseCoords(q);
    if (coords) {
      results = [{ name: `${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}`, lat: coords.lat, lon: coords.lon, detail: 'Koordinaten' }];
      active = 0;
      if (pickFirst) choose(results[0]);
      else render();
      return;
    }
    const my = ++seq;
    try {
      const r = await searchPlaces(q);
      if (my !== seq) return;
      results = r;
      active = r.length ? 0 : -1;
      if (pickFirst && r.length) choose(r[0]);
      else render();
    } catch (e) {
      if (my !== seq) return;
      close();
      showBanner(`Ortssuche fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    dirty = true;
    const q = input.value.trim();
    if (q.length < 2) {
      seq++;
      close();
      return;
    }
    timer = window.setTimeout(() => run(q), 300);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) {
      active = (active + 1) % results.length;
      render();
      e.preventDefault();
    } else if (e.key === 'ArrowUp' && results.length) {
      active = (active - 1 + results.length) % results.length;
      render();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (!dirty && list.classList.contains('open') && results[active]) choose(results[active]);
      else {
        clearTimeout(timer);
        if (input.value.trim().length >= 2) run(input.value.trim(), true);
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
}
