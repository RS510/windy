import type { MultiLineString } from 'geojson';

/**
 * Splits lines where they jump across the date line (e.g. Russia, Fiji, Antarctica), which
 * would otherwise be drawn as long horizontal strokes across the whole map.
 */
export function splitAtDateLine(ml: MultiLineString): MultiLineString {
  const out: number[][][] = [];
  for (const line of ml.coordinates) {
    let part: number[][] = [];
    for (const pt of line) {
      const prev = part[part.length - 1];
      if (prev && Math.abs(pt[0] - prev[0]) > 180) {
        if (part.length > 1) out.push(part);
        part = [];
      }
      part.push(pt);
    }
    if (part.length > 1) out.push(part);
  }
  return { type: 'MultiLineString', coordinates: out };
}
