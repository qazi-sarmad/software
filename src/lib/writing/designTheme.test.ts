import { describe, expect, it } from 'vitest';
import { deriveTheme, defaultThemeInput, shapePalette, type ResolvedBranding } from './designTheme';
import { contrastRatio } from './colourMath';

const branding: ResolvedBranding = {
  primary: '#2f6f5e', accent: '#c9a227', text: '#14161b', background: '#ffffff',
};

describe('deriveTheme', () => {
  it('derives every colour from the four brand colours, deterministically', () => {
    const a = deriveTheme(defaultThemeInput(), branding);
    const b = deriveTheme(defaultThemeInput(), branding);
    expect(a).toEqual(b);
    expect(a.primary).toBe('#2f6f5e');
    expect(a.background).toBe('#ffffff');
    // Derived, not copied: heading, rule, link and surfaces differ from the four inputs.
    expect(a.rule).not.toBe(branding.primary);
    expect(a.link).not.toBe(branding.accent);
    expect(a.surface).not.toBe(branding.background);
  });

  it('every derived colour is a #rrggbb value', () => {
    const t = deriveTheme(defaultThemeInput(), branding);
    for (const [k, v] of Object.entries(t)) {
      if (typeof v !== 'string' || k === 'tableStyle') continue;
      expect(v, k).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('darkens a too-pale brand colour until the heading is readable on the page', () => {
    const pale = deriveTheme(defaultThemeInput(), { ...branding, primary: '#fffff0' });
    expect(contrastRatio(pale.heading, pale.background)).toBeGreaterThanOrEqual(3);
  });

  it('keeps a readable brand colour unchanged', () => {
    const t = deriveTheme(defaultThemeInput(), branding);
    expect(t.heading).toBe(branding.primary);
  });

  it('derives a link distinct from the body text and the accent', () => {
    const t = deriveTheme(defaultThemeInput(), branding);
    expect(t.link).not.toBe(t.body);
    expect(contrastRatio(t.link, t.background)).toBeGreaterThan(3);
  });

  it('gives every shape palette entry a name and a colour', () => {
    const t = deriveTheme(defaultThemeInput(), branding);
    const p = shapePalette(t);
    expect(p.map((s) => s.name)).toEqual(['brand', 'accent', 'surface', 'callout', 'none']);
    expect(p.every((s) => typeof s.fill === 'string' && typeof s.stroke === 'string')).toBe(true);
  });
});
