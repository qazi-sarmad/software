/**
 * Board Pack model (F10, S7).
 *
 * Pure functions only: no database client, no DOM. The database builds and hashes the snapshot
 * (board_pack_snapshot); this module turns that snapshot into the rows a screen renders, mirrors the
 * database's "every figure carries refs" walk so the app can fail loudly too, computes the delta
 * against the previous pack, and builds the drill-down URL for a figure. Deterministic throughout
 * (L1): no randomness, no AI.
 */

/** The SIRA heatmap and the plan Gantt shapes live with their own pure module; re-exported types
 *  keep the snapshot interface in one place. */
import type { GanttRow, SiraHeatmap } from './boardPackVisuals';

export type { GanttRow, SiraHeatmap };

/** A pointer to the sealed or ledgered record a figure came from. */
export interface FigureRef {
  type: string;
  id: string;
}

/** One number in the pack, with the records behind it. */
export interface Figure {
  value: number;
  refs: FigureRef[];
  [key: string]: unknown;
}

export interface BoardPackSnapshot {
  scope_key?: string;
  org_id?: string;
  from_ts?: string;
  to_ts?: string;
  /** `heatmap` is the entity × band grid (migration 0099); older packs carry only `bands`. */
  sira?: { bands?: Figure[]; heatmap?: SiraHeatmap };
  /** `gantt` is one row per dated plan item (migration 0099); older packs carry only the counts. */
  plan?: Figure & { by_status?: Figure[]; gantt?: GanttRow[] };
  cap?: Record<string, Figure>;
  sealed_work?: Figure & { sealed_engagements?: Figure; root_hashes?: unknown[] };
  management_responses?: Figure;
  excluded?: Record<string, unknown>;
}

export interface FigureRow {
  /** Dotted path of the figure inside the snapshot, e.g. "cap.31-60". */
  path: string;
  label: string;
  value: number;
  refs: FigureRef[];
}

export interface BoardPackRow {
  id: string;
  scopeKey: string;
  scopeDescription: string;
  boundaryKind: string;
  fromTs: string | null;
  toTs: string | null;
  generatedBy: string | null;
  generatedAt: string;
  dataHash: string;
  status: string;
  ledgerEntryId: string | null;
  previousPackId: string | null;
}

export interface BoardPackSection {
  sectionKey: string;
  label: string;
  ordinal: number;
  enabled: boolean;
  visibleRoles: string[];
}

export interface SnapshotDelta {
  added: FigureRow[];
  changed: { path: string; label: string; from: number; to: number }[];
  removed: FigureRow[];
}

/** The eight sections F10 names, in order. The database seeds the same list (board_pack_sections_seed). */
export const DEFAULT_SECTIONS: Omit<BoardPackSection, 'visibleRoles'>[] = [
  { sectionKey: 'cover', label: 'Cover and assurance statement', ordinal: 1, enabled: true },
  { sectionKey: 'changes', label: 'What changed since the last pack', ordinal: 2, enabled: true },
  { sectionKey: 'sira', label: 'SIRA residual risk and heatmap', ordinal: 3, enabled: true },
  { sectionKey: 'plan', label: 'Audit plan progress and Gantt', ordinal: 4, enabled: true },
  { sectionKey: 'issues', label: 'Open issues and CAP aging by severity', ordinal: 5, enabled: true },
  { sectionKey: 'sealed', label: 'Sealed work and integrity', ordinal: 6, enabled: true },
  { sectionKey: 'management_responses', label: 'Management responses', ordinal: 7, enabled: true },
  { sectionKey: 'sources', label: 'Sources index', ordinal: 8, enabled: true },
];

/** Human labels for the CAP aging bands, so the screen never shows a raw band key. */
const CAP_BAND_LABELS: Record<string, string> = {
  '0-30': '0 to 30 days overdue',
  '31-60': '31 to 60 days overdue',
  '61-90': '61 to 90 days overdue',
  '90+': 'More than 90 days overdue',
  not_due: 'Not yet due',
  no_due_date: 'No due date',
};

export function capBandLabel(band: string): string {
  return CAP_BAND_LABELS[band] ?? band;
}

function isFigure(v: unknown): v is Figure {
  return typeof v === 'object' && v !== null && typeof (v as Figure).value === 'number';
}

/**
 * Flatten a snapshot into the rows a screen renders. A deterministic walk: object keys in insertion
 * order, arrays by index. Figures nested one level inside a named object are included.
 */
export function collectFigures(snapshot: BoardPackSnapshot | null | undefined): FigureRow[] {
  const rows: FigureRow[] = [];
  if (!snapshot) return rows;

  const push = (path: string, label: string, fig: Figure) => {
    rows.push({ path, label, value: fig.value, refs: Array.isArray(fig.refs) ? fig.refs : [] });
  };

  const walk = (path: string, label: string, node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(`${path}[${i}]`, label, child));
      return;
    }
    if (!isFigure(node)) return;
    push(path, label, node);
    for (const [key, child] of Object.entries(node)) {
      if (key === 'value' || key === 'refs') continue;
      // `gantt` is pushed by the caller with a title-bearing label, so the generic walk skips it.
      if (key === 'gantt') continue;
      if (Array.isArray(child)) {
        child.forEach((c, i) => {
          if (isFigure(c)) push(`${path}.${key}[${i}]`, label, c);
        });
      } else if (isFigure(child)) {
        push(`${path}.${key}`, label, child);
      }
    }
  };

  if (snapshot.sira?.bands) {
    snapshot.sira.bands.forEach((b, i) => {
      const band = typeof b.band === 'string' ? b.band : `band ${i + 1}`;
      push(`sira.bands[${i}]`, `SIRA residual risk: ${band}`, b);
    });
  }
  // The heatmap cells are figures too, so a cell with a value and no refs fails loudly (F10).
  (snapshot.sira?.heatmap?.cells ?? []).forEach((c, i) => {
    push(`sira.heatmap.cells[${i}]`, `SIRA heatmap: ${c.entity} × ${c.band}`, c as unknown as Figure);
  });
  if (snapshot.plan) walk('plan', 'Audit plan items', snapshot.plan);
  // Each Gantt bar carries value 1 and its own ref, so it is a figure like any other.
  (snapshot.plan?.gantt ?? []).forEach((g, i) => {
    push(`plan.gantt[${i}]`, `Plan window: ${g.title ?? `item ${i + 1}`}`, g as unknown as Figure);
  });
  if (snapshot.cap) {
    for (const [band, fig] of Object.entries(snapshot.cap)) {
      if (isFigure(fig)) push(`cap.${band}`, `CAP aging: ${capBandLabel(band)}`, fig);
    }
  }
  if (snapshot.sealed_work) walk('sealed_work', 'Sealed workpapers', snapshot.sealed_work);
  if (snapshot.management_responses) {
    push('management_responses', 'Management responses', snapshot.management_responses);
  }
  return rows;
}

/**
 * The figures that carry no refs. Mirrors the database's board_pack_figure_refs so the app can warn
 * before it renders a figure with nothing to drill into. A figure whose value is zero has nothing to
 * point at and is allowed.
 */
export function figuresWithoutRefs(snapshot: BoardPackSnapshot | null | undefined): string[] {
  return collectFigures(snapshot)
    .filter((r) => r.value !== 0 && r.refs.length === 0)
    .map((r) => r.path);
}

/** The delta between two snapshots of the same scope_key: added, changed and removed figures. */
export function deltaAgainst(
  previous: BoardPackSnapshot | null | undefined, next: BoardPackSnapshot | null | undefined
): SnapshotDelta {
  const before = new Map(collectFigures(previous).map((r) => [r.path, r]));
  const after = new Map(collectFigures(next).map((r) => [r.path, r]));
  const added: FigureRow[] = [];
  const changed: SnapshotDelta['changed'] = [];
  const removed: FigureRow[] = [];
  for (const [path, row] of after) {
    const prev = before.get(path);
    if (!prev) added.push(row);
    else if (prev.value !== row.value) {
      changed.push({ path, label: row.label, from: prev.value, to: row.value });
    }
  }
  for (const [path, row] of before) if (!after.has(path)) removed.push(row);
  return { added, changed, removed };
}

/** The drill-down URL for a figure's ref. PDF and PPTX links use the same shape (F10). */
export function figureDrillDownUrl(appBaseUrl: string, ref: FigureRef): string {
  const base = appBaseUrl.replace(/\/+$/, '');
  return `${base}/view/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}`;
}

/** Whether a section is visible to a caller holding these role slugs (F10 per-section visibility). */
export function sectionVisible(section: BoardPackSection, roleSlugs: string[]): boolean {
  if (!section.enabled) return false;
  if (section.visibleRoles.length === 0) return true;
  return section.visibleRoles.some((r) => roleSlugs.includes(r));
}

/** The sections in display order, filtered to what the caller may see. */
export function visibleSections(
  sections: BoardPackSection[], roleSlugs: string[]
): BoardPackSection[] {
  return [...sections]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((s) => sectionVisible(s, roleSlugs));
}

/** A plain-language sentence for the excluded footnote (F10 "n items not yet sealed"). */
export function excludedNote(snapshot: BoardPackSnapshot | null | undefined): string {
  const ex = snapshot?.excluded ?? {};
  const wp = Number(ex.unsealed_workpapers ?? 0);
  const en = Number(ex.unsealed_engagements ?? 0);
  if (!wp && !en) return 'Nothing is excluded: every item is sealed.';
  const parts: string[] = [];
  if (wp) parts.push(`${wp} workpaper${wp === 1 ? '' : 's'}`);
  if (en) parts.push(`${en} engagement${en === 1 ? '' : 's'}`);
  return `${parts.join(' and ')} not yet sealed are not included.`;
}
