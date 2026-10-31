/**
 * Drilldown from an aggregate to the exact records that produced it (E5, U1; docs/EXPLAIN-LAYER.md §4).
 *
 * A number on a screen summarises a set of records. This module is the pure rule that turns the
 * caller's ALREADY-SCOPED and ALREADY-FILTERED rows into the list the number was counted from, so
 * the drilldown can never widen access: it only ever restates rows the host screen already held.
 *
 * Everything here is a pure function of its arguments. No clock, no client, no tenant read.
 */
import type {
  AuditCapItem,
  AuditEntity,
  AuditEngagement,
  AuditIssue,
  AuditObservation,
  ReviewComment,
  WorkingPaper,
} from '../types';

/** The record families a dashboard number can summarise. */
export type DrillKind = 'entities' | 'engagements' | 'issues' | 'workpapers' | 'caps' | 'observations' | 'comments';

export const DRILL_KINDS: DrillKind[] = [
  'entities',
  'engagements',
  'issues',
  'workpapers',
  'caps',
  'observations',
  'comments',
];

/** One row in a drilldown: the minimum needed to name it and to open its record. */
export interface DrillItem {
  id: string;
  title: string;
  subtitle?: string;
  /** Status/severity chip text, when the family has one. */
  badge?: string;
}

/** A drilldown target: which family, what it is called, and the filter that produced the number. */
export interface DrillTarget {
  kind: DrillKind;
  /** Human label for the panel header, e.g. "In Fieldwork". */
  label: string;
  /** Plain-language description of the filter, e.g. "status is in_progress". */
  filterSummary: string;
  /** Optional extra narrowing the host applies to the source rows (e.g. a CAP department). */
  department?: string;
}

/** The rows the host screen already filtered, grouped by family. */
export interface DrillSource {
  entities: AuditEntity[];
  engagements: AuditEngagement[];
  issues: AuditIssue[];
  workpapers: WorkingPaper[];
  caps: AuditCapItem[];
  observations: AuditObservation[];
  comments: ReviewComment[];
}

/** Rows whose department matches, when the target names one. Entities have no department link here. */
function byDepartment<T extends { department: string }>(rows: T[], department?: string): T[] {
  return department ? rows.filter((r) => r.department === department) : rows;
}

/** Map each family's rows to drill items. Each mapper is pure and deterministic. */
export function drillItems(kind: DrillKind, source: DrillSource, department?: string): DrillItem[] {
  switch (kind) {
    case 'entities':
      return source.entities.map((e) => ({
        id: e.id,
        title: e.name,
        subtitle: e.department,
        badge: `${e.residualRisk} residual`,
      }));
    case 'engagements':
      return source.engagements.map((e) => ({
        id: e.id,
        title: e.title,
        subtitle: e.stage,
        badge: e.status,
      }));
    case 'issues':
      return byDepartment(source.issues, department).map((i) => ({
        id: i.id,
        title: i.title,
        subtitle: i.department,
        badge: i.severity,
      }));
    case 'workpapers':
      return source.workpapers.map((w) => ({
        id: w.id,
        title: `${w.refCode} · ${w.title}`,
        subtitle: w.status,
        badge: w.sealed ? 'sealed' : undefined,
      }));
    case 'caps':
      return byDepartment(source.caps, department).map((c) => ({
        id: c.id,
        title: c.title,
        subtitle: c.owner,
        badge: c.status,
      }));
    case 'observations':
      return source.observations.map((o) => ({
        id: o.id,
        title: o.title,
        subtitle: o.status,
        badge: o.severity,
      }));
    case 'comments':
      return source.comments.map((c) => ({
        id: c.id,
        title: c.text,
        subtitle: `${c.authorName} · ${c.createdAt.slice(0, 10)}`,
        badge: c.status === 'cleared' || c.resolved ? 'cleared' : 'open',
      }));
  }
}

/**
 * The exact predicates the dashboard's numbers are counted with. Kept here, beside the drilldown, so
 * the number and its drilldown cannot silently drift apart: both call the same function.
 */
export function engagementsInProgress(rows: AuditEngagement[]): AuditEngagement[] {
  return rows.filter((e) => e.status === 'in_progress');
}

export function openIssues(rows: AuditIssue[]): AuditIssue[] {
  return rows.filter((i) => i.status !== 'closed' && i.status !== 'remediated');
}

export function sealedWorkpapers(rows: WorkingPaper[]): WorkingPaper[] {
  return rows.filter((w) => w.sealed);
}

/** Caps that are not closed. The overdue subset is `overdueCaps`. */
export function openCaps(rows: AuditCapItem[]): AuditCapItem[] {
  return rows.filter((c) => c.status !== 'Closed');
}

/** Deep link for a drilldown: a hash the shell reads on load, so a drilldown state is shareable. */
export function drillHash(target: DrillTarget): string {
  return `#drill=${target.kind}`;
}

/** Parse a drilldown hash back to a target, or null when the hash is not a drilldown. */
export function parseDrillHash(hash: string): DrillTarget | null {
  const m = /(?:^#|&)drill=([a-z_]+)/.exec(hash);
  if (!m) return null;
  const kind = m[1] as DrillKind;
  if (!DRILL_KINDS.includes(kind)) return null;
  return { kind, label: '', filterSummary: '' };
}
