import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { X } from './Icons';
import { groupedShortcuts, formatSequence } from '../../lib/keyboardShortcuts';
import { useApp } from '../../context/AppContext';

export interface ShortcutSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? '');

/**
 * The keyboard shortcut sheet (U8; docs/SYSTELIGON.md §11.1c Tier 1 item 10).
 *
 * `?` opens this sheet anywhere. It lists only the shortcuts the caller may actually use
 * (`groupedShortcuts` filters by right), so it never advertises a key that would be refused. It is
 * non-blocking by construction: a `role="complementary"` panel anchored below the header, no scrim,
 * no focus trap, no modal semantics. Escape and an outside click dismiss it. The keys shown come from
 * `formatSequence`, so a macOS reader sees ⌘ and a Windows reader sees Ctrl.
 */
export const ShortcutSheet: React.FC<ShortcutSheetProps> = ({ isOpen, onClose }) => {
  const { currentUser } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const mac = isMac();
  const groups = groupedShortcuts(currentUser);

  return (
    <div
      className="fixed top-14 left-0 right-0 z-50 flex items-start justify-center pt-4 px-4 pointer-events-none"
      data-testid="shortcut-sheet"
    >
      <motion.div
        ref={containerRef}
        role="complementary"
        aria-label="Keyboard shortcuts"
        initial={{ opacity: 0, scale: 0.96, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative w-full max-w-lg bg-surface border border-hairline shadow-apple rounded-2xl overflow-hidden z-10 pointer-events-auto"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
          <h2 className="text-apple-13 font-semibold text-primary">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="shortcut-sheet-close"
            aria-label="Close the shortcut sheet"
            className="p-1 rounded-md text-secondary hover:text-primary transition-colors"
          >
            <X className="w-4 h-4 stroke-[1.5]" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-3 space-y-4" data-testid="shortcut-sheet-list">
          {groups.length === 0 ? (
            <div data-testid="shortcut-sheet-empty" className="py-8 text-center text-secondary text-apple-13">
              No shortcuts are available for your permissions.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.group} data-testid={`shortcut-sheet-group-${g.group.toLowerCase()}`}>
                <div className="px-2 pb-1 text-apple-11 font-medium text-tertiary uppercase tracking-wider">
                  {g.group}
                </div>
                <ul className="space-y-0.5">
                  {g.items.map((s) => (
                    <li
                      key={s.id}
                      data-testid={`shortcut-sheet-item-${s.id}`}
                      className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-surface-hover"
                    >
                      <div className="min-w-0">
                        <div className="text-apple-13 text-primary truncate">{s.label}</div>
                        <div className="text-apple-11 text-secondary truncate">{s.hint}</div>
                      </div>
                      <span className="flex items-center gap-1 shrink-0" aria-hidden="true">
                        {formatSequence(s, mac).map((k, i) =>
                          k === 'then' ? (
                            <span key={i} className="text-apple-11 text-tertiary">
                              then
                            </span>
                          ) : (
                            <kbd
                              key={i}
                              className="px-1.5 py-0.5 rounded border border-hairline bg-surface-sunken text-apple-11 text-secondary"
                            >
                              {k}
                            </kbd>
                          )
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-hairline text-apple-11 text-tertiary">
          Press <kbd className="px-1 rounded border border-hairline bg-surface-sunken">Esc</kbd> to dismiss.
        </div>
      </motion.div>
    </div>
  );
};
