import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import {
  CAPABILITY_KINDS,
  DEFAULT_CAPABILITY_CONFIG,
  capabilityStorageReady,
  getCapabilityConfig,
  hashCapabilityInputs,
  listCapabilityRuns,
  recordCapabilityRun,
  saveCapabilityConfig,
  type CapabilityConfig,
  type CapabilityKind,
  type CapabilityRunRow,
} from '../../data/capabilities';
import {
  CAPABILITY_CATALOG,
  evaluateCapability,
  type CapabilityConfigValues,
  type CapabilityEvaluation,
  type CapabilityInputs,
} from '../../lib/capabilities';
import { getOrgLocalToday } from '../../lib/orgDate';
import { hasRight } from '../../lib/rights';
import { ExplainPopout } from '../explain/ExplainPopout';
import { StandardsAffordance } from '../explain/StandardsAffordance';
import { InlineError } from '../common/InlineError';
import { AlertTriangle, Check, RefreshCw, Shield, Sliders } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'unconfigured';

/**
 * DB-02 Deterministic capability library (D1-D4; docs/SYSTELIGON.md §11.1a).
 *
 * The screen surface for the twenty deterministic capabilities. Each is a pure function in
 * `src/lib/capabilities/`; this panel hands one call site (`evaluateCapability`) the rows the caller
 * may see (already filtered by `useScopedData`), the organisation's thresholds and the current day,
 * and renders the uniform result. A capability with no inputs says what it is waiting for; it never
 * shows an empty result as a clean bill of health.
 *
 * The screen carries no model call and no client import (Law L1/L2, rule M8). A run may be recorded
 * as evidence: the input HASH and the derived findings, never the tenant rows themselves.
 */
export const CapabilityLibraryPanel: React.FC<{ screenId?: string }> = ({ screenId = 'DB-02' }) => {
  const {
    currentUser, scopedEntities, scopedControls, scopedEngagements, scopedIssues,
    scopedWorkpapers,
  } = useScopedData();

  const [state, setState] = useState<LoadState>('loading');
  const [config, setConfig] = useState<CapabilityConfig>(DEFAULT_CAPABILITY_CONFIG);
  const [draft, setDraft] = useState<CapabilityConfig>(DEFAULT_CAPABILITY_CONFIG);
  const [runs, setRuns] = useState<CapabilityRunRow[]>([]);
  const [kind, setKind] = useState<CapabilityKind>('risk_control');
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canConfig = hasRight(currentUser, 'edit_config');
  const today = getOrgLocalToday();

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      if (!(await capabilityStorageReady())) {
        setState('unconfigured');
        return;
      }
      setConfig(await getCapabilityConfig());
      setRuns(await listCapabilityRuns());
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the capability library.');
      setState('unconfigured');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  // The one bundle of already-scoped inputs the evaluator is handed. Nothing here re-queries.
  const inputs: CapabilityInputs = useMemo(
    () => ({
      asOf: today,
      entities: scopedEntities,
      controls: scopedControls,
      engagements: scopedEngagements,
      issues: scopedIssues,
      workpapers: scopedWorkpapers,
    }),
    [today, scopedEntities, scopedControls, scopedEngagements, scopedIssues, scopedWorkpapers]
  );

  const configValues: CapabilityConfigValues = useMemo(
    () => ({
      riskTolerance: config.riskTolerance,
      stratificationSample: config.stratificationSample,
      reviewerAgeingDays: config.reviewerAgeingDays,
    }),
    [config]
  );

  const rowsForKind = useMemo(
    () => CAPABILITY_CATALOG.filter((c) => c.kind === kind),
    [kind]
  );

  const evaluations = useMemo(
    () => rowsForKind.map((c) => evaluateCapability(c.id, inputs, configValues)),
    [rowsForKind, inputs, configValues]
  );

  const runnable = evaluations.filter((e) => e.status === 'ready');

  const saveConfig = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await saveCapabilityConfig(draft, `Thresholds changed from ${screenId} on ${today}`);
      if (!res.ok) setError(res.reason);
      else {
        setConfig(draft);
        setMessage('The thresholds were saved and versioned.');
      }
    } finally {
      setSaving(false);
    }
  };

  const recordRuns = async () => {
    setRecording(true);
    setError(null);
    setMessage(null);
    try {
      let recorded = 0;
      for (const e of runnable) {
        const hash = await hashCapabilityInputs({ id: e.id, kind: e.kind, asOf: inputs.asOf, rows: e.rows.map((r) => r.refs ?? []) });
        const res = await recordCapabilityRun(e.kind, hash, { id: e.id, headline: e.headline, rows: e.rows.length }, e.rows.length);
        if (!res.ok) {
          setError(res.reason);
          break;
        }
        recorded++;
      }
      if (recorded > 0) {
        setMessage(`${recorded} run(s) recorded as evidence.`);
        setRuns(await listCapabilityRuns());
      }
    } finally {
      setRecording(false);
    }
  };

  if (state === 'unconfigured') {
    return (
      <div className="space-y-4" data-testid={`${screenId}-panel`}>
        <h3 className="text-apple-14 font-semibold text-primary">Deterministic capability library</h3>
        <p className="text-apple-12 text-secondary" data-testid={`${screenId}-unconfigured`}>
          The capability library is not configured. Connect this build to a tenant database to read
          the thresholds and record capability runs.
        </p>
        <InlineError message={error} testId={`${screenId}-error`} />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`${screenId}-panel`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-apple-14 font-semibold text-primary">Deterministic capability library</h3>
          <p className="text-apple-12 text-secondary">
            Twenty capabilities over the data in scope. Every finding names the rule that produced it
            and the records behind it; the same inputs re-run identically.
          </p>
          <StandardsAffordance kind="screen" target={screenId} screenId={screenId} element="standards" className="mt-2" />
        </div>
        <button
          type="button"
          disabled={recording || runnable.length === 0}
          onClick={() => void recordRuns()}
          data-testid={`${screenId}-record`}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${recording ? 'animate-spin' : ''}`} />
          Record {runnable.length} run(s)
        </button>
      </div>

      {/* Family tabs. */}
      <div className="flex items-center gap-1 rounded-xl border border-hairline bg-surface p-1 w-fit" role="tablist" aria-label="Capability families">
        {CAPABILITY_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            data-testid={`${screenId}-kind-${k.kind}`}
            onClick={() => setKind(k.kind)}
            className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold ${kind === k.kind ? 'bg-surface-hover text-primary' : 'text-secondary'}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <p className="text-apple-12 text-secondary" data-testid={`${screenId}-kind-summary`}>
        {CAPABILITY_KINDS.find((k) => k.kind === kind)?.summary}
      </p>

      {message && (
        <p role="status" data-testid={`${screenId}-message`} className="px-3 py-2 rounded-xl text-apple-12 border border-hairline bg-surface-elevated text-secondary">
          {message}
        </p>
      )}
      <InlineError message={error} testId={`${screenId}-error`} onDismiss={() => setError(null)} />

      {/* The capabilities. */}
      <ul className="space-y-2" data-testid={`${screenId}-list`}>
        {evaluations.map((e) => (
          <CapabilityCard
            key={e.id}
            screenId={screenId}
            evaluation={e}
            open={openId === e.id}
            onToggle={() => setOpenId(openId === e.id ? null : e.id)}
          />
        ))}
      </ul>

      {/* Thresholds. A change requires edit_config and is versioned. */}
      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h4 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Sliders className="w-4 h-4 stroke-[1.5]" /> Thresholds
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-apple-12 text-secondary space-y-1">
            Risk tolerance
            <select
              value={draft.riskTolerance}
              disabled={!canConfig}
              data-testid={`${screenId}-tolerance`}
              onChange={(e) => setDraft({ ...draft, riskTolerance: e.target.value as CapabilityConfig['riskTolerance'] })}
              className="w-full bg-surface-elevated border border-hairline rounded-lg px-2 py-1.5 text-apple-12 text-primary"
            >
              {(['low', 'medium', 'high', 'critical'] as const).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            Stratification sample
            <input
              type="number"
              min={1}
              value={draft.stratificationSample}
              disabled={!canConfig}
              data-testid={`${screenId}-sample`}
              onChange={(e) => setDraft({ ...draft, stratificationSample: Number(e.target.value) })}
              className="w-full bg-surface-elevated border border-hairline rounded-lg px-2 py-1.5 text-apple-12 text-primary"
            />
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            Reviewer ageing (days)
            <input
              type="number"
              min={1}
              value={draft.reviewerAgeingDays}
              disabled={!canConfig}
              data-testid={`${screenId}-ageing`}
              onChange={(e) => setDraft({ ...draft, reviewerAgeingDays: Number(e.target.value) })}
              className="w-full bg-surface-elevated border border-hairline rounded-lg px-2 py-1.5 text-apple-12 text-primary"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={!canConfig || saving}
          onClick={() => void saveConfig()}
          data-testid={`${screenId}-save`}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" /> Save thresholds
        </button>
        {!canConfig && (
          <p className="text-apple-11 text-tertiary" data-testid={`${screenId}-save-denied`}>
            You need the edit-config right to change the thresholds.
          </p>
        )}
      </div>

      {/* Recorded runs. */}
      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <h4 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Shield className="w-4 h-4 stroke-[1.5]" /> Recorded runs
        </h4>
        {runs.length === 0 ? (
          <p className="text-apple-12 text-secondary" data-testid={`${screenId}-runs-empty`}>
            No capability run has been recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-hairline" data-testid={`${screenId}-runs`}>
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2" data-testid={`${screenId}-run-${r.id}`}>
                <span className="text-apple-12 text-primary">{r.kind}</span>
                <span className="text-apple-11 text-tertiary">
                  {r.findingCount} finding(s) · {r.createdAt.slice(0, 10)} · {r.inputsHash.slice(0, 12)}…
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The explain affordance for the whole library. */}
      <ExplainPopout explainId={`screen.${screenId}`} screenId={screenId} element="explain">
        <span className="text-apple-12 text-accent hover:underline cursor-help">
          What is this screen?
        </span>
      </ExplainPopout>
    </div>
  );
};

interface CapabilityCardProps {
  screenId: string;
  evaluation: CapabilityEvaluation;
  open: boolean;
  onToggle: () => void;
}

const CapabilityCard: React.FC<CapabilityCardProps> = ({ screenId, evaluation, open, onToggle }) => {
  const statusIcon =
    evaluation.status === 'ready' ? <AlertTriangle className="w-4 h-4 text-cinnabar" /> :
    evaluation.status === 'empty' ? <Check className="w-4 h-4 text-verdigris" /> :
    <Sliders className="w-4 h-4 text-tertiary" />;
  return (
    <li className="rounded-2xl border border-hairline bg-surface" data-testid={`${screenId}-cap-${evaluation.id}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={`${screenId}-cap-${evaluation.id}-toggle`}
        className="w-full flex items-start gap-3 px-4 py-3 text-left"
      >
        <span className="mt-0.5">{statusIcon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-apple-13 font-medium text-primary">{evaluation.label}</span>
          <span className="block text-apple-12 text-secondary" data-testid={`${screenId}-cap-${evaluation.id}-headline`}>
            {evaluation.headline}
          </span>
        </span>
        <span
          className={`text-apple-11 font-semibold ${evaluation.status === 'ready' ? 'text-cinnabar' : evaluation.status === 'empty' ? 'text-verdigris' : 'text-tertiary'}`}
          data-testid={`${screenId}-cap-${evaluation.id}-status`}
        >
          {evaluation.status === 'ready' ? `${evaluation.rows.length} finding(s)` : evaluation.status === 'empty' ? 'clean' : 'awaiting input'}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-hairline pt-2">
          <p className="text-apple-11 text-tertiary" data-testid={`${screenId}-cap-${evaluation.id}-rule`}>
            Rule: {evaluation.rule}
          </p>
          {evaluation.needs && (
            <p className="text-apple-12 text-secondary" data-testid={`${screenId}-cap-${evaluation.id}-needs`}>
              Awaiting: {evaluation.needs}.
            </p>
          )}
          {evaluation.rows.length > 0 && (
            <ul className="space-y-1" data-testid={`${screenId}-cap-${evaluation.id}-rows`}>
              {evaluation.rows.map((r, i) => (
                <li key={`${r.label}-${i}`} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-apple-12 text-primary">{r.label}</span>
                    <span className="block text-apple-11 text-tertiary">{r.detail}</span>
                  </span>
                  {r.refs && r.refs.length > 0 && (
                    <span className="text-apple-11 text-tertiary shrink-0 tabular-nums" data-testid={`${screenId}-cap-${evaluation.id}-refs-${i}`}>
                      {r.refs.length} record(s)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
};
