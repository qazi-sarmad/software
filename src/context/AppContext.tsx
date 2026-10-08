import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
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
import { canAccessEntity, canPerformAction } from '../lib/access';
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

  commandError: string;
  // Actions
  appendLedger: (params: Parameters<typeof appendLedgerEntry>[1]) => Promise<LedgerEntry>;
  signOffEngagement: (engagementId: string) => Promise<void>;
  reopenEngagement: (engagementId: string, justification: string) => Promise<void>;
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

  const [rawUniverses, setRawUniverses] = useState<AuditUniverse[]>(initialUniverses);
  const [rawEntities, setRawEntities] = useState<AuditEntity[]>(initialEntities);
  const [rawEngagements, setRawEngagements] = useState<AuditEngagement[]>(initialEngagements);
  const [rawControls, setRawControls] = useState<AuditControl[]>(initialControls);
  const [rawWorkpapers, setRawWorkpapers] = useState<WorkingPaper[]>(initialWorkpapers);
  const [rawObservations, setRawObservations] = useState<AuditObservation[]>(initialObservations);
  const [rawIssues, setRawIssues] = useState<AuditIssue[]>(initialIssues);
  const [rawComments, setRawComments] = useState<ReviewComment[]>(initialComments);
  const [rawCapItems, setRawCapItems] = useState<AuditCapItem[]>(initialCapItems);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [commandError, setCommandError] = useState('');
  const ledgerRef = useRef<LedgerEntry[]>([]);
  const ledgerQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [glassBoxTokens, setGlassBoxTokens] = useState<GlassBoxToken[]>(initialGlassBoxTokens);

  useEffect(() => {
    let isMounted = true;
    const initialLedger = generateInitialLedger().then((initial) => {
      if (isMounted) {
        ledgerRef.current = initial;
        setLedger(initial);
      }
    });
    ledgerQueue.current = initialLedger.catch(() => { setCommandError('Secure ledger initialization failed.'); });
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

  const requireMutableScope = (entityId: string, locked = false) => {
    const entity = rawEntities.find(e => e.id === entityId);
    if (ledgerAsOf !== null || locked || !entity || !canAccessEntity(currentUser, entity)) {
      throw new Error('Record is sealed, historical, or outside your assigned scope.');
    }
  };

  const appendLedger = (params: Parameters<typeof appendLedgerEntry>[1]) => {
    const pending = ledgerQueue.current.then(async () => {
      const newEntry = await appendLedgerEntry(ledgerRef.current, params);
      ledgerRef.current = [...ledgerRef.current, newEntry];
      setLedger(ledgerRef.current);
      return newEntry;
    });
    ledgerQueue.current = pending.catch(() => undefined);
    return pending;
  };

  const signOffEngagement = async (engagementId: string) => {
    const eng = rawEngagements.find((e) => e.id === engagementId);
    if (!eng) return;
    try { requireMutableScope(eng.entityId); } catch(e) {setCommandError((e as Error).message);return;}

    const gate = canPerformAction(currentUser, 'audit_sign_off', {
      leadAuditorId: eng.leadAuditorId,
      preparerId: eng.leadAuditorId,
      isLocked: eng.isLocked,
    });
    if (!gate.allowed) {
      setCommandError(gate.reason || 'Action not permitted');
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

  const reopenEngagement = async (engagementId: string, justification: string) => {
    const eng = rawEngagements.find((e) => e.id === engagementId);
    if (!eng) return;
    try { requireMutableScope(eng.entityId); } catch(e) {setCommandError((e as Error).message);return;}

    const gate = canPerformAction(currentUser, 'reopen', {
      reopenJustification: justification,
    });
    if (!gate.allowed) {
      setCommandError(gate.reason || 'Action not permitted');
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

  const finalizeTest = async (_workpaperId: string) => {
    // Seeded hashes are demonstration fixtures, not persisted population verification.
    // Authenticated finalization uses audit_command's population and census gates.
    setCommandError('Demo workpapers cannot be finalized. Use authenticated Audit File to import, reconcile and test a real population.');
  };

  const signOffWorkpaper = async (workpaperId: string) => {
    const wp = rawWorkpapers.find((w) => w.id === workpaperId);
    if (!wp) return;
    try { requireMutableScope(wp.entityId, rawEngagements.find(e=>e.id===wp.engagementId)?.isLocked); } catch(e) {setCommandError((e as Error).message);return;}

    const gate = canPerformAction(currentUser, 'sign_off', {
      preparerId: wp.preparerId,
      isLocked: wp.sealed,
    });
    if (!gate.allowed) {
      setCommandError(gate.reason || 'Action not permitted');
      return;
    }

    if (wp.status !== 'completed') { setCommandError('Complete verified fieldwork before review.'); return; }
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
    try { requireMutableScope(wp.entityId, rawEngagements.find(e=>e.id===wp.engagementId)?.isLocked); } catch(e) {setCommandError((e as Error).message);return;}

    const gate = canPerformAction(currentUser, 'reopen', {
      reopenJustification: justification,
    });
    if (!gate.allowed) {
      setCommandError(gate.reason || 'Action not permitted');
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
    const parent = rawWorkpapers.find(w=>w.id===obs.workpaperId);
    if (!parent) throw new Error('Working paper not found');
    if (obs.entityId !== parent.entityId || (obs.controlId && obs.controlId !== parent.controlId) || (obs.universeId && obs.universeId !== parent.universeId)) throw new Error('Observation scope must match its working paper.');
    requireMutableScope(parent.entityId, parent.sealed || rawEngagements.find(e=>e.id===parent.engagementId)?.isLocked);
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

    // Findings remain drafts. The authenticated issuance transaction creates issues.

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
    const wp = rawWorkpapers.find(w=>w.id===workpaperId);
    if (!wp) throw new Error('Working paper not found');
    requireMutableScope(wp.entityId, wp.sealed || rawEngagements.find(e=>e.id===wp.engagementId)?.isLocked);
    if (['observer','org_admin','auditee'].includes(currentUser.role) || !text.trim()) throw new Error('Comment not permitted');
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
    _actorName: string
  ) => {
    const parent = rawWorkpapers.find(w=>w.id===workpaperId);
    if (!parent) throw new Error('Working paper not found');
    requireMutableScope(parent.entityId, parent.sealed || rawEngagements.find(e=>e.id===parent.engagementId)?.isLocked);
    if (!canPerformAction(currentUser,'edit_workpaper').allowed) throw new Error('Evidence not permitted');
    const item = {
      id: `ev-${Date.now()}`,
      name: file.name,
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentUser.name,
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
        actorName: currentUser.name,
        actorRole: currentUser.role,
        eventType: 'evidence_drop',
        entityId: wp.entityId,
        recordId: wp.id,
        recordType: 'evidence',
        payloadSummary: `Evidence attached by authorized user: ${file.name} (SHA-256: ${file.sha256.substring(0, 16)}...)`,
        payloadHash: file.sha256,
      });
    }
  };

  const orgRoleConfig = buildDefaultOrgRoleConfig();

  const updateCapStatus = (capId: string, status: CapStatus, retestStatus?: RetestStatus) => {
    setCommandError('Direct CAP status changes are disabled. Submit evidence and use independent validation.');
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
        commandError,
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
