/**
 * CAP due-date change (pure, deterministic, no I/O, no AI).
 *
 * Minimal types introduced by this slice (documented here per the brief):
 *  - CapDueDateHistoryEntry: immutable record of one due-date change
 *      (who, when, old -> new). Stored in AuditCapItem.dueDateHistory (append-only).
 *  - CapNotification: in-app notification object (no email/SMS).
 *  - CapActor: the minimal user shape needed (id, name, role).
 *
 * Rules:
 *  - Only roles allowed by canChangeCapDueDate (audit_manager | cia) may change.
 *  - Closed CAPs cannot be changed.
 *  - New date must be a real YYYY-MM-DD calendar date and differ from the current one.
 *  - Dates in messages/history are ORG-LOCAL (see orgDate.ts), never UTC.
 *  - Moving a date into the past is allowed (the CAP then shows overdue via isCapOverdue).
 *  - Status is NOT migrated here (out of scope).
 */
import { AuditCapItem, Role } from '../types';
import { canChangeCapDueDate } from './access';
import { DEFAULT_ORG_TIME_ZONE, getOrgLocalToday } from './orgDate';

export type CapActor = { id: string; name: string; role: Role };

export type CapDueDateHistoryEntry = {
  readonly id: string;
  readonly capId: string;
  readonly changedById: string;
  readonly changedByName: string;
  readonly changedByRole: Role;
  /** Exact instant of the change (ISO-8601 UTC). */
  readonly changedAt: string;
  /** Org-local calendar date of the change (YYYY-MM-DD). */
  readonly changedOnOrgLocal: string;
  readonly oldDueDate: string;
  readonly newDueDate: string;
  readonly reason?: string;
};

export type CapNotification = {
  readonly id: string;
  readonly type: 'cap_due_date_changed';
  readonly capId: string;
  readonly recipients: readonly string[];
  readonly message: string;
  readonly createdAt: string;
  readonly createdOnOrgLocal: string;
  read: boolean;
};

export type ChangeCapDueDateError =
  | 'forbidden'
  | 'invalid_date'
  | 'unchanged'
  | 'cap_closed';

export type ChangeCapDueDateResult =
  | { ok: true; cap: AuditCapItem; historyEntry: CapDueDateHistoryEntry; notification: CapNotification }
  | { ok: false; error: ChangeCapDueDateError; message: string };

export type ChangeCapDueDateInput = {
  cap: AuditCapItem;
  newDueDate: string;
  actor: CapActor;
  reason?: string;
  /** Defaults to the frozen demo clock via getOrgLocalToday. */
  now?: Date;
  timeZone?: string;
};

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const fail = (error: ChangeCapDueDateError, message: string): ChangeCapDueDateResult => ({
  ok: false,
  error,
  message,
});

export function changeCapDueDate(input: ChangeCapDueDateInput): ChangeCapDueDateResult {
  const { cap, newDueDate, actor, reason, now, timeZone = DEFAULT_ORG_TIME_ZONE } = input;

  if (!canChangeCapDueDate(actor.role)) {
    return fail('forbidden', 'Only an Audit Manager or the CIA can change a CAP due date.');
  }
  if (cap.status === 'Closed') {
    return fail('cap_closed', 'A closed CAP cannot have its due date changed.');
  }
  if (!isValidIsoDate(newDueDate)) {
    return fail('invalid_date', 'Enter a valid date (YYYY-MM-DD).');
  }
  if (newDueDate === cap.dueDate) {
    return fail('unchanged', 'The new due date is the same as the current one.');
  }

  const changedOnOrgLocal = getOrgLocalToday(timeZone, now);
  // Instant: use provided clock; fall back to noon of the org-local demo day (deterministic).
  const instant = now ?? new Date(`${changedOnOrgLocal}T12:00:00+05:00`);
  const changedAt = instant.toISOString();
  const trimmedReason = reason?.trim() || undefined;
  const existing = cap.dueDateHistory ?? [];

  const historyEntry: CapDueDateHistoryEntry = Object.freeze({
    id: `${cap.id}-DD-${existing.length + 1}`,
    capId: cap.id,
    changedById: actor.id,
    changedByName: actor.name,
    changedByRole: actor.role,
    changedAt,
    changedOnOrgLocal,
    oldDueDate: cap.dueDate,
    newDueDate,
    ...(trimmedReason ? { reason: trimmedReason } : {}),
  });

  const notification: CapNotification = {
    id: `NTF-${historyEntry.id}`,
    type: 'cap_due_date_changed',
    capId: cap.id,
    recipients: [cap.owner],
    message: `${actor.name} changed the due date of ${cap.id} from ${cap.dueDate} to ${newDueDate} on ${changedOnOrgLocal}.`,
    createdAt: changedAt,
    createdOnOrgLocal: changedOnOrgLocal,
    read: false,
  };

  return {
    ok: true,
    cap: { ...cap, dueDate: newDueDate, dueDateHistory: [...existing, historyEntry] },
    historyEntry,
    notification,
  };
}
