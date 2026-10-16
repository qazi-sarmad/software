import React from 'react';
import { useRecordViewMode } from '../../hooks/useRecordViewMode';
import { FloatingWindow } from './FloatingWindow';

/**
 * RecordView (H3b/H3c, spec §17.1, §27.5).
 *
 * A record opens in one of two non-blocking modes, chosen by the user's `record_view_mode`
 * preference:
 *   - full_page:        the caller navigates to the record's own route (/view/:recordType/:id).
 *                       This component renders null; there is no overlay.
 *   - floating_window:  the record opens in the shared FloatingWindow chrome (draggable,
 *                       minimisable, pop-out), the same window the Audit File uses.
 *
 * There is never a blocking modal: no backdrop scrim and no aria-modal.
 */
export interface RecordViewProps {
  recordType: string;
  recordId: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
  /** Rendered when mode is floating_window and the caller wants a minimise control. */
  onNavigateFullPage?: () => void;
}

export const RecordView: React.FC<RecordViewProps> = ({
  recordType,
  recordId,
  title,
  subtitle,
  children,
  footer,
  onClose,
}) => {
  const [mode] = useRecordViewMode();

  if (mode !== 'floating_window') {
    // full_page: the caller is responsible for routing; nothing is rendered inline.
    return null;
  }

  const windowId = `${recordType}:${recordId}`;
  return (
    <FloatingWindow
      windowId={windowId}
      title={title}
      subtitle={subtitle}
      onClose={onClose ?? (() => {})}
      footer={footer}
      popOutUrl={`/view/${recordType}/${recordId}`}
    >
      {children}
    </FloatingWindow>
  );
};
