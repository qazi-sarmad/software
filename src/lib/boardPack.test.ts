import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTIONS,
  capBandLabel,
  collectFigures,
  deltaAgainst,
  excludedNote,
  figureDrillDownUrl,
  figuresWithoutRefs,
  sectionVisible,
  visibleSections,
  type BoardPackSnapshot,
  type BoardPackSection,
} from './boardPack';

const ref = (type: string, id: string) => ({ type, id });

const snap = (): BoardPackSnapshot => ({
  scope_key: 'org',
  sira: {
    bands: [
      { value: 2, refs: [ref('sira_score', 's1'), ref('sira_score', 's2')], band: 'High' },
      { value: 0, refs: [], band: 'Low' },
    ],
  },
  plan: {
    value: 3,
    refs: [ref('plan_item', 'p1'), ref('plan_item', 'p2'), ref('plan_item', 'p3')],
    by_status: [
      { value: 2, refs: [ref('plan_item', 'p1'), ref('plan_item', 'p2')], status: 'approved' },
      { value: 1, refs: [ref('plan_item', 'p3')], status: 'proposed' },
    ],
  },
  cap: {
    '0-30': { value: 1, refs: [ref('cap', 'c1')] },
    '31-60': { value: 2, refs: [ref('cap', 'c2'), ref('cap', 'c3')] },
    '90+': { value: 0, refs: [] },
  },
  sealed_work: {
    value: 4,
    refs: [ref('workpaper', 'w1')],
    sealed_engagements: { value: 1, refs: [ref('engagement', 'e1')] },
    root_hashes: [{ engagement_id: 'e1', row_hash: 'abc' }],
  },
  management_responses: { value: 1, refs: [ref('report_block', 'b1')] },
  excluded: { unsealed_workpapers: 2, unsealed_engagements: 1 },
});

describe('collectFigures', () => {
  it('returns one row per figure, with a stable path', () => {
    const rows = collectFigures(snap());
    const paths = rows.map((r) => r.path);
    expect(paths).toContain('sira.bands[0]');
    expect(paths).toContain('sira.bands[1]');
    expect(paths).toContain('plan');
    expect(paths).toContain('plan.by_status[0]');
    expect(paths).toContain('cap.31-60');
    expect(paths).toContain('sealed_work');
    expect(paths).toContain('sealed_work.sealed_engagements');
    expect(paths).toContain('management_responses');
  });

  it('carries the refs through', () => {
    const rows = collectFigures(snap());
    const cap = rows.find((r) => r.path === 'cap.31-60');
    expect(cap?.value).toBe(2);
    expect(cap?.refs.map((r) => r.id)).toEqual(['c2', 'c3']);
  });

  it('is deterministic: the same snapshot yields the same rows in the same order', () => {
    expect(collectFigures(snap())).toEqual(collectFigures(snap()));
  });

  it('is empty for a missing snapshot', () => {
    expect(collectFigures(null)).toEqual([]);
    expect(collectFigures(undefined)).toEqual([]);
  });
});

describe('figuresWithoutRefs', () => {
  it('passes a snapshot where every non-zero figure has a ref', () => {
    expect(figuresWithoutRefs(snap())).toEqual([]);
  });

  it('names a non-zero figure with no refs', () => {
    const bad: BoardPackSnapshot = { cap: { '0-30': { value: 5, refs: [] } } };
    expect(figuresWithoutRefs(bad)).toEqual(['cap.0-30']);
  });

  it('allows a zero figure to carry no refs', () => {
    const zero: BoardPackSnapshot = { cap: { '90+': { value: 0, refs: [] } } };
    expect(figuresWithoutRefs(zero)).toEqual([]);
  });
});

describe('deltaAgainst', () => {
  it('reports added, changed and removed figures', () => {
    const before: BoardPackSnapshot = { cap: { '0-30': { value: 1, refs: [ref('cap', 'a')] } } };
    const after: BoardPackSnapshot = {
      cap: { '0-30': { value: 3, refs: [ref('cap', 'a')] }, '31-60': { value: 1, refs: [ref('cap', 'b')] } },
    };
    const d = deltaAgainst(before, after);
    expect(d.changed).toEqual([{ path: 'cap.0-30', label: 'CAP aging: 0 to 30 days overdue', from: 1, to: 3 }]);
    expect(d.added.map((r) => r.path)).toEqual(['cap.31-60']);
    expect(d.removed).toEqual([]);
  });

  it('reports a removed figure', () => {
    const before: BoardPackSnapshot = { cap: { '0-30': { value: 1, refs: [ref('cap', 'a')] } } };
    const d = deltaAgainst(before, { cap: {} });
    expect(d.removed.map((r) => r.path)).toEqual(['cap.0-30']);
    expect(d.added).toEqual([]);
  });

  it('is empty when the two snapshots are equal', () => {
    const d = deltaAgainst(snap(), snap());
    expect(d).toEqual({ added: [], changed: [], removed: [] });
  });

  it('treats a missing previous pack as all-added', () => {
    const d = deltaAgainst(null, snap());
    expect(d.added.length).toBeGreaterThan(0);
    expect(d.changed).toEqual([]);
  });
});

describe('figureDrillDownUrl', () => {
  it('builds the /view/:type/:id route from the org app_base_url', () => {
    expect(figureDrillDownUrl('https://provio.example', ref('cap', 'c1')))
      .toBe('https://provio.example/view/cap/c1');
  });

  it('does not double a trailing slash', () => {
    expect(figureDrillDownUrl('https://provio.example/', ref('cap', 'c1')))
      .toBe('https://provio.example/view/cap/c1');
  });

  it('encodes a value that needs it', () => {
    expect(figureDrillDownUrl('https://x', ref('cap', 'a b')))
      .toBe('https://x/view/cap/a%20b');
  });
});

describe('capBandLabel', () => {
  it('names every band F10 lists', () => {
    expect(capBandLabel('0-30')).toBe('0 to 30 days overdue');
    expect(capBandLabel('31-60')).toBe('31 to 60 days overdue');
    expect(capBandLabel('61-90')).toBe('61 to 90 days overdue');
    expect(capBandLabel('90+')).toBe('More than 90 days overdue');
  });

  it('falls back to the raw key for an unknown band', () => {
    expect(capBandLabel('mystery')).toBe('mystery');
  });
});

describe('sections', () => {
  const sections: BoardPackSection[] = [
    { sectionKey: 'cover', label: 'Cover', ordinal: 2, enabled: true, visibleRoles: [] },
    { sectionKey: 'sira', label: 'SIRA', ordinal: 1, enabled: true, visibleRoles: ['cia'] },
    { sectionKey: 'issues', label: 'Issues', ordinal: 3, enabled: false, visibleRoles: [] },
  ];

  it('offers the eight F10 sections in order', () => {
    expect(DEFAULT_SECTIONS.map((s) => s.sectionKey)).toEqual([
      'cover', 'changes', 'sira', 'plan', 'issues', 'sealed', 'management_responses', 'sources',
    ]);
    expect(DEFAULT_SECTIONS.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('hides a disabled section', () => {
    expect(sectionVisible(sections[2], ['cia'])).toBe(false);
  });

  it('shows a section with no role restriction to anyone', () => {
    expect(sectionVisible(sections[0], [])).toBe(true);
  });

  it('restricts a section to the listed roles', () => {
    expect(sectionVisible(sections[1], ['cia'])).toBe(true);
    expect(sectionVisible(sections[1], ['preparer'])).toBe(false);
  });

  it('returns the visible sections in ordinal order', () => {
    expect(visibleSections(sections, ['cia']).map((s) => s.sectionKey)).toEqual(['sira', 'cover']);
    expect(visibleSections(sections, ['preparer']).map((s) => s.sectionKey)).toEqual(['cover']);
  });
});

describe('excludedNote', () => {
  it('states what is not included', () => {
    expect(excludedNote(snap())).toBe('2 workpapers and 1 engagement not yet sealed are not included.');
  });

  it('says so when nothing is excluded', () => {
    expect(excludedNote({ excluded: { unsealed_workpapers: 0, unsealed_engagements: 0 } }))
      .toBe('Nothing is excluded: every item is sealed.');
  });

  it('uses the singular for one item', () => {
    expect(excludedNote({ excluded: { unsealed_workpapers: 1, unsealed_engagements: 0 } }))
      .toBe('1 workpaper not yet sealed are not included.');
  });

  it('handles a missing excluded block', () => {
    expect(excludedNote({})).toBe('Nothing is excluded: every item is sealed.');
  });
});
