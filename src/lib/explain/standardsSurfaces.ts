/**
 * Standards surfaces — where each IIA standard appears in the workflow (docs/EXPLAIN-LAYER.md §5.4;
 * E6, E7).
 *
 * §5.4 is explicit that the standards must not be a separate tab people never open: they appear (1)
 * on the thing itself, (2) on the lifecycle step, (3) on the screen, (4) in a full Standards view,
 * and (5) in the report and board pack. This module is the authored data that says which standards
 * each of those surfaces carries, so the affordance and the view are pure data and cannot invent a
 * mapping.
 *
 * Every screen id here is a real id from docs/ACP-UI-CONTRACT.md, and every standard number is one
 * of the verified numbers in docs/iia-standards-reference.md (G9 checks both).
 */
import { IIA_STANDARDS, iiaStandard, type IiaStandard } from './iia';

/**
 * The standards a screen addresses, derived from the standards' own `implementedBy` list, so the
 * screen view and the catalogue can never disagree. A screen with no standard returns an empty list
 * (the affordance then renders nothing, which is honest).
 */
export function standardsForScreen(screenId: string): IiaStandard[] {
  return IIA_STANDARDS.filter((s) => s.implementedBy.includes(screenId));
}

/** The lifecycle step ids and the standards each satisfies (docs/EXPLAIN-LAYER.md §5.4 item 2). */
export const LIFECYCLE_STEP_STANDARDS: Array<{ step: string; label: string; standards: string[] }> = [
  { step: 'planning', label: 'Planning', standards: ['13.2', '13.3', '13.4', '13.6', '9.4'] },
  { step: 'testing', label: 'Fieldwork', standards: ['14.1', '14.2', '14.6'] },
  { step: 'conclusion', label: 'Conclusion', standards: ['14.3', '14.4', '14.5'] },
  { step: 'seal', label: 'Seal and final communication', standards: ['15.1', '15.2', '14.6'] },
];

/** The standards a lifecycle step satisfies. Empty when the step is unknown. */
export function standardsForStep(step: string): IiaStandard[] {
  const row = LIFECYCLE_STEP_STANDARDS.find((s) => s.step === step);
  return (row?.standards ?? []).map((n) => iiaStandard(n)).filter((s): s is IiaStandard => !!s);
}

/**
 * The report sections and the standards each satisfies (docs/EXPLAIN-LAYER.md §5.4 item 5). The
 * section keys match the report editor's `SECTION_ORDER`, so a section tab can carry its tags.
 */
export const REPORT_SECTION_STANDARDS: Array<{ section: string; label: string; standards: string[] }> = [
  { section: 'executive_summary', label: 'Executive summary', standards: ['15.1', '14.5'] },
  { section: 'scope', label: 'Scope and approach', standards: ['13.3', '13.4', '13.5'] },
  { section: 'findings', label: 'Findings and recommendations', standards: ['14.2', '14.3', '14.4'] },
  { section: 'opinion', label: 'Opinion and conclusion', standards: ['15.1', '14.5'] },
  { section: 'appendices', label: 'Appendices', standards: ['14.6'] },
];

/** The standards a report section satisfies. */
export function standardsForReportSection(section: string): IiaStandard[] {
  const row = REPORT_SECTION_STANDARDS.find((s) => s.section === section);
  return (row?.standards ?? []).map((n) => iiaStandard(n)).filter((s): s is IiaStandard => !!s);
}
