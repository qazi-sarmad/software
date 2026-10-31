import { describe, expect, it } from 'vitest';
import {
  hyperlinkError, isSafeUrl, referenceTargets, resolveReference,
  type CrossReferenceSpec, type HyperlinkSpec,
} from './links';

const link = (over: Partial<HyperlinkSpec> = {}): HyperlinkSpec => ({
  id: 'l1', label: 'Example', url: 'https://example.test/x', underline: true, ...over,
});

describe('hyperlinks', () => {
  it('accepts only http and https URLs', () => {
    expect(isSafeUrl('https://example.test')).toBe(true);
    expect(isSafeUrl('http://example.test/a?b=1')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
  });

  it('reports a precise problem for an unsafe or incomplete link', () => {
    expect(hyperlinkError(link())).toBeNull();
    expect(hyperlinkError(link({ label: '  ' }))).toMatch(/label/i);
    expect(hyperlinkError(link({ url: 'javascript:1' }))).toMatch(/http/i);
    expect(hyperlinkError(link({ label: 'x'.repeat(200) }))).toMatch(/characters/i);
  });
});

describe('cross-references', () => {
  const targets = referenceTargets(
    [{ key: 'scope', label: 'Scope', page: 3 }, { key: 'criteria', label: 'Criteria', page: 5 }],
    [{ key: 'fig-1', label: 'Coverage', page: 7 }],
  );

  it('numbers the targets in reading order', () => {
    expect(targets.map((t) => [t.key, t.ordinal, t.page])).toEqual([
      ['scope', 1, 3], ['criteria', 2, 5], ['fig-1', 1, 7],
    ]);
  });

  it('resolves a heading reference to the target section and page', () => {
    const ref: CrossReferenceSpec = { id: 'r1', kind: 'heading', targetKey: 'criteria', label: 'see' };
    const r = resolveReference(ref, targets);
    expect(r.text).toBe('see Criteria, page 5');
    expect(r.page).toBe(5);
  });

  it('resolves a figure reference to its ordinal and page', () => {
    const ref: CrossReferenceSpec = { id: 'r2', kind: 'figure', targetKey: 'fig-1', label: 'see' };
    expect(resolveReference(ref, targets).text).toBe('see Figure 1, page 7');
  });

  it('resolves a missing target to a defined not-found text, never a throw', () => {
    const ref: CrossReferenceSpec = { id: 'r3', kind: 'heading', targetKey: 'ghost', label: 'see' };
    const r = resolveReference(ref, targets);
    expect(r.text).toBe('see ghost (not found)');
    expect(r.page).toBeNull();
  });

  it('is deterministic', () => {
    const ref: CrossReferenceSpec = { id: 'r1', kind: 'table', targetKey: 'scope', label: 'see' };
    expect(resolveReference(ref, targets)).toEqual(resolveReference(ref, targets));
  });
});
