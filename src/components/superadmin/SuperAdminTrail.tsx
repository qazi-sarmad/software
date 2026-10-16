import React, { useCallback, useEffect, useState } from 'react';
import { listTrail, type TrailRow } from '../../data/platform';
import { InlineError } from '../common/InlineError';
import { History } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Platform trail panel (C4, spec §24). Read-only metadata trail of platform actions. No tenant
 * business content is shown. Non-blocking.
 */
export const SuperAdminTrail: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<TrailRow[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setRows(await listTrail(200));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the platform trail.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="text-secondary text-apple-13 py-12 text-center" data-testid="superadmin-trail-loading">
        Loading platform trail…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-trail-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">
          Retry
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-secondary text-apple-13 py-12 text-center" data-testid="superadmin-trail-empty">
        The platform trail is empty.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-hairline bg-surface overflow-hidden" data-testid="superadmin-trail">
      <table className="w-full text-apple-12">
        <thead className="bg-surface-sunken text-secondary">
          <tr>
            <th className="text-left px-4 py-2 font-semibold">When</th>
            <th className="text-left px-4 py-2 font-semibold">Action</th>
            <th className="text-left px-4 py-2 font-semibold">Tenant</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-hairline">
              <td className="px-4 py-2 text-tertiary whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  <History className="w-3 h-3" />
                  {new Date(r.ts).toLocaleString()}
                </span>
              </td>
              <td className="px-4 py-2 text-primary font-medium">{r.action}</td>
              <td className="px-4 py-2 text-secondary">{r.tenantId ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
