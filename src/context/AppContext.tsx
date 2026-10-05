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
import { changeCapDueDate as changeCapDueDateFn, CapNotification, ChangeCapDueDateResult } from '../lib/cap';
import { appendLedgerEntry, computePayloadHash, generateInitialLedger, verifyChain } from '../lib/ledger';
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
  updateCapStatus: (capId: string, status: CapStatus, retestStatus?: RetestStatus) => void;
  capNotifications: CapNotification[];
  changeCapDueDate: (capId: string, newDueDate: string, reason?: string) => ChangeCapDueDateResult;
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
  const [capNotifications, setCapNotifications] = useState<CapNotification[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [glassBoxTokens, setGlassBoxTokens] = useState<GlassBoxToken[]>(initialGlassBoxTokens);

  useEffect(() => {
    let isMounted = true;
    generateInitialLedger().then((initial) => {
      if (isMounted) {
        setLedger(initial);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const [selectedUniverseId, setSelectedUniverseId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
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

    const gate = canPerformAction(currentUser, 'sign_off', {
      leadAuditorId: eng.leadAuditorId,
      preparerId: eng.leadAuditorId,
      isLocked: eng.isLocked,
    });
    if (!gate.allowed) {
      alert(gate.reason || 'Action not permitted');
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

  const updateCapStatus = (capId: string, status: CapStatus, retestStatus?: RetestStatus) => {
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

  const changeCapDueDate = (capId: string, newDueDate: string, reason?: string): ChangeCapDueDateResult => {
    const cap = rawCapItems.find((c) => c.id === capId);
    if (!cap) {
      return { ok: false, error: 'invalid_date', message: 'CAP not found.' };
    }
    const result = changeCapDueDateFn({
      cap,
      newDueDate,
      reason,
      actor: { id: currentUser.id, name: currentUser.name, role: currentUser.role },
    });
    if (result.ok) {
      setRawCapItems((prev) => prev.map((c) => (c.id === capId ? result.cap : c)));
      setCapNotifications((prev) => [result.notification, ...prev]);
    }
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
        finalizeTest,
        signOffWorkpaper,
        reopenWorkpaper,
        addObservation,
        addReviewComment,
        attachEvidenceToWorkpaper,
        updateCapStatus,
        capNotifications,
        changeCapDueDate,
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
