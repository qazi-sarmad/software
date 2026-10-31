import { describe, expect, it } from 'vitest';
import { TABLE_STYLE_NAMES, allTableStyles, isTableStyleName, resolveTableStyle, tableStyle, type TableTheme } from './tableStyles';
import { contrastRatio } from './colourMath';

const theme: TableTheme = {
  primary: '#2f6f5e', accent: '#c9a227', text: '#14161b', background: '#ffffff',
  tableBorder: '#5f6573', tableRowAlternate: '#eef3f1',
};

describe('table styles', () => {
  it('offers the six named styles, each with a label and a description', () => {
    const all = allTableStyles(theme);
    expect(all.map((s) => s.name)).toEqual([...TABLE_STYLE_NAMES]);
    expect(all.every((s) => s.label.length > 0 && s.description.length > 0)).toBe(true);
  });

  it('derives every style from the theme, deterministically', () => {
    for (const name of TABLE_STYLE_NAMES) {
      expect(tableStyle(name, theme)).toEqual(tableStyle(name, theme));
    }
  });

  it('prints readable header text on every style', () => {
    for (const name of TABLE_STYLE_NAMES) {
      const s = tableStyle(name, theme);
      expect(contrastRatio(s.headerText, s.headerBackground), name).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives each style its own distinguishing treatment', () => {
    expect(tableStyle('zebra', theme).rowAlternate).not.toBeNull();
    expect(tableStyle('plain', theme).rowAlternate).toBeNull();
    expect(tableStyle('brand', theme).headerBackground).toBe(theme.primary);
    expect(tableStyle('bold', theme).borderPt).toBeGreaterThan(tableStyle('boxed', theme).borderPt);
    expect(tableStyle('muted', theme).borderPt).toBe(0);
  });

  it('resolves a per-table choice, falling back to the format default', () => {
    const choices = [{ key: 'scope', style: 'zebra' as const }];
    expect(resolveTableStyle(theme, choices, 'scope', 'plain').name).toBe('zebra');
    expect(resolveTableStyle(theme, choices, 'other', 'boxed').name).toBe('boxed');
  });

  it('recognises style names only', () => {
    expect(isTableStyleName('zebra')).toBe(true);
    expect(isTableStyleName('striped')).toBe(false);
    expect(isTableStyleName(7)).toBe(false);
  });
});
