import React from 'react';
import { ExplainPopout } from './ExplainPopout';
import { useApp } from '../../context/AppContext';
import {
  standardsForReportSection,
  standardsForScreen,
  standardsForStep,
} from '../../lib/explain/standardsSurfaces';
import type { IiaStandard } from '../../lib/explain/iia';

/**
 * Standards affordance (E6; docs/EXPLAIN-LAYER.md §5.4 items 1-3, 5).
 *
 * The IIA standards appear where the work happens, not in a tab people never open. This component
 * renders a compact, non-blocking chip row of the standards a screen, a lifecycle step or a report
 * section addresses, each chip opening the standard's explain popout, plus a control that opens the
 * full Standards view (E7).
 *
 * It is data-driven: the standards come from `standardsSurfaces`, which derives them from the
 * standard catalogue, so a chip cannot claim a mapping the catalogue does not carry. A surface with
 * no standards renders nothing rather than an empty box.
 */
export interface StandardsAffordanceProps {
  /** One of `screen`, `step` or `section`. */
  kind: 'screen' | 'step' | 'section';
  /** The screen id (`AF-06`), lifecycle step (`testing`) or report section key (`findings`). */
  target: string;
  /** The screen id that owns this affordance, for the testid prefix. */
  screenId: string;
  /** Optional element name; defaults to `standards`. */
  element?: string;
  /** The label shown before the chips. */
  label?: string;
  className?: string;
}

export const StandardsAffordance: React.FC<StandardsAffordanceProps> = ({
  kind,
  target,
  screenId,
  element = 'standards',
  label = 'IIA standards',
  className = '',
}) => {
  const { openInspector } = useApp();

  const standards: IiaStandard[] =
    kind === 'screen'
      ? standardsForScreen(target)
      : kind === 'step'
        ? standardsForStep(target)
        : standardsForReportSection(target);

  if (standards.length === 0) return null;

  const testId = `${screenId}-${element}`;

  return (
    <div
      data-testid={testId}
      data-standards-kind={kind}
      data-standards-target={target}
      className={`flex flex-wrap items-center gap-2 ${className}`}
    >
      <span className="text-apple-11 uppercase tracking-wider text-secondary">{label}</span>
      {standards.map((s) => (
        <ExplainPopout
          key={s.id}
          explainId={`standard.${s.id}`}
          screenId={screenId}
          element={`${element}-${s.id}`}
        >
          <span
            className="px-1.5 py-0.5 rounded text-apple-11 font-semibold bg-surface-sunken border border-hairline text-secondary hover:text-primary transition-colors"
            title={s.title}
          >
            IIA {s.id}
          </span>
        </ExplainPopout>
      ))}
      <button
        type="button"
        data-testid={`${testId}-open`}
        onClick={() => openInspector('standards', { kind, target })}
        className="px-2 py-0.5 rounded text-apple-11 font-medium border border-hairline text-accent hover:bg-accent-subtle transition-colors"
      >
        Standards view
      </button>
    </div>
  );
};
