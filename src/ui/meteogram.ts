import { s } from './dom';
import { convert, formatValue, unitLabel, type Quantity, type UnitSettings } from '../util/units';
import { dayKey, fmtDay, localHour } from '../util/time';
import type { Series } from '../data/openMeteo';

const COL = 13; // px per hour
const LEFT = 44; // axis label space

export function weatherIcon(code: number | null | undefined): string {
  if (code === null || code === undefined) return '';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '';
}

export const WEATHER_TEXT: [number, string][] = [
  [0, 'Klar'],
  [2, 'Leicht bewölkt'],
  [3, 'Bedeckt'],
  [48, 'Nebel'],
  [57, 'Niesel'],
  [67, 'Regen'],
  [77, 'Schnee'],
  [82, 'Regenschauer'],
  [86, 'Schneeschauer'],
  [99, 'Gewitter'],
];

export function weatherText(code: number | null | undefined): string {
  if (code === null || code === undefined) return '';
  return WEATHER_TEXT.find(([max]) => code <= max)?.[1] ?? '';
}

function finite(vals: (number | null)[]): number[] {
  return vals.filter((v): v is number => v !== null && Number.isFinite(v));
}

interface Row {
  height: number;
  draw: (g: SVGGElement, y0: number, width: number) => void;
  label?: string;
}

/** Common frame: day separators, day names and hour ticks. */
function frame(time: number[], rows: Row[]): SVGSVGElement {
  const width = LEFT + time.length * COL;
  const header = 30;
  const height = header + rows.reduce((a, r) => a + r.height + 6, 0);
  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  const grid = s('g', {});
  svg.appendChild(grid);
  time.forEach((t, i) => {
    const x = LEFT + i * COL;
    const isDayStart = i === 0 || dayKey(t) !== dayKey(time[i - 1]);
    if (isDayStart) {
      grid.appendChild(s('line', { x1: x, x2: x, y1: 0, y2: height, stroke: 'rgba(255,255,255,0.18)' }));
      grid.appendChild(s('text', { x: x + 4, y: 12, class: 'day-label' }, fmtDay(t)));
    }
    const hr = localHour(t);
    if (hr % 3 === 0) grid.appendChild(s('text', { x: x + COL / 2, y: 26, 'text-anchor': 'middle' }, String(hr)));
  });
  let y = header;
  for (const r of rows) {
    const g = s('g', {});
    svg.appendChild(g);
    if (r.label) g.appendChild(s('text', { x: 2, y: y + 10 }, r.label));
    r.draw(g, y, width);
    y += r.height + 6;
  }
  return svg;
}

function linePath(vals: (number | null)[], y0: number, h: number, min: number, max: number): string {
  let d = '';
  let pen = false;
  vals.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = LEFT + i * COL + COL / 2;
    const y = y0 + h - ((v - min) / (max - min || 1)) * h;
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

function range(vals: number[], pad = 0.1, minSpan = 1): [number, number] {
  if (!vals.length) return [0, 1];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < minSpan) {
    const mid = (max + min) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const p = (max - min) * pad;
  return [min - p, max + p];
}

function lineRow(
  label: string,
  vals: (number | null)[],
  q: Quantity,
  u: UnitSettings,
  color: string,
  height = 64,
  extra?: { vals: (number | null)[]; color: string; dashed?: boolean },
): Row {
  const conv = (arr: (number | null)[]) => arr.map((v) => (v === null || !Number.isFinite(v) ? null : convert(q, v, u)));
  const main = conv(vals);
  const second = extra ? conv(extra.vals) : null;
  const [min, max] = range(finite([...main, ...(second ?? [])]), 0.15, q === 'pressure' ? (u.pressure === 'inhg' ? 0.3 : 8) : 2);
  return {
    height,
    label: `${label} ${unitLabel(q, u)}`,
    draw: (g, y0) => {
      const top = y0 + 14;
      const h = height - 16;
      if (second && extra) {
        g.appendChild(s('path', { d: linePath(second, top, h, min, max), fill: 'none', stroke: extra.color, 'stroke-width': 1.5, 'stroke-dasharray': extra.dashed ? '4 3' : '0' }));
      }
      g.appendChild(s('path', { d: linePath(main, top, h, min, max), fill: 'none', stroke: color, 'stroke-width': 2 }));
      main.forEach((v, i) => {
        if (v === null || i % 3 !== 0) return;
        const x = LEFT + i * COL + COL / 2;
        const y = top + h - ((v - min) / (max - min || 1)) * h;
        g.appendChild(s('text', { x, y: Math.max(top - 2, y - 5), class: 'val', 'text-anchor': 'middle' }, formatValue(q, vals[i], u, false)));
      });
    },
  };
}

/** Full point forecast chart: weather, temperature, precipitation, wind, clouds, pressure. */
export function buildMeteogram(series: Series, u: UnitSettings): SVGSVGElement {
  const v = series.values;
  const rows: Row[] = [
    {
      height: 20,
      draw: (g, y0) => {
        series.time.forEach((_, i) => {
          if (i % 3 !== 1) return;
          g.appendChild(s('text', { x: LEFT + i * COL + COL / 2, y: y0 + 15, 'text-anchor': 'middle', style: 'font-size:13px' }, weatherIcon(v.weather_code?.[i])));
        });
      },
    },
    lineRow('Temp.', v.temperature_2m, 'temp', u, '#e8a33c', 70, { vals: v.apparent_temperature, color: 'rgba(232,163,60,0.45)', dashed: true }),
    precipRow(series, u),
    windRow(series, u),
    cloudRow(series),
    lineRow('Druck', v.pressure_msl, 'pressure', u, '#9bb0d0', 52),
  ];
  const svg = frame(series.time, rows);
  svg.setAttribute('data-testid', 'meteogram');
  return svg;
}

function precipRow(series: Series, u: UnitSettings): Row {
  const vals = series.values.precipitation;
  const prob = series.values.precipitation_probability;
  const conv = vals.map((x) => (x === null ? 0 : convert('precip', x, u)));
  const max = Math.max(u.precip === 'mm' ? 2 : 0.08, ...conv);
  const height = 46;
  return {
    height,
    label: `Regen ${unitLabel('precip', u)}`,
    draw: (g, y0) => {
      const top = y0 + 14;
      const h = height - 16;
      conv.forEach((p, i) => {
        const x = LEFT + i * COL;
        const pr = prob?.[i];
        if (pr !== null && pr !== undefined && pr > 0) {
          g.appendChild(s('rect', { x: x + 1, y: top + h - (pr / 100) * h, width: COL - 2, height: (pr / 100) * h, fill: 'rgba(79,163,224,0.12)' }));
        }
        if (p <= 0) return;
        const bh = Math.max(1, (p / max) * h);
        g.appendChild(s('rect', { x: x + 2, y: top + h - bh, width: COL - 4, height: bh, fill: '#4fa3e0', rx: 1 }));
        if (p >= (u.precip === 'mm' ? 0.5 : 0.02) && i % 3 === 0) {
          g.appendChild(s('text', { x: x + COL / 2, y: top + h - bh - 2, class: 'val', 'text-anchor': 'middle' }, formatValue('precip', vals[i], u, false)));
        }
      });
    },
  };
}

function windRow(series: Series, u: UnitSettings): Row {
  const base = lineRow('Wind', series.values.wind_speed_10m, 'wind', u, '#7fd17f', 84, {
    vals: series.values.wind_gusts_10m,
    color: '#d1a07f',
    dashed: true,
  });
  return {
    ...base,
    height: 104,
    draw: (g, y0, w) => {
      base.draw(g, y0, w);
      const ay = y0 + 96;
      series.values.wind_direction_10m.forEach((d, i) => {
        if (d === null || i % 3 !== 0) return;
        const x = LEFT + i * COL + COL / 2;
        // Arrow points where the wind blows to (direction + 180°).
        const arrow = s('path', { d: 'M0,-6 L4,4 L0,2 L-4,4 Z', fill: '#cfd6df', transform: `translate(${x},${ay}) rotate(${d + 180})` });
        arrow.setAttribute('data-dir', String(d));
        g.appendChild(arrow);
      });
    },
  };
}

function cloudRow(series: Series): Row {
  return {
    height: 26,
    label: 'Wolken',
    draw: (g, y0) => {
      series.values.cloud_cover.forEach((c, i) => {
        if (c === null) return;
        g.appendChild(s('rect', { x: LEFT + i * COL, y: y0 + 13, width: COL, height: 12, fill: `rgba(220,226,234,${(c / 100) * 0.85})` }));
      });
    },
  };
}

export interface ChartLine {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

/** Generic multi-line chart (model comparison, waves, air quality). */
export function buildLineChart(time: number[], lines: ChartLine[], q: Quantity, u: UnitSettings, title: string, height = 120): SVGSVGElement {
  const conv = lines.map((l) => l.values.map((v) => (v === null || !Number.isFinite(v) ? null : convert(q, v, u))));
  const all = finite(conv.flat());
  const [min, max] = range(all, 0.12, 2);
  const row: Row = {
    height,
    label: `${title} ${unitLabel(q, u)}`,
    draw: (g, y0, w) => {
      const top = y0 + 24; // leave room for the row label above the axis values
      const h = height - 26;
      // Horizontal guide lines with values.
      for (let k = 0; k <= 3; k++) {
        const val = min + ((max - min) * k) / 3;
        const y = top + h - (h * k) / 3;
        g.appendChild(s('line', { x1: LEFT, x2: w, y1: y, y2: y, stroke: 'rgba(255,255,255,0.07)' }));
        g.appendChild(s('text', { x: LEFT - 4, y: y + 3, 'text-anchor': 'end' }, (Math.abs(val) < 10 ? val.toFixed(1) : Math.round(val).toString()).replace('.', ',')));
      }
      conv.forEach((vals, i) => {
        g.appendChild(
          s('path', {
            d: linePath(vals, top, h, min, max),
            fill: 'none',
            stroke: lines[i].color,
            'stroke-width': 1.8,
            'stroke-dasharray': lines[i].dashed ? '4 3' : '0',
            'data-series': lines[i].label,
          }),
        );
      });
    },
  };
  return frame(time, [row]);
}
