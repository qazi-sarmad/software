import React, { useCallback, useEffect, useState } from 'react';
import { listTutorials, tutorialHealth, type TutorialRow } from '../../data/tutorials';
import { InlineError } from '../common/InlineError';
import { Check, AlertTriangle, XCircle } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * SA-13 tutorial library health (F18). Shows every Appendix A key and whether its recording exists
 * and is current. A stale ui_hash means the screen changed since the recording was made; a missing
 * media path means the GIF has not been generated yet. Read-only; non-blocking.
 */
export const SuperAdminTutorials: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<TutorialRow[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setRows(await listTutorials());
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the tutorial library.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="superadmin-tutorials-loading">Loading tutorials…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-tutorials-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  const health = tutorialHealth(rows, {});
  const badge = (key: string) => {
    if (health.missing.includes(key)) return { label: 'missing', cls: 'text-cinnabar', Icon: XCircle };
    if (health.stale.includes(key)) return { label: 'stale', cls: 'text-secondary', Icon: AlertTriangle };
    return { label: 'ok', cls: 'text-accent', Icon: Check };
  };

  if (rows.length === 0) {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="superadmin-tutorials-empty">The tutorial registry is empty.</div>;
  }

  return (
    <div className="rounded-2xl border border-hairline bg-surface overflow-hidden" data-testid="superadmin-tutorials">
      <table className="w-full text-apple-12">
        <thead className="bg-surface-sunken text-secondary">
          <tr>
            <th className="text-left px-4 py-2 font-semibold">Key</th>
            <th className="text-left px-4 py-2 font-semibold">Audience</th>
            <th className="text-left px-4 py-2 font-semibold">Title</th>
            <th className="text-left px-4 py-2 font-semibold">Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = badge(r.key);
            return (
              <tr key={r.key} className="border-t border-hairline" data-testid={`tutorial-${r.key}`}>
                <td className="px-4 py-2 text-primary font-mono">{r.key}</td>
                <td className="px-4 py-2 text-secondary">{r.audience}</td>
                <td className="px-4 py-2 text-secondary">{r.title}</td>
                <td className={`px-4 py-2 inline-flex items-center gap-1 ${b.cls}`}>
                  <b.Icon className="w-3 h-3" /> {b.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
