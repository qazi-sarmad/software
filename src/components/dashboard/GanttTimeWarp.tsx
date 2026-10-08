import React from 'react';
import { motion } from 'motion/react';
import { AuditEngagement } from '../../types';
import { HoverPreview } from '../common/HoverPreview';
import { Calendar, CheckCircle2, Clock } from '../common/Icons';

interface GanttProps {
  engagements: AuditEngagement[];
  onSelectEngagement: (id: string) => void;
}

export const GanttTimeWarp: React.FC<GanttProps> = ({
  engagements,
  onSelectEngagement,
}) => {
  const months = ['Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026'];

  // Calculate horizontal offset and width for engagement timeline bar
  const getBarStyle = (eng: AuditEngagement) => {
    // Relative positioning between July 1 and Dec 31
    const baseDate = new Date('2026-07-01').getTime();
    const endDate = new Date('2026-12-31').getTime();
    const totalSpan = endDate - baseDate;

    const start = Math.max(baseDate, new Date(eng.periodStart).getTime());
    const due = Math.min(endDate, new Date(eng.dueDate).getTime());

    const leftPercent = Math.max(0, Math.min(100, ((start - baseDate) / totalSpan) * 100));
    const widthPercent = Math.max(12, Math.min(100 - leftPercent, ((due - start) / totalSpan) * 100));

    return {
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
    };
  };

  return (
    <div className="w-full bg-surface border border-hairline rounded-2xl p-5 shadow-apple space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-apple-15 font-semibold text-primary">Engagement Timeline &amp; Delivery Warp</h3>
          <p className="text-apple-12 text-secondary">
            Multi-quarter milestones, phase gates, and reviewer sign-off horizons
          </p>
        </div>
        <div className="flex items-center gap-3 text-apple-11 text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent" /> In Progress
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-verdigris" /> Sealed / Signed-off
          </span>
        </div>
      </div>

      {/* Month timeline header columns */}
      <div className="grid grid-cols-6 border-b border-hairline pb-2 text-center text-apple-11 font-medium text-tertiary">
        {months.map((m) => (
          <div key={m}>{m}</div>
        ))}
      </div>

      {/* Gantt Bars List */}
      <div className="space-y-3 relative min-h-[140px]">
        {/* Background grid vertical guidelines */}
        <div className="absolute inset-0 grid grid-cols-6 pointer-events-none">
          {months.map((m, idx) => (
            <div
              key={idx}
              className={`h-full ${idx > 0 ? 'border-l border-hairline opacity-40' : ''}`}
            />
          ))}
        </div>

        {engagements.length === 0 ? (
          <div className="py-8 text-center text-apple-12 text-secondary">
            No engagements active for this scoped filter.
          </div>
        ) : (
          engagements.map((eng) => {
            const barPos = getBarStyle(eng);
            const isSigned = eng.status === 'signed_off';
            const previewData = {
              title: eng.title,
              category: `Stage: ${eng.stage.toUpperCase()}`,
              subtitle: `Progress: ${eng.completionPercent}% complete`,
              status: isSigned ? 'Signed-off & Sealed' : 'In Fieldwork',
              statusType: isSigned ? ('verdigris' as const) : ('neutral' as const),
              dueDate: eng.dueDate,
              metrics: [
                { label: 'Start', value: eng.periodStart },
                { label: 'Due', value: eng.dueDate },
              ],
              hint: 'Click to open audit plan and workpapers',
            };

            return (
              <div key={eng.id} className="relative z-10">
                <HoverPreview content={previewData}>
                  <div
                    onClick={() => onSelectEngagement(eng.id)}
                    className="relative w-full h-11 bg-surface-elevated/40 hover:bg-surface-elevated/80 rounded-xl transition-colors cursor-pointer flex items-center px-2"
                  >
                    {/* The colored timeline pill */}
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      style={{
                        position: 'absolute',
                        left: barPos.left,
                        width: barPos.width,
                        transformOrigin: 'left center',
                      }}
                      className={`h-8 rounded-lg px-3 flex items-center justify-between text-apple-11 font-medium transition-shadow shadow-xs ${
                        isSigned
                          ? 'bg-verdigris-subtle text-verdigris border border-verdigris'
                          : 'bg-accent-subtle text-accent border border-accent'
                      }`}
                    >
                      <span className="truncate pr-2 font-medium">{eng.title}</span>
                      <span className="tabular-nums shrink-0 font-semibold">
                        {eng.completionPercent}%
                      </span>
                    </motion.div>
                  </div>
                </HoverPreview>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
