import { describe, expect, it } from 'vitest';
import {
  AuditControl,
  AuditEngagement,
  AuditEntity,
  AuditIssue,
  AuditObservation,
  AuditUniverse,
  ReviewComment,
  User,
  WorkingPaper,
} from '../types';
import {
  canAccessEntity,
  canAccessUniverse,
  canPerformAction,
  filterComments,
  filterControls,
  filterEngagements,
  filterEntities,
  filterIssues,
  filterObservations,
  filterUniverses,
  filterWorkpapers,
} from './access';

describe('Task A: Scoped Visibility and Rights & Responsibilities', () => {
  // Fixtures: 2 Universes x 3 Entities total (2 in U1, 1 in U2)
  const universes: AuditUniverse[] = [
    {
      id: 'u-1',
      name: 'Global Banking & Markets',
      code: 'GBM',
      description: 'Capital markets, custody, and treasury',
      totalEntities: 2,
      highRiskCount: 1,
      lastReviewDate: '2026-08-15',
    },
    {
      id: 'u-2',
      name: 'Retail & Consumer Banking',
      code: 'RCB',
      description: 'Consumer loans, cards, branch network',
      totalEntities: 1,
      highRiskCount: 1,
      lastReviewDate: '2026-08-20',
    },
  ];

  const entities: AuditEntity[] = [
    {
      id: 'ent-a',
      universeId: 'u-1',
      name: 'Treasury & Liquidity Operations',
      code: 'GBM-TREAS',
      department: 'Treasury',
      headOfDepartment: 'David Miller',
      inherentRisk: 'high',
      residualRisk: 'medium',
      siraScore: 78,
      controlsCount: 12,
      lastAuditDate: '2026-06-12',
      status: 'active',
    },
    {
      id: 'ent-b',
      universeId: 'u-1',
      name: 'FX & Derivatives Trading',
      code: 'GBM-FX',
      department: 'Markets',
      headOfDepartment: 'Elena Rostova',
      inherentRisk: 'high',
      residualRisk: 'high',
      siraScore: 88,
      controlsCount: 15,
      lastAuditDate: '2026-07-01',
      status: 'in_review',
    },
    {
      id: 'ent-c',
      universeId: 'u-2',
      name: 'Consumer Mortgages & Origination',
      code: 'RCB-MTG',
      department: 'Lending',
      headOfDepartment: 'Sarah Jenkins',
      inherentRisk: 'medium',
      residualRisk: 'low',
      siraScore: 54,
      controlsCount: 8,
      lastAuditDate: '2026-05-18',
      status: 'active',
    },
  ];

  const engagements: AuditEngagement[] = [
    {
      id: 'eng-1',
      universeId: 'u-1',
      entityId: 'ent-a',
      title: 'Q3 Liquidity Coverage Audit',
      stage: 'fieldwork',
      status: 'in_progress',
      leadAuditorId: 'usr-prep-1',
      reviewerId: 'usr-rev-1',
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
      dueDate: '2026-10-15',
      completionPercent: 65,
    },
    {
      id: 'eng-2',
      universeId: 'u-1',
      entityId: 'ent-b',
      title: 'Q3 Derivative Settlement Integrity',
      stage: 'fieldwork',
      status: 'in_progress',
      leadAuditorId: 'usr-prep-2',
      reviewerId: 'usr-rev-1',
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
      dueDate: '2026-10-20',
      completionPercent: 40,
    },
    {
      id: 'eng-3',
      universeId: 'u-2',
      entityId: 'ent-c',
      title: 'Mortgage Escrow Testing',
      stage: 'reporting',
      status: 'draft',
      leadAuditorId: 'usr-prep-3',
      reviewerId: 'usr-rev-2',
      periodStart: '2026-06-01',
      periodEnd: '2026-08-31',
      dueDate: '2026-09-30',
      completionPercent: 90,
    },
  ];

  const controls: AuditControl[] = [
    {
      id: 'ctrl-1',
      entityId: 'ent-a',
      engagementId: 'eng-1',
      code: 'CTRL-LQ-01',
      title: 'Daily Basel III LCR Reconciliation',
      description: 'Daily cash and HQLA buffer reconciliation',
      controlType: 'preventive',
      frequency: 'daily',
      ownerId: 'own-1',
      effectiveness: 'effective',
      sampleSize: 25,
      exceptionsCount: 0,
    },
    {
      id: 'ctrl-2',
      entityId: 'ent-b',
      engagementId: 'eng-2',
      code: 'CTRL-FX-04',
      title: 'ISDA Master Agreement Collateral Calls',
      description: 'Variation margin calls confirmation',
      controlType: 'detective',
      frequency: 'daily',
      ownerId: 'own-2',
      effectiveness: 'needs_improvement',
      sampleSize: 30,
      exceptionsCount: 3,
    },
    {
      id: 'ctrl-3',
      entityId: 'ent-c',
      engagementId: 'eng-3',
      code: 'CTRL-MTG-02',
      title: 'Annual Escrow Account Rebalance',
      description: 'Review of escrow accounts balance',
      controlType: 'detective',
      frequency: 'annual',
      ownerId: 'own-3',
      effectiveness: 'effective',
      sampleSize: 45,
      exceptionsCount: 1,
    },
  ];

  const workpapers: WorkingPaper[] = [
    {
      id: 'wp-1',
      engagementId: 'eng-1',
      controlId: 'ctrl-1',
      entityId: 'ent-a',
      universeId: 'u-1',
      refCode: 'WP-LQ-01',
      title: 'Testing of Daily LCR Buffer Verification',
      status: 'completed',
      preparerId: 'usr-prep-1',
      reviewerId: 'usr-rev-1',
      objective: 'Verify HQLA compliance',
      scope: 'Months of July and August 2026',
      methodology: 'Attribute sampling',
      testSteps: [],
      populationCount: 62,
      sampleCount: 25,
      exceptionsIdentified: 0,
      conclusion: 'Effective operational design',
      sealed: false,
      evidenceItems: [],
    },
    {
      id: 'wp-2',
      engagementId: 'eng-2',
      controlId: 'ctrl-2',
      entityId: 'ent-b',
      universeId: 'u-1',
      refCode: 'WP-FX-04',
      title: 'Margin Call Disputes Analysis',
      status: 'in_progress',
      preparerId: 'usr-prep-2',
      reviewerId: 'usr-rev-1',
      objective: 'Identify uncollateralized exposure',
      scope: 'Active portfolio as of Q3',
      methodology: 'Full population scan',
      testSteps: [],
      populationCount: 180,
      sampleCount: 30,
      exceptionsIdentified: 3,
      conclusion: 'Control gaps noted in timing',
      sealed: false,
      evidenceItems: [],
    },
  ];

  const observations: AuditObservation[] = [
    {
      id: 'obs-1',
      workpaperId: 'wp-1',
      controlId: 'ctrl-1',
      entityId: 'ent-a',
      universeId: 'u-1',
      title: 'Automated Feed Stale Timestamp',
      condition: 'Feed timestamp delayed by 45 minutes on 2 dates',
      criteria: 'Real-time feed required by Liquidity Policy § 4.2',
      cause: 'Batch scheduler queue congestion',
      consequence: 'Temporary delayed visibility into HQLA status',
      recommendation: 'Priority queue for Treasury data pipe',
      severity: 'medium',
      status: 'open',
      createdAt: '2026-08-10',
      raisedBy: 'usr-prep-1',
    },
    {
      id: 'obs-2',
      workpaperId: 'wp-2',
      controlId: 'ctrl-2',
      entityId: 'ent-b',
      universeId: 'u-1',
      title: 'Unreconciled Variation Margin Discrepancy',
      condition: '$1.4M collateral variance unconfirmed for 4 business days',
      criteria: 'T+1 dispute resolution under Dodd-Frank / EMIR',
      cause: 'Counterparty system migration',
      consequence: 'Potential regulatory notification trigger',
      recommendation: 'Escalate to Chief Risk Officer',
      severity: 'high',
      status: 'open',
      createdAt: '2026-08-14',
      raisedBy: 'usr-prep-2',
    },
  ];

  const issues: AuditIssue[] = [
    {
      id: 'iss-1',
      observationId: 'obs-1',
      entityId: 'ent-a',
      universeId: 'u-1',
      department: 'Treasury',
      title: 'LCR Stale Feed Batch Queuing',
      description: 'Improve scheduler thread priority for Treasury data ingest',
      severity: 'medium',
      status: 'identified',
      ownerId: 'own-1',
      identifiedDate: '2026-08-10',
      dueDate: '2026-10-31',
    },
    {
      id: 'iss-2',
      observationId: 'obs-2',
      entityId: 'ent-b',
      universeId: 'u-1',
      department: 'Markets',
      title: 'Collateral Dispute Escalation Protocol Failure',
      description: 'Enforce automatic paging for disputes exceeding $1M past T+1',
      severity: 'high',
      status: 'identified',
      ownerId: 'own-2',
      identifiedDate: '2026-08-14',
      dueDate: '2026-10-01',
    },
  ];

  const comments: ReviewComment[] = [
    {
      id: 'cmt-1',
      workpaperId: 'wp-1',
      authorId: 'usr-rev-1',
      authorName: 'Marcus Vance',
      authorRole: 'reviewer',
      text: 'Please ensure July 14th tickmark is corroborated by Swift MT535 statement.',
      createdAt: '2026-08-11T10:00:00Z',
      status: 'open',
    },
    {
      id: 'cmt-2',
      workpaperId: 'wp-2',
      authorId: 'usr-rev-1',
      authorName: 'Marcus Vance',
      authorRole: 'reviewer',
      text: 'Has legal counsel confirmed the counterparty dispute letter?',
      createdAt: '2026-08-15T14:30:00Z',
      status: 'open',
    },
  ];

  it('User tagged to Universe 1 / Entity A sees exactly that and nothing from Universe 2 or Entity B', () => {
    const userScopedToEntA: User = {
      id: 'usr-prep-1',
      name: 'Auditor Alpha',
      email: 'alpha@provio.internal',
      avatar: '',
      role: 'preparer',
      universeIds: ['u-1'],
      entityIds: ['ent-a'],
      department: 'Treasury',
    };

    // Scoped Universes
    const visibleUniverses = filterUniverses(universes, userScopedToEntA);
    expect(visibleUniverses).toHaveLength(1);
    expect(visibleUniverses[0].id).toBe('u-1');

    // Scoped Entities
    const visibleEntities = filterEntities(entities, userScopedToEntA);
    expect(visibleEntities).toHaveLength(1);
    expect(visibleEntities[0].id).toBe('ent-a');
    expect(visibleEntities.map((e) => e.id)).not.toContain('ent-b');
    expect(visibleEntities.map((e) => e.id)).not.toContain('ent-c');

    const allowedEntityIds = new Set(visibleEntities.map((e) => e.id));

    // Scoped Engagements
    const visibleEngagements = filterEngagements(engagements, userScopedToEntA, allowedEntityIds);
    expect(visibleEngagements).toHaveLength(1);
    expect(visibleEngagements[0].id).toBe('eng-1');
    expect(visibleEngagements[0].entityId).toBe('ent-a');

    // Scoped Controls
    const visibleControls = filterControls(controls, userScopedToEntA, allowedEntityIds);
    expect(visibleControls).toHaveLength(1);
    expect(visibleControls[0].id).toBe('ctrl-1');

    // Scoped Workpapers
    const visibleWorkpapers = filterWorkpapers(workpapers, userScopedToEntA, allowedEntityIds);
    expect(visibleWorkpapers).toHaveLength(1);
    expect(visibleWorkpapers[0].id).toBe('wp-1');

    // Scoped Observations
    const visibleObservations = filterObservations(observations, userScopedToEntA, allowedEntityIds);
    expect(visibleObservations).toHaveLength(1);
    expect(visibleObservations[0].id).toBe('obs-1');

    // Scoped Issues
    const visibleIssues = filterIssues(issues, userScopedToEntA, allowedEntityIds);
    expect(visibleIssues).toHaveLength(1);
    expect(visibleIssues[0].id).toBe('iss-1');

    // Scoped Comments
    const allowedWorkpaperIds = new Set(visibleWorkpapers.map((w) => w.id));
    const visibleComments = filterComments(comments, userScopedToEntA, allowedWorkpaperIds);
    expect(visibleComments).toHaveLength(1);
    expect(visibleComments[0].id).toBe('cmt-1');
  });

  it('Entity-tagged user cannot obtain Entity B via deep link or direct check', () => {
    const userScopedToEntA: User = {
      id: 'usr-prep-1',
      name: 'Auditor Alpha',
      email: 'alpha@provio.internal',
      avatar: '',
      role: 'preparer',
      universeIds: ['u-1'],
      entityIds: ['ent-a'],
    };

    expect(canAccessEntity(userScopedToEntA, { id: 'ent-a', universeId: 'u-1' })).toBe(true);
    expect(canAccessEntity(userScopedToEntA, { id: 'ent-b', universeId: 'u-1' })).toBe(false);
    expect(canAccessEntity(userScopedToEntA, { id: 'ent-c', universeId: 'u-2' })).toBe(false);

    expect(canAccessUniverse(userScopedToEntA, 'u-1')).toBe(true);
    expect(canAccessUniverse(userScopedToEntA, 'u-2')).toBe(false);
  });

  it('Role gating: Reviewer cannot sign off their own work (Four-Eyes Principle)', () => {
    const reviewer: User = {
      id: 'usr-rev-1',
      name: 'Marcus Vance',
      email: 'marcus@provio.internal',
      avatar: '',
      role: 'reviewer',
      universeIds: ['u-1'],
      entityIds: ['ent-a', 'ent-b'],
    };

    // Reviewer reviewing someone else's work (usr-prep-1) -> ALLOWED
    const reviewSomeoneElse = canPerformAction(reviewer, 'sign_off', {
      preparerId: 'usr-prep-1',
    });
    expect(reviewSomeoneElse.allowed).toBe(true);

    // Reviewer attempting to sign off work they prepared themselves -> DISALLOWED
    const reviewOwnWork = canPerformAction(reviewer, 'sign_off', {
      preparerId: 'usr-rev-1',
    });
    expect(reviewOwnWork.allowed).toBe(false);
    expect(reviewOwnWork.reason).toContain('Four-eyes policy');
  });

  it('Role gating: Preparer cannot approve audit records or sign-offs', () => {
    const preparer: User = {
      id: 'usr-prep-1',
      name: 'Auditor Alpha',
      email: 'alpha@provio.internal',
      avatar: '',
      role: 'preparer',
      universeIds: ['u-1'],
      entityIds: ['ent-a'],
    };

    const approveResult = canPerformAction(preparer, 'approve');
    expect(approveResult.allowed).toBe(false);
    expect(approveResult.reason).toContain('Only Reviewers, CIAs, or Admins');

    const signOffResult = canPerformAction(preparer, 'sign_off');
    expect(signOffResult.allowed).toBe(false);
    expect(signOffResult.reason).toContain('Preparers cannot perform sign-offs');
  });

  it('Locking: Sealed/signed-off audit is read-only; reopen requires >= 10 char note', () => {
    const ciaUser: User = {
      id: 'usr-cia',
      name: 'Chief Audit Executive',
      email: 'cae@provio.internal',
      avatar: '',
      role: 'cia',
      universeIds: ['*'],
      entityIds: ['*'],
    };

    // Attempting edit on locked item -> disallowed
    const editLocked = canPerformAction(ciaUser, 'edit_workpaper', { isLocked: true });
    expect(editLocked.allowed).toBe(false);
    expect(editLocked.reason).toContain('sealed and signed-off');

    // Attempting reopen with short note (< 10 chars) -> disallowed
    const reopenShort = canPerformAction(ciaUser, 'reopen', {
      isLocked: true,
      reopenJustification: 'Short',
    });
    expect(reopenShort.allowed).toBe(false);
    expect(reopenShort.reason).toContain('at least 10 characters');

    // Attempting reopen with valid note >= 10 chars -> allowed
    const reopenValid = canPerformAction(ciaUser, 'reopen', {
      isLocked: true,
      reopenJustification: 'Regulatory inquiry into July 14 liquidity variance',
    });
    expect(reopenValid.allowed).toBe(true);
  });
});
