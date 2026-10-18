/**
 * CAP status transitions — pure, deterministic, capability-gated by caller.
 */
import {
  AuditCapItem,
  CapCapability,
  CapStatus,
  CapStatusHistoryEntry,
  OrgRoleConfig,
  User,
} from '../types';
import { canPerformCapability } from './orgCapabilities';

export type CapStatusAction =
  | 'mark_in_progress'
  | 'submit_validation'
  | 'verify_close'
  | 'reject';

export const ACTION_CAPABILITY: Record<CapStatusAction, CapCapability> = {
  mark_in_progress: 'cap_mark_in_progress',
  submit_validation: 'cap_submit_validation',
  verify_close: 'cap_verify_close',
  reject: 'cap_reject',
};

export type TransitionCapInput = {
  cap: AuditCapItem;
  action: CapStatusAction;
  user: User;
  orgConfig: OrgRoleConfig;
  note?: string;
  evidenceRefs?: string[];
  /** Reject target when action is reject */
  rejectTo?: 'Open' | 'In progress';
  nowIso?: string;
};

export type TransitionCapResult =
  | { ok: true; cap: AuditCapItem }
  | { ok: false; reason: string };

function minChars(config: OrgRoleConfig): number {
  return config.policy?.capJustificationMinChars ?? 10;
}

function requireEvidence(config: OrgRoleConfig): boolean {
  return config.policy?.capRequireEvidenceOnSubmit !== false;
}

function nonWsLen(s?: string): number {
  return (s ?? '').trim().length;
}

function historyEntry(
  cap: AuditCapItem,
  user: User,
  action: CapStatusAction,
  from: CapStatus,
  to: CapStatus,
  at: string,
  note?: string,
  evidenceRefs?: string[]
): CapStatusHistoryEntry {
  return {
    id: `cap-hist-${cap.id}-${at}-${action}`,
    at,
    actorUserId: user.id,
    actorName: user.name,
    actorRole: user.role,
    fromStatus: from,
    toStatus: to,
    action,
    note: note?.trim() || undefined,
    evidenceRefs: evidenceRefs && evidenceRefs.length ? evidenceRefs : undefined,
  };
}

export function transitionCapStatus(input: TransitionCapInput): TransitionCapResult {
  const { cap, action, user, orgConfig, note, evidenceRefs, rejectTo, nowIso } = input;
  const at = nowIso ?? new Date().toISOString();
  const capability = ACTION_CAPABILITY[action];
  const gate = canPerformCapability(user, capability, orgConfig, {
    submitterUserId: cap.lastSubmittedByUserId,
  });
  if (!gate.allowed) return { ok: false, reason: gate.reason || 'Not permitted' };

  if (cap.status === 'Closed') {
    return { ok: false, reason: 'Closed CAPs cannot change status in this workflow' };
  }

  const from = cap.status;
  let to: CapStatus = from;
  let lastSubmittedByUserId = cap.lastSubmittedByUserId;
  let validationEvidence = cap.validationEvidence;
  const min = minChars(orgConfig);

  switch (action) {
    case 'mark_in_progress': {
      if (from !== 'Open' && from !== 'Overdue' && from !== 'In progress') {
        return { ok: false, reason: `Cannot mark in progress from status ${from}` };
      }
      to = 'In progress';
      break;
    }
    case 'submit_validation': {
      if (from !== 'Open' && from !== 'In progress' && from !== 'Overdue') {
        return { ok: false, reason: `Cannot submit for validation from status ${from}` };
      }
      if (nonWsLen(note) < min) {
        return {
          ok: false,
          reason: `Justification must be at least ${min} characters`,
        };
      }
      const refs = (evidenceRefs ?? []).map((r) => r.trim()).filter(Boolean);
      if (requireEvidence(orgConfig) && refs.length === 0 && !nonWsLen(cap.validationEvidence)) {
        return { ok: false, reason: 'At least one evidence reference is required to submit for validation' };
      }
      to = 'Pending validation';
      lastSubmittedByUserId = user.id;
      if (refs.length) validationEvidence = refs.join('; ');
      break;
    }
    case 'verify_close': {
      if (from !== 'Pending validation') {
        return { ok: false, reason: 'Only CAPs pending validation can be verified and closed' };
      }
      to = 'Closed';
      break;
    }
    case 'reject': {
      if (from !== 'Pending validation') {
        return { ok: false, reason: 'Only CAPs pending validation can be rejected' };
      }
      if (nonWsLen(note) < min) {
        return { ok: false, reason: `Rejection reason must be at least ${min} characters` };
      }
      to = rejectTo === 'Open' ? 'Open' : 'In progress';
      break;
    }
    default:
      return { ok: false, reason: 'Unknown action' };
  }

  const entry = historyEntry(cap, user, action, from, to, at, note, evidenceRefs);
  const statusHistory = [...(cap.statusHistory ?? []), entry];

  return {
    ok: true,
    cap: {
      ...cap,
      status: to,
      lastSubmittedByUserId,
      validationEvidence,
      statusHistory,
    },
  };
}

/**
 * The single canonical mapping between the UI CAP vocabulary and the §16.2 database vocabulary.
 * D-6D-CAP: the register table `caps` is authoritative; the UI keeps its labels but every read and
 * write crosses this one boundary, so no second status set survives in the product.
 */
export type DbCapStatus =
  | 'open'
  | 'verified_closed'
  | 'verified_closed_delay'
  | 'unverified'
  | 'overdue_unverified';

const UI_TO_DB: Record<CapStatus, DbCapStatus> = {
  Open: 'open',
  'In progress': 'open',
  'Pending validation': 'unverified',
  Overdue: 'overdue_unverified',
  Closed: 'verified_closed',
};

const DB_TO_UI: Record<DbCapStatus, CapStatus> = {
  open: 'Open',
  verified_closed: 'Closed',
  verified_closed_delay: 'Closed',
  unverified: 'Pending validation',
  overdue_unverified: 'Overdue',
};

export function capStatusToDb(status: CapStatus): DbCapStatus {
  return UI_TO_DB[status];
}

export function capStatusFromDb(status: DbCapStatus): CapStatus {
  return DB_TO_UI[status];
}
