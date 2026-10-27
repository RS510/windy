import L from 'leaflet';
import { radarTileUrl, type RadarInfo } from '../data/rainviewer';

/** Shows RainViewer radar frames; frames already shown stay loaded so playback is smooth. */
export class RadarLayer {
  private layers = new Map<string, L.TileLayer>();
  private info: RadarInfo | null = null;
  private current = -1;

  constructor(private map: L.Map) {}

  setInfo(info: RadarInfo | null): void {
    this.clear();
    this.info = info;
  }

  get frames() {
    return this.info?.frames ?? [];
  }

  show(index: number): void {
    const info = this.info;
    if (!info || !info.frames[index]) return;
    const load = (i: number) => {
      const f = info.frames[i];
      if (!f || this.layers.has(f.path)) return;
      const layer = L.tileLayer(radarTileUrl(info, f), {
        pane: 'radar',
        opacity: 0,
        maxNativeZoom: 7,
        maxZoom: 19,
        tileSize: 256,
        className: 'radar-tiles',
        attribution: 'Radar: <a href="https://www.rainviewer.com/">RainViewer</a>',
      });
      layer.addTo(this.map);
      this.layers.set(f.path, layer);
    };
    load(index);
    load(index + 1); // preload the next frame for playback
    this.current = index;
    for (const [path, layer] of this.layers) {
      layer.setOpacity(path === info.frames[index].path ? 0.85 : 0);
    }
  }

  clear(): void {
    for (const l of this.layers.values()) l.remove();
    this.layers.clear();
    this.current = -1;
  }

  get currentIndex(): number {
    return this.current;
  }
}
