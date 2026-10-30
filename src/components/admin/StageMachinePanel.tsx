import React, { useCallback, useEffect, useState } from 'react';
import {
  defaultStages, getStageMachine, resetStageMachine, saveStageMachine, STAGE_ANCHORS,
  type StageAnchor, type StageRow,
} from '../../data/lifecycle';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Plus, X } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const resultText = (r: DataResult | null): string => (r === null ? '' : r.ok ? 'Saved.' : r.reason);

/**
 * OA-22 stage machine (S6, F30 / R5).
 *
 * The engagement stage machine, configurable per organisation. The three built-in stages —
 * Planning, Testing, Conclusion — are always present and always in that order, because the ethics
 * gate, the testing lock and the conclusion-readiness rule are anchored to them. A tenant renames
 * their labels and inserts stages between them (for example a Fieldwork stage after Planning). Each
 * stage names the anchor it inherits, so a custom stage runs the right built-in gate.
 *
 * The list of stages currently in use is shown, so a tenant can see why a stage matters before
 * removing it. Saving writes a whole machine in one call; the database refuses a machine that drops
 * an anchor or duplicates a key, and the refusal is shown inline, never silently accepted.
 */
export const StageMachinePanel: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [stages, setStages] = useState<StageRow[]>([]);
  const [custom, setCustom] = useState(false);
  const [inUse, setInUse] = useState<{ stage: string; count: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DataResult | null>(null);
  const [newStage, setNewStage] = useState<{ key: string; label: string; anchor: StageAnchor }>(
    { key: '', label: '', anchor: 'planning' });

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const m = await getStageMachine();
      setStages(m.stages);
      setCustom(m.custom);
      setInUse(m.inUse);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read the stage machine.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<DataResult>) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      setResult(r);
      if (r.ok) await load();
    } catch (err) {
      setResult({ ok: false, reason: err instanceof Error ? err.message : 'The change was refused.' });
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[i], next[j]] = [next[j], next[i]];
    setStages(next.map((s, idx) => ({ ...s, position: idx + 1 })));
  };

  const addStage = () => {
    if (newStage.key.trim() === '' || newStage.label.trim() === '') return;
    const next = [...stages, { key: newStage.key.trim(), label: newStage.label.trim(),
      anchor: newStage.anchor, position: stages.length + 1 }];
    setStages(next);
    setNewStage({ key: '', label: '', anchor: 'planning' });
  };

  const removeStage = (key: string) => {
    setStages(stages.filter((s) => s.key !== key).map((s, idx) => ({ ...s, position: idx + 1 })));
  };

  if (state === 'loading') {
    return <div className="text-secondary text-apple-13 py-8 text-center" data-testid="oa-governance-stage-loading">Loading the stage machine…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="oa-governance-stage-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="oa-governance-stage-machine">
      <InlineError message={result && !result.ok ? result.reason : null} testId="oa-governance-stage-result" />
      <div className="flex items-center justify-between">
        <p className="text-apple-12 text-secondary">
          {custom ? 'This organisation uses a custom stage machine.' : 'This organisation uses the default three-stage machine.'}
        </p>
        <span className="text-apple-11 text-tertiary" data-testid="oa-governance-stage-custom">{custom ? 'Custom' : 'Default'}</span>
      </div>

      <ol className="space-y-2" data-testid="oa-governance-stage-list">
        {stages.map((s, i) => {
          const used = inUse.find((u) => u.stage === s.key);
          return (
            <li key={s.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-elevated p-3" data-testid={`oa-governance-stage-${s.key}`}>
              <span className="text-apple-11 text-tertiary w-6">{i + 1}</span>
              <input value={s.label} onChange={(e) => setStages(stages.map((x) => x.key === s.key ? { ...x, label: e.target.value } : x))}
                className="w-40 p-1.5 rounded-lg bg-surface border border-hairline text-apple-12 text-primary outline-none"
                data-testid={`oa-governance-stage-label-${s.key}`} />
              <span className="text-apple-11 text-tertiary">{s.key}</span>
              <span className="text-apple-11 text-secondary">anchor: {s.anchor}</span>
              {used && used.count > 0 && (
                <span className="text-apple-11 text-secondary" data-testid={`oa-governance-stage-inuse-${s.key}`}>{used.count} in use</span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="px-2 text-apple-12 text-secondary disabled:opacity-30" aria-label={`Move ${s.key} up`}>↑</button>
                <button type="button" disabled={i === stages.length - 1} onClick={() => move(i, 1)} className="px-2 text-apple-12 text-secondary disabled:opacity-30" aria-label={`Move ${s.key} down`}>↓</button>
                <button type="button" onClick={() => removeStage(s.key)} className="px-2 text-apple-12 text-secondary" aria-label={`Remove ${s.key}`} data-testid={`oa-governance-stage-remove-${s.key}`}><X className="w-4 h-4" /></button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-end gap-2" data-testid="oa-governance-stage-add-row">
        <label className="space-y-1">
          <span className="text-apple-11 text-secondary">Key</span>
          <input value={newStage.key} onChange={(e) => setNewStage({ ...newStage, key: e.target.value })} placeholder="fieldwork"
            className="w-32 p-1.5 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary outline-none"
            data-testid="oa-governance-stage-new-key" />
        </label>
        <label className="space-y-1">
          <span className="text-apple-11 text-secondary">Label</span>
          <input value={newStage.label} onChange={(e) => setNewStage({ ...newStage, label: e.target.value })} placeholder="Fieldwork"
            className="w-40 p-1.5 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary outline-none"
            data-testid="oa-governance-stage-new-label" />
        </label>
        <label className="space-y-1">
          <span className="text-apple-11 text-secondary">Anchor</span>
          <select value={newStage.anchor} onChange={(e) => setNewStage({ ...newStage, anchor: e.target.value as StageAnchor })}
            className="p-1.5 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary outline-none"
            data-testid="oa-governance-stage-new-anchor">
            {STAGE_ANCHORS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || newStage.key.trim() === '' || newStage.label.trim() === ''} onClick={addStage}
          className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary disabled:opacity-40 inline-flex items-center gap-1"
          data-testid="oa-governance-stage-add"><Plus className="w-4 h-4" /> Add stage</button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void run(() => saveStageMachine(stages))}
          className="px-3 py-2 rounded-lg bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
          data-testid="oa-governance-stage-save">Save stage machine</button>
        <button type="button" disabled={busy} onClick={() => { setStages(defaultStages()); void run(() => resetStageMachine()); }}
          className="px-3 py-2 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary disabled:opacity-40"
          data-testid="oa-governance-stage-reset">Reset to default</button>
        {result && result.ok && <span className="text-apple-12 text-secondary" data-testid="oa-governance-stage-saved">{resultText(result)}</span>}
      </div>
    </div>
  );
};
