import React from 'react';
import { HoverPreview } from '../common/HoverPreview';
import type { CommentPopoutModel } from '../../lib/commentPopout';

/**
 * The review-comment popout (S21; docs/EXPLAIN-LAYER.md §2).
 *
 * It wraps a comment row in the existing `HoverPreview` chrome (the same hover/focus popout used by
 * the explain layer) and renders the pure `commentPopout` model: author, age, workpaper,
 * engagement, status and the resolution path — access-filtered, because the model re-checks the
 * viewer's rights and redacts (Law L2). Non-blocking by construction: `HoverPreview` renders a
 * `pointer-events: none` popover, never a scrim or a modal, so the panel behind it stays usable.
 *
 * The trigger is focusable and opens on focus; the popover is a tooltip, so it never steals focus.
 */
export interface CommentPopoutProps {
  model: CommentPopoutModel;
  /** The screen id, so every interactive element carries `<screenId>-<element>`. */
  screenId: string;
  /** Element name for the trigger testid; defaults to `comment-popout`. */
  element?: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export const CommentPopout: React.FC<CommentPopoutProps> = ({
  model,
  screenId,
  element = 'comment-popout',
  children,
  onClick,
  className = '',
}) => {
  const testId = `${screenId}-${element}`;
  const redacted = model.status === 'redacted';

  return (
    <HoverPreview
      className={className}
      onClick={onClick}
      tooltipId={`${testId}-tip`}
      content={{
        title: redacted ? 'Restricted comment' : model.author,
        subtitle: redacted ? model.redactedReason ?? 'Not visible to your role' : model.text ?? '',
        category: redacted ? 'Review' : `${model.authorRole} · ${model.ageLabel}`,
        status: model.statusLabel,
        statusType: redacted ? 'cinnabar' : model.status === 'open' ? 'cinnabar' : 'verdigris',
        metrics: [
          ...(model.workpaperRef
            ? [{ label: 'Workpaper', value: `${model.workpaperRef}${model.workpaperTitle ? ` · ${model.workpaperTitle}` : ''}` }]
            : []),
          ...(model.engagementTitle ? [{ label: 'Engagement', value: model.engagementTitle }] : []),
          { label: 'Age', value: model.ageLabel },
        ],
        hint: model.resolutionPath,
      }}
    >
      <span
        data-testid={testId}
        data-comment-status={model.status}
        data-comment-id={model.id}
      >
        {children}
      </span>
    </HoverPreview>
  );
};
