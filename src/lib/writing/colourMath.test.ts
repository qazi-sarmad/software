import { describe, expect, it } from 'vitest';
import {
  alphaOver, contrastRatio, contrastText, darken, isHex, lighten, mixHex, parseHex,
  relativeLuminance, tint, toHex,
} from './colourMath';

describe('colourMath', () => {
  it('parses #rgb and #rrggbb, and falls back to a defined grey', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHex('#2F6F5E')).toEqual({ r: 47, g: 111, b: 94 });
    expect(parseHex('not a colour')).toEqual({ r: 136, g: 136, b: 136 });
    expect(parseHex('')).toEqual({ r: 136, g: 136, b: 136 });
  });

  it('recognises hex values only', () => {
    expect(isHex('#abc')).toBe(true);
    expect(isHex('#aabbcc')).toBe(true);
    expect(isHex('abc')).toBe(false);
    expect(isHex('brand-primary')).toBe(false);
  });

  it('formats components as a lowercase #rrggbb and clamps out-of-range bytes', () => {
    expect(toHex({ r: 47, g: 111, b: 94 })).toBe('#2f6f5e');
    expect(toHex({ r: 300, g: -20, b: 128.6 })).toBe('#ff0081');
  });

  it('mixes deterministically and clamps t', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', -5)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 5)).toBe('#ffffff');
    // The same inputs always give the same output.
    expect(mixHex('#123456', '#abcdef', 0.37)).toBe(mixHex('#123456', '#abcdef', 0.37));
  });

  it('lightens toward white and darkens toward black', () => {
    expect(lighten('#000000', 1)).toBe('#ffffff');
    expect(darken('#ffffff', 1)).toBe('#000000');
    expect(lighten('#2f6f5e', 0)).toBe('#2f6f5e');
    expect(tint('#2f6f5e', 0.5)).toBe(lighten('#2f6f5e', 0.5));
  });

  it('computes the WCAG contrast ratio symmetrically, in [1, 21]', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('picks readable text on a fill', () => {
    expect(contrastText('#ffffff')).toBe('#000000');
    expect(contrastText('#14161b')).toBe('#ffffff');
    expect(contrastText('#2f6f5e')).toBe('#ffffff');
  });

  it('composites a translucent colour over an opaque one', () => {
    expect(alphaOver('#000000', '#ffffff', 0)).toBe('#ffffff');
    expect(alphaOver('#000000', '#ffffff', 1)).toBe('#000000');
    expect(alphaOver('#2f6f5e', '#ffffff', 0.5)).toBe(mixHex('#ffffff', '#2f6f5e', 0.5));
  });
});
