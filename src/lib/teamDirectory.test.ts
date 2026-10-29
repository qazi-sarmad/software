import { describe, expect, it } from 'vitest';
import {
  avatarInitials, generatedAvatar, workloadBand, profileWorkload, withinRange, availabilityOn,
  willTravelTo, recommendAssignee, summariseTeam, visibleProfileFields,
  type TeamProfile, type ResourcingRequirement,
} from './teamDirectory';

function profile(over: Partial<TeamProfile> = {}): TeamProfile {
  return {
    userId: 'u1', displayName: 'Ayesha Khan', roleSlug: 'senior', roleName: 'Senior Auditor',
    avatarUrl: null, capacityHours: 100,
    assignments: [{ engagementId: 'e1', engagementName: 'Treasury', from: '2026-11-01', to: '2026-11-30', hours: 40, role: 'lead' }],
    travel: { homeBase: 'Karachi', willingness: 'limited', preferredRegions: ['Karachi', 'Lahore'], blackoutDates: [] },
    trips: [], rights: ['perform_work', 'review_and_approve'],
    ...over,
  };
}

describe('team directory (people, workload, travel)', () => {
  it('derives initials and a stable generated avatar', () => {
    expect(avatarInitials('Ayesha Khan')).toBe('AK');
    expect(avatarInitials('Madonna')).toBe('MA');
    expect(avatarInitials('')).toBe('?');
    const a = generatedAvatar('Ayesha Khan');
    const b = generatedAvatar('Ayesha Khan');
    expect(a).toEqual(b);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
    expect(a.from).toMatch(/^hsl\(/);
  });

  it('bands workload and computes load from capacity', () => {
    expect(workloadBand(0.3)).toBe('light');
    expect(workloadBand(0.6)).toBe('balanced');
    expect(workloadBand(0.9)).toBe('heavy');
    expect(workloadBand(1.2)).toBe('overloaded');
    expect(profileWorkload({ assignments: [{ engagementId: 'e', engagementName: 'x', from: '', to: '', hours: 85, role: '' }], capacityHours: 100 }).band).toBe('heavy');
    // An unmeasured capacity reports 0 load, never a division by zero.
    expect(profileWorkload({ assignments: [], capacityHours: 0 }).loadPct).toBe(0);
  });

  it('reads availability from trips and blackouts', () => {
    const p = profile({
      trips: [{ engagementId: 'e2', location: 'Lahore', from: '2026-11-10', to: '2026-11-14' }],
      travel: { homeBase: 'Karachi', willingness: 'limited', preferredRegions: [], blackoutDates: ['2026-11-20'] },
    });
    expect(withinRange('2026-11-12', '2026-11-10', '2026-11-14')).toBe(true);
    expect(availabilityOn(p, '2026-11-12', 'Lahore')).toBe('on_site');
    expect(availabilityOn(p, '2026-11-12', 'Karachi')).toBe('travelling');
    expect(availabilityOn(p, '2026-11-20')).toBe('blackout');
    expect(availabilityOn(p, '2026-11-05')).toBe('available');
  });

  it('respects travel willingness and preferred regions', () => {
    const p = profile();
    expect(willTravelTo(p, 'Karachi')).toBe(true);
    expect(willTravelTo(p, 'Lahore')).toBe(true);
    expect(willTravelTo(p, 'Dubai')).toBe(false);
    const anywhere = profile({ travel: { homeBase: 'Karachi', willingness: 'full', preferredRegions: [], blackoutDates: [] } });
    expect(willTravelTo(anywhere, 'Dubai')).toBe(true);
    const none = profile({ travel: { homeBase: 'Karachi', willingness: 'none', preferredRegions: [], blackoutDates: [] } });
    expect(willTravelTo(none, 'Karachi')).toBe(false);
  });

  it('recommends the lightest fully-qualified person and excludes the unqualified', () => {
    const ayesha = profile({ userId: 'u1', displayName: 'Ayesha Khan', capacityHours: 100 });
    const bilal = profile({ userId: 'u2', displayName: 'Bilal Ahmed', capacityHours: 100, rights: ['perform_work'], assignments: [] });
    const req: ResourcingRequirement = { engagementId: 'e9', rights: ['review_and_approve'], travelLocation: null, from: '2026-12-01', to: '2026-12-05' };
    const recs = recommendAssignee([ayesha, bilal], req);
    // Bilal lacks review_and_approve, so he is excluded; Ayesha is recommended.
    expect(recs[0].userId).toBe('u1');
    expect(recs[0].verdict).toBe('recommended');
    expect(recs[1].verdict).toBe('excluded');
    expect(recs[1].reason).toContain('missing right');
  });

  it('marks a person who will not travel as excluded and one with a clash as possible', () => {
    const wont = profile({ userId: 'u1', travel: { homeBase: 'Karachi', willingness: 'none', preferredRegions: [], blackoutDates: [] } });
    const clash = profile({ userId: 'u2', displayName: 'Bilal Ahmed', capacityHours: 100,
      trips: [{ engagementId: 'x', location: 'Karachi', from: '2026-12-02', to: '2026-12-03' }], assignments: [] });
    const req: ResourcingRequirement = { engagementId: 'e9', rights: ['perform_work'], travelLocation: 'Karachi', from: '2026-12-01', to: '2026-12-05' };
    const recs = recommendAssignee([wont, clash], req);
    const byId = Object.fromEntries(recs.map((r) => [r.userId, r]));
    expect(byId.u1.verdict).toBe('excluded');
    expect(byId.u1.reason).toContain('will not travel');
    expect(byId.u2.verdict).toBe('possible');
    expect(byId.u2.conflicts).toBeGreaterThan(0);
  });

  it('summarises the team and hides travel from a caller who may not see it', () => {
    const t = [profile({ userId: 'u1', assignments: [] }), profile({ userId: 'u2', capacityHours: 10 })];
    const s = summariseTeam(t);
    expect(s.light + s.balanced + s.heavy + s.overloaded).toBe(2);
    expect(visibleProfileFields(t[0], 'u1', []).travelVisible).toBe(true);
    expect(visibleProfileFields(t[0], 'u2', []).travelVisible).toBe(false);
    expect(visibleProfileFields(t[0], 'u2', ['manage_team']).travelVisible).toBe(true);
  });
});
