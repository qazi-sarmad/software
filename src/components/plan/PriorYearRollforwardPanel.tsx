import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  buildRollForward,
  exportCheck,
  listRollForwards,
  logExport,
  priorYearAccessOk,
  type ExportCheck,
  type RollForwardRow,
} from '../../data/priorYearRollforward';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Check, XCircle } from '../common/Icons';

export interface PriorYearRollforwardPanelProps {
  engagements: { id: string; label: string }[];
}

/**
 * Prior-year roll-forward and export check (owner instruction 2026-10-30): roll a prior engagement's
 * workpapers forward and check that each one has a recorded export before the current file relies on
 * it. Only a caller with prior-year access to the source engagement may build the roll-forward or run
 * the check — the database refuses the request by name otherwise (migration 0201).
 */
export const PriorYearRollforwardPanel: React.FC<PriorYearRollforwardPanelProps> = ({ engagements }) => {
  const { currentUser } = useApp();
  const canBuild = hasRight(currentUser, 'manage_engagements');

  const [rows, setRows] = useState<RollForwardRow[]>([]);
  const [targetId, setTargetId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [check, setCheck] = useState<ExportCheck | null>(null);
  const [sourceAccess, setSourceAccess] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listRollForwards());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The roll-forwards could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Show, before the write, whether the caller may read the chosen source — the gate, made legible.
  useEffect(() => {
    let cancelled = false;
    if (!sourceId) { setSourceAccess(null); return; }
    priorYearAccessOk(sourceId)
      .then((ok) => { if (!cancelled) setSourceAccess(ok); })
      .catch(() => { if (!cancelled) setSourceAccess(false); });
    return () => { cancelled = true; };
  }, [sourceId]);

  const build = async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await buildRollForward(targetId, sourceId);
      if (!result) { setError('The roll-forward could not be built.'); return; }
      setNotice(`Rolled forward ${result.itemsExpected} item(s). ${result.exportComplete ? 'Every item has an export.' : 'Some items have no export yet.'}`);
      await load();
      setCheck(await exportCheck(targetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The roll-forward was refused.');
    }
  };

  const runCheck = async () => {
    setError(null);
    setNotice(null);
    try {
      setCheck(await exportCheck(targetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export check was refused.');
    }
  };

  const recordExport = async (workpaperId: string) => {
    setError(null);
    setNotice(null);
    try {
      await logExport('workpaper', workpaperId, 'pdf', 'sha256:recorded-in-app');
      setNotice('The export was recorded.');
      setCheck(await exportCheck(targetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export could not be recorded.');
    }
  };

  return (
    <div data-testid="prior-year-rollforward-panel" className="p-5 space-y-5">
      <header>
        <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">Prior year</span>
        <h3 className="text-apple-20 font-bold text-primary mt-1">Roll-forward &amp; export check</h3>
        <p className="text-apple-12 text-secondary mt-1">
          Roll a prior engagement&rsquo;s workpapers forward and check that each has a recorded export.
          Only a person who can read the prior engagement may raise the request.
        </p>
      </header>

      <InlineError message={error} testId="prior-year-rollforward-error" />
      {notice && (
        <div data-testid="prior-year-rollforward-notice" className="rounded-xl border border-verdigris bg-verdigris-subtle px-3 py-2 text-apple-12 text-primary">
          {notice}
        </div>
      )}

      {canBuild && (
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Roll forward into</span>
              <Select ariaLabel="Target engagement" testId="prior-year-rollforward-target" value={targetId} onChange={setTargetId}
                options={[{ value: '', label: 'Select an engagement' }, ...engagements.map((e) => ({ value: e.id, label: e.label }))]} />
            </label>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>From (prior engagement)</span>
              <Select ariaLabel="Source engagement" testId="prior-year-rollforward-source" value={sourceId} onChange={setSourceId}
                options={[{ value: '', label: 'Select an engagement' }, ...engagements.map((e) => ({ value: e.id, label: e.label }))]} />
            </label>
            <button type="button" data-testid="prior-year-rollforward-build" disabled={!targetId || !sourceId || sourceAccess === false}
              onClick={() => void build()}
              className="px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-13 font-medium disabled:opacity-50">
              Roll forward
            </button>
          </div>
          {sourceId && (
            <p data-testid="prior-year-rollforward-access" className={sourceAccess ? 'text-apple-12 text-verdigris' : 'text-apple-12 text-cinnabar'}>
              {sourceAccess === null
                ? 'Checking prior-year access…'
                : sourceAccess
                  ? 'You have prior-year access to this source engagement.'
                  : 'You do not have prior-year access to this source engagement, so the request will be refused.'}
            </p>
          )}
        </section>
      )}

      {!canBuild && (
        <p data-testid="prior-year-rollforward-readonly" className="text-apple-12 text-secondary">
          Rolling material forward needs the <em>Manage engagements</em> right.
        </p>
      )}

      {/* Export check ------------------------------------------------------- */}
      {check && (
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-apple-14 font-semibold text-primary">Export check</h4>
            {check.complete ? (
              <span data-testid="prior-year-rollforward-complete" className="inline-flex items-center gap-1 text-apple-12 text-verdigris">
                <Check className="w-4 h-4 stroke-[1.5]" /> Every item has an export
              </span>
            ) : (
              <span data-testid="prior-year-rollforward-incomplete" className="inline-flex items-center gap-1 text-apple-12 text-cinnabar">
                <XCircle className="w-4 h-4 stroke-[1.5]" /> {check.missing.length} item(s) without an export
              </span>
            )}
          </div>
          <p data-testid="prior-year-rollforward-counts" className="text-apple-12 text-secondary">
            {check.itemsPresent} of {check.itemsExpected} item(s) present.
          </p>
          {check.missing.map((m) => (
            <div key={m.workpaper_id} data-testid={`prior-year-rollforward-missing-${m.workpaper_id}`} className="flex items-center gap-2 text-apple-12">
              <span className="text-primary">{m.workpaper_id.slice(0, 8)} · {m.stage}</span>
              <button type="button" data-testid={`prior-year-rollforward-export-${m.workpaper_id}`} onClick={() => void recordExport(m.workpaper_id)}
                className="px-2 py-1 rounded-lg border border-hairline text-apple-11 text-primary">
                Record an export
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Existing roll-forwards --------------------------------------------- */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <h4 className="text-apple-14 font-semibold text-primary">Roll-forwards</h4>
        {loading ? (
          <p data-testid="prior-year-rollforward-loading" className="text-apple-12 text-secondary">Loading…</p>
        ) : rows.length === 0 ? (
          <p data-testid="prior-year-rollforward-empty" className="text-apple-12 text-secondary">No roll-forward has been built.</p>
        ) : (
          rows.map((r) => (
            <button
              key={r.engagementId}
              type="button"
              data-testid={`prior-year-rollforward-row-${r.engagementId}`}
              onClick={() => { setTargetId(r.engagementId); setSourceId(r.sourceEngagementId); void runCheck(); }}
              className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl border border-hairline"
            >
              <span className="text-apple-13 text-primary flex-1">{r.engagementTitle}</span>
              <span className="text-apple-12 text-secondary">{r.itemsPresent}/{r.itemsExpected}</span>
              <span className={`text-apple-11 ${r.exportComplete ? 'text-verdigris' : 'text-cinnabar'}`}>
                {r.exportComplete ? 'complete' : 'incomplete'}
              </span>
              <span className="text-apple-11 text-secondary">v{r.version}</span>
            </button>
          ))
        )}
      </section>
    </div>
  );
};
