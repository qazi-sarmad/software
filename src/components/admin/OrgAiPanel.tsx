import React, { useCallback, useEffect, useState } from 'react';
import {
  addVoiceSample, addVoiceTerm, getVoiceProfile, listUseCases, listVoiceSamples, listVoiceTerms,
  saveUseCase, saveVoiceProfile, setEndpoint,
  type AiUseCase, type VoiceSample, type VoiceTerm,
} from '../../data/ai';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Check, MessageSquare, Sliders, Zap } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const USE_CASES: { key: string; label: string; max: number }[] = [
  { key: 'observation_draft', label: 'Observation draft', max: 600 },
  { key: 'cap_wording', label: 'CAP wording', max: 400 },
  { key: 'board_slides', label: 'Board slides', max: 1200 },
  { key: 'anomaly_explain', label: 'Explain anomaly', max: 500 },
  { key: 'exec_summary', label: 'Executive summary', max: 800 },
  { key: 'report_wording', label: 'Report wording', max: 600 },
  { key: 'risk_wording', label: 'Risk wording', max: 400 },
];

/**
 * OA-06 and OA-07 AI settings and voice library (F8). The Org Admin sets the endpoint, the access
 * mode, the use-case toggles, the parameters and the voice library. It can never add, remove,
 * change or choose a model: that is the Super Admin's registry, and the server refuses an attempt.
 * The endpoint is refused if it matches the vendor deny-list (L2).
 */
export const OrgAiPanel: React.FC<{ orgId: string }> = ({ orgId }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [useCases, setUseCases] = useState<AiUseCase[]>([]);
  const [terms, setTerms] = useState<VoiceTerm[]>([]);
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [endpoint, setEndpointDraft] = useState({ url: '', mode: 'server' as 'server' | 'browser' });
  const [voice, setVoice] = useState({ tone: 'neutral', person: 'third', length: 'standard', custom: '' });
  const [term, setTerm] = useState({ preferred: '', avoid: '', glossary: '', definition: '' });
  const [sample, setSample] = useState({ kind: 'observation', title: '', text: '' });

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [uc, t, s, profile] = await Promise.all([
        listUseCases(orgId), listVoiceTerms(orgId), listVoiceSamples(orgId), getVoiceProfile(orgId),
      ]);
      setUseCases(uc);
      setTerms(t);
      setSamples(s);
      if (profile) setVoice({
        tone: profile.tone, person: profile.person, length: profile.length,
        custom: profile.customInstructions ?? '',
      });
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the AI settings.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveEndpoint = async () => {
    setBusy(true);
    setResult(null);
    const r = await setEndpoint(orgId, endpoint.url.trim() || null, endpoint.mode);
    setBusy(false);
    setResult(r);
  };

  const toggleUseCase = async (uc: AiUseCase, enabled: boolean) => {
    setBusy(true);
    setResult(null);
    const r = await saveUseCase(orgId, uc.useCase, enabled, uc.systemPrompt ?? '', uc.temperature, uc.topP, uc.maxTokens ?? null);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  const saveVoice = async () => {
    setBusy(true);
    setResult(null);
    const r = await saveVoiceProfile(orgId, voice.tone, voice.person, voice.length, voice.custom);
    setBusy(false);
    setResult(r);
  };

  const saveTerm = async () => {
    setBusy(true);
    setResult(null);
    const r = await addVoiceTerm(orgId, term.preferred, term.avoid, term.glossary, term.definition);
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setTerm({ preferred: '', avoid: '', glossary: '', definition: '' });
      await load();
    }
  };

  const saveSample = async () => {
    setBusy(true);
    setResult(null);
    const r = await addVoiceSample(orgId, sample.kind, sample.title, sample.text, 'paste');
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setSample({ kind: 'observation', title: '', text: '' });
      await load();
    }
  };

  if (state === 'loading') {
    return <p className="text-sm opacity-70" data-testid="oa-ai-loading">Loading the AI settings…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="oa-ai-error" />;
  }

  return (
    <div className="space-y-6" data-testid="org-ai-panel">
      {result && !result.ok && <InlineError message={result.reason} testId="oa-ai-result" />}

      <section data-testid="oa-ai-endpoint" className="space-y-2">
        <h3 className="font-medium flex items-center gap-2"><Zap className="w-4 h-4" /> Model endpoint</h3>
        <p className="text-sm opacity-70">
          Only models on your own infrastructure. In server mode the address must be public https; in
          browser mode your browser calls the endpoint directly and a localhost address is allowed.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Endpoint
            <input className="block border rounded px-2 py-1" data-testid="oa-ai-endpoint-url"
              value={endpoint.url} onChange={(e) => setEndpointDraft({ ...endpoint, url: e.target.value })} />
          </label>
          <label className="text-sm">Access mode
            <select className="block border rounded px-2 py-1" data-testid="oa-ai-endpoint-mode"
              value={endpoint.mode} onChange={(e) => setEndpointDraft({ ...endpoint, mode: e.target.value as 'server' | 'browser' })}>
              <option value="server">server</option>
              <option value="browser">browser</option>
            </select>
          </label>
          <button type="button" className="border rounded px-3 py-1" data-testid="oa-ai-endpoint-save"
            disabled={busy} onClick={() => void saveEndpoint()}>Save endpoint</button>
        </div>
      </section>

      <section data-testid="oa-ai-usecases" className="space-y-2">
        <h3 className="font-medium flex items-center gap-2"><Sliders className="w-4 h-4" /> Use cases</h3>
        <ul className="space-y-1">
          {USE_CASES.map((def) => {
            const uc = useCases.find((u) => u.useCase === def.key);
            return (
              <li key={def.key} className="flex items-center gap-3 text-sm" data-testid={`oa-ai-usecase-${def.key}`}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" data-testid={`oa-ai-usecase-toggle-${def.key}`}
                    checked={Boolean(uc?.enabled)} disabled={busy}
                    onChange={(e) => void toggleUseCase(uc ?? {
                      useCase: def.key, enabled: false, temperature: 0.2, topP: 0.9, maxTokens: def.max,
                    }, e.target.checked)} />
                  {def.label}
                </label>
                <span className="opacity-60">max {def.max} tokens</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section data-testid="oa-voice" className="space-y-3">
        <h3 className="font-medium flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Voice library</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Tone
            <select className="block border rounded px-2 py-1" data-testid="oa-voice-tone"
              value={voice.tone} onChange={(e) => setVoice({ ...voice, tone: e.target.value })}>
              <option value="formal">formal</option>
              <option value="neutral">neutral</option>
              <option value="concise">concise</option>
            </select>
          </label>
          <button type="button" className="border rounded px-3 py-1" data-testid="oa-voice-save"
            disabled={busy} onClick={() => void saveVoice()}>Save voice</button>
        </div>

        <ul className="space-y-1">
          {terms.map((t) => (
            <li key={t.id} className="text-sm" data-testid={`oa-voice-term-${t.id}`}>
              {t.preferredPhrase && <span>Prefer “{t.preferredPhrase}”. </span>}
              {t.avoidPhrase && <span>Avoid “{t.avoidPhrase}”. </span>}
              {t.glossaryTerm && <span>{t.glossaryTerm}: {t.definition}</span>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <input className="border rounded px-2 py-1" placeholder="Preferred phrase" data-testid="oa-voice-term-preferred"
            value={term.preferred} onChange={(e) => setTerm({ ...term, preferred: e.target.value })} />
          <input className="border rounded px-2 py-1" placeholder="Phrase to avoid" data-testid="oa-voice-term-avoid"
            value={term.avoid} onChange={(e) => setTerm({ ...term, avoid: e.target.value })} />
          <button type="button" className="border rounded px-3 py-1" data-testid="oa-voice-term-add"
            disabled={busy} onClick={() => void saveTerm()}>Add term</button>
        </div>

        <ul className="space-y-1">
          {samples.map((s) => (
            <li key={s.id} className="text-sm opacity-80" data-testid={`oa-voice-sample-${s.id}`}>
              {s.kind}: {s.title || s.text.slice(0, 40)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <select className="border rounded px-2 py-1" data-testid="oa-voice-sample-kind"
            value={sample.kind} onChange={(e) => setSample({ ...sample, kind: e.target.value })}>
            {['observation', 'finding', 'cap', 'report', 'board'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <textarea className="border rounded px-2 py-1" rows={2} placeholder="Sample text" data-testid="oa-voice-sample-text"
            value={sample.text} onChange={(e) => setSample({ ...sample, text: e.target.value })} />
          <button type="button" className="border rounded px-3 py-1" data-testid="oa-voice-sample-add"
            disabled={busy || !sample.text.trim()} onClick={() => void saveSample()}>Add sample</button>
        </div>
        <p className="text-xs opacity-60 flex items-center gap-1"><Check className="w-3 h-3" />
          Only your own data is used. Suggestions are drafts and stay out of the record until accepted.</p>
      </section>
    </div>
  );
};
