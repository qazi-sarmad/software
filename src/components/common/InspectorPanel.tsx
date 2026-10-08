import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from './Icons';

interface InspectorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  width?: string; // e.g. "max-w-2xl" or "max-w-4xl"
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Fill most of the viewport height (Audit File, workbench). */
  tall?: boolean;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  width = 'max-w-2xl',
  children,
  footer,
  tall = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape key press & handle focus trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // Focus panel on open
    panelRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 overflow-hidden">
          {/* Backdrop Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            aria-hidden="true"
          />

          {/* Sliding Inspector Panel */}
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 30,
            }}
            className={`relative w-full ${width} ${tall ? 'h-[min(90vh,60rem)]' : 'max-h-[88vh]'} bg-surface border border-hairline rounded-2xl overflow-hidden shadow-apple flex flex-col z-10 outline-none`}
          >
            {/* Header with frosted glass style */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-hairline bg-surface/90 backdrop-blur-md shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-apple-15 font-semibold text-primary truncate">{title}</h2>
                    {badge}
                  </div>
                  {subtitle && (
                    <p className="text-apple-12 text-secondary truncate mt-0.5">{subtitle}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-secondary hover:text-primary bg-surface-hover transition-colors flex items-center gap-1.5"
                  title="Close (Esc)"
                  aria-label="Close panel"
                >
                  <span className="text-apple-11 text-tertiary hidden sm:inline">Esc</span>
                  <X className="w-4 h-4 stroke-[1.5]" />
                </button>
              </div>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">{children}</div>

            {/* Optional Footer */}
            {footer && (
              <div className="px-6 py-4 border-t border-hairline bg-surface-elevated shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
