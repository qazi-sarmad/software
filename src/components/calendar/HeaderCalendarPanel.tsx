import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useScopedData } from '../../hooks/useScopedData';
import { AuditEngagement } from '../../types';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  RotateCcw,
  Calendar,
} from '../common/Icons';

interface CalendarPanelProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onSelectAudit?: (auditId: string) => void;
}

export const HeaderCalendarPanel: React.FC<CalendarPanelProps> = ({
  isOpen,
  onClose,
  triggerRef,
  onSelectAudit,
}) => {
  const { scopedEngagements } = useScopedData();
  const panelRef = useRef<HTMLDivElement>(null);

  // Month navigation: default to September 2026
  const [currentDate, setCurrentDate] = useState<Date>(new Date(2026, 8, 1));
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');
  const [highlightedAuditId, setHighlightedAuditId] = useState<string | null>(null);

  // Hover popover for day
  const [hoveredDay, setHoveredDay] = useState<{
    dateStr: string;
    dayNumber: number;
    audits: AuditEngagement[];
    rect: DOMRect;
  } | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Monday-start calendar calculation
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sun
  const mondayOffset = (firstDayOfMonth + 6) % 7; // 0 = Mon, 6 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const changeMonth = (delta: number) => {
    setSlideDirection(delta > 0 ? 'right' : 'left');
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const jumpToToday = () => {
    setSlideDirection('right');
    setCurrentDate(new Date(2026, 8, 30)); // 2026-09-30 simulated today
  };

  // Native non-passive wheel listener with preventDefault and 260ms cooldown
  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
    let lastWheelTime = 0;
    const cooldownMs = 260;

    const handleWheel = (e: WheelEvent) => {
      // Must prevent default page scroll
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastWheelTime < cooldownMs) return;

      if (Math.abs(e.deltaY) > 10 || Math.abs(e.deltaX) > 10) {
        lastWheelTime = now;
        if (e.deltaY > 0 || e.deltaX > 0) {
          changeMonth(1);
        } else {
          changeMonth(-1);
        }
      }
    };

    const el = panelRef.current;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [isOpen]);

  // Close on outside click and Esc
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, onClose, triggerRef]);

  // Determine audits active on a given day
  const getAuditsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return scopedEngagements.filter((eng) => {
      const start = eng.periodStart;
      const due = eng.dueDate;
      return dateStr >= start && dateStr <= due;
    });
  };

  const highlightedAudit = scopedEngagements.find((e) => e.id === highlightedAuditId);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label="Audit Calendar Panel"
          initial={{ opacity: 0, scale: 0.94, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: -8 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{ transformOrigin: 'top right' }}
          className="absolute right-0 top-14 mt-2 w-[340px] bg-glass border border-hairline shadow-apple rounded-2xl p-4 z-50 select-none text-primary"
        >
          {/* Header row: Month in serif font, prev/next, and Jump to today */}
          <div className="flex items-center justify-between pb-3 border-b border-hairline">
            <div className="flex items-center gap-1.5">
              <span className="font-serif-title text-apple-15 font-bold text-primary">
                {monthNames[month]} {year}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={jumpToToday}
                className="px-2 py-0.5 rounded text-apple-11 font-medium text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
                title="Jump to today (Sep 30)"
              >
                Today
              </button>
              <button
                onClick={() => changeMonth(-1)}
                className="p-1 rounded-md text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
                title="Previous month"
              >
                <ChevronLeft className="w-4 h-4 stroke-[1.5]" />
              </button>
              <button
                onClick={() => changeMonth(1)}
                className="p-1 rounded-md text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
                title="Next month"
              >
                <ChevronRight className="w-4 h-4 stroke-[1.5]" />
              </button>
            </div>
          </div>

          {/* Dismissible selected audit filter chip */}
          {highlightedAudit && (
            <div className="mt-2.5 flex items-center justify-between px-2.5 py-1 rounded-lg bg-accent-subtle text-accent text-apple-11 font-medium">
              <span className="truncate pr-2">Highlighting: {highlightedAudit.title}</span>
              <button
                onClick={() => setHighlightedAuditId(null)}
                className="p-0.5 hover:opacity-75"
              >
                <X className="w-3 h-3 stroke-[1.5]" />
              </button>
            </div>
          )}

          {/* Monday-start 7-column header */}
          <div className="grid grid-cols-7 text-center text-apple-11 font-semibold text-secondary uppercase tracking-wider pt-3 pb-1.5">
            <div>M</div>
            <div>T</div>
            <div>W</div>
            <div>T</div>
            <div>F</div>
            <div>S</div>
            <div>S</div>
          </div>

          {/* Sliding Grid Animation */}
          <div className="overflow-hidden relative min-h-[210px]">
            <motion.div
              key={`${year}-${month}`}
              initial={{ x: slideDirection === 'right' ? 30 : -30, opacity: 0.7 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="grid grid-cols-7 gap-1"
            >
              {/* Empty leading padding */}
              {Array.from({ length: mondayOffset }).map((_, i) => (
                <div key={`offset-${i}`} className="h-8 rounded-lg opacity-20" />
              ))}

              {/* Days in Month */}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(
                  day
                ).padStart(2, '0')}`;
                const dayAudits = getAuditsForDay(day);
                const hasAudits = dayAudits.length > 0;
                const isMultiAudit = dayAudits.length > 1;
                const isToday = year === 2026 && month === 8 && day === 30;

                // Check audit states for tinting
                const hasOverdue = dayAudits.some((a) => a.dueDate < '2026-09-30' && a.status !== 'signed_off');
                const hasInProgress = dayAudits.some((a) => a.status === 'in_progress');
                const hasCompleted = dayAudits.some((a) => a.status === 'signed_off');
                const isSelectedAuditDay =
                  highlightedAuditId &&
                  dayAudits.some((a) => a.id === highlightedAuditId);

                let cellClass = 'hover:bg-surface-hover text-secondary';
                if (isToday) {
                  cellClass = 'bg-accent text-white font-bold shadow-xs';
                } else if (isSelectedAuditDay) {
                  cellClass = 'bg-accent-subtle text-accent font-bold ring-1 ring-accent';
                } else if (hasOverdue) {
                  cellClass = 'bg-cinnabar-subtle text-cinnabar font-semibold';
                } else if (hasCompleted) {
                  cellClass = 'bg-verdigris-subtle text-verdigris font-semibold';
                } else if (hasInProgress) {
                  cellClass = 'bg-surface-elevated text-primary font-medium';
                }

                return (
                  <div
                    key={day}
                    onMouseEnter={(e) => {
                      if (hasAudits) {
                        setHoveredDay({
                          dateStr,
                          dayNumber: day,
                          audits: dayAudits,
                          rect: e.currentTarget.getBoundingClientRect(),
                        });
                      }
                    }}
                    onMouseLeave={() => setHoveredDay(null)}
                    className={`h-8 rounded-lg flex flex-col items-center justify-center text-apple-12 tabular-nums cursor-pointer relative transition-all ${cellClass}`}
                  >
                    <span>{day}</span>
                    {/* Multi-audit indicator dot */}
                    {isMultiAudit && !isToday && (
                      <span className="w-1 h-1 rounded-full bg-accent absolute bottom-1" />
                    )}
                  </div>
                );
              })}
            </motion.div>
          </div>

          {/* Hover Popover showing 3 step circles per audit (Fieldwork / Review / Sign-off) */}
          {hoveredDay && (
            <div
              className="absolute left-4 right-4 bg-surface border border-hairline shadow-apple rounded-xl p-3 z-50 text-apple-11 space-y-2 pointer-events-auto"
              style={{ bottom: 44 }}
            >
              <div className="font-semibold text-primary border-b border-hairline pb-1.5 flex items-center justify-between">
                <span>{hoveredDay.dateStr}</span>
                <span className="text-secondary font-normal">{hoveredDay.audits.length} audit(s)</span>
              </div>
              <div className="space-y-2 max-h-36 overflow-y-auto">
                {hoveredDay.audits.map((audit) => {
                  const isSigned = audit.status === 'signed_off';
                  const isReopened = audit.status === 'reopened';
                  const step1 = isSigned || audit.completionPercent > 50 ? 'check' : 'filled';
                  const step2 = isSigned ? 'check' : isReopened ? 'red_dot' : audit.stage === 'testing' ? 'filled' : 'empty';
                  const step3 = isSigned ? 'check' : 'empty';

                  const renderStepCircle = (type: string, label: string) => {
                    if (type === 'check') {
                      return (
                        <span className="w-3.5 h-3.5 rounded-full bg-verdigris-subtle text-verdigris flex items-center justify-center" title={`${label}: Checked`}>
                          <Check className="w-2.5 h-2.5 stroke-[2]" />
                        </span>
                      );
                    }
                    if (type === 'red_dot') {
                      return (
                        <span className="w-3.5 h-3.5 rounded-full bg-cinnabar-subtle flex items-center justify-center" title={`${label}: Reverts`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-cinnabar" />
                        </span>
                      );
                    }
                    if (type === 'filled') {
                      return (
                        <span className="w-3.5 h-3.5 rounded-full border border-accent flex items-center justify-center" title={`${label}: In Progress`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                        </span>
                      );
                    }
                    return (
                      <span className="w-3.5 h-3.5 rounded-full border border-hairline" title={`${label}: Pending`} />
                    );
                  };

                  return (
                    <div
                      key={audit.id}
                      onClick={() => {
                        setHighlightedAuditId(audit.id);
                        if (onSelectAudit) onSelectAudit(audit.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-surface-hover cursor-pointer transition-colors"
                    >
                      <div className="font-medium text-primary truncate">{audit.title}</div>
                      <div className="flex items-center justify-between pt-1 text-tertiary">
                        <span>Due: {audit.dueDate}</span>
                        <div className="flex items-center gap-1.5">
                          {renderStepCircle(step1, 'Fieldwork')}
                          {renderStepCircle(step2, 'Review')}
                          {renderStepCircle(step3, 'Sign-off')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend at bottom */}
          <div className="mt-3 pt-2.5 border-t border-hairline flex items-center justify-between text-apple-11 text-secondary">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-accent" /> Active
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-verdigris" /> Sealed
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cinnabar" /> Overdue
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" /> Multi
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
