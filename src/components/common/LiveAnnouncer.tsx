import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { classifyAnnouncement } from '../../lib/liveRegion';

/**
 * A single global live region (WP12, accessibility).
 *
 * Every screen reports state changes a sighted user perceives visually (a report was sealed, a
 * notification arrived, an action was refused) through `announce(message, ok)`. The message is
 * rendered into one `role="status"` region so a screen-reader user hears it. It renders no visible
 * content and holds no tenant data; the region is a polite announcer that switches to assertive for
 * a refusal. Not a blocking modal.
 */

type AnnouncerContextValue = { announce: (message: string, ok?: boolean) => void };

const AnnouncerContext = createContext<AnnouncerContextValue>({ announce: () => {} });

export function useAnnouncer(): AnnouncerContextValue {
  return useContext(AnnouncerContext);
}

export const LiveAnnouncerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [text, setText] = useState('');
  const [politeness, setPoliteness] = useState<'polite' | 'assertive'>('polite');
  // Clear before setting so an identical consecutive message still re-announces.
  const frame = useRef<number | null>(null);

  const announce = useCallback((message: string, ok = true) => {
    const a = classifyAnnouncement(message, ok);
    if (!a) return;
    setText('');
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      setPoliteness(a.politeness);
      setText(a.message);
    });
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live={politeness}
        aria-atomic="true"
        data-testid="live-announcer"
        className="sr-only"
      >
        {text}
      </div>
    </AnnouncerContext.Provider>
  );
};
