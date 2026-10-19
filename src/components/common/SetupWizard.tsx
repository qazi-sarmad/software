import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { listSetupSteps, saveSetupStep, setupProgress, type SetupScope, type SetupStep, type StepState, type StepStatus } from '../../data/setup';
import { visibleSteps, type WizardStepDef } from '../../lib/wizardSteps';
import { InlineError } from './InlineError';
import { TutorialDrawer } from './TutorialDrawer';
import { Check, ChevronLeft, ChevronRight, Eye } from './Icons';

type LoadState = 'loading' | 'ready' | 'error';

interface SetupWizardProps {
  scope: SetupScope;
  /** Features the org has enabled; steps that require a disabled feature are hidden (F25). */
  enabledFeatures?: string[];
  /** The current step body, given the step definition. */
  renderStep?: (step: WizardStepDef) => React.ReactNode;
  onDone?: () => void;
}

/**
 * Guided setup wizard (F17). Two linear, persisted wizards share this frame. Each step shows the
 * plain-language what / why / skip text, a tutorial ("Show me how") and Back / Skip / Save and
 * exit. Progress is persisted through src/data/setup.ts; a resume banner appears on return. The
 * frame is non-blocking and never a modal.
 */
export const SetupWizard: React.FC<SetupWizardProps> = ({
  scope, enabledFeatures = [], renderStep, onDone,
}) => {
  const steps = useMemo(() => visibleSteps(scope, new Set(enabledFeatures)), [scope, enabledFeatures]);
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState<SetupStep[]>([]);
  const [index, setIndex] = useState(0);
  const [tutorialKey, setTutorialKey] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const rows = await listSetupSteps(scope);
      setSaved(rows);
      const firstOpen = steps.findIndex((s) => {
        const row = rows.find((r) => r.stepKey === s.key);
        return !row || row.status !== 'done';
      });
      if (rows.length > 0 && firstOpen > 0) {
        setIndex(firstOpen);
        setResumed(true);
      }
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the setup wizard.');
      setState('error');
    }
  }, [scope, steps]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusOf = useCallback(
    (key: string): StepState => saved.find((r) => r.stepKey === key)?.status ?? 'not_started',
    [saved]
  );

  const mark = useCallback(
    async (key: string, status: StepStatus) => {
      const r = await saveSetupStep(scope, key, status);
      if (r.ok) setSaved((prev) => {
        const rest = prev.filter((p) => p.stepKey !== key);
        return [...rest, { stepKey: key, status, answerRef: {}, updatedAt: new Date().toISOString() }];
      });
      return r;
    },
    [scope]
  );

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid={`${scope}-wizard-loading`}>Loading setup…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId={`${scope}-wizard-error`} />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }
  if (steps.length === 0) {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid={`${scope}-wizard-empty`}>There are no setup steps.</div>;
  }

  const step = steps[Math.min(index, steps.length - 1)];
  const progress = setupProgress(saved, steps.length);

  return (
    <div className="space-y-4" data-testid={`${scope}-wizard`}>
      {resumed && (
        <div className="rounded-xl border border-hairline bg-accent-subtle px-4 py-2 text-apple-12 text-primary" data-testid={`${scope}-wizard-resume`}>
          Welcome back. You left off at “{step.title}”.
        </div>
      )}

      <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden" data-testid={`${scope}-wizard-progress`}>
        <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      <ol className="flex flex-wrap gap-2" data-testid={`${scope}-wizard-steps`}>
        {steps.map((s, i) => {
          const st = statusOf(s.key);
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                data-testid={`${scope}-wizard-step-${s.key}`}
                className={`px-3 py-1.5 rounded-lg text-apple-12 border ${i === index ? 'border-accent text-primary' : 'border-hairline text-secondary hover:text-primary'}`}
              >
                {st === 'done' && <Check className="w-3 h-3 inline mr-1" />}
                {s.title}
              </button>
            </li>
          );
        })}
      </ol>

      <section className="rounded-2xl border border-hairline bg-surface p-5 space-y-3" data-testid={`${scope}-wizard-body`}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-apple-16 font-semibold text-primary">{step.title}</h2>
          <button
            type="button"
            onClick={() => setTutorialKey(step.tutorialKey)}
            data-testid={`${scope}-wizard-show-${step.key}`}
            className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline"
          >
            <Eye className="w-3.5 h-3.5" /> Show me how
          </button>
        </div>
        <p className="text-apple-13 text-primary">{step.what}</p>
        <p className="text-apple-12 text-secondary"><span className="font-medium text-primary">Why it matters:</span> {step.why}</p>
        <p className="text-apple-12 text-secondary"><span className="font-medium text-primary">If you skip it:</span> {step.skip}</p>
        {renderStep && <div className="pt-2" data-testid={`${scope}-wizard-content-${step.key}`}>{renderStep(step)}</div>}
      </section>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          data-testid={`${scope}-wizard-back`}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className="flex gap-2">
          {step.optional && (
            <button
              type="button"
              onClick={() => void mark(step.key, 'skipped')}
              data-testid={`${scope}-wizard-skip`}
              className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary"
            >
              Do this later
            </button>
          )}
          <button
            type="button"
            onClick={() => void mark(step.key, 'pending')}
            data-testid={`${scope}-wizard-save`}
            className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary"
          >
            Save and exit
          </button>
          <button
            type="button"
            onClick={() => {
              void mark(step.key, 'done').then(() => {
                if (index < steps.length - 1) setIndex((i) => i + 1);
                else onDone?.();
              });
            }}
            data-testid={`${scope}-wizard-next`}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90"
          >
            {index < steps.length - 1 ? 'Next' : 'Finish'}
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {tutorialKey && (
        <TutorialDrawer
          tutorialKey={tutorialKey}
          title={step.title}
          onClose={() => setTutorialKey(null)}
        />
      )}
    </div>
  );
};
