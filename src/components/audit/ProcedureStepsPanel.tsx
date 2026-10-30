import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { InlineError } from '../common/InlineError';
import { Check, CheckCircle2, Plus } from '../common/Icons';
import {
  listWorkpaperSteps, listProcedureTemplates, applyTemplateToWorkpaper,
  STEP_KIND_LABELS, type WorkpaperStepRow, type ProcedureTemplate,
} from '../../data/methodology';

interface ProcedureStepsPanelProps {
  workpaperId: string;
  locked: boolean;
  /** Reports whether the workpaper carries template steps, so the caller can hide its seed list. */
  onHasTemplateSteps?: (has: boolean) => void;
}

/**
 * Procedure steps for one workpaper (Phase 4.2, §11.3).
 *
 * The steps an engagement follows come from the organisation's methodology library (0110), not from
 * React state. This panel shows the steps applied to this workpaper and lets a preparer snapshot the
 * current procedure for an audit type onto it. Ticking a step persists through set_test_step_state,
 * and finalize_testing refuses to close fieldwork while an applied step is open.
 */
export const ProcedureStepsPanel: React.FC<ProcedureStepsPanelProps> = ({ workpaperId, locked, onHasTemplateSteps }) => {
  const { setTestStepCompleted } = useApp();
  const [steps, setSteps] = useState<WorkpaperStepRow[]>([]);
  const [templates, setTemplates] = useState<ProcedureTemplate[]>([]);
  const [modelId, setModelId] = useState('internal_audit');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [rows, tpls] = await Promise.all([listWorkpaperSteps(workpaperId), listProcedureTemplates()]);
    setSteps(rows);
    setTemplates(tpls);
    if (tpls.length && !tpls.some((t) => t.modelId === modelId)) setModelId(tpls[0].modelId);
    onHasTemplateSteps?.(rows.some((r) => r.fromTemplate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workpaperId]);

  useEffect(() => { void load(); }, [load]);

  const apply = async () => {
    setBusy(true); setMessage(null);
    const res = await applyTemplateToWorkpaper(workpaperId, modelId);
    if (!res.ok) setMessage(res.reason);
    else { await load(); }
    setBusy(false);
  };

  const toggle = (step: WorkpaperStepRow) => {
    if (locked) return;
    const r = setTestStepCompleted(workpaperId, step.stepId, !step.completed);
    if (!r.ok) { setMessage(r.reason); return; }
    setSteps((prev) => prev.map((s) => (s.stepId === step.stepId ? { ...s, completed: !s.completed } : s)));
  };

  const templateSteps = steps.filter((s) => s.fromTemplate);

  return (
    <div className="space-y-3" data-testid="procedure-steps-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          Procedure steps (from your methodology)
        </h3>
        <div className="flex items-center gap-2">
          <select data-testid="procedure-model" value={modelId} disabled={busy || locked}
            onChange={(e) => setModelId(e.target.value)}
            className="h-9 px-2 rounded-xl bg-surface-elevated border border-hairline text-apple-12 text-primary">
            {templates.map((t) => (<option key={t.modelId} value={t.modelId}>{t.title || t.modelId}</option>))}
          </select>
          <button type="button" onClick={() => void apply()} disabled={busy || locked || templates.length === 0}
            data-testid="procedure-apply"
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Apply procedure
          </button>
        </div>
      </div>

      {message && <InlineError message={message} testId="procedure-steps-message" />}

      <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
        {templateSteps.length === 0 && (
          <p className="p-4 text-apple-12 text-secondary" data-testid="procedure-steps-empty">
            No procedure applied yet. Choose a methodology and apply it to snapshot its steps here.
          </p>
        )}
        {templateSteps.map((step, idx) => (
          <button
            key={step.stepId}
            type="button"
            onClick={() => toggle(step)}
            disabled={locked}
            data-testid={`procedure-step-${step.stepId}`}
            className={`w-full text-left p-4 flex items-start gap-3 ${locked ? 'opacity-80 cursor-not-allowed' : 'hover:bg-surface-hover'}`}
          >
            <span className="pt-0.5 shrink-0">
              <span className={`inline-flex w-4 h-4 rounded border items-center justify-center ${step.completed ? 'bg-verdigris border-verdigris text-white' : 'border-hairline'}`}>
                {step.completed && <Check className="w-3 h-3" />}
              </span>
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex items-center justify-between text-apple-12">
                <span className="font-medium text-primary">Step {idx + 1}: {step.label}</span>
                {step.completed && (
                  <span className="text-apple-11 text-verdigris font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Done
                  </span>
                )}
              </span>
              <span className="text-apple-11 text-tertiary">
                {STEP_KIND_LABELS[step.kind]}{step.requiresEvidence ? ' · evidence required' : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
