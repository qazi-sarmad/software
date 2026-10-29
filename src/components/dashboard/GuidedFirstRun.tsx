import React, { useCallback, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useOrgDataState } from '../../hooks/useOrgDataState';
import { nextGuidedStep, visibleGuidedSteps } from '../../lib/guidedFirstRun';
import { InlineError } from '../common/InlineError';
import { Check, Plus, Sparkles, ArrowRight } from '../common/Icons';

/**
 * The guided first run (U6; SYSTELIGON.md §11.1c Tier 2 item 7).
 *
 * A new organisation's dashboard must not be a wall of zeros. When the organisation holds no
 * universe yet, this panel replaces the ordinary dashboard body with one plain sentence and one
 * button: "Create your first universe". The decision of what to show is the pure
 * `src/lib/guidedFirstRun.ts` rule over three counts; the counts come from the gated
 * `get_org_data_state` RPC (migration 0117), which returns counts and a boolean, never a row of
 * tenant content (Law L2).
 *
 * The create is the same right-checked path every other write uses: `createUniverse` on the app
 * context, gated by `edit_config` in the browser and re-checked in the database. Non-blocking: an
 * inline form in the panel, never a modal.
 */
export interface GuidedFirstRunProps {
  screenId: string;
  /** Called when a guided step should open an existing surface (the setup wizard). */
  onOpenSetup?: () => void;
}

export const GuidedFirstRun: React.FC<GuidedFirstRunProps> = ({ screenId, onOpenSetup }) => {
  const { currentUser, createUniverse } = useApp();
  const { counts, isNew, loading } = useOrgDataState();

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = visibleGuidedSteps(currentUser, counts);
  const next = nextGuidedStep(currentUser, counts);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await createUniverse({ name });
    setBusy(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setName('');
    setNaming(false);
    // createUniverse reloads the tenant snapshot, which changes the scoped universe count and
    // re-reads the org state, so this panel leaves the first-run state on its own.
  }, [createUniverse, name]);

  // Not a new organisation (or still resolving): the dashboard shows its ordinary content.
  if (loading || !isNew) return null;

  return (
    <section
      className="rounded-2xl bg-surface border border-hairline shadow-apple p-6 space-y-4"
      data-testid={`${screenId}-guided-empty`}
      aria-label="Getting started"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-9 h-9 rounded-xl bg-accent-subtle text-accent flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 stroke-[1.5]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-apple-18 font-semibold text-primary">Let’s get your first audit in</h2>
          <p className="text-apple-13 text-secondary mt-1">
            Your organisation is empty. These steps turn it into a working audit workspace.
          </p>
        </div>
      </div>

      <ol className="space-y-2" data-testid={`${screenId}-guided-steps`}>
        {steps.map((step, i) => (
          <li
            key={step.key}
            className="flex items-start gap-3 py-2 border-t border-hairline first:border-t-0"
            data-testid={`${screenId}-guided-step-${step.key}`}
            data-done={step.done}
          >
            <span
              className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-apple-11 ${
                step.done ? 'bg-verdigris-subtle text-verdigris' : 'bg-surface-sunken text-tertiary'
              }`}
              aria-hidden="true"
            >
              {step.done ? <Check className="w-3 h-3 stroke-[2]" /> : <span>{i + 1}</span>}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-apple-13 font-medium text-primary">{step.title}</div>
              <div className="text-apple-12 text-secondary">{step.body}</div>
            </div>
          </li>
        ))}
      </ol>

      {error && <InlineError message={error} testId={`${screenId}-guided-error`} />}

      <div className="flex items-center gap-3 flex-wrap">
        {naming ? (
          <form
            className="flex items-center gap-2"
            data-testid={`${screenId}-guided-universe-form`}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="sr-only" htmlFor={`${screenId}-guided-universe-name`}>
              Universe name
            </label>
            <input
              id={`${screenId}-guided-universe-name`}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Treasury, or Core Banking"
              data-testid={`${screenId}-guided-universe-name`}
              className="px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-13 text-primary placeholder:text-tertiary outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || name.trim() === ''}
              data-testid={`${screenId}-guided-universe-submit`}
              className="px-4 py-2 rounded-xl bg-accent text-canvas text-apple-13 font-medium disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create universe'}
            </button>
          </form>
        ) : next ? (
          <button
            type="button"
            data-testid={`${screenId}-guided-primary`}
            onClick={() => {
              if (next.action === 'create_universe') setNaming(true);
              else if (next.action === 'open_setup') onOpenSetup?.();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-canvas text-apple-13 font-medium"
          >
            <Plus className="w-4 h-4 stroke-[1.5]" />
            {next.ctaLabel}
            <ArrowRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        ) : (
          // No actionable first-run step for this caller (no edit_config): the only safe primary is
          // the setup wizard, never a create button that would be refused.
          <button
            type="button"
            data-testid={`${screenId}-guided-primary`}
            onClick={() => onOpenSetup?.()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-canvas text-apple-13 font-medium"
          >
            <Sparkles className="w-4 h-4 stroke-[1.5]" />
            Open the setup wizard
          </button>
        )}
        {next && (
          <button
            type="button"
            data-testid={`${screenId}-guided-setup`}
            onClick={() => onOpenSetup?.()}
            className="text-apple-13 text-accent font-medium"
          >
            Or run the guided setup wizard
          </button>
        )}
      </div>
    </section>
  );
};
