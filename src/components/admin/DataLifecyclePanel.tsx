import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  executeErasure, listErasureRequests, requestErasure, setErasureLegalHold, type ErasureRequest,
} from '../../data/erasure';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Database, Check, Lock } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Data lifecycle / right to erasure (WP15, OA data-lifecycle tab).
 *
 * The register of erasure requests. A request with manage_users raises it; edit_config executes it.
 * A legal hold blocks execution. Execution pseudonymises the subject's subject identifiers in
 * place and never rewrites the sealed, hash-chained record: the audit trail stays verifiable. Not a
 * blocking modal.
 */
export const DataLifecyclePanel: React.FC = () => {
  const { currentUser } = useApp();
  const canRequest = hasRight(currentUser, 'manage_users');
  const canExecute = hasRight(currentUser, 'edit_config');
  const orgId = currentUser.orgId ?? '';

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<ErasureRequest[]>([]);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setRows(orgId ? await listErasureRequests(orgId) : []);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the erasure register.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<DataResult>) => {
    setResult(null);
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  if (state === 'loading') {
    return <div className="text-apple-13 text-secondary" data-testid="erasure-loading">Loading erasure register…</div>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="erasure-error" />;
  }

  return (
    <div className="space-y-5" data-testid="erasure-panel">
      <div className="flex items-center gap-2">
        <Database className="w-5 h-5 text-accent" />
        <h2 className="text-apple-17 font-semibold text-primary">Data erasure</h2>
      </div>
      <p className="text-apple-13 text-secondary">
        Raise and action requests to erase a data subject. Execution replaces the subject's identifiers
        identifiers and leaves the sealed, hash-chained record intact, so a sealed report stays
        independently verifiable. A legal hold blocks execution.
      </p>

      {canRequest && (
        <div className="space-y-3 rounded-2xl bg-surface border border-hairline p-4" data-testid="erasure-form">
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">Subject email</span>
            <input
              data-testid="erasure-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">Reason (required)</span>
            <input
              data-testid="erasure-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
            />
          </label>
          <button
            type="button"
            data-testid="erasure-request"
            disabled={busy || email.trim() === '' || reason.trim() === ''}
            onClick={() => run(() => requestErasure(orgId, email.trim(), reason.trim()))}
            className="px-4 py-2 rounded-xl bg-accent text-white text-apple-13 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Raise request
          </button>
        </div>
      )}

      <InlineError message={result && !result.ok ? result.reason : null} testId="erasure-action-error" />
      {result?.ok && (
        <div className="flex items-center gap-2 text-apple-12 text-primary" data-testid="erasure-action-ok">
          <Check className="w-4 h-4 text-accent" /> Done.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-apple-13 text-secondary" data-testid="erasure-empty">No erasure requests.</div>
      ) : (
        <ul className="space-y-2" data-testid="erasure-list">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface border border-hairline p-3" data-testid={`erasure-row-${r.id}`}>
              <div className="min-w-0">
                <div className="text-apple-13 text-primary truncate">{r.subjectEmail}</div>
                <div className="text-apple-11 text-secondary">
                  {r.status}{r.legalHold ? ' · legal hold' : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canExecute && (
                  <>
                    <button
                      type="button"
                      data-testid={`erasure-hold-${r.id}`}
                      disabled={busy || r.status === 'executed'}
                      onClick={() => run(() => setErasureLegalHold(r.id, !r.legalHold, r.legalHold ? 'hold lifted' : 'legal hold'))}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary transition-colors disabled:opacity-50"
                    >
                      <Lock className="w-3.5 h-3.5" /> {r.legalHold ? 'Lift hold' : 'Hold'}
                    </button>
                    <button
                      type="button"
                      data-testid={`erasure-execute-${r.id}`}
                      disabled={busy || r.status === 'executed' || r.legalHold}
                      onClick={() => run(() => executeErasure(r.id, 'right to erasure'))}
                      className="px-3 py-1.5 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      Execute
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
