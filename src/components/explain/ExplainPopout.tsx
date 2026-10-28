import React from 'react';
import { HoverPreview } from '../common/HoverPreview';
import { useExplain } from '../../hooks/useExplain';
import type { ExplainContext } from '../../lib/explain/catalogue';

/**
 * The explain affordance (docs/EXPLAIN-LAYER.md §2, E2/E4).
 *
 * It wraps any trigger in the existing `HoverPreview` chrome (the same hover/focus/long-press popout
 * used elsewhere) and renders the catalogue entry for `explainId`. It is non-blocking by construction
 * — `HoverPreview` renders a `pointer-events: none` popover, never a scrim or a modal — so a screen
 * can carry an explain affordance on every number without ever trapping the user.
 *
 * The popout renders STATIC catalogue content (safe for any signed-in user) plus any contextual
 * values the host screen already filtered. It never queries and never decides access to tenant data;
 * it re-checks the caller's rights and redacts (Law L2).
 *
 * Accessibility: the trigger is focusable and opens on focus; the popover itself is presented as
 * `role="complementary"` by its host when it is rendered as a panel. The hover card is a tooltip, so
 * it is not announced as a dialog and never steals focus.
 */
export interface ExplainPopoutProps {
  /** The catalogue id to explain, e.g. `method.mus`. */
  explainId: string;
  /** Contextual values the HOST SCREEN has already filtered. Never tenant content fetched here. */
  context?: ExplainContext;
  children: React.ReactNode;
  /** The screen id, so every interactive element carries `<screenId>-<element>`. */
  screenId: string;
  /** Optional element name; defaults to `explain`. */
  element?: string;
  className?: string;
  onClick?: () => void;
}

export const ExplainPopout: React.FC<ExplainPopoutProps> = ({
  explainId,
  context,
  children,
  screenId,
  element = 'explain',
  className = '',
  onClick,
}) => {
  const { view } = useExplain(explainId, context);
  const testId = `${screenId}-${element}`;

  const statusType = view.status === 'denied' ? 'cinnabar' : 'neutral';

  return (
    <HoverPreview
      className={className}
      onClick={onClick}
      tooltipId={`${testId}-tip`}
      content={{
        title: view.title,
        subtitle: view.status === 'denied' ? view.deniedReason : view.summary,
        category: view.kind === 'standard' ? 'Standard' : 'Explain',
        status: view.status === 'denied' ? 'Restricted' : undefined,
        statusType,
        metrics: view.values.map((v) => ({ label: v.label, value: v.value })),
        hint: view.status === 'denied' ? 'No detail available' : 'What it is and what it does',
      }}
    >
      <span data-testid={testId} data-explain-id={view.id} data-explain-status={view.status}>
        {children}
      </span>
    </HoverPreview>
  );
};
