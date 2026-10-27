import L from 'leaflet';

/**
 * A canvas that always covers the visible map. It lives in its own pane so it pans with the
 * map; after each move it is repositioned to the viewport and redrawn by the owner.
 */
export class ViewportCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  dpr = 1;

  constructor(
    readonly map: L.Map,
    paneName: string,
    zIndex: number,
    className: string,
  ) {
    const pane = map.getPane(paneName) ?? map.createPane(paneName);
    pane.style.zIndex = String(zIndex);
    pane.style.pointerEvents = 'none';
    this.canvas = L.DomUtil.create('canvas', className, pane);
    this.canvas.style.position = 'absolute';
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  /** Matches canvas size to the map and pins it to the viewport's top-left corner. */
  resize(): void {
    const size = this.map.getSize();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (size.x !== this.width || size.y !== this.height || this.canvas.width !== Math.round(size.x * this.dpr)) {
      this.width = size.x;
      this.height = size.y;
      this.canvas.width = Math.round(size.x * this.dpr);
      this.canvas.height = Math.round(size.y * this.dpr);
      this.canvas.style.width = `${size.x}px`;
      this.canvas.style.height = `${size.y}px`;
    }
    L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  show(visible: boolean): void {
    this.canvas.style.visibility = visible ? 'visible' : 'hidden';
  }

  /** Longitude per screen column and latitude per screen row (exact for Web Mercator). */
  axes(step: number): { lons: Float64Array; lats: Float64Array; cols: number; rows: number } {
    const cols = Math.ceil(this.width / step) + 1;
    const rows = Math.ceil(this.height / step) + 1;
    const lons = new Float64Array(cols);
    const lats = new Float64Array(rows);
    for (let x = 0; x < cols; x++) lons[x] = this.map.containerPointToLatLng([x * step, 0]).lng;
    for (let y = 0; y < rows; y++) lats[y] = this.map.containerPointToLatLng([0, y * step]).lat;
    return { lons, lats, cols, rows };
  }
}
