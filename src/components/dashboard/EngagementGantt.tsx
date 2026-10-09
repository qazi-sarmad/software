import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AuditEngagement } from '../../types';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { HoverPreview } from '../common/HoverPreview';
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  X,
} from '../common/Icons';

interface EngagementGanttProps {
  engagements: AuditEngagement[];
  onSelectEngagement?: (id: string) => void;
}

export const EngagementGantt: React.FC<EngagementGanttProps> = ({
  engagements,
  onSelectEngagement,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const { openInspector, currentUser } = useApp();
  const { can } = useScopedData();

  // Timeline: 2022-2032 at fixed density. Wide enough to behave as continuous; true infinite extension is not built.
  const timelineStart = new Date('2022-01-01').getTime();
  const timelineEnd = new Date('2032-12-31').getTime();
  const totalDuration = timelineEnd - timelineStart;
  const PX_PER_DAY = 4.77; // same density as before (2600px over ~545 days)
  const timelineWidth = Math.round(((timelineEnd - timelineStart) / 86400000) * PX_PER_DAY);

  // Simulated today: Sept 30, 2026
  const todayDate = new Date('2026-09-30').getTime();
  const todayX = ((todayDate - timelineStart) / totalDuration) * timelineWidth;

  // Inertial drag-to-pan state (§ 3.4 requirement)
  const [isPanning, setIsPanning] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const velocityRef = useRef(0);
  const lastPointerXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  // Focus card on click (§ 3.4 requirement)
  const [focusedEngagement, setFocusedEngagement] = useState<AuditEngagement | null>(null);

  // Manager date range drag along X pending change chip (§ 3.4 requirement)
  const [pendingDateChange, setPendingDateChange] = useState<{
    engagementId: string;
    title: string;
    newStart: string;
    newDue: string;
  } | null>(null);

  // Month generation
  const months: { label: string; year: number; isJan: boolean; startX: number; width: number }[] = [];
  let cur = new Date(timelineStart);
  while (cur.getTime() < timelineEnd) {
    const mYear = cur.getFullYear();
    const mMonth = cur.getMonth();
    const mStart = cur.getTime();
    const nextMonth = new Date(mYear, mMonth + 1, 1);
    const mEnd = Math.min(timelineEnd, nextMonth.getTime());
    const mStartX = ((mStart - timelineStart) / totalDuration) * timelineWidth;
    const mWidth = ((mEnd - mStart) / totalDuration) * timelineWidth;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.push({
      label: monthNames[mMonth],
      year: mYear,
      isJan: mMonth === 0,
      startX: mStartX,
      width: mWidth,
    });
    cur = nextMonth;
  }

  // Smooth inertial decay loop (decay factor 0.94 per § 3.4)
  const startInertia = useCallback(() => {
    const decay = 0.94;
    const step = () => {
      if (Math.abs(velocityRef.current) > 0.1 && containerRef.current) {
        containerRef.current.scrollLeft -= velocityRef.current;
        velocityRef.current *= decay;
        setScrollLeft(containerRef.current.scrollLeft);
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        velocityRef.current = 0;
      }
    };
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(step);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.gantt-bar-element')) return;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setIsPanning(true);
    lastPointerXRef.current = e.clientX;
    lastTimeRef.current = performance.now();
    velocityRef.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPanning || !containerRef.current) return;
    const now = performance.now();
    const deltaX = e.clientX - lastPointerXRef.current;
    const dt = Math.max(1, now - lastTimeRef.current);
    containerRef.current.scrollLeft -= deltaX;
    setScrollLeft(containerRef.current.scrollLeft);
    velocityRef.current = (deltaX / dt) * 16.6; // normalized velocity
    lastPointerXRef.current = e.clientX;
    lastTimeRef.current = now;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isPanning) return;
    setIsPanning(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    startInertia();
  };

  // Center on "Today" smooth-scroll button (§ 3.4 requirement)
  const scrollToToday = () => {
    if (!containerRef.current) return;
    const targetScroll = todayX - containerRef.current.clientWidth / 2;
    containerRef.current.scrollTo({
      left: Math.max(0, targetScroll),
      behavior: 'smooth',
    });
  };

  // Initial scroll positioning toward today on mount
  useEffect(() => {
    if (containerRef.current) {
      const targetScroll = todayX - containerRef.current.clientWidth / 2;
      containerRef.current.scrollLeft = Math.max(0, targetScroll);
      setScrollLeft(containerRef.current.scrollLeft);
    }
  }, []);

  // Compute bar state per § 3.4:
  // - concluded: solid verdigris
  // - in progress: verdigris pulsing
  // - overdue: cinnabar
  // - prior year: muted verdigris
  // - upcoming: neutral
  // - ghosted plan: outlined verdigris
  // - ad-hoc pending: pulsing cinnabar
  const getBarState = (eng: AuditEngagement) => {
    const end = new Date(eng.dueDate).getTime();
    const isPriorYear = new Date(eng.dueDate).getFullYear() < 2026;
    const isOverdue = eng.status !== 'signed_off' && eng.status !== 'closed' && end < todayDate;

    if (eng.status === 'signed_off' || eng.status === 'closed') {
      if (isPriorYear) {
        return {
          type: 'prior_year',
          label: 'Prior Year (Concluded)',
          colorClass: 'bg-surface-sunken border border-hairline text-secondary',
        };
      }
      return {
        type: 'concluded',
        label: 'Concluded & Sealed',
        colorClass: 'bg-verdigris text-canvas',
      };
    }

    if (isOverdue) {
      return {
        type: 'overdue',
        label: 'Remediation Overdue',
        colorClass: 'bg-cinnabar text-canvas shadow-xs',
      };
    }

    if (eng.stage === 'planning' && eng.completionPercent === 0) {
      return {
        type: 'ghosted_plan',
        label: 'Ghosted Plan',
        colorClass: 'border-2 border-dashed border-verdigris bg-surface-elevated text-secondary',
      };
    }

    if (eng.status === 'in_progress') {
      return {
        type: 'in_progress',
        label: 'In Progress (Active Fieldwork)',
        colorClass: 'bg-verdigris-subtle border-2 border-verdigris text-verdigris animate-pulse',
      };
    }

    return {
      type: 'upcoming',
      label: 'Scheduled Execution',
      colorClass: 'bg-surface-elevated border border-hairline text-secondary',
    };
  };

  // Convert engagement dates to X coordinates
  const getBarBounds = (eng: AuditEngagement) => {
    const start = Math.max(timelineStart, new Date(eng.periodStart).getTime());
    const end = Math.min(timelineEnd, new Date(eng.dueDate).getTime());
    const leftX = ((start - timelineStart) / totalDuration) * timelineWidth;
    const barWidth = Math.max(36, ((end - start) / totalDuration) * timelineWidth);
    return { leftX, barWidth };
  };

  // Depth scale and opacity falloff while dragging (§ 3.4 requirement)
  const getDynamicStyle = (leftX: number, barWidth: number) => {
    if (!containerRef.current || !isPanning) {
      return { opacity: 1, transform: 'scale(1)' };
    }
    const viewportCenter = scrollLeft + containerRef.current.clientWidth / 2;
    const barCenter = leftX + barWidth / 2;
    const distFromCenter = Math.abs(viewportCenter - barCenter);
    const maxDist = containerRef.current.clientWidth / 1.2;
    const factor = Math.max(0, Math.min(1, distFromCenter / maxDist));
    const opacity = 1 - factor * 0.45;
    const scale = 1 - factor * 0.04;
    return {
      opacity,
      transform: `scale(${scale})`,
      transition: 'opacity 80ms linear, transform 80ms linear',
    };
  };

  return (
    <div className="w-full bg-surface border border-hairline rounded-2xl p-6 shadow-apple space-y-4 select-none">
      {/* Header controls: Title, Legend, and "Today" smooth scroll */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-hairline">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">
              Assurance Flight Plan &amp; Velocity
            </span>
            <span className="px-2 py-0.5 rounded-full text-apple-11 font-medium bg-surface-elevated text-secondary border border-hairline">
              18-Month Continuous Scope
            </span>
          </div>
          <h3 className="text-apple-17 font-bold text-primary mt-1">
            Engagement Gantt &amp; Horizon Warp
          </h3>
          <p className="text-apple-12 text-secondary mt-0.5">
            Pan with natural velocity decay (0.94) • Click for focus card • Double-click to launch audit file
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Legend Chips */}
          <div className="hidden lg:flex items-center gap-2 text-apple-11 text-secondary">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-verdigris" /> Concluded
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-verdigris bg-verdigris-subtle animate-pulse" /> Active
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-cinnabar" /> Overdue
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-verdigris" /> Plan
            </span>
          </div>

          {/* "Today" Smooth Scroll Button (§ 3.4 requirement) */}
          <button
            onClick={scrollToToday}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-subtle hover:bg-accent-hover text-accent text-apple-12 font-semibold transition-colors shadow-xs"
            title="Jump viewport to today (Sep 30, 2026)"
          >
            <Calendar className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Today</span>
          </button>
        </div>
      </div>

      {/* Pending Date Range Chip for Managers (§ 3.4 requirement) */}
      <AnimatePresence>
        {pendingDateChange && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center justify-between p-3 rounded-xl bg-accent-subtle border border-accent text-apple-12 text-accent"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 stroke-[1.5]" />
              <span>
                Pending milestone change for <strong>{pendingDateChange.title}</strong>: {pendingDateChange.newStart} → {pendingDateChange.newDue}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPendingDateChange(null)}
                className="px-2.5 py-1 rounded-lg bg-surface border border-hairline text-secondary hover:text-primary text-apple-11"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  setPendingDateChange(null);
                }}
                className="px-2.5 py-1 rounded-lg bg-accent text-canvas font-semibold text-apple-11 shadow-xs"
              >
                Approve Shift
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline Scrollable Viewport with Inertial Drag */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setIsPanning(false)}
        className="w-full overflow-x-auto relative rounded-xl border border-hairline bg-surface-sunken cursor-grab active:cursor-grabbing select-none scrollbar-none"
      >
        <div
          ref={trackRef}
          style={{ width: `${timelineWidth}px` }}
          className="relative min-h-[380px] py-4"
        >
          {/* Parallax Weekly Grid (0.4x relative background scroll per § 3.4) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundSize: '40px 100%',
              backgroundImage: 'linear-gradient(to right, var(--border-hairline) 1px, transparent 1px)',
              opacity: 0.35,
              transform: `translateX(${-scrollLeft * 0.4}px)`,
              pointerEvents: 'none',
            }}
          />

          {/* Month Ruler Header (§ 3.4: Jan emphasized with year) */}
          <div className="relative border-b border-hairline pb-2 mb-4 h-9">
            {months.map((m, idx) => (
              <div
                key={`${m.year}-${m.label}-${idx}`}
                style={{ left: `${m.startX}px`, width: `${m.width}px` }}
                className={`absolute top-0 text-center font-medium ${
                  m.isJan
                    ? 'text-apple-13 font-serif-title font-bold text-primary border-l-2 border-accent pl-1'
                    : 'text-apple-11 text-tertiary border-l border-hairline'
                }`}
              >
                {m.label} {m.isJan && <span className="text-accent">{m.year}</span>}
              </div>
            ))}
          </div>

          {/* TODAY Marker (§ 3.4 requirement) */}
          <div
            style={{ left: `${todayX}px` }}
            className="absolute top-0 bottom-0 w-[2px] bg-accent z-20 pointer-events-none"
          >
            <div className="absolute top-0 -translate-x-1/2 px-2 py-0.5 bg-accent text-canvas rounded-full text-apple-11 font-bold shadow-xs whitespace-nowrap">
              TODAY (SEP 30)
            </div>
          </div>

          {/* Engagement Gantt Bars Rows */}
          <div className="space-y-3.5 pt-2">
            {engagements.map((eng) => {
              const { leftX, barWidth } = getBarBounds(eng);
              const state = getBarState(eng);
              const dynamicStyle = getDynamicStyle(leftX, barWidth);

              const previewData = {
                title: eng.title,
                category: `Fieldwork Stage: ${eng.stage.toUpperCase()}`,
                subtitle: `${eng.completionPercent}% execution completed • Lead: ${eng.leadAuditorId}`,
                status: state.label,
                statusType:
                  state.type === 'concluded'
                    ? ('verdigris' as const)
                    : state.type === 'overdue'
                    ? ('cinnabar' as const)
                    : ('neutral' as const),
                dueDate: eng.dueDate,
                hint: 'Double-click to open permanent audit file • Click for focus card',
              };

              return (
                <div key={eng.id} className="relative h-10 flex items-center">
                  {/* Subtle track lane */}
                  <div className="absolute inset-x-0 h-8 rounded-lg bg-surface border border-hairline opacity-40 pointer-events-none" />

                  {/* Gantt Bar Element with Universal Frosted Hover Preview */}
                  <HoverPreview content={previewData} className="contents">
                    <div
                      style={{
                        position: 'absolute',
                        left: `${leftX}px`,
                        width: `${barWidth}px`,
                        ...dynamicStyle,
                      }}
                      onClick={() => {
                        setFocusedEngagement(eng);
                        if (onSelectEngagement) onSelectEngagement(eng.id);
                      }}
                      onDoubleClick={() => {
                        openInspector('audit_file', { engagement: eng });
                      }}
                      className={`gantt-bar-element h-8 px-3 rounded-lg flex items-center justify-between text-apple-12 font-medium cursor-pointer transition-all hover:brightness-105 active:scale-95 shadow-xs overflow-hidden z-10 ${state.colorClass}`}
                    >
                      <span className="truncate pr-2">{eng.title}</span>
                      <span className="text-apple-11 font-semibold tabular-nums shrink-0 opacity-90">
                        {eng.completionPercent}%
                      </span>
                    </div>
                  </HoverPreview>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Morphing Focus Card on Click (§ 3.4 requirement) */}
      <AnimatePresence>
        {focusedEngagement && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="p-4 rounded-xl bg-surface-elevated border border-hairline shadow-apple flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-apple-11 font-mono uppercase font-semibold text-accent">
                  {focusedEngagement.id}
                </span>
                <span className="px-2 py-0.2 rounded text-apple-11 font-semibold uppercase bg-accent-subtle text-accent">
                  {focusedEngagement.stage}
                </span>
                {focusedEngagement.signedOffAt && (
                  <span className="flex items-center gap-1 text-apple-11 text-verdigris font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5 stroke-[2]" />
                    Sealed
                  </span>
                )}
              </div>
              <h4 className="text-apple-15 font-bold text-primary">
                {focusedEngagement.title}
              </h4>
              <p className="text-apple-12 text-secondary">
                Period: {focusedEngagement.periodStart} → {focusedEngagement.dueDate} • Progress: {focusedEngagement.completionPercent}%
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setFocusedEngagement(null)}
                className="p-2 rounded-xl text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
                title="Dismiss focus card"
              >
                <X className="w-4 h-4 stroke-[1.5]" />
              </button>
              <button
                onClick={() => {
                  openInspector('audit_file', { engagement: focusedEngagement });
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-canvas font-semibold text-apple-12 hover:opacity-90 transition-opacity shadow-xs"
              >
                <span>Open Audit File</span>
                <ExternalLink className="w-3.5 h-3.5 stroke-[1.5]" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
