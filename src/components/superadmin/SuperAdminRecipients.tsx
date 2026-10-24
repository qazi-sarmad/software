import React, { useCallback, useEffect, useState } from 'react';
import {
  addRecipient, listRecipients, looksLikeEmail, removeRecipient, type RecipientRow,
} from '../../data/platformSettings';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Plus, XCircle, Send } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * SA-05 platform notification recipients (F7). The list of Super Admin addresses that receive
 * platform alerts. Non-blocking; a bad address is refused inline before any call.
 */
export const SuperAdminRecipients: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setRows(await listRecipients());
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load recipients.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!looksLikeEmail(draft)) {
      setResult({ ok: false, reason: 'Enter an email address such as ops@example.com.' });
      return;
    }
    setBusy(true);
    setResult(null);
    const r = await addRecipient(draft.trim());
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setDraft('');
      await load();
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setResult(null);
    const r = await removeRecipient(id);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="superadmin-recipients-loading">Loading recipients…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-recipients-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="superadmin-recipients">
      <InlineError message={result && !result.ok ? result.reason : null} testId="superadmin-recipients-result" />

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <h3 className="text-apple-14 font-semibold text-primary">Platform notification recipients</h3>
        <p className="text-apple-12 text-secondary">
          These addresses receive platform alerts (an AI model change, a hosting migration event, a
          feature change) and are copied on tenant configuration changes.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ops@qscorp.example"
            aria-label="New recipient address"
            data-testid="superadmin-recipients-input"
            className="flex-1 px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void add()}
            data-testid="superadmin-recipients-add"
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="superadmin-recipients-empty">
          No platform recipients are set. Platform alerts are logged only.
        </div>
      ) : (
        <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-2" data-testid={`recipient-${r.address}`}>
              <span className="inline-flex items-center gap-2 text-apple-13 text-primary">
                <Send className="w-3.5 h-3.5 text-secondary" />
                {r.address}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(r.id)}
                aria-label={`Remove ${r.address}`}
                data-testid={`recipient-remove-${r.address}`}
                className="text-apple-12 text-cinnabar hover:underline disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
