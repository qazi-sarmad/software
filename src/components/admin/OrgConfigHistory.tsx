import React, { useCallback, useEffect, useState } from 'react';
import { listConfigHistory, type ConfigHistoryRow } from '../../data/configHistory';
import { InlineError } from '../common/InlineError';
import { History, Shield } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-17 configuration history. One story for every configuration change in the organisation:
 * roles and rights, entitlements, AI models and settings, newest first, hash-chained. A change a
 * QSCorp consultant made during a Dual Session is labelled "platform consultant". Read-only and
 * non-blocking.
 */
export const OrgConfigHistory: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<ConfigHistoryRow[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setRows(await listConfigHistory(200));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the configuration history.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="org-history-loading">Loading configuration history…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="org-history-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4" data-testid="org-history">
      <div className="flex items-center gap-2 border-b border-hairline pb-3">
        <History className="w-5 h-5 text-accent" />
        <h2 className="text-apple-16 font-bold text-primary">Configuration history</h2>
      </div>
      <p className="text-apple-12 text-secondary">
        Every configuration change, in one story. Each row is hash-chained to the one before it, so
        the history cannot be altered. A change made by a QSCorp consultant is labelled.
      </p>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="org-history-empty">
          No configuration has changed yet.
        </div>
      ) : (
        <table className="w-full text-apple-12" data-testid="org-history-table">
          <thead className="bg-surface-sunken text-secondary">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">When</th>
              <th className="text-left px-3 py-2 font-semibold">Area</th>
              <th className="text-left px-3 py-2 font-semibold">What changed</th>
              <th className="text-left px-3 py-2 font-semibold">Who</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.area}-${r.entity}-${r.createdAt}-${i}`} className="border-t border-hairline" data-testid={`org-history-row-${i}`}>
                <td className="px-3 py-2 text-tertiary whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 text-secondary">{r.areaLabel}</td>
                <td className="px-3 py-2 text-primary">{r.summary}</td>
                <td className="px-3 py-2 text-secondary">
                  {r.actorIsPlatform ? (
                    <span className="inline-flex items-center gap-1 text-accent" data-testid={`org-history-platform-${i}`}>
                      <Shield className="w-3 h-3" /> Platform consultant
                    </span>
                  ) : (
                    'Your organisation'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
