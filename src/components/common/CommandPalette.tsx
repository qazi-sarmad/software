import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Folder, FileText, AlertCircle, ShieldAlert, ArrowRight } from './Icons';
import { useScopedData } from '../../hooks/useScopedData';
import { useApp } from '../../context/AppContext';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const {
    scopedEntities,
    scopedEngagements,
    scopedWorkpapers,
    scopedObservations,
    scopedIssues,
  } = useScopedData();
  const {
    setActiveTab,
    setSelectedEngagementId,
    setSelectedWorkpaperId,
    openInspector,
  } = useApp();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery('');
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();

  const matchingEntities = q
    ? scopedEntities.filter(
        (e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)
      )
    : scopedEntities.slice(0, 3);

  const matchingEngagements = q
    ? scopedEngagements.filter(
        (e) => e.title.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
      )
    : scopedEngagements.slice(0, 3);

  const matchingWorkpapers = q
    ? scopedWorkpapers.filter(
        (w) => w.title.toLowerCase().includes(q) || w.refCode.toLowerCase().includes(q)
      )
    : scopedWorkpapers.slice(0, 3);

  const matchingObservations = q
    ? scopedObservations.filter(
        (o) => o.title.toLowerCase().includes(q) || o.condition.toLowerCase().includes(q)
      )
    : scopedObservations.slice(0, 3);

  const matchingIssues = q
    ? scopedIssues.filter(
        (i) => i.title.toLowerCase().includes(q) || i.department.toLowerCase().includes(q)
      )
    : scopedIssues.slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-xs"
      />

      {/* Palette Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -10 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative w-full max-w-2xl bg-surface border border-hairline shadow-apple rounded-2xl overflow-hidden z-10"
      >
        {/* Input Field */}
        <div className="flex items-center px-4 py-3.5 border-b border-hairline gap-3 bg-surface">
          <Search className="w-5 h-5 text-secondary stroke-[1.5]" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scoped entities, engagements, workpapers, observations..."
            className="w-full bg-transparent text-apple-15 text-primary placeholder:text-tertiary outline-none border-none"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-secondary hover:text-primary transition-colors"
          >
            <X className="w-4 h-4 stroke-[1.5]" />
          </button>
        </div>

        {/* Results Body */}
        <div className="max-h-96 overflow-y-auto p-3 space-y-4">
          {/* Engagements */}
          {matchingEngagements.length > 0 && (
            <div>
              <div className="px-3 py-1 text-apple-11 font-medium text-tertiary uppercase tracking-wider">
                Engagements ({matchingEngagements.length})
              </div>
              {matchingEngagements.map((eng) => (
                <button
                  key={eng.id}
                  onClick={() => {
                    setSelectedEngagementId(eng.id);
                    setActiveTab('plan');
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <Folder className="w-4 h-4 text-accent stroke-[1.5]" />
                    <div>
                      <div className="text-apple-13 font-medium text-primary">{eng.title}</div>
                      <div className="text-apple-11 text-secondary">
                        {eng.stage.toUpperCase()} • Due {eng.dueDate}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-tertiary group-hover:text-primary transition-colors stroke-[1.5]" />
                </button>
              ))}
            </div>
          )}

          {/* Workpapers */}
          {matchingWorkpapers.length > 0 && (
            <div>
              <div className="px-3 py-1 text-apple-11 font-medium text-tertiary uppercase tracking-wider">
                Workpapers ({matchingWorkpapers.length})
              </div>
              {matchingWorkpapers.map((wp) => (
                <button
                  key={wp.id}
                  onClick={() => {
                    setSelectedWorkpaperId(wp.id);
                    setActiveTab('workbench');
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-secondary stroke-[1.5]" />
                    <div>
                      <div className="text-apple-13 font-medium text-primary">
                        {wp.refCode}: {wp.title}
                      </div>
                      <div className="text-apple-11 text-secondary">
                        {wp.status.replace('_', ' ').toUpperCase()} • {wp.sampleCount} samples
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-tertiary group-hover:text-primary transition-colors stroke-[1.5]" />
                </button>
              ))}
            </div>
          )}

          {/* Observations */}
          {matchingObservations.length > 0 && (
            <div>
              <div className="px-3 py-1 text-apple-11 font-medium text-tertiary uppercase tracking-wider">
                Observations ({matchingObservations.length})
              </div>
              {matchingObservations.map((obs) => (
                <button
                  key={obs.id}
                  onClick={() => {
                    openInspector('observation', obs);
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <AlertCircle className="w-4 h-4 text-cinnabar stroke-[1.5]" />
                    <div>
                      <div className="text-apple-13 font-medium text-primary">{obs.title}</div>
                      <div className="text-apple-11 text-secondary">
                        {obs.severity.toUpperCase()} • Workpaper {obs.workpaperId}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-tertiary group-hover:text-primary transition-colors stroke-[1.5]" />
                </button>
              ))}
            </div>
          )}

          {/* Empty search state */}
          {q &&
            matchingEntities.length === 0 &&
            matchingEngagements.length === 0 &&
            matchingWorkpapers.length === 0 &&
            matchingObservations.length === 0 && (
              <div className="py-12 text-center text-secondary text-apple-13">
                No scoped items match "{query}" within your permissions.
              </div>
            )}
        </div>
      </motion.div>
    </div>
  );
};
