import React, { createContext, useContext, useEffect, useState } from 'react';
import type { TenantSeed } from '../types/seed';
import { canPerformAction, canAccessEntity } from '../lib/access';
import { hasRight } from '../lib/rights';
import { getSignOffBlockers } from '../lib/auditFile';
import { appendLedgerEntry, computePayloadHash, HashUnavailableError } from '../lib/ledger';
import { transitionCapStatus, CapStatusAction, TransitionCapResult } from '../lib/cap';
import { buildDefaultOrgRoleConfig } from '../lib/orgCapabilities';

import {
  AuditCapItem,
  AuditControl,
  AuditEngagement,
  AuditEntity,
  AuditIssue,
  AuditObservation,
  AuditUniverse,
  CapStatus,
  GlassBoxToken,
  LedgerEntry,
  RetestStatus,
  ReviewComment,
  User,
  WorkingPaper,
} from '../types';

export type InspectorType =
  | 'observation'
  | 'comment'
  | 'sira'
  | 'audit_file'
  | 'workbench'
  | 'glassbox_share'
  | 'account_settings'
  | 'comment_history'
  | 'cap_inspector'
  | 'people_admin'
  | 'entity_approval'
  | 'deployment_gate'
  | 'ethics'
  | 'combined_approval'
  | 'sira_model'
  | 'sira_cycles'
  | 'plan_items';

export interface InspectorState {
  type: InspectorType | null;
  data?: any;
}

export type GateResult = { ok: true } | { ok: false; code: string; reason: string };
export type PopulationSummary = { sha256: string; fileName: string; rowCount: number; totalCents: number };

export type NewEntityInput = {
  universeId: string;
  name: string;
  code: string;
  department: string;
  headOfDepartment: string;
  inherentRisk: 'low' | 'medium' | 'high' | 'critical';
};

interface AppContextType {
  /** The identity of the authenticated session. It is supplied by the sign-in boundary and never changed in-app. */
  currentUser: User;
  /** Set when secure hashing is unavailable. Sealing and ledger writes are refused while it is set. */
  ledgerError: string | null;
  /** Id of the tenant this session belongs to. */
  tenantId: string;
  /** Sample figures for the analytics tab, from the tenant seed. */
  analyticsSample: TenantSeed['analyticsSample'];
  /** Starting text for the document review tab, from the tenant seed. */
  documentSample: string;

  // Raw State (internal to context and useScopedData)
  rawUniverses: AuditUniverse[];
  rawEntities: AuditEntity[];
  rawEngagements: AuditEngagement[];
  rawControls: AuditControl[];
  rawWorkpapers: WorkingPaper[];
  rawObservations: AuditObservation[];
  rawIssues: AuditIssue[];
  rawComments: ReviewComment[];
  rawCapItems: AuditCapItem[];
  ledger: LedgerEntry[];
  glassBoxTokens: GlassBoxToken[];

  // Selections & Navigation
  selectedUniverseId: string | null;
  setSelectedUniverseId: (id: string | null) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedEngagementId: string | null;
  setSelectedEngagementId: (id: string | null) => void;
  selectedWorkpaperId: string | null;
  setSelectedWorkpaperId: (id: string | null) => void;
  selectedObservationId: string | null;
  setSelectedObservationId: (id: string | null) => void;

  // Inspector Panel (Sliding right sheet)
  inspector: InspectorState;
  openInspector: (type: InspectorType, data?: any) => void;
  closeInspector: () => void;

  // 1-stage vs 2-stage Org Toggle (Task 6 differentiator)
  isTwoStageOrg: boolean;
  setIsTwoStageOrg: (twoStage: boolean) => void;

  // Actions
  appendLedger: (params: Parameters<typeof appendLedgerEntry>[1]) => Promise<LedgerEntry>;
  signOffEngagement: (engagementId: string) => Promise<GateResult>;
  reopenEngagement: (engagementId: string, justification: string) => Promise<GateResult>;
  addEntity: (input: NewEntityInput) => Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
  finalizeTest: (workpaperId: string) => Promise<GateResult>;
  registerPopulation: (workpaperId: string, summary: PopulationSummary) => Promise<GateResult>;
  setTestStepCompleted: (workpaperId: string, stepId: string, completed: boolean) => GateResult;
  signOffWorkpaper: (workpaperId: string) => Promise<GateResult>;
  reopenWorkpaper: (workpaperId: string, justification: string) => Promise<GateResult>;
  addObservation: (
    obs: Omit<AuditObservation, 'id' | 'createdAt' | 'raisedBy'>
  ) => Promise<AuditObservation>;
  addReviewComment: (workpaperId: string, text: string) => Promise<ReviewComment>;
  attachEvidenceToWorkpaper: (
    workpaperId: string,
    file: { name: string; sizeBytes: number; sha256: string },
    actorName: string
  ) => Promise<void>;
  /** @deprecated Prefer transitionCap */
  updateCapStatus: (capId: string, status: CapStatus, retestStatus?: RetestStatus) => void;
  transitionCap: (
    capId: string,
    action: CapStatusAction,
    payload?: { note?: string; evidenceRefs?: string[]; rejectTo?: 'Open' | 'In progress' }
  ) => TransitionCapResult;
  orgRoleConfig: ReturnType<typeof buildDefaultOrgRoleConfig>;

}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ user, seed, children }: { user: User; seed: TenantSeed; children: React.ReactNode }) {
  // Identity comes only from the authenticated session (see AuthContext). There is no default user and no in-app switching.
  const currentUser = user;
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const [rawUniverses, setRawUniverses] = useState<AuditUniverse[]>(seed.universes);
  const [rawEntities, setRawEntities] = useState<AuditEntity[]>(seed.entities);
  const [rawEngagements, setRawEngagements] = useState<AuditEngagement[]>(seed.engagements);
  const [rawControls, setRawControls] = useState<AuditControl[]>(seed.controls);
  const [rawWorkpapers, setRawWorkpapers] = useState<WorkingPaper[]>(seed.workpapers);
  const [rawObservations, setRawObservations] = useState<AuditObservation[]>(seed.observations);
  const [rawIssues, setRawIssues] = useState<AuditIssue[]>(seed.issues);
  const [rawComments, setRawComments] = useState<ReviewComment[]>(seed.comments);
  const [rawCapItems, setRawCapItems] = useState<AuditCapItem[]>(seed.capItems);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [glassBoxTokens, setGlassBoxTokens] = useState<GlassBoxToken[]>(seed.glassBoxTokens);

  useEffect(() => {
    let isMounted = true;
    seed
      .buildLedger()
      .then((initial) => {
        if (isMounted) {
          setLedger(initial);
        }
      })
      .catch((err) => {
        if (isMounted) setLedgerError(err instanceof Error ? err.message : 'The ledger could not be built.');
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const [selectedUniverseId, setSelectedUniverseId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('executive');
  const [selectedEngagementId, setSelectedEngagementId] = useState<string | null>(null);
  const [selectedWorkpaperId, setSelectedWorkpaperId] = useState<string | null>(null);
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null);

  const [inspector, setInspector] = useState<InspectorState>({ type: null });
  const [isTwoStageOrg, setIsTwoStageOrg] = useState<boolean>(true);

  // Auto-select universe if user is tagged to exactly one
  useEffect(() => {
    if (currentUser.universeIds && currentUser.universeIds.length === 1 && currentUser.universeIds[0] !== '*') {
      setSelectedUniverseId(currentUser.universeIds[0]);
    }
  }, [currentUser]);

  const openInspector = (type: InspectorType, data?: any) => {
    setInspector({ type, data });
  };

  const closeInspector = () => {
    setInspector({ type: null });
  };

  /** Runs a sealing command. If secure hashing is unavailable it refuses, changes nothing and reports why. */
  const withSealGuard = async (run: () => Promise<GateResult>): Promise<GateResult> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof HashUnavailableError) {
        setLedgerError(err.message);
        return { ok: false, code: 'HASH_UNAVAILABLE', reason: err.message };
      }
      throw err;
    }
  };

  const appendLedger = async (params: Parameters<typeof appendLedgerEntry>[1]) => {
    const newEntry = await appendLedgerEntry(ledger, params);
    setLedger((prev) => [...prev, newEntry]);
    return newEntry;
  };

  const signOffEngagement = (engagementId: string): Promise<GateResult> => withSealGuard(async () => {
    const eng = rawEngagements.find((e) => e.id === engagementId);
    if (!eng) return { ok: false, code: 'NOT_AVAILABLE', reason: 'Engagement not available.' };

    const ctx = { leadAuditorId: eng.leadAuditorId, preparerId: eng.leadAuditorId, isLocked: eng.isLocked };
    const gate = canPerformAction(currentUser, 'sign_off', ctx);
    if (!gate.allowed) {
      return { ok: false, code: 'FORBIDDEN', reason: gate.reason || 'Action not permitted' };
    }
    // Command-level enforcement (same rule for every entry point, not just the Audit File button).
    const auditGate = canPerformAction(currentUser, 'audit_sign_off', ctx);
    if (!auditGate.allowed) {
      return { ok: false, code: 'FORBIDDEN', reason: auditGate.reason || 'Action not permitted' };
    }
    const blockers = getSignOffBlockers(
      rawWorkpapers.filter((w) => w.engagementId === engagementId),
      rawObservations,
      rawComments
    );
    if (blockers.length) {
      return { ok: false, code: 'SIGN_OFF_BLOCKED', reason: 'Cannot sign off yet:\n' + blockers.join('\n') };
    }

    const payloadHash = await computePayloadHash({ engagementId, stage: 'signed_off', timestamp: new Date().toISOString() });
    await appendLedger({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      eventType: 'audit_sign_off',
      entityId: eng.entityId,
      recordId: eng.id,
      recordType: 'engagement',
      payloadSummary: `Audit engagement "${eng.title}" signed-off and sealed by ${currentUser.name}`,
      payloadHash,
    });

    setRawEngagements((prev) =>
      prev.map((item) =>
        item.id === engagementId
          ? {
              ...item,
              status: 'signed_off',
              stage: 'conclusion',
              completionPercent: 100,
              signedOffAt: new Date().toISOString(),
              signedOffBy: currentUser.name,
              signedHash: payloadHash,
              isLocked: true,
            }
          : item
      )
    );
    return { ok: true };
  });

  const addEntity = async (input: NewEntityInput): Promise<{ ok: true; id: string } | { ok: false; reason: string }> => {
    if (!hasRight(currentUser, 'edit_config')) {
      return { ok: false, reason: 'Only a principal with the edit_config right can add auditable entities.' };
    }
    const name = input.name.trim();
    const code = input.code.trim().toUpperCase();
    if (!name || !code || !input.department.trim()) return { ok: false, reason: 'Name, code and department are required.' };
    if (!rawUniverses.some((u) => u.id === input.universeId)) return { ok: false, reason: 'Choose a valid universe.' };
    if (rawEntities.some((e) => e.code.toUpperCase() === code)) return { ok: false, reason: `Code ${code} is already used.` };
    const id = `ent-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const entity: AuditEntity = {
      id, universeId: input.universeId, name, code,
      department: input.department.trim(), headOfDepartment: input.headOfDepartment.trim() || 'Unassigned',
      inherentRisk: input.inherentRisk, residualRisk: input.inherentRisk,
      siraScore: 0, controlsCount: 0, lastAuditDate: 'Never', status: 'active',
    };
    try {
      const payloadHash = await computePayloadHash({ id, universeId: input.universeId, name, code, timestamp: new Date().toISOString() });
      await appendLedger({
        actorId: currentUser.id, actorName: currentUser.name, actorRole: currentUser.role,
        eventType: 'config_changed', entityId: id, recordId: id, recordType: 'entity',
        payloadSummary: `Auditable entity "${name}" (${code}) added to universe ${input.universeId} by ${currentUser.name}`,
        payloadHash,
      });
    } catch (err) {
      if (err instanceof HashUnavailableError) {
        setLedgerError(err.message);
        return { ok: false, reason: err.message };
      }
      throw err;
    }
    setRawEntities((prev) => [...prev, entity]);
    return { ok: true, id };
  };

  const reopenEngagement = (engagementId: string, justification: string): Promise<GateResult> => withSealGuard(async () => {
    const eng = rawEngagements.find((e) => e.id === engagementId);
    if (!eng) return { ok: false, code: 'NOT_AVAILABLE', reason: 'Engagement not available.' };

    const gate = canPerformAction(currentUser, 'reopen', {
      reopenJustification: justification,
    });
    if (!gate.allowed) {
      return { ok: false, code: 'FORBIDDEN', reason: gate.reason || 'Action not permitted' };
    }

    const payloadHash = await computePayloadHash({ engagementId, justification, timestamp: new Date().toISOString() });
    await appendLedger({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      eventType: 'reopen',
      entityId: eng.entityId,
      recordId: eng.id,
      recordType: 'engagement',
      payloadSummary: `Engagement "${eng.title}" reopened: ${justification}`,
      payloadHash,
      justification,
    });

    setRawEngagements((prev) =>
      prev.map((item) =>
        item.id === engagementId
          ? {
              ...item,
              status: 'reopened',
              stage: 'testing',
              isLocked: false,
              reopenJustification: justification,
            }
          : item
      )
    );
    return { ok: true };
  });

  /** One shared pre-check for every command that changes a paper: scope, history, seal, capability. */
  const paperGuard = (
    wp: WorkingPaper | undefined,
    action: 'edit_workpaper' | 'finalize_test'
  ): GateResult => {
    if (!wp) return { ok: false, code: 'NOT_AVAILABLE', reason: 'Working paper not available.' };
    const entity = rawEntities.find((e) => e.id === wp.entityId);
    if (!entity || !canAccessEntity(currentUser, entity)) {
      return { ok: false, code: 'NOT_AVAILABLE', reason: 'Working paper not available.' };
    }
    if (wp.sealed) return { ok: false, code: 'SEALED', reason: 'This working paper is sealed and read-only.' };
    const gate = canPerformAction(currentUser, action, { isLocked: wp.sealed });
    if (!gate.allowed) return { ok: false, code: 'FORBIDDEN', reason: gate.reason || 'Action not permitted' };
    return { ok: true };
  };

  const setTestStepCompleted = (workpaperId: string, stepId: string, completed: boolean): GateResult => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    const g = paperGuard(wp, 'edit_workpaper');
    if (!g.ok) return g;
    if (!wp!.populationSha256) {
      return { ok: false, code: 'POPULATION_NOT_VERIFIED', reason: 'Verify the population before recording test steps.' };
    }
    setRawWorkpapers((prev) =>
      prev.map((w) => (w.id === workpaperId ? { ...w, testSteps: w.testSteps.map((t) => (t.id === stepId ? { ...t, completed } : t)) } : w))
    );
    return { ok: true };
  };

  const registerPopulation = (workpaperId: string, summary: PopulationSummary): Promise<GateResult> => withSealGuard(async () => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    const g = paperGuard(wp, 'edit_workpaper');
    if (!g.ok) return g;
    if (!/^[0-9a-f]{64}$/.test(summary.sha256) || summary.rowCount < 1) {
      return { ok: false, code: 'INVALID_POPULATION', reason: 'A verified population needs a SHA-256 and at least one row.' };
    }
    const payloadHash = await computePayloadHash({ workpaperId, ...summary });
    await appendLedger({
      actorId: currentUser.id, actorName: currentUser.name, actorRole: currentUser.role,
      eventType: 'population_verified', entityId: wp!.entityId, recordId: wp!.id, recordType: 'population',
      payloadSummary: `Population ${summary.fileName} verified for "${wp!.refCode}": ${summary.rowCount} rows, SHA-256 ${summary.sha256.slice(0, 12)}…`,
      payloadHash,
    });
    setRawWorkpapers((prev) =>
      prev.map((w) =>
        w.id === workpaperId
          ? {
              ...w,
              populationSha256: summary.sha256,
              populationCount: summary.rowCount,
              populationFileName: summary.fileName,
              populationTotalCents: summary.totalCents,
              populationVerifiedAt: new Date().toISOString(),
              populationVerifiedBy: currentUser.name,
            }
          : w
      )
    );
    return { ok: true };
  });

  const finalizeTest = (workpaperId: string): Promise<GateResult> => withSealGuard(async () => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    const g = paperGuard(wp, 'finalize_test');
    if (!g.ok) return g;
    // Law 3, enforced in the command (not just the button): no verified population, no finalization.
    if (!wp!.populationSha256) {
      return { ok: false, code: 'POPULATION_NOT_VERIFIED', reason: 'Population is not verified. Upload and reconcile it first.' };
    }
    const open = wp!.testSteps.filter((t) => !t.completed).length;
    if (open > 0) {
      return { ok: false, code: 'STEPS_INCOMPLETE', reason: `${open} test step${open === 1 ? '' : 's'} still not completed.` };
    }

    const payloadHash = await computePayloadHash(wp);
    await appendLedger({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      eventType: 'test_finalize',
      entityId: wp!.entityId,
      recordId: wp!.id,
      recordType: 'workpaper',
      payloadSummary: `Testing finalized for workpaper "${wp!.refCode}" (${wp!.sampleCount} samples tested)`,
      payloadHash,
    });

    setRawWorkpapers((prev) =>
      prev.map((w) =>
        w.id === workpaperId
          ? { ...w, status: 'completed', preparedDate: new Date().toISOString().split('T')[0] }
          : w
      )
    );
    return { ok: true };
  });

  const signOffWorkpaper = (workpaperId: string): Promise<GateResult> => withSealGuard(async () => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    if (!wp) return { ok: false, code: 'NOT_AVAILABLE', reason: 'Working paper not available.' };

    const gate = canPerformAction(currentUser, 'sign_off', {
      preparerId: wp.preparerId,
      isLocked: wp.sealed,
    });
    if (!gate.allowed) {
      return { ok: false, code: 'FORBIDDEN', reason: gate.reason || 'Action not permitted' };
    }

    const payloadHash = await computePayloadHash(wp);
    await appendLedger({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      eventType: 'reviewer_sign_off',
      entityId: wp.entityId,
      recordId: wp.id,
      recordType: 'workpaper',
      payloadSummary: `Working paper "${wp.refCode}" sealed and signed-off by Reviewer ${currentUser.name}`,
      payloadHash,
    });

    setRawWorkpapers((prev) =>
      prev.map((w) =>
        w.id === workpaperId
          ? {
              ...w,
              status: 'signed_off',
              reviewedDate: new Date().toISOString().split('T')[0],
              sealed: true,
              sealedHash: payloadHash,
            }
          : w
      )
    );
    return { ok: true };
  });

  const reopenWorkpaper = (workpaperId: string, justification: string): Promise<GateResult> => withSealGuard(async () => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    if (!wp) return { ok: false, code: 'NOT_AVAILABLE', reason: 'Working paper not available.' };

    const gate = canPerformAction(currentUser, 'reopen', {
      reopenJustification: justification,
    });
    if (!gate.allowed) {
      return { ok: false, code: 'FORBIDDEN', reason: gate.reason || 'Action not permitted' };
    }

    const payloadHash = await computePayloadHash({ workpaperId, justification, timestamp: new Date().toISOString() });
    await appendLedger({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      eventType: 'reopen',
      entityId: wp.entityId,
      recordId: wp.id,
      recordType: 'workpaper',
      payloadSummary: `Workpaper "${wp.refCode}" unsealed and reopened: ${justification}`,
      payloadHash,
      justification,
    });

    setRawWorkpapers((prev) =>
      prev.map((w) =>
        w.id === workpaperId
          ? {
              ...w,
              status: 'reopened',
              sealed: false,
              sealedHash: undefined,
            }
          : w
      )
    );
    return { ok: true };
  });

  const addObservation = async (
    obs: Omit<AuditObservation, 'id' | 'createdAt' | 'raisedBy'>
  ) => {
    const gate = canPerformAction(currentUser, 'raise_observation');
    if (!gate.allowed) {
      throw new Error(gate.reason || 'Not allowed to raise observation');
    }

    const newObs: AuditObservation = {
      ...obs,
      id: `obs-${Date.now()}`,
      createdAt: new Date().toISOString(),
      raisedBy: currentUser.id,
    };

    // Ledger first: if secure hashing is unavailable this throws HashUnavailableError and nothing below changes.
    await appendLedger({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      eventType: 'test_finalize',
      entityId: newObs.entityId,
      recordId: newObs.id,
      recordType: 'observation',
      payloadSummary: `Audit Observation raised: "${newObs.title}" (${newObs.severity.toUpperCase()})`,
      payloadData: newObs,
    });

    setRawObservations((prev) => [newObs, ...prev]);

    // Also auto-create tracking Issue
    const newIssue: AuditIssue = {
      id: `iss-${Date.now()}`,
      observationId: newObs.id,
      entityId: newObs.entityId,
      universeId: newObs.universeId || rawEntities.find((e) => e.id === newObs.entityId)?.universeId || 'u-gbm',
      department: rawEntities.find((e) => e.id === newObs.entityId)?.department || 'Audit',
      title: newObs.title,
      description: newObs.condition,
      severity: newObs.severity,
      status: 'identified',
      ownerId: currentUser.id,
      identifiedDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    };
    setRawIssues((prev) => [newIssue, ...prev]);

    return newObs;
  };

  const addReviewComment = async (workpaperId: string, text: string) => {
    const newComment: ReviewComment = {
      id: `cmt-${Date.now()}`,
      workpaperId,
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorRole: currentUser.role,
      text,
      createdAt: new Date().toISOString(),
      status: 'open',
    };
    setRawComments((prev) => [newComment, ...prev]);
    return newComment;
  };

  const attachEvidenceToWorkpaper = async (
    workpaperId: string,
    file: { name: string; sizeBytes: number; sha256: string },
    actorName: string
  ) => {
    // Sealed papers and historical views never accept new evidence, whatever the entry point.
    const target = rawWorkpapers.find((w) => w.id === workpaperId);
    if (!target || target.sealed) return;
    const item = {
      id: `ev-${Date.now()}`,
      name: file.name,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actorName,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
    };

    setRawWorkpapers((prev) =>
      prev.map((w) => (w.id === workpaperId ? { ...w, evidenceItems: [...w.evidenceItems, item] } : w))
    );

    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    if (wp) {
      await appendLedger({
        actorId: currentUser.id,
        actorName,
        actorRole: 'auditee',
        eventType: 'evidence_drop',
        entityId: wp.entityId,
        recordId: wp.id,
        recordType: 'evidence',
        payloadSummary: `Auditee evidence uploaded: ${file.name} (SHA-256: ${file.sha256.substring(0, 16)}...)`,
        payloadHash: file.sha256,
      });
    }
  };

  const orgRoleConfig = buildDefaultOrgRoleConfig();

  const updateCapStatus = (capId: string, status: CapStatus, retestStatus?: RetestStatus) => {
    // Legacy ungated path retained only for non-workflow callers; CapInspector must use transitionCap.
    setRawCapItems((prev) =>
      prev.map((c) =>
        c.id === capId
          ? {
              ...c,
              status,
              retestStatus: retestStatus !== undefined ? retestStatus : c.retestStatus,
            }
          : c
      )
    );
  };

  const transitionCap = (
    capId: string,
    action: CapStatusAction,
    payload?: { note?: string; evidenceRefs?: string[]; rejectTo?: 'Open' | 'In progress' }
  ): TransitionCapResult => {
    const cap = rawCapItems.find((c) => c.id === capId);
    if (!cap) return { ok: false, reason: 'CAP not found' };
    const result = transitionCapStatus({
      cap,
      action,
      user: currentUser,
      orgConfig: orgRoleConfig,
      note: payload?.note,
      evidenceRefs: payload?.evidenceRefs,
      rejectTo: payload?.rejectTo,
    });
    if (!result.ok) return result;
    setRawCapItems((prev) => prev.map((c) => (c.id === capId ? result.cap : c)));
    return result;
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        ledgerError,
        tenantId: seed.tenantId,
        analyticsSample: seed.analyticsSample,
        documentSample: seed.documentSample,
        rawUniverses,
        rawEntities,
        rawEngagements,
        rawControls,
        rawWorkpapers,
        rawObservations,
        rawIssues,
        rawComments,
        rawCapItems,
        ledger,
        glassBoxTokens,
        selectedUniverseId,
        setSelectedUniverseId,
        activeTab,
        setActiveTab,
        selectedEngagementId,
        setSelectedEngagementId,
        selectedWorkpaperId,
        setSelectedWorkpaperId,
        selectedObservationId,
        setSelectedObservationId,
        inspector,
        openInspector,
        closeInspector,
        isTwoStageOrg,
        setIsTwoStageOrg,
        appendLedger,
        signOffEngagement,
        reopenEngagement,
        addEntity,
        registerPopulation,
        setTestStepCompleted,
        finalizeTest,
        signOffWorkpaper,
        reopenWorkpaper,
        addObservation,
        addReviewComment,
        attachEvidenceToWorkpaper,
        updateCapStatus,
        transitionCap,
        orgRoleConfig,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
