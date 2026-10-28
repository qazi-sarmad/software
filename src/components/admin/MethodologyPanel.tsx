import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Check, Plus, X } from '../common/Icons';
import {
  listProcedureTemplates, saveProcedureTemplate, publishProcedureTemplate,
  STEP_KINDS, STEP_KIND_LABELS, type ProcedureTemplate, type ProcedureStep, type StepKind,
} from '../../data/methodology';

type LoadState = 'loading' | 'ready' | 'error';

const input = 'h-9 w-full px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent';

/**
 * Methodology library (Phase 4.3, §10.1, §11.3).
 *
 * A procedure is the ordered set of test steps an engagement of a given audit type follows. This
 * screen makes the library first-class data: create a procedure, name it, and define its steps (a
 * label, a kind, and whether evidence is required). Saving writes a new version; publishing makes it
 * the current one an engagement snapshots. The step kinds are a closed set, so the screen can never
 * offer a kind the database or the product cannot render.
 */
export const MethodologyPanel: React.FC = () => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<ProcedureTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; description: string; steps: ProcedureStep[] }>({
    title: '', description: '', steps: [],
  });

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const rows = await listProcedureTemplates();
      setTemplates(rows);
      const first = rows.find((r) => r.modelId === 'internal_audit') ?? rows[0];
      if (first) {
        setSelected(first.id);
        setDraft({ title: first.title, description: first.description, steps: first.steps });
      }
      setState('ready');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the methodology library.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = (t: ProcedureTemplate) => {
    setSelected(t.id);
    setDraft({ title: t.title, description: t.description, steps: t.steps.map((s) => ({ ...s })) });
    setResult(null);
  };

  const current = templates.find((t) => t.id === selected) ?? null;

  const setStep = (index: number, patch: Partial<ProcedureStep>) => {
    setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  };
  const moveStep = (index: number, delta: number) => {
    setDraft((d) => {
      const next = [...d.steps];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...d, steps: next.map((s, i) => ({ ...s, ordinal: i + 1 })) };
    });
  };
  const removeStep = (index: number) => {
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, ordinal: i + 1 })) }));
  };
  const addStep = () => {
    setDraft((d) => ({
      ...d,
      steps: [...d.steps, { stepKey: `step-${d.steps.length + 1}-${Date.now() % 10000}`, label: '', kind: 'inquiry', requiresEvidence: false, ordinal: d.steps.length + 1 }],
    }));
  };

  const save = async () => {
    if (!current) return;
    setBusy(true); setResult(null); setLoadError('');
    const res = await saveProcedureTemplate(current.modelId, draft.title, draft.description, draft.steps);
    if (!res.ok) setLoadError(res.reason);
    else { setResult('Procedure saved as a new version. The next engagement snapshots this plan.'); await load(); }
    setBusy(false);
  };

  const publish = async () => {
    if (!current) return;
    setBusy(true); setResult(null); setLoadError('');
    const res = await publishProcedureTemplate(current.id);
    if (!res.ok) setLoadError(res.reason);
    else { setResult('This version is now the current procedure for its audit type.'); await load(); }
    setBusy(false);
  };

  if (!canEdit) {
    return (
      <div data-testid="methodology-no-right">
        <InlineError message="You need the Edit configuration right to change the methodology library." testId="methodology-denied" />
      </div>
    );
  }

  if (state === 'loading') {
    return <p className="text-apple-12 text-secondary" data-testid="methodology-loading">Loading methodology library…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="methodology-error" />;
  }

  const availableKinds = STEP_KINDS.filter((k) => k !== 'inquiry');

  return (
    <section className="space-y-4" data-testid="methodology-panel">
      <header className="space-y-1">
        <h3 className="text-apple-15 font-semibold text-primary">Methodology library</h3>
        <p className="text-apple-12 text-secondary">
          A procedure is the ordered test steps an engagement of an audit type follows. Editing and
          saving writes a new version; publishing makes it the current one an engagement snapshots.
          A snapshot never changes underneath an engagement already in progress.
        </p>
        {current && (
          <p className="text-apple-12 text-secondary" data-testid="methodology-version">
            Current: {current.modelId} — version {current.version}
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-2" data-testid="methodology-list">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t)}
            data-testid={`methodology-template-${t.modelId}`}
            className={`px-3 py-2 rounded-xl border text-apple-12 font-medium ${t.id === selected ? 'border-accent text-primary bg-accent-subtle' : 'border-hairline text-secondary hover:text-primary'}`}
          >
            {t.title || t.modelId} · v{t.version} · {t.steps.length} steps
          </button>
        ))}
        {templates.length === 0 && (
          <p className="text-apple-12 text-secondary" data-testid="methodology-empty">
            No procedures yet. A new organisation is seeded with a default internal-audit procedure.
          </p>
        )}
      </div>

      {loadError && <InlineError message={loadError} testId="methodology-save-error" />}
      {result && <p className="text-apple-12 text-secondary" data-testid="methodology-result">{result}</p>}

      {current && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-apple-11 text-secondary">
              <span className="block">Title</span>
              <input data-testid="methodology-title" className={input} value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </label>
            <label className="space-y-1 text-apple-11 text-secondary">
              <span className="block">Description</span>
              <input data-testid="methodology-description" className={input} value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
            </label>
          </div>

          <ul className="space-y-1" data-testid="methodology-steps">
            {draft.steps.map((s, i) => (
              <li key={s.stepKey} className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline px-3 py-2"
                  data-testid={`methodology-step-${s.stepKey}`}>
                <input data-testid={`methodology-step-label-${s.stepKey}`} className={`${input} flex-1 min-w-48`}
                  placeholder="Step label" value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} />
                <select data-testid={`methodology-step-kind-${s.stepKey}`}
                  className="h-9 px-2 rounded-xl bg-surface-elevated border border-hairline text-apple-12 text-primary"
                  value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as StepKind })}>
                  {STEP_KINDS.map((k) => (<option key={k} value={k}>{STEP_KIND_LABELS[k]}</option>))}
                </select>
                <label className="inline-flex items-center gap-1 text-apple-11 text-secondary">
                  <input type="checkbox" data-testid={`methodology-step-evidence-${s.stepKey}`}
                    checked={s.requiresEvidence} onChange={(e) => setStep(i, { requiresEvidence: e.target.checked })} />
                  evidence
                </label>
                <span className="flex items-center gap-1">
                  <button type="button" disabled={i === 0} onClick={() => moveStep(i, -1)}
                    data-testid={`methodology-step-up-${s.stepKey}`}
                    className="px-2 py-1 rounded-lg border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40">↑</button>
                  <button type="button" disabled={i === draft.steps.length - 1} onClick={() => moveStep(i, 1)}
                    data-testid={`methodology-step-down-${s.stepKey}`}
                    className="px-2 py-1 rounded-lg border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40">↓</button>
                  <button type="button" onClick={() => removeStep(i)}
                    data-testid={`methodology-step-remove-${s.stepKey}`}
                    className="px-2 py-1 text-cinnabar hover:opacity-80"><X className="w-3.5 h-3.5" /></button>
                </span>
              </li>
            ))}
            {draft.steps.length === 0 && (
              <li className="text-apple-12 text-secondary" data-testid="methodology-steps-empty">
                No steps yet. Add at least one; a procedure needs a non-empty step list.
              </li>
            )}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addStep} data-testid="methodology-add-step"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle">
              <Plus className="w-3.5 h-3.5" /> Add step
            </button>
            <button type="button" disabled={busy || draft.steps.length === 0} onClick={() => void save()}
              data-testid="methodology-save"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> Save new version
            </button>
            <button type="button" disabled={busy} onClick={() => void publish()}
              data-testid="methodology-publish"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle disabled:opacity-50">
              Publish this version
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
