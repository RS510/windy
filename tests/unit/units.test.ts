import { describe, expect, it } from 'vitest';
import {
  beaufortToMs,
  compass,
  convertPressure,
  convertTemp,
  convertWind,
  formatValue,
  fromUV,
  msToBeaufort,
  toUV,
  windToMs,
  DEFAULT_UNITS,
} from '../../src/util/units';

describe('units', () => {
  it('converts wind speeds', () => {
    expect(convertWind(10, 'kmh')).toBeCloseTo(36);
    expect(convertWind(10, 'kt')).toBeCloseTo(19.44, 1);
    expect(convertWind(10, 'mph')).toBeCloseTo(22.37, 1);
    expect(convertWind(10, 'ms')).toBe(10);
  });

  it('round-trips wind units', () => {
    for (const u of ['kmh', 'ms', 'kt', 'mph'] as const) {
      expect(windToMs(convertWind(7.3, u), u)).toBeCloseTo(7.3, 6);
    }
  });

  it('maps Beaufort scale boundaries', () => {
    expect(msToBeaufort(0)).toBe(0);
    expect(msToBeaufort(0.5)).toBe(1);
    expect(msToBeaufort(5.4)).toBe(3);
    expect(msToBeaufort(5.5)).toBe(4);
    expect(msToBeaufort(32.6)).toBe(11);
    expect(msToBeaufort(40)).toBe(12);
    expect(beaufortToMs(4)).toBe(5.5);
    expect(msToBeaufort(beaufortToMs(6))).toBe(6);
  });

  it('converts temperature and pressure', () => {
    expect(convertTemp(0, 'f')).toBe(32);
    expect(convertTemp(100, 'f')).toBe(212);
    expect(convertPressure(1013.25, 'inhg')).toBeCloseTo(29.92, 2);
  });

  it('formats values in German locale with unit', () => {
    expect(formatValue('wind', 10, DEFAULT_UNITS)).toBe('36 km/h');
    expect(formatValue('precip', 1.25, DEFAULT_UNITS)).toBe('1,3 mm');
    expect(formatValue('temp', null, DEFAULT_UNITS)).toBe('–');
    expect(formatValue('temp', NaN, DEFAULT_UNITS)).toBe('–');
    expect(formatValue('direction', 270, DEFAULT_UNITS)).toBe('W 270°');
    expect(formatValue('wind', 10, { ...DEFAULT_UNITS, wind: 'bft' })).toBe('5 Bft');
    expect(formatValue('pressure', 1013.2, DEFAULT_UNITS)).toBe('1013 hPa'); // no thousands separator
  });

  it('names compass directions', () => {
    expect(compass(0)).toBe('N');
    expect(compass(359)).toBe('N');
    expect(compass(90)).toBe('O');
    expect(compass(225)).toBe('SW');
    expect(compass(-45)).toBe('NW');
  });

  it('converts meteorological direction to vector and back', () => {
    // Wind from the west blows towards the east: u > 0.
    const [u, v] = toUV(10, 270);
    expect(u).toBeCloseTo(10);
    expect(v).toBeCloseTo(0);
    // Wind from the north blows south: v < 0.
    expect(toUV(5, 0)[1]).toBeCloseTo(-5);
    const [s, d] = fromUV(...toUV(8, 135));
    expect(s).toBeCloseTo(8);
    expect(d).toBeCloseTo(135);
  });
});
