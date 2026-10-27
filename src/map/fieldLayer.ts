import type L from 'leaflet';
import { ViewportCanvas } from './canvasLayer';
import { bilinear, gridIndex, type Grid } from '../data/grid';
import { colorAt, type ColorScale } from '../layers/colorScales';
import { isolines } from './isolines';

const STEP = 4; // CSS pixels per sample; the image is smoothed when scaled up

export interface FieldData {
  grid: Grid;
  variable: string;
  t: number;
  scale: ColorScale;
  iso?: { variable: string; interval: number };
}

/** Colour-filled weather field plus optional isolines (isobars). */
export class FieldLayer {
  private vc: ViewportCanvas;
  private small = document.createElement('canvas');
  private data: FieldData | null = null;

  constructor(map: L.Map) {
    this.vc = new ViewportCanvas(map, 'field', 250, 'field-canvas');
    this.vc.canvas.dataset.testid = 'field-canvas';
  }

  set(data: FieldData | null): void {
    this.data = data;
    this.redraw();
  }

  show(v: boolean): void {
    this.vc.show(v);
  }

  redraw(): void {
    const vc = this.vc;
    vc.resize();
    vc.clear();
    const d = this.data;
    if (!d) return;
    const values = d.grid.vars[d.variable]?.[d.t];
    if (!values) return;
    const { spec } = d.grid;
    const { lons, lats, cols, rows } = vc.axes(STEP);
    const fx = new Float64Array(cols);
    const fy = new Float64Array(rows);
    for (let x = 0; x < cols; x++) fx[x] = gridIndex(spec, 0, lons[x])[0];
    for (let y = 0; y < rows; y++) fy[y] = gridIndex(spec, lats[y], 0)[1];

    this.small.width = cols;
    this.small.height = rows;
    const sctx = this.small.getContext('2d')!;
    const img = sctx.createImageData(cols, rows);
    const px = img.data;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = bilinear(values, spec.nx, spec.ny, fx[x], fy[y]);
        colorAt(d.scale, v, px, (y * cols + x) * 4);
      }
    }
    sctx.putImageData(img, 0, 0);

    const ctx = vc.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(vc.dpr, 0, 0, vc.dpr, 0, 0);
    ctx.drawImage(this.small, 0, 0, cols * STEP, rows * STEP);

    if (d.iso) this.drawIsolines(d, fx, fy);
  }

  private drawIsolines(d: FieldData, fx: Float64Array, fy: Float64Array): void {
    const iso = d.iso!;
    const values = d.grid.vars[iso.variable]?.[d.t];
    if (!values) return;
    const { spec } = d.grid;
    const ctx = this.vc.ctx;
    // Map grid coordinates back to screen via the inverse of the column/row lookups.
    const toScreenX = (gx: number) => invert(fx, gx) * STEP;
    const toScreenY = (gy: number) => invert(fy, gy) * STEP;
    const lines = isolines(values, spec.nx, spec.ny, iso.interval);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const line of lines) {
      ctx.beginPath();
      for (const [ax, ay, bx, by] of line.segments) {
        ctx.moveTo(toScreenX(ax), toScreenY(ay));
        ctx.lineTo(toScreenX(bx), toScreenY(by));
      }
      ctx.stroke();
      // One label per level at its first visible segment.
      const seg = line.segments.find(([ax, ay]) => {
        const x = toScreenX(ax);
        const y = toScreenY(ay);
        return x > 20 && y > 20 && x < this.vc.width - 20 && y < this.vc.height - 20;
      });
      if (seg) {
        const x = toScreenX(seg[0]);
        const y = toScreenY(seg[1]);
        const label = String(Math.round(line.level));
        const w = ctx.measureText(label).width + 6;
        ctx.fillStyle = 'rgba(20,24,30,0.75)';
        ctx.fillRect(x - w / 2, y - 7, w, 14);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x, y);
      }
    }
  }
}

/** Finds the fractional array index where a monotonic array reaches `v` (screen position). */
function invert(arr: Float64Array, v: number): number {
  const n = arr.length;
  if (n < 2) return 0;
  const asc = arr[n - 1] > arr[0];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v === asc) lo = mid;
    else hi = mid;
  }
  const a = arr[lo];
  const b = arr[hi];
  return b === a ? lo : lo + (v - a) / (b - a);
}
