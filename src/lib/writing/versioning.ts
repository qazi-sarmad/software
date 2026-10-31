/**
 * W8: versioning and comparison.
 *
 * 8.1 compare_report_versions: added, changed and removed claims and changed figures between two
 *     versions, with the cause (changed record, changed phrase version, changed register, auditor
 *     edit).
 * 8.2 Older reports keep the phrase and engine versions they were built with; re-rendering an old
 *     version with its recorded versions reproduces the original bytes.
 * 8.3 A functional screen: version compare, including a register and locale compare.
 */

import type { Claim, FigureBinding } from './types';

export interface ReportVersionSnapshot {
  id: string;
  /** The engine, template and phrase-library versions this version was built with. */
  versions: { engine: string; template: string; phraseLibrary: string };
  claims: Claim[];
  graphRoot: string;
  renderHash: string;
}

export type ChangeCause =
  | 'added'
  | 'removed'
  | 'changed_record'
  | 'changed_phrase_version'
  | 'changed_register'
  | 'auditor_edit'
  | 'changed_figure'
  | 'changed_slots';

export interface ClaimChange {
  claimId: string;
  cause: ChangeCause;
  detail: string;
}

export interface VersionComparison {
  added: ClaimChange[];
  removed: ClaimChange[];
  changed: ClaimChange[];
  changedFigures: Array<{ claimId: string; figureId: string; from: string; to: string }>;
  graphRootChanged: boolean;
  renderHashChanged: boolean;
}

/** W8.1: compare two report versions claim by claim. */
export function compareReportVersions(before: ReportVersionSnapshot, after: ReportVersionSnapshot): VersionComparison {
  const beforeById = new Map(before.claims.map((c) => [c.id, c]));
  const afterById = new Map(after.claims.map((c) => [c.id, c]));
  const added: ClaimChange[] = [];
  const removed: ClaimChange[] = [];
  const changed: ClaimChange[] = [];
  const changedFigures: VersionComparison['changedFigures'] = [];

  for (const id of afterById.keys()) {
    if (!beforeById.has(id)) added.push({ claimId: id, cause: 'added', detail: 'claim present only in the newer version' });
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) removed.push({ claimId: id, cause: 'removed', detail: 'claim present only in the older version' });
  }
  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (!a) continue;
    if (b.phraseVersion !== a.phraseVersion) {
      changed.push({ claimId: id, cause: 'changed_phrase_version', detail: `phrase version ${b.phraseVersion} -> ${a.phraseVersion}` });
    }
    if (b.auditorText !== a.auditorText) {
      changed.push({ claimId: id, cause: 'auditor_edit', detail: 'auditor text changed' });
    }
    if (referenceChanged(b.references, a.references)) {
      changed.push({ claimId: id, cause: 'changed_record', detail: 'a referenced record or its content hash changed' });
    }
    if (slotSignature(b.slots) !== slotSignature(a.slots)) {
      changed.push({ claimId: id, cause: 'changed_slots', detail: 'a typed slot value changed' });
    }
    for (const fb of b.figures) {
      const fa = a.figures.find((f) => f.figureId === fb.figureId);
      if (!fa) {
        changedFigures.push({ claimId: id, figureId: fb.figureId, from: fb.result, to: '<removed>' });
      } else if (fa.result !== fb.result || fa.figureVersion !== fb.figureVersion) {
        changedFigures.push({ claimId: id, figureId: fb.figureId, from: fb.result, to: fa.result });
      }
    }
    for (const fa of a.figures) {
      if (!b.figures.some((f) => f.figureId === fa.figureId)) {
        changedFigures.push({ claimId: id, figureId: fa.figureId, from: '<none>', to: fa.result });
      }
    }
  }
  changed.sort((x, y) => (x.claimId < y.claimId ? -1 : 1));
  return {
    added,
    removed,
    changed,
    changedFigures,
    graphRootChanged: before.graphRoot !== after.graphRoot,
    renderHashChanged: before.renderHash !== after.renderHash,
  };
}

function referenceChanged(before: Claim['references'], after: Claim['references']): boolean {
  const sig = (refs: Claim['references']) => refs.map((r) => `${r.type}:${r.id}:${r.contentHash}`).sort().join('|');
  return sig(before) !== sig(after);
}

function slotSignature(slots: Claim['slots']): string {
  return slots.map((s) => `${s.name}=${JSON.stringify(s.value)}`).sort().join('|');
}

/**
 * W8.3: the register and locale comparison. The same facts, two renderings, side by side. The graph
 * root is identical; only the words differ.
 */
export interface RegisterComparisonRow {
  claimId: string;
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}

export function compareRenders(
  leftLabel: string, left: Array<{ claimId: string; text: string }>,
  rightLabel: string, right: Array<{ claimId: string; text: string }>,
): RegisterComparisonRow[] {
  const rightBy = new Map(right.map((r) => [r.claimId, r.text]));
  return left.map((l) => ({
    claimId: l.claimId,
    left: l.text,
    right: rightBy.get(l.claimId) ?? '',
    leftLabel,
    rightLabel,
  }));
}

/** A figure binding's identity for a comparison table. */
export function figureKey(binding: FigureBinding): string {
  return `${binding.figureId}@${binding.figureVersion}`;
}
