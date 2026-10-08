/** Cascade for "Raise Formal Audit Finding": Department → Audit (annual / special) → Working paper. Pure. */
import { AuditEngagement, AuditEntity, WorkingPaper } from '../types';
import { getWorkpaperLock } from './workpaperLock';

export type AuditOption = { id: string; label: string; special: boolean };
export type WorkpaperOption = { id: string; label: string; locked: boolean };

export function departmentsOf(entities: Pick<AuditEntity, 'department'>[]): string[] {
  return Array.from(new Set(entities.map((e) => e.department))).sort((a, b) => a.localeCompare(b));
}

export function auditsForDepartment(
  department: string,
  entities: Pick<AuditEntity, 'id' | 'department'>[],
  engagements: Pick<AuditEngagement, 'id' | 'entityId' | 'title' | 'isAdHoc'>[]
): AuditOption[] {
  const ids = new Set(entities.filter((e) => e.department === department).map((e) => e.id));
  return engagements
    .filter((g) => ids.has(g.entityId))
    .map((g) => ({
      id: g.id,
      special: Boolean(g.isAdHoc),
      label: `${g.title} · ${g.isAdHoc ? 'Special / ad hoc' : 'Annual plan'}`,
    }));
}

export function workpapersForAudit(
  engagementId: string,
  workpapers: WorkingPaper[],
  engagements: Pick<AuditEngagement, 'id' | 'status' | 'isLocked' | 'signedOffAt'>[]
): WorkpaperOption[] {
  const eng = engagements.find((g) => g.id === engagementId);
  return workpapers
    .filter((w) => w.engagementId === engagementId)
    .map((w) => ({
      id: w.id,
      label: `${w.refCode} • ${w.title}`,
      locked: getWorkpaperLock(w, eng).locked,
    }));
}
