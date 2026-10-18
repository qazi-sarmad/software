import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Minus, ExternalLink } from './Icons';

/**
 * Floating window chrome (MODE B of the record view, spec §17.1, §27.5).
 *
 * Non-blocking by construction: there is no backdrop scrim and no `aria-modal`, so the application
 * behind the window stays fully usable. It can be minimised to a dock, dragged, or popped out as a
 * real browser window that shares the origin and session. This is the same chrome the Audit File
 * window uses; RecordsView and the Audit File route reuse it.
 */
export interface FloatingWindowProps {
  windowId: string;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  width?: number;
  initial?: { top: number; right: number };
  minimised?: boolean;
  onMinimise?: () => void;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** When set, a pop-out button opens this same-origin URL as its own browser window. */
  popOutUrl?: string;
}

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
  windowId,
  title,
  subtitle,
  badge,
  width = 720,
  initial,
  minimised = false,
  onMinimise,
  onClose,
  children,
  footer,
  popOutUrl,
}) => {
  const [pos, setPos] = useState(initial ?? { top: 96, right: 24 });
  const dragRef = useRef<{ startX: number; startY: number; startTop: number; startRight: number } | null>(null);
  const winRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startTop: pos.top, startRight: pos.right };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pos.top, pos.right]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setPos({
      top: Math.max(8, d.startTop + dy),
      right: Math.max(8, d.startRight - dx),
    });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      {!minimised && (
        <motion.div
          ref={winRef}
          data-testid={`floating-window-${windowId}`}
          role="dialog"
          aria-label={title}
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 6 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          style={{
            position: 'fixed',
            top: pos.top,
            right: pos.right,
            // Responsive width (D15): never wider than the viewport minus the offset it is anchored
            // to, so the window cannot clip off the left edge on a phone. `min()` keeps the desktop
            // width identical when the viewport is wide enough.
            width: `min(${width}px, calc(100vw - ${pos.right}px - 0.5rem))`,
          }}
          className="z-[60] max-h-[min(84vh,52rem)] bg-surface border border-hairline rounded-2xl overflow-hidden shadow-apple flex flex-col text-primary"
        >
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="flex items-center justify-between px-4 py-2.5 border-b border-hairline bg-surface/95 backdrop-blur-md shrink-0 cursor-grab active:cursor-grabbing select-none"
            title="Drag to move"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-apple-14 font-semibold text-primary truncate">{title}</h2>
                {badge}
              </div>
              {subtitle && <p className="text-apple-11 text-secondary truncate mt-0.5">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {popOutUrl && (
                <button
                  type="button"
                  onClick={() => window.open(popOutUrl, `provio-${windowId}`, `width=${width},height=800`)}
                  className="p-1.5 rounded-lg text-secondary hover:text-primary bg-surface-hover transition-colors"
                  title="Open in its own window"
                  aria-label="Open in its own window"
                >
                  <ExternalLink className="w-4 h-4 stroke-[1.5]" />
                </button>
              )}
              {onMinimise && (
                <button
                  type="button"
                  onClick={onMinimise}
                  className="p-1.5 rounded-lg text-secondary hover:text-primary bg-surface-hover transition-colors"
                  title="Minimise"
                  aria-label="Minimise window"
                >
                  <Minus className="w-4 h-4 stroke-[1.5]" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-secondary hover:text-primary bg-surface-hover transition-colors"
                title="Close (Esc)"
                aria-label="Close window"
              >
                <X className="w-4 h-4 stroke-[1.5]" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">{children}</div>

          {footer && <div className="px-5 py-3 border-t border-hairline bg-surface-elevated shrink-0">{footer}</div>}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
