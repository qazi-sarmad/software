import { describe, expect, it } from 'vitest';
import {
  describeBranch, PLATFORM_ESCALATION_KEYS, recommend, RECOMMENDATION_OPTIONS,
  type RecommendationBranch,
} from './escalation';

const TEMPLATE: RecommendationBranch[] = [
  { field: 'severity', equals: 'critical', recommend: 'Yes', reason: 'A critical-severity anomaly was raised.' },
  { field: 'severity', equals: 'high', recommend: 'Yes', reason: 'A high-severity anomaly was raised.' },
  { field: 'severity', equals: 'low', recommend: 'No', reason: 'A low-severity anomaly needs no escalation.' },
  { defaultRecommend: 'Needs review', defaultReason: 'An anomaly was raised; a person should review it.' },
];

describe('escalation recommendation (F12, L1)', () => {
  it('gives the recommendation of the first matching branch', () => {
    expect(recommend({ severity: 'critical' }, TEMPLATE)).toEqual({
      recommendation: 'Yes', reason: 'A critical-severity anomaly was raised.',
    });
  });

  it('matches case-insensitively', () => {
    expect(recommend({ severity: 'CRITICAL' }, TEMPLATE).recommendation).toBe('Yes');
  });

  it('falls through to the default when nothing matches', () => {
    expect(recommend({ severity: 'medium' }, TEMPLATE)).toEqual({
      recommendation: 'Needs review', reason: 'An anomaly was raised; a person should review it.',
    });
  });

  it('answers Needs review for a missing template rather than erroring', () => {
    expect(recommend({ severity: 'critical' }, []).recommendation).toBe('Needs review');
  });

  it('is deterministic: the same input always gives the same answer', () => {
    const a = recommend({ severity: 'high' }, TEMPLATE);
    const b = recommend({ severity: 'high' }, TEMPLATE);
    expect(a).toEqual(b);
  });

  it('supports a contains branch', () => {
    const t: RecommendationBranch[] = [
      { field: 'entity', contains: 'cash', recommend: 'Yes', reason: 'A cash entity is involved.' },
      { defaultRecommend: 'No', defaultReason: 'Nothing matched.' },
    ];
    expect(recommend({ entity: 'Petty cash' }, t).recommendation).toBe('Yes');
  });

  it('supports an explicit No recommendation', () => {
    expect(recommend({ severity: 'low' }, TEMPLATE).recommendation).toBe('No');
  });

  it('fills a reason from the field when the branch gives none', () => {
    const t: RecommendationBranch[] = [{ field: 'severity', equals: 'high', recommend: 'Yes' }];
    expect(recommend({ severity: 'high' }, t).reason).toContain('high');
  });

  it('normalises an unknown recommendation value to Needs review', () => {
    const t: RecommendationBranch[] = [{ field: 'severity', equals: 'high', recommend: 'Maybe' }];
    expect(recommend({ severity: 'high' }, t).recommendation).toBe('Needs review');
  });

  it('treats a missing field as an empty string, not a crash', () => {
    expect(recommend({}, TEMPLATE).recommendation).toBe('Needs review');
  });

  it('offers exactly the three recommendation options', () => {
    expect(RECOMMENDATION_OPTIONS).toEqual(['Yes', 'No', 'Needs review']);
  });

  it('describes a branch and a default in plain language', () => {
    expect(describeBranch({ field: 'severity', equals: 'high', recommend: 'Yes', reason: 'x' }))
      .toContain('severity is high');
    expect(describeBranch({ defaultRecommend: 'Needs review' })).toContain('Otherwise');
  });

  it('lists the three seeded platform escalation keys', () => {
    expect(PLATFORM_ESCALATION_KEYS).toHaveLength(3);
    expect(PLATFORM_ESCALATION_KEYS.every((k) => k.startsWith('platform.escalation.'))).toBe(true);
  });
});
