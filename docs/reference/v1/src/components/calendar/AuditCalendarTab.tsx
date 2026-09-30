import React, { useState } from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useFilterStore } from '../../context/FilterStore';
import { useApp } from '../../context/AppContext';
import { HoverPreview } from '../common/HoverPreview';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
} from '../common/Icons';

export const AuditCalendarTab: React.FC = () => {
  const { filteredEngagements, scopedWorkpapers, scopedIssues } = useScopedData();
  const filter = useFilterStore();
  const { setSelectedEngagementId, setActiveTab } = useApp();

  const [currentMonth, setCurrentMonth] = useState<number>(8); // 8 = September 2026
  const [currentYear, setCurrentYear] = useState<number>(2026);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  // Find events on a specific day
  const getDayEvents = (day: number) => {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(
      day
    ).padStart(2, '0')}`;

    const dueEngagements = filteredEngagements.filter((e) => e.dueDate === dateStr);
    const startEngagements = filteredEngagements.filter((e) => e.periodStart === dateStr);
    const dueIssues = scopedIssues.filter((i) => i.dueDate === dateStr);

    return {
      dueEngagements,
      startEngagements,
      dueIssues,
      totalCount: dueEngagements.length + startEngagements.length + dueIssues.length,
      hasCritical: dueIssues.some((i) => i.severity === 'critical'),
    };
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-apple-28 font-bold text-primary tracking-tight">Audit Schedule &amp; Milestones</h1>
          <p className="text-apple-15 text-secondary mt-1">
            Deadlines, phase completions, and testing deadlines across your scoped entities
          </p>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center gap-3 bg-surface border border-hairline rounded-xl p-1.5 shadow-apple">
          <button
            onClick={handlePrevMonth}
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
          >
            <ChevronLeft className="w-4 h-4 stroke-[1.5]" />
          </button>
          <span className="text-apple-13 font-semibold text-primary px-3">
            {monthNames[currentMonth]} {currentYear}
          </span>
          <button
            onClick={handleNextMonth}
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
          >
            <ChevronRight className="w-4 h-4 stroke-[1.5]" />
          </button>
        </div>
      </div>

      {/* Calendar Grid Container */}
      <div className="bg-surface border border-hairline rounded-2xl p-6 shadow-apple space-y-4">
        {/* Days of week header */}
        <div className="grid grid-cols-7 text-center text-apple-11 font-semibold text-secondary uppercase tracking-wider pb-2 border-b border-hairline">
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>

        {/* Calendar Day Cells */}
        <div className="grid grid-cols-7 gap-2">
          {/* Empty cells for leading offset */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`offset-${i}`} className="min-h-[100px] p-2 rounded-xl bg-surface-elevated/20 opacity-40" />
          ))}

          {/* Days */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const events = getDayEvents(day);
            const isToday = currentYear === 2026 && currentMonth === 8 && day === 30;

            const previewData = events.totalCount > 0 ? {
              title: `${monthNames[currentMonth]} ${day}, ${currentYear}`,
              category: 'Audit Calendar Milestone',
              subtitle: `${events.totalCount} Scheduled Milestone(s)`,
              status: events.hasCritical ? 'Critical Due Date' : 'Normal Cadence',
              statusType: events.hasCritical ? ('cinnabar' as const) : ('verdigris' as const),
              metrics: [
                { label: 'Engagements Due', value: events.dueEngagements.length },
                { label: 'Issues Due', value: events.dueIssues.length },
              ],
              hint: 'Click to inspect scheduled items',
            } : null;

            return (
              <HoverPreview key={day} content={previewData} className="w-full">
                <div
                  className={`min-h-[100px] p-2.5 rounded-xl border border-hairline transition-all flex flex-col justify-between cursor-pointer ${
                    isToday
                      ? 'bg-accent-subtle border-accent'
                      : events.totalCount > 0
                      ? 'bg-surface hover:bg-surface-hover shadow-xs'
                      : 'bg-surface-elevated/30 hover:bg-surface-elevated/70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-apple-13 font-semibold tabular-nums ${
                        isToday ? 'text-accent' : 'text-primary'
                      }`}
                    >
                      {day}
                    </span>
                    {/* Task 6 differentiator: Micro-state circle indicators (empty, half, check, red dot) */}
                    <div className="flex items-center gap-1">
                      {events.hasCritical && (
                        <span className="w-2 h-2 rounded-full bg-cinnabar" title="Critical Issue Due" />
                      )}
                      {events.dueEngagements.some((e) => e.status === 'signed_off') && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-verdigris stroke-[1.5]" />
                      )}
                      {events.dueEngagements.some((e) => e.status === 'in_progress') && (
                        <span className="w-2 h-2 rounded-full bg-amber" />
                      )}
                    </div>
                  </div>

                  {/* Event Badges */}
                  <div className="space-y-1 mt-1">
                    {events.dueEngagements.map((eng) => (
                      <div
                        key={eng.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEngagementId(eng.id);
                          setActiveTab('plan');
                        }}
                        className="text-apple-11 truncate px-1.5 py-0.5 rounded bg-accent-subtle text-accent font-medium hover:opacity-80"
                      >
                        Due: {eng.title}
                      </div>
                    ))}
                    {events.dueIssues.map((iss) => (
                      <div
                        key={iss.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTab('issues');
                        }}
                        className={`text-apple-11 truncate px-1.5 py-0.5 rounded font-medium ${
                          iss.severity === 'critical'
                            ? 'bg-cinnabar-subtle text-cinnabar'
                            : 'bg-surface-elevated text-secondary'
                        }`}
                      >
                        Issue: {iss.title}
                      </div>
                    ))}
                  </div>
                </div>
              </HoverPreview>
            );
          })}
        </div>
      </div>
    </div>
  );
};
