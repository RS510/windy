import type L from 'leaflet';
import { ViewportCanvas } from './canvasLayer';
import { bilinear, gridIndex, type Grid } from '../data/grid';

const FIELD_STEP = 8; // CSS pixels between velocity samples
const SPEED_FACTOR = 0.3; // px per frame per m/s
const MAX_AGE = 90;

export interface WindData {
  grid: Grid;
  speedVar: string;
  dirVar: string;
  t: number;
}

/** Animated wind particles with fading trails. */
export class ParticleLayer {
  private vc: ViewportCanvas;
  private data: WindData | null = null;
  private u = new Float32Array(0);
  private v = new Float32Array(0);
  private cols = 0;
  private rows = 0;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private age = new Uint16Array(0);
  private raf = 0;
  private running = false;
  private enabled = true;
  private paused = false;
  frames = 0;

  constructor(map: L.Map) {
    this.vc = new ViewportCanvas(map, 'particles', 420, 'particle-canvas');
    this.vc.canvas.dataset.testid = 'particle-canvas';
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  set(data: WindData | null): void {
    this.data = data;
    this.rebuild();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.rebuild();
    else {
      this.stop();
      this.vc.clear();
    }
  }

  /** Pause while the map moves; `rebuild` resumes with a fresh field. */
  pause(): void {
    this.paused = true;
    this.vc.clear();
  }

  rebuild(): void {
    this.paused = false;
    this.vc.resize();
    this.vc.clear();
    if (!this.enabled || !this.data || !this.buildField()) {
      this.stop();
      return;
    }
    this.seed();
    this.start();
  }

  private buildField(): boolean {
    const d = this.data!;
    const sp = d.grid.vars[d.speedVar]?.[d.t];
    const dir = d.grid.vars[d.dirVar]?.[d.t];
    if (!sp || !dir) return false;
    const { spec } = d.grid;
    // Interpolate u/v (not speed/direction) so directions blend correctly.
    const n = spec.nx * spec.ny;
    const gu = new Float32Array(n);
    const gv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = (dir[i] * Math.PI) / 180;
      gu[i] = -sp[i] * Math.sin(r);
      gv[i] = -sp[i] * Math.cos(r);
    }
    const { lons, lats, cols, rows } = this.vc.axes(FIELD_STEP);
    this.cols = cols;
    this.rows = rows;
    this.u = new Float32Array(cols * rows);
    this.v = new Float32Array(cols * rows);
    const fx = Array.from(lons, (lon) => gridIndex(spec, 0, lon)[0]);
    const fy = Array.from(lats, (lat) => gridIndex(spec, lat, 0)[1]);
    let valid = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const uu = bilinear(gu, spec.nx, spec.ny, fx[x], fy[y]);
        const vv = bilinear(gv, spec.nx, spec.ny, fx[x], fy[y]);
        // Screen y grows downwards, so northward wind moves particles up.
        this.u[i] = uu * SPEED_FACTOR;
        this.v[i] = -vv * SPEED_FACTOR;
        if (!Number.isNaN(uu)) valid++;
      }
    }
    return valid > 0;
  }

  private count(): number {
    const area = this.vc.width * this.vc.height;
    const density = this.vc.width < 700 ? 260 : 330;
    return Math.min(5000, Math.max(300, Math.round(area / density)));
  }

  private seed(): void {
    const n = this.count();
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.age = new Uint16Array(n);
    for (let i = 0; i < n; i++) this.respawn(i, true);
  }

  private respawn(i: number, randomAge = false): void {
    this.px[i] = Math.random() * this.vc.width;
    this.py[i] = Math.random() * this.vc.height;
    this.age[i] = randomAge ? Math.floor(Math.random() * MAX_AGE) : 0;
  }

  private velocity(x: number, y: number): [number, number] {
    const fx = x / FIELD_STEP;
    const fy = y / FIELD_STEP;
    return [bilinear(this.u, this.cols, this.rows, fx, fy), bilinear(this.v, this.cols, this.rows, fx, fy)];
  }

  private start(): void {
    if (this.running || !this.enabled || !this.data || document.hidden) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      if (!this.paused) this.step();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private step(): void {
    const { ctx, dpr } = this.vc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Fade existing trails while keeping the canvas transparent.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, this.vc.canvas.width, this.vc.canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const n = this.px.length;
    for (let i = 0; i < n; i++) {
      const x = this.px[i];
      const y = this.py[i];
      const [du, dv] = this.velocity(x, y);
      if (Number.isNaN(du) || this.age[i]++ > MAX_AGE) {
        this.respawn(i);
        continue;
      }
      const nx = x + du;
      const ny = y + dv;
      if (nx < 0 || ny < 0 || nx > this.vc.width || ny > this.vc.height) {
        this.respawn(i);
        continue;
      }
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      this.px[i] = nx;
      this.py[i] = ny;
    }
    ctx.stroke();
    this.frames++;
  }
}
