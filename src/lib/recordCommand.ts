/**
 * Record commands (U2; docs/SYSTELIGON.md §11.1c Tier 1 item 2).
 *
 * The palette can jump to a record, not just a screen. This module turns a record the host screen
 * has ALREADY scoped (through `src/lib/access.ts`) into (a) the search row the palette ranks and
 * (b) the open descriptor the palette dispatches. It performs no filtering of its own — the caller
 * passes only rows it is allowed to see (Law L2).
 *
 * A record opens the SAME drilldown the dashboard drilldown opens (RecordView /
 * FloatingWindowManager), so the palette is a keyboard route to an existing path, never a new one.
 */
import type {
  AuditCapItem,
  AuditEngagement,
  AuditEntity,
  AuditIssue,
  AuditObservation,
  WorkingPaper,
} from '../types';
import type { RecordCommandInput, RecordFamily } from './commandPalette';

type Mapper<T> = (r: T) => RecordCommandInput;

export function commandToRecord(family: 'entity'): Mapper<AuditEntity>;
export function commandToRecord(family: 'engagement'): Mapper<AuditEngagement>;
export function commandToRecord(family: 'workpaper'): Mapper<WorkingPaper>;
export function commandToRecord(family: 'issue'): Mapper<AuditIssue>;
export function commandToRecord(family: 'cap'): Mapper<AuditCapItem>;
export function commandToRecord(family: 'observation'): Mapper<AuditObservation>;
export function commandToRecord(family: RecordFamily): Mapper<never> {
  const mapper = (row: unknown): RecordCommandInput => {
    switch (family) {
      case 'entity': {
        const e = row as AuditEntity;
        return {
          id: e.id,
          family,
          title: e.name,
          subtitle: `${e.code} · ${e.department}`,
          keywords: [e.code, e.department, e.headOfDepartment, e.status],
        };
      }
      case 'engagement': {
        const e = row as AuditEngagement;
        return {
          id: e.id,
          family,
          title: e.title,
          subtitle: `${e.stage} · due ${e.dueDate}`,
          keywords: [e.stage, e.status, e.dueDate],
        };
      }
      case 'workpaper': {
        const w = row as WorkingPaper;
        return {
          id: w.id,
          family,
          title: `${w.refCode}: ${w.title}`,
          subtitle: w.status.replace('_', ' '),
          keywords: [w.refCode, w.status, w.objective ?? ''],
        };
      }
      case 'issue': {
        const i = row as AuditIssue;
        return {
          id: i.id,
          family,
          title: i.title,
          subtitle: `${i.status.replace('_', ' ')} · due ${i.dueDate}`,
          keywords: [i.status, i.department, i.severity],
        };
      }
      case 'cap': {
        const c = row as AuditCapItem;
        return {
          id: c.id,
          family,
          title: c.title,
          subtitle: `${c.status} · ${c.department}`,
          keywords: [c.status, c.department, c.owner, c.severity],
        };
      }
      case 'observation': {
        const o = row as AuditObservation;
        return {
          id: o.id,
          family,
          title: o.title,
          subtitle: o.severity,
          keywords: [o.severity, o.status, o.ruleId ?? ''],
        };
      }
    }
  };
  return mapper as Mapper<never>;
}

/** The rows the resolver searches — the caller passes only the ALREADY-SCOPED arrays. */
export interface RecordScope {
  entities: AuditEntity[];
  engagements: AuditEngagement[];
  workpapers: WorkingPaper[];
  issues: AuditIssue[];
  caps: AuditCapItem[];
  observations: AuditObservation[];
}

/** How to open a record: the existing inspector to mount, its payload, and any tab to switch to. */
export interface RecordRef {
  family: RecordFamily;
  id: string;
  inspector?: string;
  data?: unknown;
  tab?: string;
}

/**
 * Resolve a family + id to its open descriptor, searching only the caller's scoped rows. Returns
 * null when the record is not in scope — so the palette can never open a record the screen behind it
 * would have hidden.
 */
export function resolveRecordRef(family: RecordFamily, id: string, scope: RecordScope): RecordRef | null {
  switch (family) {
    case 'entity': {
      const e = scope.entities.find((x) => x.id === id);
      return e ? { family, id: e.id, tab: 'universe' } : null;
    }
    case 'engagement': {
      const e = scope.engagements.find((x) => x.id === id);
      return e ? { family, id: e.id, inspector: 'audit_file', data: { engagement: { id: e.id } } } : null;
    }
    case 'workpaper': {
      const w = scope.workpapers.find((x) => x.id === id);
      return w ? { family, id: w.id, inspector: 'workbench', data: { workpaperId: w.id } } : null;
    }
    case 'issue': {
      const i = scope.issues.find((x) => x.id === id);
      return i ? { family, id: i.id, tab: 'issues' } : null;
    }
    case 'cap': {
      const c = scope.caps.find((x) => x.id === id);
      return c ? { family, id: c.id, inspector: 'cap_inspector', data: { cap: c, department: c.department } } : null;
    }
    case 'observation': {
      const o = scope.observations.find((x) => x.id === id);
      return o ? { family, id: o.id, inspector: 'observation', data: o } : null;
    }
  }
}
