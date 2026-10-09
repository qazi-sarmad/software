import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  initialCapItems,
  initialComments,
  initialControls,
  initialEngagements,
  initialEntities,
  initialGlassBoxTokens,
  initialIssues,
  initialObservations,
  initialUniverses,
  initialUsers,
  initialWorkpapers,
} from '../data/initialData';
import { canPerformAction } from '../lib/access';
import { getSignOffBlockers } from '../lib/auditFile';
import { appendLedgerEntry, computePayloadHash, generateInitialLedger, verifyChain } from '../lib/ledger';
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
  | 'people'
  | 'audit_file'
  | 'workbench'
  | 'red_thread'
  | 'glassbox_share'
  | 'account_settings'
  | 'comment_history'
  | 'cap_inspector';

export interface InspectorState {
  type: InspectorType | null;
  data?: any;
}

/**
 * Seed data carries [CANARY-*] markers used only by the /dev/access leak scanner.
 * They are removed from everything users see unless the dev scanner explicitly asks for them.
 */
const KEEP_CANARIES =
  import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('canary');
function cleanSeed<T>(rows: T): T {
  if (KEEP_CANARIES) return rows;
  return JSON.parse(JSON.stringify(rows).replace(/\s?\[CANARY-[A-Z]+\]/g, ''));
}

export type NewEntityInput = {
  universeId: string;
  name: string;
  code: string;
  department: string;
  headOfDepartment: string;
  inherentRisk: 'low' | 'medium' | 'high' | 'critical';
};

interface AppContextType {
  // Current authenticated user (and scope)
  currentUser: User;
  setCurrentUser: (user: User) => void;
  availableUsers: User[];

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

  // 4D Ledger Scrub Bar (Task 6 differentiator)
  ledgerAsOf: number | null; // null means live; number is max seq
  setLedgerAsOf: (seq: number | null) => void;

  // 1-stage vs 2-stage Org Toggle (Task 6 differentiator)
  isTwoStageOrg: boolean;
  setIsTwoStageOrg: (twoStage: boolean) => void;

  // Actions
  appendLedger: (params: Parameters<typeof appendLedgerEntry>[1]) => Promise<LedgerEntry>;
  signOffEngagement: (engagementId: string) => Promise<void>;
  reopenEngagement: (engagementId: string, justification: string) => Promise<void>;
  addEntity: (input: NewEntityInput) => Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
  finalizeTest: (workpaperId: string) => Promise<void>;
  signOffWorkpaper: (workpaperId: string) => Promise<void>;
  reopenWorkpaper: (workpaperId: string, justification: string) => Promise<void>;
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User>(initialUsers[0]); // default to CIA
  const [availableUsers] = useState<User[]>(initialUsers);

  const [rawUniverses, setRawUniverses] = useState<AuditUniverse[]>(cleanSeed(initialUniverses));
  const [rawEntities, setRawEntities] = useState<AuditEntity[]>(cleanSeed(initialEntities));
  const [rawEngagements, setRawEngagements] = useState<AuditEngagement[]>(cleanSeed(initialEngagements));
  const [rawControls, setRawControls] = useState<AuditControl[]>(cleanSeed(initialControls));
  const [rawWorkpapers, setRawWorkpapers] = useState<WorkingPaper[]>(cleanSeed(initialWorkpapers));
  const [rawObservations, setRawObservations] = useState<AuditObservation[]>(cleanSeed(initialObservations));
  const [rawIssues, setRawIssues] = useState<AuditIssue[]>(cleanSeed(initialIssues));
  const [rawComments, setRawComments] = useState<ReviewComment[]>(cleanSeed(initialComments));
  const [rawCapItems, setRawCapItems] = useState<AuditCapItem[]>(cleanSeed(initialCapItems));
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [glassBoxTokens, setGlassBoxTokens] = useState<GlassBoxToken[]>(initialGlassBoxTokens);

  useEffect(() => {
    let isMounted = true;
    generateInitialLedger().then((initial) => {
      if (isMounted) {
        setLedger(KEEP_CANARIES ? initial : initial.map((e) => ({ ...e, payloadSummary: e.payloadSummary.replace(/\s?\[CANARY-[A-Z]+\]/g, '') })));
      }
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
  const [ledgerAsOf, setLedgerAsOf] = useState<number | null>(null);
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

  const appendLedger = async (params: Parameters<typeof appendLedgerEntry>[1]) => {
    const newEntry = await appendLedgerEntry(ledger, params);
    setLedger((prev) => [...prev, newEntry]);
    return newEntry;
  };

  const signOffEngagement = async (engagementId: string) => {
    const eng = rawEngagements.find((e) => e.id === engagementId);
    if (!eng) return;

    const ctx = { leadAuditorId: eng.leadAuditorId, preparerId: eng.leadAuditorId, isLocked: eng.isLocked };
    const gate = canPerformAction(currentUser, 'sign_off', ctx);
    if (!gate.allowed) {
      alert(gate.reason || 'Action not permitted');
      return;
    }
    // Command-level enforcement (same rule for every entry point, not just the Audit File button).
    const auditGate = canPerformAction(currentUser, 'audit_sign_off', ctx);
    if (!auditGate.allowed) {
      alert(auditGate.reason || 'Action not permitted');
      return;
    }
    const blockers = getSignOffBlockers(
      rawWorkpapers.filter((w) => w.engagementId === engagementId),
      rawObservations,
      rawComments
    );
    if (blockers.length) {
      alert('Cannot sign off yet:\n' + blockers.join('\n'));
      return;
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
  };

  const addEntity = async (input: NewEntityInput): Promise<{ ok: true; id: string } | { ok: false; reason: string }> => {
    if (currentUser.role !== 'cia' && currentUser.role !== 'org_admin') {
      return { ok: false, reason: 'Only the CIA or an Org Admin can add auditable entities.' };
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
    const payloadHash = await computePayloadHash({ id, universeId: input.universeId, name, code, timestamp: new Date().toISOString() });
    await appendLedger({
      actorId: currentUser.id, actorName: currentUser.name, actorRole: currentUser.role,
      eventType: 'config_changed', entityId: id, recordId: id, recordType: 'entity',
      payloadSummary: `Auditable entity "${name}" (${code}) added to universe ${input.universeId} by ${currentUser.name}`,
      payloadHash,
    });
    setRawEntities((prev) => [...prev, entity]);
    return { ok: true, id };
  };

  const reopenEngagement = async (engagementId: string, justification: string) => {
    const eng = rawEngagements.find((e) => e.id === engagementId);
    if (!eng) return;

    const gate = canPerformAction(currentUser, 'reopen', {
      reopenJustification: justification,
    });
    if (!gate.allowed) {
      alert(gate.reason || 'Action not permitted');
      return;
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
  };

  const finalizeTest = async (workpaperId: string) => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    if (!wp) return;

    const gate = canPerformAction(currentUser, 'finalize_test', { isLocked: wp.sealed });
    if (!gate.allowed) {
      alert(gate.reason || 'Action not permitted');
      return;
    }

    const payloadHash = await computePayloadHash(wp);
    await appendLedger({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      eventType: 'test_finalize',
      entityId: wp.entityId,
      recordId: wp.id,
      recordType: 'workpaper',
      payloadSummary: `Testing finalized for workpaper "${wp.refCode}" (${wp.sampleCount} samples tested)`,
      payloadHash,
    });

    setRawWorkpapers((prev) =>
      prev.map((w) =>
        w.id === workpaperId
          ? {
              ...w,
              status: 'completed',
              preparedDate: new Date().toISOString().split('T')[0],
            }
          : w
      )
    );
  };

  const signOffWorkpaper = async (workpaperId: string) => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    if (!wp) return;

    const gate = canPerformAction(currentUser, 'sign_off', {
      preparerId: wp.preparerId,
      isLocked: wp.sealed,
    });
    if (!gate.allowed) {
      alert(gate.reason || 'Action not permitted');
      return;
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
  };

  const reopenWorkpaper = async (workpaperId: string, justification: string) => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    if (!wp) return;

    const gate = canPerformAction(currentUser, 'reopen', {
      reopenJustification: justification,
    });
    if (!gate.allowed) {
      alert(gate.reason || 'Action not permitted');
      return;
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
  };

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

    // Ledger entry
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
        setCurrentUser,
        availableUsers,
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
        ledgerAsOf,
        setLedgerAsOf,
        isTwoStageOrg,
        setIsTwoStageOrg,
        appendLedger,
        signOffEngagement,
        reopenEngagement,
        addEntity,
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
