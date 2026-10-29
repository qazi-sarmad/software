import { describe, expect, it } from 'vitest';
import { isFontLoaded, loadFont, loadFonts } from './loader';

describe('the font lazy loader (F2)', () => {
  it('loads a lazy family and reports it as loaded', async () => {
    expect(isFontLoaded('Lora')).toBe(false);
    expect(await loadFont('Lora')).toBe(true);
    expect(isFontLoaded('Lora')).toBe(true);
  });

  it('is idempotent: a second load is a cheap no-op', async () => {
    await loadFont('Merriweather');
    expect(await loadFont('Merriweather')).toBe(true);
  });

  it('treats a chrome family as already loaded (index.css imported it)', async () => {
    expect(await loadFont('Inter')).toBe(true);
    expect(isFontLoaded('Inter')).toBe(true);
  });

  it('returns false for a family outside the catalogue rather than throwing', async () => {
    expect(await loadFont('Comic Sans MS')).toBe(false);
  });

  it('loads a batch without failing when one family is unknown', async () => {
    await expect(loadFonts(['Playfair Display', 'Nope', 'Roboto Slab'])).resolves.toBeUndefined();
    expect(isFontLoaded('Playfair Display')).toBe(true);
    expect(isFontLoaded('Roboto Slab')).toBe(true);
  });
});
