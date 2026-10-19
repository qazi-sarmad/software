import React, { useCallback, useEffect, useState } from 'react';
import {
  addAiModel, addDenyPattern, listAiModels, listDenyPatterns, removeAiModel, removeDenyPattern,
  updateAiModel, type AiModel, type DenyPattern,
} from '../../data/ai';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Check, Database, Lock, Shield } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * SA-06 AI model registry and endpoint deny-list (F8). Only the Super Admin adds, removes or
 * changes a model, and edits the deny-list of vendor-hosted hosts. A saved endpoint that matches a
 * denied host is refused by the server with the fixed L2 message.
 */
export const SuperAdminAi: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [models, setModels] = useState<AiModel[]>([]);
  const [patterns, setPatterns] = useState<DenyPattern[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState({ name: '', modelRef: '', notes: '' });
  const [pattern, setPattern] = useState({ pattern: '', label: '' });

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [m, p] = await Promise.all([listAiModels(), listDenyPatterns()]);
      setModels(m);
      setPatterns(p);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the AI registry.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveModel = async () => {
    setBusy(true);
    setResult(null);
    const r = await addAiModel(model.name.trim(), model.modelRef.trim(), model.notes.trim() || undefined);
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setModel({ name: '', modelRef: '', notes: '' });
      await load();
    }
  };

  const toggleStatus = async (m: AiModel) => {
    setBusy(true);
    const next = m.status === 'active' ? 'disabled' : 'active';
    const r = await updateAiModel(m.id, m.name, m.modelRef, next);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  const dropModel = async (id: string) => {
    setBusy(true);
    const r = await removeAiModel(id);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  const savePattern = async () => {
    setBusy(true);
    setResult(null);
    const r = await addDenyPattern(pattern.pattern.trim(), pattern.label.trim() || undefined);
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setPattern({ pattern: '', label: '' });
      await load();
    }
  };

  const dropPattern = async (id: string) => {
    setBusy(true);
    const r = await removeDenyPattern(id);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  if (state === 'loading') {
    return <p className="text-sm opacity-70" data-testid="sa-ai-loading">Loading the AI registry…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="sa-ai-error" />;
  }

  return (
    <section data-testid="superadmin-ai" className="space-y-6">
      <header className="flex items-center gap-2">
        <Database className="w-5 h-5" />
        <h2 className="text-lg font-semibold">AI models and the deny-list</h2>
      </header>
      <p className="text-sm opacity-70">
        Provio only allows models that run on your own infrastructure. The registry lists the models
        the platform can offer a tenant; the deny-list refuses vendor-hosted AI services.
      </p>
      {result && !result.ok && <InlineError message={result.reason} testId="sa-ai-result" />}

      <div data-testid="sa-ai-models" className="space-y-3">
        <h3 className="font-medium flex items-center gap-2"><Lock className="w-4 h-4" /> Model registry</h3>
        <ul className="space-y-1">
          {models.length === 0 && <li className="text-sm opacity-60" data-testid="sa-ai-models-empty">No models yet.</li>}
          {models.map((m) => (
            <li key={m.id} data-testid={`sa-ai-model-${m.id}`} className="flex items-center gap-3 text-sm">
              <span className="font-medium">{m.name}</span>
              <code className="opacity-70">{m.modelRef}</code>
              <span className="opacity-70">{m.status}</span>
              <button type="button" className="underline" data-testid={`sa-ai-model-toggle-${m.id}`}
                disabled={busy} onClick={() => void toggleStatus(m)}>
                {m.status === 'active' ? 'Disable' : 'Enable'}
              </button>
              <button type="button" className="underline" data-testid={`sa-ai-model-remove-${m.id}`}
                disabled={busy} onClick={() => void dropModel(m.id)}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Name
            <input className="block border rounded px-2 py-1" data-testid="sa-ai-model-name"
              value={model.name} onChange={(e) => setModel({ ...model, name: e.target.value })} />
          </label>
          <label className="text-sm">Model
            <input className="block border rounded px-2 py-1" data-testid="sa-ai-model-ref"
              value={model.modelRef} onChange={(e) => setModel({ ...model, modelRef: e.target.value })} />
          </label>
          <button type="button" className="border rounded px-3 py-1" data-testid="sa-ai-model-add"
            disabled={busy || !model.name.trim() || !model.modelRef.trim()} onClick={() => void saveModel()}>
            Add model
          </button>
        </div>
      </div>

      <div data-testid="sa-ai-denylist" className="space-y-3">
        <h3 className="font-medium flex items-center gap-2"><Shield className="w-4 h-4" /> Endpoint deny-list</h3>
        <ul className="space-y-1">
          {patterns.map((p) => (
            <li key={p.id} data-testid={`sa-ai-pattern-${p.id}`} className="flex items-center gap-3 text-sm">
              <code>{p.pattern}</code>
              <span className="opacity-70">{p.label}</span>
              <button type="button" className="underline" data-testid={`sa-ai-pattern-remove-${p.id}`}
                disabled={busy} onClick={() => void dropPattern(p.id)}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Pattern
            <input className="block border rounded px-2 py-1" data-testid="sa-ai-pattern-input"
              value={pattern.pattern} onChange={(e) => setPattern({ ...pattern, pattern: e.target.value })} />
          </label>
          <button type="button" className="border rounded px-3 py-1" data-testid="sa-ai-pattern-add"
            disabled={busy || !pattern.pattern.trim()} onClick={() => void savePattern()}>
            Add pattern
          </button>
        </div>
        <p className="text-xs opacity-60 flex items-center gap-1"><Check className="w-3 h-3" />
          A saved endpoint that matches a pattern is refused with the L2 message.</p>
      </div>
    </section>
  );
};
