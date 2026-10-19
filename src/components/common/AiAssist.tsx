import React, { useState } from 'react';
import { decideSuggestion, runAiAssist, testAiEndpoint, type GatewayResult } from '../../data/ai';
import { InlineError } from '../common/InlineError';
import { Check, RefreshCw, Sparkles, Zap } from '../common/Icons';

/**
 * WK-07 AiAssist (M-4a, F8). One component adds "Suggest wording" beside any editor. It calls the
 * ai-gateway Edge Function, shows the draft with an "AI-generated draft" label, and keeps the text
 * OUT of the record until a user accepts it: accepting hands the text back to the caller, which
 * writes it through the normal write RPC so every deterministic check still runs.
 *
 * Laws that shape this component:
 *   - L1: the draft is advisory. Nothing here decides a result, a score, a gate or a finding status.
 *   - L2: the endpoint is the tenant's own; the gateway refuses a vendor host.
 *   - F8: an unverified figure blocks Accept until the user edits the text or confirms each figure.
 */
export interface AiAssistProps {
  orgId: string;
  useCase: string;
  recordType: string;
  recordId: string;
  /** The numbers the model may use; anything else it states is flagged. */
  allowedNumbers: string[];
  /** Build the prompt from the current record context. */
  buildPrompt: () => string;
  /** Called when the user accepts; the caller writes the text through the normal RPC. */
  onAccept: (text: string, suggestionId: string | null) => void | Promise<void>;
  testIdPrefix?: string;
}

export const AiAssist: React.FC<AiAssistProps> = ({
  orgId, useCase, recordType, recordId, allowedNumbers, buildPrompt, onAccept, testIdPrefix = 'ai-assist',
}) => {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<GatewayResult | null>(null);
  const [error, setError] = useState('');
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  const suggest = async () => {
    setBusy(true);
    setError('');
    setProbe(null);
    setConfirmed(new Set());
    const result = await runAiAssist(orgId, useCase, buildPrompt(), recordType, recordId, allowedNumbers);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? 'The model did not answer.');
      setDraft(null);
      return;
    }
    setDraft(result);
  };

  const testEndpoint = async () => {
    setBusy(true);
    setProbe(null);
    const result = await testAiEndpoint(orgId, useCase);
    setBusy(false);
    if (!result.ok) {
      setProbe({ ok: false, text: result.reason ?? 'The endpoint could not be reached.' });
      return;
    }
    const installed = result.modelInstalled
      ? 'The assigned model is installed.'
      : 'The assigned model is not installed; run ollama pull on that machine.';
    setProbe({ ok: true, text: `${installed} ${result.roundTripMs ?? 0} ms round trip.` });
  };

  const flagged = draft?.unverifiedFigures ?? [];
  const allConfirmed = flagged.every((f) => confirmed.has(f.token));

  const accept = async () => {
    if (!draft?.text) return;
    setBusy(true);
    await onAccept(draft.text, draft.suggestionId ?? null);
    if (draft.suggestionId) await decideSuggestion(draft.suggestionId, 'accepted', draft.text);
    setBusy(false);
    setDraft(null);
  };

  const reject = async () => {
    if (draft?.suggestionId) await decideSuggestion(draft.suggestionId, 'rejected');
    setDraft(null);
  };

  return (
    <div className="space-y-2 text-sm" data-testid={testIdPrefix}>
      <div className="flex items-center gap-2">
        <button type="button" className="border rounded px-3 py-1 flex items-center gap-1"
          data-testid={`${testIdPrefix}-suggest`} disabled={busy} onClick={() => void suggest()}>
          <Sparkles className="w-3.5 h-3.5" /> Suggest wording
        </button>
        <button type="button" className="border rounded px-3 py-1 flex items-center gap-1"
          data-testid={`${testIdPrefix}-test`} disabled={busy} onClick={() => void testEndpoint()}>
          <Zap className="w-3.5 h-3.5" /> Test endpoint
        </button>
      </div>

      {error && <InlineError message={error} testId={`${testIdPrefix}-error`} />}
      {probe && (
        <p className="opacity-80" data-testid={`${testIdPrefix}-probe`}>{probe.text}</p>
      )}

      {draft?.text && (
        <div className="border rounded p-2 space-y-2" data-testid={`${testIdPrefix}-draft`}>
          <p className="text-xs uppercase tracking-wide opacity-60" data-testid={`${testIdPrefix}-label`}>
            AI-generated draft
          </p>
          <p data-testid={`${testIdPrefix}-text`}>{draft.text}</p>

          {flagged.length > 0 && (
            <div className="border rounded p-2 space-y-1" data-testid={`${testIdPrefix}-figures`}>
              <p className="opacity-80">These figures are not in the record. Edit the text or confirm each one.</p>
              <ul className="space-y-1">
                {flagged.map((f) => (
                  <li key={f.token} className="flex items-center gap-2" data-testid={`${testIdPrefix}-figure-${f.token}`}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={confirmed.has(f.token)}
                        data-testid={`${testIdPrefix}-figure-confirm-${f.token}`}
                        onChange={(e) => {
                          const next = new Set(confirmed);
                          if (e.target.checked) next.add(f.token); else next.delete(f.token);
                          setConfirmed(next);
                        }} />
                      {f.token}
                    </label>
                    <span className="opacity-60 truncate">…{f.context}…</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" className="border rounded px-3 py-1 flex items-center gap-1"
              data-testid={`${testIdPrefix}-accept`} disabled={busy || (flagged.length > 0 && !allConfirmed)}
              onClick={() => void accept()}>
              <Check className="w-3.5 h-3.5" /> Accept
            </button>
            <button type="button" className="border rounded px-3 py-1" data-testid={`${testIdPrefix}-reject`}
              disabled={busy} onClick={() => void reject()}>Reject</button>
            <button type="button" className="border rounded px-3 py-1 flex items-center gap-1"
              data-testid={`${testIdPrefix}-retry`} disabled={busy} onClick={() => void suggest()}>
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
