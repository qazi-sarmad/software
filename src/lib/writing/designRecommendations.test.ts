import { describe, expect, it } from 'vitest';
import {
  recommendDesign, summariseRecommendations, designQualityScore, charactersPerLine,
  type DesignRecommendationInput,
} from './designRecommendations';
import { deriveTheme, defaultThemeInput } from './designTheme';

const branding = { primary: '#2f6f5e', accent: '#c9a227', text: '#14161b', background: '#ffffff' };
const theme = deriveTheme(defaultThemeInput(), branding);

function base(over: Partial<DesignRecommendationInput['layout']> = {}): DesignRecommendationInput {
  return {
    purpose: 'audit_report',
    theme,
    layout: {
      pageSize: 'A4',
      marginTopMm: 20, marginRightMm: 20, marginBottomMm: 20, marginLeftMm: 20,
      fontSizePt: 11, lineHeightPct: 140, headingScalePct: 160,
      columns: 1, columnGapMm: 6,
      grid: { sizeMm: 5 },
      chrome: { headerEnabled: true, headerLeft: '{engagement}', headerCentre: '', headerRight: '{classification}', footerEnabled: true, footerLeft: '{org}', footerCentre: '', footerRight: 'Page {page} of {pages}', rule: true, onFirstPage: false, pageNumber: 'page-n-of-total' },
      numberedHeadings: true,
      shapes: [],
      ...over,
    },
  };
}

describe('design recommendations (canvas smart suggestions)', () => {
  it('returns nothing for a layout that satisfies every rule', () => {
    expect(recommendDesign(base())).toEqual([]);
    expect(designQualityScore([])).toBe(100);
  });

  it('flags a defect when body text fails the 4.5:1 contrast floor', () => {
    const pale = deriveTheme({ ...defaultThemeInput(), colourText: '#cccccc' }, { ...branding, text: '#cccccc' });
    const recs = recommendDesign({ ...base(), theme: pale });
    const defect = recs.find((r) => r.id === 'colour.body_contrast');
    expect(defect?.severity).toBe('defect');
    expect(defect?.apply.colourText).toBeTruthy();
  });

  it('ranks defects before warnings before advice', () => {
    const recs = recommendDesign(base({ fontSizePt: 8, lineHeightPct: 110, numberedHeadings: false }));
    const sev = recs.map((r) => r.severity);
    const firstAdvice = sev.indexOf('advice');
    const lastWarning = sev.lastIndexOf('warning');
    expect(lastWarning).toBeLessThan(firstAdvice);
  });

  it('recommends two columns when the line runs past ~90 characters', () => {
    const recs = recommendDesign(base({ fontSizePt: 10 }));
    const long = recs.find((r) => r.id === 'type.line_too_long');
    // At 10pt on A4 with 20mm margins the line is over 90 characters, so two columns are suggested.
    expect(long?.apply.columns).toBe(2);
    expect(charactersPerLine(base({ fontSizePt: 10 }))).toBeGreaterThan(90);
  });

  it('turns on a running header/footer with real templates, not empty strings', () => {
    const recs = recommendDesign(base({ chrome: { ...base().layout.chrome, headerEnabled: false, footerEnabled: false, pageNumber: 'none' } }));
    const head = recs.find((r) => r.id === 'page.no_running_head');
    const chrome = head?.apply.chrome as Record<string, unknown>;
    expect(chrome.headerEnabled).toBe(true);
    expect(chrome.headerLeft).toBe('{engagement}');
    expect(chrome.footerRight).toContain('{page}');
  });

  it('scales the quality score down by severity and floors at 0', () => {
    const recs = recommendDesign(base({ fontSizePt: 8, lineHeightPct: 100, headingScalePct: 100, columns: 1 }));
    const s = summariseRecommendations(recs);
    expect(s.total).toBe(recs.length);
    expect(designQualityScore(recs)).toBeLessThan(100);
    const many = recommendDesign(base({ fontSizePt: 8, lineHeightPct: 100, headingScalePct: 100, marginLeftMm: 5, grid: { sizeMm: 20 }, numberedHeadings: false, chrome: { ...base().layout.chrome, headerEnabled: false, footerEnabled: false, pageNumber: 'none' } }));
    expect(designQualityScore(many)).toBeGreaterThanOrEqual(0);
  });

  it('gives the same list for the same input (deterministic)', () => {
    const a = recommendDesign(base({ fontSizePt: 9 }));
    const b = recommendDesign(base({ fontSizePt: 9 }));
    expect(a).toEqual(b);
  });
});
