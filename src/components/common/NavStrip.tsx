import React, { useRef, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { hasAnyAuditRight, hasRight, isReadOnly } from '../../lib/rights';
import {
  LayoutDashboard,
  CheckCircle2,
  ClipboardList,
  Network,
  Shield,
  Folder,
  AlertTriangle,
} from './Icons';

export const NavStrip: React.FC = () => {
  const { activeTab, setActiveTab } = useApp();
  const { currentUser } = useScopedData();
  const trackRef = useRef<HTMLDivElement>(null);

  // SPEC-v10 §5: exactly these seven tabs, in this order.
  // No Reports, Workbench or Calendar tab; audit files open from everywhere.
  const allTabs = [
    { id: 'executive', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'pending', label: 'Work Queue', icon: CheckCircle2 },
    { id: 'universe', label: 'Audit Universe', icon: Network },
    { id: 'plan', label: 'Audit Plan', icon: ClipboardList },
    { id: 'sira', label: 'SIRA', icon: Shield },
    { id: 'audit_file', label: 'Audit Files', icon: Folder },
    { id: 'issues', label: 'Issues & CAP Register', icon: AlertTriangle },
  ];

  // Filter tabs by the rights the session holds (Part 2.B). No role name is compared.
  const visibleTabs = allTabs.filter((tab) => {
    // A principal with no audit right (configuration-only) sees no audit tabs.
    if (!hasAnyAuditRight(currentUser)) return false;
    // A read-only principal: an all-scope reader (observer) sees Dashboard and Issues;
    // a scoped reader (auditee) additionally sees the Audit Universe tab for its own entity.
    if (isReadOnly(currentUser)) {
      if (hasRight(currentUser, 'view_all_scopes')) {
        return tab.id === 'executive' || tab.id === 'issues';
      }
      return tab.id === 'executive' || tab.id === 'universe' || tab.id === 'issues';
    }
    return true;
  });

  const count = visibleTabs.length;
  const activeIndex = Math.max(
    0,
    visibleTabs.findIndex((t) => t.id === activeTab)
  );

  // Dragging state for draggable pill based on index arithmetic
  const [isDragging, setIsDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const calculateIndexFromPointer = (clientX: number): number => {
    if (!trackRef.current) return activeIndex;
    const rect = trackRef.current.getBoundingClientRect();
    const relativeX = (clientX - rect.left) / rect.width;
    const rawIndex = relativeX * count - 0.5;
    return Math.max(0, Math.min(count - 1, rawIndex));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    const idx = calculateIndexFromPointer(e.clientX);
    setDragIndex(idx);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const idx = calculateIndexFromPointer(e.clientX);
    setDragIndex(idx);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    const rawIndex = calculateIndexFromPointer(e.clientX);
    const nearestIndex = Math.round(rawIndex);
    const boundedIndex = Math.max(0, Math.min(count - 1, nearestIndex));
    setDragIndex(null);
    setActiveTab(visibleTabs[boundedIndex].id);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  if (count === 0) {
    return (
      <nav
        aria-label="Navigation Strip"
        className="w-full bg-surface border-b border-hairline py-2.5 px-6 shadow-xs select-none"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between text-apple-12 text-secondary">
          <span className="font-semibold text-primary">Organisation Administration</span>
          <span className="text-secondary italic">Audit workflow tabs are restricted for Organization Administrators</span>
        </div>
      </nav>
    );
  }

  const currentDisplayIndex = dragIndex !== null ? dragIndex : activeIndex;
  const pillLeftPercent = (currentDisplayIndex / count) * 100;
  const pillWidthPercent = 100 / count;

  return (
    <nav
      aria-label="Navigation Strip"
      className="w-full bg-surface border-b border-hairline py-1 px-6 shadow-xs select-none"
    >
      <div className="max-w-7xl mx-auto">
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            setIsDragging(false);
            setDragIndex(null);
          }}
          className="relative grid rounded-xl p-1 bg-surface-sunken cursor-grab active:cursor-grabbing touch-none"
          style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
          data-testid="nav-strip-track"
        >
          {/* DRAGGABLE Pill positioned by index arithmetic: index / count * 100% */}
          <motion.div
            data-testid="nav-draggable-pill"
            style={{
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: `${pillLeftPercent}%`,
              width: `${pillWidthPercent}%`,
            }}
            animate={
              isDragging
                ? undefined
                : {
                    left: `${(activeIndex / count) * 100}%`,
                  }
            }
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 30,
            }}
            className="rounded-lg bg-surface shadow-soft border border-hairline pointer-events-none"
          >
            {/* 2px accent underline on the active tab (§ 3.2 requirement) */}
            <div className="h-[2px] bg-accent absolute bottom-0 inset-x-3 rounded-full" />
          </motion.div>

          {/* Tab Buttons (Equal-width CSS-grid columns) */}
          {visibleTabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeIndex === idx;

            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`nav-tab-${tab.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab(tab.id);
                }}
                className={`relative z-10 flex items-center justify-center gap-2 py-2 px-2 text-apple-13 font-medium transition-colors text-center truncate ${
                  isActive
                    ? 'text-primary font-semibold'
                    : 'text-secondary hover:text-primary'
                }`}
                title={tab.label}
                /* Below `sm` the label span is hidden, so the button would have no accessible name
                   from its content: the aria-label keeps the tab nameable at every width. */
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="w-4 h-4 stroke-[1.5] shrink-0" />
                {/* No horizontal scroll on narrow widths: collapse labels to icons (§ 3.2 requirement) */}
                <span className="hidden sm:inline truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
