import L from 'leaflet';
import { mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { MultiLineString } from 'geojson';
import world110 from 'world-atlas/countries-110m.json';
import { splitAtDateLine } from './lines';

/**
 * Country borders and coastlines bundled with the app (Natural Earth via world-atlas), drawn
 * as light lines above the weather colours. They don't depend on any tile server, so the
 * countries are always recognisable, even when map tiles fail to load.
 */

interface Lines {
  coast: MultiLineString;
  borders: MultiLineString;
}

function toLines(topo: Topology): Lines {
  const countries = topo.objects.countries as GeometryCollection;
  return {
    // Arcs used by one country only are coastlines, shared arcs are borders.
    coast: splitAtDateLine(mesh(topo, countries, (a, b) => a === b)),
    borders: splitAtDateLine(mesh(topo, countries, (a, b) => a !== b)),
  };
}

/** Shifts all longitudes, used to draw world copies when zoomed far out. */
function shift(ml: MultiLineString, dx: number): MultiLineString {
  return { type: 'MultiLineString', coordinates: ml.coordinates.map((line) => line.map(([x, y]) => [x + dx, y])) };
}

const DETAIL_ZOOM = 4; // from here on the finer 1:50m data is used

export class BordersLayer {
  private group = L.layerGroup();
  private coarse: Lines = toLines(world110 as unknown as Topology);
  private fine: Lines | null = null;
  private loadingFine = false;
  private shown: 'coarse' | 'fine' | null = null;
  private renderer: L.Renderer;

  constructor(private map: L.Map) {
    const pane = map.createPane('borders');
    pane.style.zIndex = '390';
    pane.style.pointerEvents = 'none';
    this.renderer = L.canvas({ pane: 'borders', padding: 0.3 });
    this.group.addTo(map);
    map.on('zoomend', () => this.update());
    this.update();
  }

  private update(): void {
    const wantFine = this.map.getZoom() >= DETAIL_ZOOM;
    if (wantFine && !this.fine) {
      this.loadFine();
      if (this.shown !== 'coarse') this.draw(this.coarse, 'coarse');
      return;
    }
    const level = wantFine ? 'fine' : 'coarse';
    if (level !== this.shown) this.draw(level === 'fine' ? this.fine! : this.coarse, level);
  }

  private loadFine(): void {
    if (this.loadingFine) return;
    this.loadingFine = true;
    import('world-atlas/countries-50m.json')
      .then((m) => {
        this.fine = toLines((m.default ?? m) as unknown as Topology);
        this.update();
      })
      .catch(() => {
        this.loadingFine = false; // keep the coarse lines, try again on the next zoom
      });
  }

  private draw(lines: Lines, level: 'coarse' | 'fine'): void {
    this.group.clearLayers();
    // At low zoom the map repeats horizontally; draw copies so every repetition has borders.
    const offsets = level === 'coarse' ? [-360, 0, 360] : [0];
    for (const dx of offsets) {
      const coast = dx ? shift(lines.coast, dx) : lines.coast;
      const borders = dx ? shift(lines.borders, dx) : lines.borders;
      L.geoJSON(coast, { renderer: this.renderer, interactive: false, style: { color: '#ffffff', weight: 1.1, opacity: 0.9 } } as L.GeoJSONOptions).addTo(this.group);
      L.geoJSON(borders, { renderer: this.renderer, interactive: false, style: { color: '#ffffff', weight: 0.8, opacity: 0.6 } } as L.GeoJSONOptions).addTo(this.group);
    }
    this.shown = level;
  }

  get level(): 'coarse' | 'fine' | null {
    return this.shown;
  }
}
