import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Search, X, ArrowRight, LayoutDashboard, Zap, ShieldAlert } from './Icons';
import { useScopedData } from '../../hooks/useScopedData';
import { useApp } from '../../context/AppContext';
import {
  flattenGroups,
  rankCommands,
  recordCommands,
  visibleCommands,
  type CommandItem,
  type CommandKind,
} from '../../lib/commandPalette';
import { commandToRecord, resolveRecordRef, type RecordScope } from '../../lib/recordCommand';
import { ExplainDetail } from '../explain/ExplainDetail';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const KIND_LABEL: Record<CommandKind, string> = {
  screen: 'Screens',
  action: 'Actions & records',
  explain: 'Explain',
};

const KIND_ICON: Record<CommandKind, React.FC<{ className?: string }>> = {
  screen: LayoutDashboard,
  action: Zap,
  explain: ShieldAlert,
};

/**
 * The command palette (U2; SPEC-v10 §5, docs/SYSTELIGON.md §11.1c Tier 1 item 2).
 *
 * `Cmd/Ctrl-K` opens everything: the seven screens, the shell actions, the explain layer, and the
 * records the caller may see. Type "benford" and reach the analyst engine; type an entity name and
 * jump to it. The index and the ranking are pure (`src/lib/commandPalette.ts`); this component adds
 * the one live-session part — the records — from `useScopedData`, which has ALREADY filtered them
 * through `src/lib/access.ts`, so the palette can never surface a record the screen behind it hid.
 *
 * It is a non-blocking dropdown (spec §27.5): no scrim, no modal role, no focus trap. The page behind
 * stays interactive; Escape and an outside click dismiss it. Every row is reachable by the keyboard
 * (Arrow keys move, Enter activates, Home/End jump), which is U8's keyboard-first requirement here.
 * An explain row opens its detail inline in a `role="complementary"` panel, never a modal.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [explainId, setExplainId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const {
    currentUser,
    scopedEntities,
    scopedEngagements,
    scopedWorkpapers,
    scopedObservations,
    scopedIssues,
    scopedCapItems,
  } = useScopedData();
  const { setActiveTab, setSelectedEngagementId, setSelectedWorkpaperId, openInspector } = useApp();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    setExplainId(null);
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, onClose]);

  // Resolve a record command against the caller's scoped rows, then open the existing drilldown.
  const scope: RecordScope = useMemo(
    () => ({
      entities: scopedEntities,
      engagements: scopedEngagements,
      workpapers: scopedWorkpapers,
      issues: scopedIssues,
      caps: scopedCapItems,
      observations: scopedObservations,
    }),
    [scopedEntities, scopedEngagements, scopedWorkpapers, scopedIssues, scopedCapItems, scopedObservations]
  );

  // The caller's ALREADY-SCOPED records as commands (Law L2: the palette filters nothing itself).
  const records = useMemo(
    () => [
      ...recordCommands(scopedEntities.map(commandToRecord('entity'))),
      ...recordCommands(scopedEngagements.map(commandToRecord('engagement'))),
      ...recordCommands(scopedWorkpapers.map(commandToRecord('workpaper'))),
      ...recordCommands(scopedIssues.map(commandToRecord('issue'))),
      ...recordCommands(scopedCapItems.map(commandToRecord('cap'))),
      ...recordCommands(scopedObservations.map(commandToRecord('observation'))),
    ],
    [scopedEntities, scopedEngagements, scopedWorkpapers, scopedIssues, scopedCapItems, scopedObservations]
  );

  const groups = useMemo(() => {
    const ranked = rankCommands(query, [...visibleCommands(currentUser), ...records]);
    return {
      screen: ranked.filter((c) => c.kind === 'screen'),
      action: ranked.filter((c) => c.kind === 'action'),
      explain: ranked.filter((c) => c.kind === 'explain'),
    };
  }, [currentUser, records, query]);

  const flat = useMemo(() => flattenGroups([groups.screen, groups.action, groups.explain]), [groups]);

  useEffect(() => {
    setActiveIndex((i) => (i >= flat.length ? 0 : i));
  }, [flat.length]);

  const activate = (item: CommandItem) => {
    const t = item.target;
    if (t.tab) {
      setActiveTab(t.tab);
      onClose();
    } else if (t.inspector) {
      openInspector(t.inspector as Parameters<typeof openInspector>[0]);
      onClose();
    } else if (t.explainId) {
      setExplainId(t.explainId);
    } else if (t.record) {
      const ref = resolveRecordRef(t.record.family, t.record.id, scope);
      if (ref) {
        if (ref.family === 'engagement') setSelectedEngagementId(ref.id);
        if (ref.family === 'workpaper') setSelectedWorkpaperId(ref.id);
        if (ref.inspector) openInspector(ref.inspector as Parameters<typeof openInspector>[0], ref.data);
        if (ref.tab) setActiveTab(ref.tab);
        onClose();
      }
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(flat.length ? flat.length - 1 : 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) activate(item);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-command-index="${activeIndex}"]`);
    // jsdom has no layout, so `scrollIntoView` is absent in tests; guard rather than assume a browser.
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  if (!isOpen) return null;

  const renderGroup = (kind: CommandKind, items: CommandItem[]) => {
    if (items.length === 0) return null;
    const Icon = KIND_ICON[kind];
    return (
      <div key={kind}>
        <div className="px-3 py-1 text-apple-11 font-medium text-tertiary uppercase tracking-wider">
          {KIND_LABEL[kind]} ({items.length})
        </div>
        {items.map((item) => {
          const index = flat.indexOf(item);
          const isActive = index === activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              id={`command-palette-opt-${item.id}`}
              data-testid={`command-palette-item-${item.id}`}
              data-command-index={index}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activate(item)}
              aria-selected={isActive}
              className={`w-full text-left px-3 py-2 rounded-xl transition-colors flex items-center justify-between group ${
                isActive ? 'bg-surface-hover' : 'hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className="w-4 h-4 text-accent stroke-[1.5] shrink-0" />
                <div className="min-w-0">
                  <div className="text-apple-13 font-medium text-primary truncate">{item.label}</div>
                  <div className="text-apple-11 text-secondary truncate">{item.hint}</div>
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-tertiary group-hover:text-primary transition-colors stroke-[1.5] shrink-0" />
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="fixed top-14 left-0 right-0 z-50 flex items-start justify-center pt-4 px-4 pointer-events-none"
      data-testid="command-palette"
    >
      {/* Palette dropdown — non-blocking: no backdrop scrim, no modal semantics, no focus trap. The
          page behind it stays reachable; Escape and an outside click dismiss it (§27.5). */}
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, scale: 0.96, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative w-full max-w-2xl bg-surface border border-hairline shadow-apple rounded-2xl overflow-hidden z-10 pointer-events-auto"
      >
        <div className="flex items-center px-4 py-3.5 border-b border-hairline gap-3 bg-surface">
          <Search className="w-5 h-5 text-secondary stroke-[1.5]" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setExplainId(null);
            }}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="command-palette-list"
            aria-activedescendant={flat[activeIndex] ? `command-palette-opt-${flat[activeIndex].id}` : undefined}
            data-testid="command-palette-input"
            placeholder="Jump to a screen, a record, an action, or an explanation…"
            className="w-full bg-transparent text-apple-15 text-primary placeholder:text-tertiary outline-none border-none"
          />
          <button
            type="button"
            onClick={onClose}
            data-testid="command-palette-close"
            aria-label="Close command palette"
            className="p-1 rounded-md text-secondary hover:text-primary transition-colors"
          >
            <X className="w-4 h-4 stroke-[1.5]" />
          </button>
        </div>

        <div id="command-palette-list" ref={listRef} role="listbox" className="max-h-96 overflow-y-auto p-3 space-y-4">
          {flat.length === 0 ? (
            <div data-testid="command-palette-empty" className="py-12 text-center text-secondary text-apple-13">
              No screen, record, action or explanation matches “{query}” within your permissions.
            </div>
          ) : (
            <>
              {renderGroup('screen', groups.screen)}
              {renderGroup('action', groups.action)}
              {renderGroup('explain', groups.explain)}
            </>
          )}
        </div>

        {/* An explain row opens its detail here, inline, non-blocking (never a modal). */}
        {explainId && (
          <div className="border-t border-hairline max-h-72 overflow-y-auto p-3" data-testid="command-palette-explain">
            <ExplainDetail explainId={explainId} screenId="CH-03" />
          </div>
        )}

        <div className="px-4 py-2 border-t border-hairline flex items-center justify-between text-apple-11 text-tertiary">
          <span>
            <kbd className="px-1 rounded border border-hairline bg-surface-sunken">↑</kbd>{' '}
            <kbd className="px-1 rounded border border-hairline bg-surface-sunken">↓</kbd> to move ·{' '}
            <kbd className="px-1 rounded border border-hairline bg-surface-sunken">Enter</kbd> to open
          </span>
          <span>
            <kbd className="px-1 rounded border border-hairline bg-surface-sunken">Esc</kbd> to dismiss
          </span>
        </div>
      </motion.div>
    </div>
  );
};
