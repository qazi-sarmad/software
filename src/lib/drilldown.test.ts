import { describe, expect, it } from 'vitest';
import {
  drillItems,
  drillHash,
  parseDrillHash,
  engagementsInProgress,
  openIssues,
  sealedWorkpapers,
  openCaps,
  type DrillSource,
} from './drilldown';
import type {
  AuditCapItem,
  AuditEngagement,
  AuditEntity,
  AuditIssue,
  AuditObservation,
  WorkingPaper,
} from '../types';

const entity = (id: string, department: string): AuditEntity => ({
  id,
  universeId: 'u1',
  name: `Entity ${id}`,
  code: id.toUpperCase(),
  department,
  headOfDepartment: 'Head',
  inherentRisk: 'high',
  residualRisk: 'medium',
  siraScore: 50,
  controlsCount: 4,
  lastAuditDate: '2026-01-01',
  status: 'active',
});

const engagement = (id: string, status: AuditEngagement['status']): AuditEngagement => ({
  id,
  universeId: 'u1',
  entityId: 'e1',
  title: `Engagement ${id}`,
  stage: 'testing',
  status,
  leadAuditorId: 'a1',
  reviewerId: 'r1',
  periodStart: '2026-01-01',
  periodEnd: '2026-06-30',
  dueDate: '2026-07-15',
  completionPercent: 40,
});

const issue = (id: string, status: AuditIssue['status'], department: string): AuditIssue => ({
  id,
  entityId: 'e1',
  universeId: 'u1',
  department,
  title: `Issue ${id}`,
  description: 'd',
  severity: 'high',
  status,
  ownerId: 'o1',
  identifiedDate: '2026-01-01',
  dueDate: '2026-02-01',
});

const workpaper = (id: string, sealed: boolean): WorkingPaper =>
  ({
    id,
    engagementId: 'g1',
    controlId: 'c1',
    entityId: 'e1',
    refCode: id.toUpperCase(),
    title: `WP ${id}`,
    status: sealed ? 'signed_off' : 'in_progress',
    preparerId: 'p1',
    reviewerId: 'r1',
    testSteps: [],
    populationCount: 10,
    sampleCount: 2,
    exceptionsIdentified: 0,
    conclusion: '',
    evidenceItems: [],
    sealed,
  }) as WorkingPaper;

const cap = (id: string, status: AuditCapItem['status'], department: string): AuditCapItem => ({
  id,
  action: 'a',
  title: `Cap ${id}`,
  owner: 'owner',
  department,
  severity: 'high',
  dueDate: '2026-02-01',
  status,
  identifiedDate: '2026-01-01',
  entityId: 'e1',
  engagementId: 'g1',
});

const observation = (id: string): AuditObservation => ({
  id,
  workpaperId: 'w1',
  entityId: 'e1',
  title: `Obs ${id}`,
  condition: 'c',
  criteria: 'cr',
  cause: 'ca',
  consequence: 'co',
  recommendation: 'r',
  severity: 'high',
  status: 'open',
  createdAt: '2026-01-01',
  raisedBy: 'u1',
});

const source: DrillSource = {
  entities: [entity('e1', 'Treasury'), entity('e2', 'Trading')],
  engagements: [engagement('g1', 'in_progress'), engagement('g2', 'signed_off')],
  issues: [issue('i1', 'open', 'Treasury'), issue('i2', 'closed', 'Treasury'), issue('i3', 'remediated', 'Trading')],
  workpapers: [workpaper('w1', true), workpaper('w2', false)],
  caps: [cap('c1', 'Open', 'Treasury'), cap('c2', 'Closed', 'Treasury'), cap('c3', 'Overdue', 'Trading')],
  observations: [observation('o1')],
  comments: [
    { id: 'cm1', workpaperId: 'w1', authorId: 'u1', authorName: 'A', authorRole: 'reviewer', text: 'check this', createdAt: '2026-01-01', resolved: false },
    { id: 'cm2', workpaperId: 'w1', authorId: 'u1', authorName: 'A', authorRole: 'reviewer', text: 'done', createdAt: '2026-01-02', resolved: true },
  ],
};

describe('drilldown predicates (E5/U1)', () => {
  it('counts exactly the rows the drilldown lists', () => {
    // The number and the drilldown call the same predicate, so they cannot disagree.
    expect(engagementsInProgress(source.engagements)).toHaveLength(1);
    expect(drillItems('engagements', { ...source, engagements: engagementsInProgress(source.engagements) })).toHaveLength(1);

    expect(openIssues(source.issues)).toHaveLength(1);
    expect(drillItems('issues', { ...source, issues: openIssues(source.issues) })).toHaveLength(1);

    expect(sealedWorkpapers(source.workpapers)).toHaveLength(1);
    expect(openCaps(source.caps)).toHaveLength(2);
  });

  it('maps each family to items with an id and a title', () => {
    for (const kind of ['entities', 'engagements', 'issues', 'workpapers', 'caps', 'observations'] as const) {
      const items = drillItems(kind, source);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.id).toBeTruthy();
        expect(item.title).toBeTruthy();
      }
    }
  });

  it('narrows CAPs and issues by department when the target names one', () => {
    expect(drillItems('caps', source, 'Treasury').map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(drillItems('caps', source, 'Trading').map((c) => c.id)).toEqual(['c3']);
    expect(drillItems('issues', source, 'Treasury').map((i) => i.id)).toEqual(['i1', 'i2']);
  });
});

describe('drilldown deep link (E5)', () => {
  it('round-trips a kind through the hash', () => {
    expect(drillHash({ kind: 'engagements', label: '', filterSummary: '' })).toBe('#drill=engagements');
    expect(parseDrillHash('#drill=engagements')?.kind).toBe('engagements');
  });

  it('ignores a hash that is not a known drilldown', () => {
    expect(parseDrillHash('#drill=whatever')).toBeNull();
    expect(parseDrillHash('#other')).toBeNull();
    expect(parseDrillHash('')).toBeNull();
  });

  it('never puts a tenant id in the hash', () => {
    // The hash carries only the family name; ids re-resolve against the session's scoped rows.
    const hash = drillHash({ kind: 'caps', label: 'Treasury CAPs', filterSummary: 'x' });
    expect(hash).not.toMatch(/[0-9a-f]{8}-/);
    expect(hash).toBe('#drill=caps');
  });
});
