import React from 'react';
import { AlertCircle } from './Icons';

interface InlineErrorProps {
  message: string | null | undefined;
  /** Optional dismiss handler. When given, a Dismiss button is shown. */
  onDismiss?: () => void;
  testId?: string;
  className?: string;
}

/**
 * Non-blocking, in-place error state. It replaces the browser's native blocking dialogs everywhere (Spec §27.5: no blocking modals).
 * Renders nothing when there is no message. Multi-line messages keep their line breaks.
 */
export const InlineError: React.FC<InlineErrorProps> = ({ message, onDismiss, testId = 'inline-error', className = '' }) => {
  if (!message) return null;
  return (
    <div
      role="alert"
      data-testid={testId}
      className={`flex items-start gap-2 px-3 py-2 rounded-xl text-apple-12 text-cinnabar bg-cinnabar-subtle border border-cinnabar ${className}`}
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1 whitespace-pre-line">{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-apple-11 font-medium underline shrink-0">
          Dismiss
        </button>
      )}
    </div>
  );
};
