/**
 * Deterministic colour arithmetic for the report designer (WP-D).
 *
 * The designer derives every shade from the organisation's own theme colours, so a client's branding
 * decides the tints, the borders and the table shades mathematically instead of a designer typing a
 * hex value per element. Pure: no clock, no randomness, no DOM. Every function is total and returns
 * an `#rrggbb` string, so an unparseable input yields a defined colour rather than a throw.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** Mid grey, the defined fallback for a value that is not a hex colour. */
const FALLBACK: Rgb = { r: 136, g: 136, b: 136 };

export function isHex(value: string): boolean {
  return HEX3.test((value || '').trim()) || HEX6.test((value || '').trim());
}

/** Parse `#rgb` or `#rrggbb` to components. Anything else parses to the defined mid grey. */
export function parseHex(value: string): Rgb {
  const v = (value || '').trim();
  const six = HEX6.exec(v);
  if (six) {
    return { r: parseInt(six[1], 16), g: parseInt(six[2], 16), b: parseInt(six[3], 16) };
  }
  const three = HEX3.exec(v);
  if (three) {
    return {
      r: parseInt(three[1] + three[1], 16),
      g: parseInt(three[2] + three[2], 16),
      b: parseInt(three[3] + three[3], 16),
    };
  }
  return { ...FALLBACK };
}

const byte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Format components as a lowercase `#rrggbb`. */
export function toHex(c: Rgb): string {
  const h = (n: number) => byte(n).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Linear interpolation between two colours in sRGB space. `t = 0` is `a`, `t = 1` is `b`, and `t` is
 * clamped, so an out-of-range fraction can never produce an undefined colour. The same inputs always
 * produce the same output.
 */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = clamp01(t);
  return toHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

/** Mix a colour toward white by `amount` (0 keeps it, 1 makes it white). */
export function lighten(value: string, amount: number): string {
  return mixHex(value, '#ffffff', amount);
}

/** Mix a colour toward black by `amount` (0 keeps it, 1 makes it black). */
export function darken(value: string, amount: number): string {
  return mixHex(value, '#000000', amount);
}

/** A tint is a lighten; named separately because the design language calls the pale shades tints. */
export function tint(value: string, amount: number): string {
  return lighten(value, amount);
}

/** The WCAG relative luminance of a colour, in [0, 1]. Pure and deterministic. */
export function relativeLuminance(value: string): number {
  const c = parseHex(value);
  const chan = (n: number) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
}

/** The WCAG contrast ratio between two colours, in [1, 21]. Pure. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The text colour to print on a coloured fill: black on a light fill, white on a dark fill. The
 * threshold is the WCAG crossover, so a header row always carries readable text whatever the
 * client's brand colour.
 */
export function contrastText(fill: string): '#000000' | '#ffffff' {
  return relativeLuminance(fill) > 0.179 ? '#000000' : '#ffffff';
}

/**
 * Composite a translucent colour over an opaque one. `alpha` is clamped to [0, 1]. Used to derive a
 * pale shade of a brand colour without hard-coding a second hex value.
 */
export function alphaOver(foreground: string, background: string, alpha: number): string {
  return mixHex(background, foreground, alpha);
}
