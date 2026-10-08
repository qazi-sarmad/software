import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';

export interface HoverPreviewContent {
  title: string;
  subtitle?: string;
  category?: string;
  status?: string;
  statusType?: 'verdigris' | 'cinnabar' | 'neutral';
  exceptionsCount?: number;
  owner?: string;
  dueDate?: string;
  metrics?: { label: string; value: string | number }[];
  hint?: string;
}

interface HoverPreviewProps {
  children: React.ReactNode;
  content: HoverPreviewContent | null | undefined;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export const HoverPreview: React.FC<HoverPreviewProps> = ({
  children,
  content,
  onClick,
  className = '',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; placeAbove: boolean }>({
    x: 12,
    y: 12,
    placeAbove: false,
  });
  const triggerRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const pointer = useRef<{ x: number; y: number } | null>(null);
  const POP_W = 280;
  const POP_H = 190;

  /** Anchor to the cursor when we have one (mouse), else to the trigger box (keyboard/touch). */
  const place = (px: number, py: number, byCursor: boolean) => {
    const gap = byCursor ? 16 : 8;
    let x = byCursor ? px + gap : px - POP_W / 2;
    if (byCursor && x + POP_W > window.innerWidth - 12) x = px - gap - POP_W; // flip left of cursor
    x = Math.max(12, Math.min(x, window.innerWidth - POP_W - 12));
    let placeAbove = false;
    let y = py + gap;
    if (y + POP_H > window.innerHeight - 12) {
      placeAbove = true;
      y = Math.max(12, py - gap - POP_H);
    }
    setCoords({ x, y, placeAbove });
  };

  const calculatePosition = () => {
    if (pointer.current) {
      place(pointer.current.x, pointer.current.y, true);
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // display:contents wrappers report an empty box; never anchor to (0,0)
    if (rect.width === 0 && rect.height === 0) return;
    place(rect.left + rect.width / 2, rect.bottom, false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    if (isOpen) place(e.clientX, e.clientY, true);
  };

  const handleMouseEnter = (e?: React.MouseEvent) => {
    if (disabled || !content) return;
    if (e) pointer.current = { x: e.clientX, y: e.clientY };
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = window.setTimeout(() => {
      calculatePosition();
      setIsOpen(true);
    }, 120);
  };

  const handleMouseLeave = () => {
    pointer.current = null;
    if (openTimer.current) clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 80);
  };

  const handleFocus = () => {
    if (disabled || !content) return;
    calculatePosition();
    setIsOpen(true);
  };

  const handleBlur = () => {
    setIsOpen(false);
  };

  // Touch support: long press (350ms)
  const touchTimer = useRef<number | null>(null);
  const handleTouchStart = () => {
    if (disabled || !content) return;
    touchTimer.current = window.setTimeout(() => {
      calculatePosition();
      setIsOpen(true);
    }, 350);
  };

  const handleTouchEnd = () => {
    if (touchTimer.current) clearTimeout(touchTimer.current);
  };

  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      if (touchTimer.current) clearTimeout(touchTimer.current);
    };
  }, []);

  const getStatusChipClass = (type?: string) => {
    switch (type) {
      case 'verdigris':
        return 'text-verdigris bg-verdigris-subtle border-verdigris';
      case 'cinnabar':
        return 'text-cinnabar bg-cinnabar-subtle border-cinnabar';
      default:
        return 'text-secondary bg-surface-hover';
    }
  };

  return (
    <div
      ref={triggerRef}
      className={`inline-block ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={onClick}
      tabIndex={0}
      role="button"
      data-testid="hover-preview-trigger"
    >
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isOpen && content && (
              <motion.div
                data-testid="hover-preview-popover"
                initial={{
                  opacity: 0,
                  scale: 0.96,
                  y: coords.placeAbove ? 6 : -6,
                }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  y: 0,
                }}
                exit={{
                  opacity: 0,
                  scale: 0.96,
                  y: coords.placeAbove ? 6 : -6,
                }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 30,
                }}
                style={{
                  position: 'fixed',
                  top: coords.y,
                  left: coords.x,
                  zIndex: 9999,
                  pointerEvents: 'none',
                  width: 280,
                }}
                className="bg-glass border border-hairline shadow-apple rounded-xl p-3.5 select-none"
              >
                {/* Header row: category and status */}
                <div className="flex items-center justify-between gap-2 mb-1.5 text-apple-11">
                  {content.category && (
                    <span className="text-secondary font-medium tracking-wide uppercase">
                      {content.category}
                    </span>
                  )}
                  {content.status && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-apple-11 font-medium ${getStatusChipClass(
                        content.statusType
                      )}`}
                    >
                      {content.status}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h4 className="text-primary text-apple-13 font-semibold line-clamp-2 leading-snug mb-1">
                  {content.title}
                </h4>
                {content.subtitle && (
                  <p className="text-secondary text-apple-11 line-clamp-1 mb-2">
                    {content.subtitle}
                  </p>
                )}

                {/* Exception Count / Owner / Due Date metadata */}
                <div className="grid grid-cols-2 gap-y-1 gap-x-2 pt-2 border-t border-hairline text-apple-11">
                  {content.owner && (
                    <div>
                      <span className="text-tertiary">Owner: </span>
                      <span className="text-primary font-medium">{content.owner}</span>
                    </div>
                  )}
                  {content.dueDate && (
                    <div>
                      <span className="text-tertiary">Due: </span>
                      <span className="text-primary tabular-nums font-medium">
                        {content.dueDate}
                      </span>
                    </div>
                  )}
                  {content.exceptionsCount !== undefined && (
                    <div className="col-span-2">
                      <span className="text-tertiary">Exceptions: </span>
                      <span
                        className={`tabular-nums font-semibold ${
                          content.exceptionsCount > 0 ? 'text-cinnabar' : 'text-verdigris'
                        }`}
                      >
                        {content.exceptionsCount === 0
                          ? '0 (Clean)'
                          : `${content.exceptionsCount} Identified`}
                      </span>
                    </div>
                  )}
                  {content.metrics?.map((m, i) => (
                    <div key={i}>
                      <span className="text-tertiary">{m.label}: </span>
                      <span className="text-primary tabular-nums font-medium">{m.value}</span>
                    </div>
                  ))}
                </div>

                {/* Hint */}
                <div className="mt-2.5 pt-1.5 border-t border-hairline flex items-center justify-between text-apple-11 text-secondary">
                  <span>{content.hint || 'Click to open details'}</span>
                  <span className="text-accent text-apple-11 font-medium">→</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};
