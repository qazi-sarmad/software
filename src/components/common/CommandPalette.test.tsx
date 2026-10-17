import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * R4: the command palette is a non-blocking dropdown (spec §27.5), not a modal. It must not render a
 * full-viewport scrim, must not carry modal semantics, and must dismiss on Escape and outside click.
 */
const SRC = readFileSync(resolve(process.cwd(), 'src/components/common/CommandPalette.tsx'), 'utf-8');

describe('CommandPalette is non-blocking (§27.5)', () => {
  it('renders no full-viewport scrim', () => {
    expect(SRC).not.toMatch(/fixed inset-0/);
    expect(SRC).not.toMatch(/aria-modal/);
  });

  it('carries no modal role', () => {
    expect(SRC).not.toMatch(/role\s*=\s*["']dialog["']/);
  });

  it('is anchored below the header, not centred as an overlay', () => {
    expect(SRC).toMatch(/fixed top-14/);
  });

  it('dismisses on Escape and on outside click', () => {
    expect(SRC).toMatch(/e\.key === 'Escape'/);
    expect(SRC).toMatch(/pointerdown/);
    expect(SRC).toMatch(/contains\(e\.target as Node\)/);
  });
});
