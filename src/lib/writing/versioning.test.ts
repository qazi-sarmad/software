import { describe, expect, it } from 'vitest';
import { compareReportVersions, compareRenders, type ReportVersionSnapshot } from './versioning';
import { fixtureClaims } from './fixtures';
import type { Claim } from './types';

function snapshot(id: string, claims: Claim[]): ReportVersionSnapshot {
  return { id, versions: { engine: '1.0.0', template: 'M1@1', phraseLibrary: '1.0.0' }, claims, graphRoot: 'a'.repeat(64), renderHash: 'b'.repeat(64) };
}

describe('W8.1 compare_report_versions', () => {
  it('reports an added claim and a removed claim', () => {
    const base = fixtureClaims();
    const extra: Claim = { ...base[0], id: 'c-extra' };
    const before = snapshot('v1', base);
    const after = snapshot('v2', [...base.slice(1), extra]);
    const cmp = compareReportVersions(before, after);
    expect(cmp.added.map((a) => a.claimId)).toContain('c-extra');
    expect(cmp.removed.map((r) => r.claimId)).toContain('c-scope');
  });

  it('reports a changed phrase version with the cause', () => {
    const base = fixtureClaims();
    const after = base.map((c) => c.id === 'c-scope' ? { ...c, phraseVersion: 2 } : c);
    const cmp = compareReportVersions(snapshot('v1', base), snapshot('v2', after));
    const change = cmp.changed.find((c) => c.claimId === 'c-scope')!;
    expect(change.cause).toBe('changed_phrase_version');
  });

  it('reports a changed record, a changed figure and an auditor edit', () => {
    const base = fixtureClaims();
    const after = base.map((c) => {
      if (c.id === 'c-scope') return { ...c, references: [{ ...c.references[0], contentHash: 'f'.repeat(64) }] };
      if (c.id === 'c-effect') return { ...c, figures: [{ figureId: 'fig.x', figureVersion: 1, parameters: {}, result: '999' }] as Claim['figures'] };
      if (c.kind === 'auditor') return { ...c, auditorText: 'Changed wording by the auditor.' };
      return c;
    });
    const cmp = compareReportVersions(snapshot('v1', base), snapshot('v2', after));
    expect(cmp.changed.find((c) => c.claimId === 'c-scope')?.cause).toBe('changed_record');
    expect(cmp.changedFigures.find((f) => f.claimId === 'c-effect')?.figureId).toBe('fig.x');
    const auditor = cmp.changed.find((c) => c.cause === 'auditor_edit');
    expect(auditor).toBeDefined();
  });
});

describe('W8.3 register and locale comparison', () => {
  it('places the same claims side by side in two renderings', () => {
    const left = [{ claimId: 'c1', text: 'We tested 40 payments.' }];
    const right = [{ claimId: 'c1', text: 'Forty payments were examined.' }];
    const rows = compareRenders('F1 active en-GB', left, 'F5 passive en-GB', right);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBe('We tested 40 payments.');
    expect(rows[0].right).toBe('Forty payments were examined.');
    expect(rows[0].leftLabel).toBe('F1 active en-GB');
  });
});
