import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { RecordContent, INSPECTOR_TITLES } from './RecordContent';
import type { InspectorType } from '../../context/AppContext';
import { Minus, X } from './Icons';

/**
 * FloatingWindowManager (5C, spec §17.1, §27.5).
 *
 * Manages the array of open floating windows. Each window is identified by `recordType:recordId`, so
 * the same record can never open twice. Windows are non-blocking by construction (no scrim, no
 * aria-modal): they can be minimised to a dock at the bottom, dragged, and popped out as their own
 * same-origin browser window that shares the session. The Audit File window is one record type here,
 * so its chrome is the same chrome every other record uses.
 */
export interface OpenWindow {
  windowId: string;
  recordType: InspectorType;
  recordId: string;
  title: string;
  data?: unknown;
}

export const recordWindowId = (recordType: InspectorType, recordId: string) => `${recordType}:${recordId}`;

interface FloatingWindowManagerProps {
  /** Windows the caller wants open. The manager owns minimise state for each. */
  windows: OpenWindow[];
  /** Closing a window removes it from the caller's set. */
  onCloseWindow: (windowId: string) => void;
  width?: number;
  /**
   * Optional content renderer. Defaults to RecordContent (the App shell's record renderer). A caller
   * that owns its own content (RecordView) passes an override so the chrome stays identical.
   */
  renderWindow?: (window: OpenWindow) => React.ReactNode;
}

export const FloatingWindowManager: React.FC<FloatingWindowManagerProps> = ({
  windows,
  onCloseWindow,
  width = 860,
  renderWindow,
}) => {
  const [minimised, setMinimised] = useState<Record<string, boolean>>({});

  const ids = useMemo(() => windows.map((w) => w.windowId).join('|'), [windows]);
  useEffect(() => {
    // Forget minimise state for windows that are gone, so a re-opened record starts expanded.
    setMinimised((prev) => {
      const live = new Set(windows.map((w) => w.windowId));
      const next: Record<string, boolean> = {};
      for (const id of Object.keys(prev)) if (live.has(id)) next[id] = prev[id];
      return next;
    });
  }, [ids, windows]);

  const toggle = useCallback((windowId: string, value: boolean) => {
    setMinimised((prev) => ({ ...prev, [windowId]: value }));
  }, []);

  const docked = windows.filter((w) => minimised[w.windowId]);

  return (
    <>
      {windows.map((w, i) => (
        <FloatingWindow
          key={w.windowId}
          windowId={w.windowId}
          title={w.title || INSPECTOR_TITLES[w.recordType] || 'Record'}
          width={width}
          initial={{ top: 96 + i * 28, right: 24 + i * 28 }}
          minimised={Boolean(minimised[w.windowId])}
          onMinimise={() => toggle(w.windowId, true)}
          onClose={() => onCloseWindow(w.windowId)}
          popOutUrl={`/view/${recordTypeToPath(w.recordType)}/${w.recordId}`}
          // The sync identity must match the pop-out's, which reads the URL segment, so the same
          // record resolves to one key in both windows.
          liveSync={{ recordType: recordTypeToPath(w.recordType), recordId: w.recordId }}
        >
          {renderWindow ? (
            renderWindow(w)
          ) : (
            <RecordContent type={w.recordType} data={w.data} onClose={() => onCloseWindow(w.windowId)} />
          )}
        </FloatingWindow>
      ))}

      {/* The dock: minimised windows collapse to a labelled chip the user can restore or close. */}
      {docked.length > 0 && (
        <div
          data-testid="floating-window-dock"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface border border-hairline shadow-apple"
          role="toolbar"
          aria-label="Minimised windows"
        >
          {docked.map((w) => (
            <span
              key={w.windowId}
              className="flex items-center gap-2 pl-3 pr-1 py-1 rounded-xl bg-surface-sunken border border-hairline"
              data-testid={`dock-item-${w.windowId}`}
            >
              <button
                type="button"
                onClick={() => toggle(w.windowId, false)}
                className="text-apple-12 text-primary font-medium hover:underline flex items-center gap-1.5"
                title="Restore window"
              >
                <Minus className="w-3.5 h-3.5 stroke-[1.5]" />
                {w.title || INSPECTOR_TITLES[w.recordType] || 'Record'}
              </button>
              <button
                type="button"
                onClick={() => onCloseWindow(w.windowId)}
                className="p-1 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover"
                aria-label={`Close ${w.title}`}
              >
                <X className="w-3.5 h-3.5 stroke-[1.5]" />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
};

/** The URL segment for a record type (/view/:recordType/:id). The inverse of RECORD_TYPE_TO_INSPECTOR. */
export function recordTypeToPath(recordType: InspectorType): string {
  switch (recordType) {
    case 'audit_file':
      return 'engagement';
    case 'workbench':
      return 'workpaper';
    case 'observation':
      return 'observation';
    case 'cap_inspector':
      return 'cap';
    case 'org_settings':
      return 'org_settings';
    default:
      return recordType;
  }
}
