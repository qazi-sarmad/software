import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { AuditObservation, Severity } from '../../types';
import { AlertCircle, CheckCircle2, Zap } from '../common/Icons';

interface ObservationDrilldownProps {
  data?: {
    observation?: AuditObservation;
    issue?: any;
    workpaper?: any;
  } | null;
  onClose?: () => void;
}

export const ObservationDrilldown: React.FC<ObservationDrilldownProps> = ({ data, onClose }) => {
  const { addObservation, closeInspector, openInspector } = useApp();
  const { scopedWorkpapers, scopedEntities } = useScopedData();

  const existingObs = data?.observation;
  const isEditingOrCreating = !existingObs;

  const [title, setTitle] = useState(existingObs?.title || '');
  const [condition, setCondition] = useState(existingObs?.condition || '');
  const [criteria, setCriteria] = useState(existingObs?.criteria || '');
  const [cause, setCause] = useState(existingObs?.cause || '');
  const [consequence, setConsequence] = useState(existingObs?.consequence || '');
  const [recommendation, setRecommendation] = useState(existingObs?.recommendation || '');
  const [severity, setSeverity] = useState<Severity>(existingObs?.severity || 'high');
  const [selectedWpId, setSelectedWpId] = useState(
    data?.workpaper?.id || scopedWorkpapers[0]?.id || ''
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !condition.trim()) {
      alert('Please provide title and condition.');
      return;
    }

    const targetWp = scopedWorkpapers.find((w) => w.id === selectedWpId) || scopedWorkpapers[0];
    if (!targetWp) {
      alert('No working paper available in current scope.');
      return;
    }

    await addObservation({
      workpaperId: targetWp.id,
      controlId: targetWp.controlId,
      entityId: targetWp.entityId,
      universeId: targetWp.universeId,
      title,
      condition,
      criteria,
      cause,
      consequence,
      recommendation,
      severity,
      status: 'open',
    });

    closeInspector();
  };

  if (existingObs) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <span className="text-apple-11 font-semibold text-cinnabar bg-cinnabar-subtle px-2.5 py-1 rounded uppercase">
            {existingObs.severity} Severity Finding
          </span>
          {existingObs.ruleId && (
            <button
              onClick={() => openInspector('red_thread')}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-apple-11 font-medium bg-accent-subtle text-accent hover:opacity-80 transition-opacity"
            >
              <Zap className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Trace Red Thread</span>
            </button>
          )}
        </div>

        <div>
          <h3 className="text-apple-20 font-bold text-primary">{existingObs.title}</h3>
          <div className="text-apple-11 text-secondary mt-1">
            Recorded {new Date(existingObs.createdAt).toLocaleString()} by {existingObs.raisedBy}
          </div>
        </div>

        <div className="space-y-4 text-apple-13">
          <div className="p-4 rounded-xl bg-surface-elevated border border-hairline space-y-1">
            <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
              1. Condition (What was found)
            </span>
            <p className="text-primary leading-relaxed">{existingObs.condition}</p>
          </div>

          <div className="p-4 rounded-xl bg-surface-elevated border border-hairline space-y-1">
            <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
              2. Criteria (What should be)
            </span>
            <p className="text-primary leading-relaxed">{existingObs.criteria}</p>
          </div>

          <div className="p-4 rounded-xl bg-surface-elevated border border-hairline space-y-1">
            <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
              3. Root Cause
            </span>
            <p className="text-primary leading-relaxed">{existingObs.cause}</p>
          </div>

          <div className="p-4 rounded-xl bg-surface-elevated border border-hairline space-y-1">
            <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
              4. Consequence / Risk Impact
            </span>
            <p className="text-primary leading-relaxed">{existingObs.consequence}</p>
          </div>

          <div className="p-4 rounded-xl bg-surface-elevated border border-hairline space-y-1">
            <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
              5. Auditor Recommendation
            </span>
            <p className="text-primary leading-relaxed">{existingObs.recommendation}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="border-b border-hairline pb-3">
        <h3 className="text-apple-15 font-semibold text-primary">Raise Formal Audit Finding</h3>
        <p className="text-apple-12 text-secondary mt-0.5">
          Standardized 5C observation structure committed to hash ledger
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-apple-12 font-medium text-secondary">Target Working Paper</label>
        <select
          value={selectedWpId}
          onChange={(e) => setSelectedWpId(e.target.value)}
          className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
        >
          {scopedWorkpapers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.refCode} • {w.title}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-apple-12 font-medium text-secondary">Finding Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Brief executive summary of deficiency..."
          className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-apple-12 font-medium text-secondary">Severity</label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-apple-12 font-medium text-secondary">Condition (Observation)</label>
        <textarea
          rows={2}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="What specific deficiency was observed?"
          className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-apple-12 font-medium text-secondary">Criteria</label>
        <textarea
          rows={2}
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          placeholder="Policy clause, regulation, or standard breached..."
          className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-apple-12 font-medium text-secondary">Recommendation</label>
        <textarea
          rows={2}
          value={recommendation}
          onChange={(e) => setRecommendation(e.target.value)}
          placeholder="Actionable remedial steps for management..."
          className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
        />
      </div>

      <div className="pt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={closeInspector}
          className="px-4 py-2 text-apple-12 text-secondary hover:text-primary"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-5 py-2 bg-accent text-white font-medium text-apple-12 rounded-xl hover:opacity-90 transition-opacity shadow-xs"
        >
          Commit Finding
        </button>
      </div>
    </form>
  );
};
