import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  confirmPriorYearItem,
  importPriorYearItem,
  listPriorYearImports,
  revertPriorYearItem,
  unconfirmedPriorYearImports,
  type PriorYearImportRow,
  type PriorYearItemType,
} from '../../data/imports';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { History, CheckCircle2, RotateCcw, AlertTriangle } from '../common/Icons';

const ITEM_TYPES: { type: PriorYearItemType; label: string }[] = [
  { type: 'risk_control_mapping', label: 'Risk/control mapping' },
  { type: 'scope', label: 'Scope' },
  { type: 'procedures', label: 'Procedures' },
  { type: 'resource_estimates', label: 'Resource estimates' },
];

const STATUS_CHIP: Record<string, string> = {
  imported_confirm: 'bg-cinnabar-subtle border-cinnabar text-cinnabar',
  confirmed: 'bg-verdigris-subtle border-verdigris text-verdigris',
  reverted: 'bg-surface-sunken border-hairline text-secondary',
};

export interface PriorYearImportPanelProps {
  engagementId: string;
  /** Source engagements to copy from (prior year). */
  sourceEngagements: { id: string; label: string }[];
}

/**
 * Prior-year material (7G, spec §9.1). Inside an engagement's Planning tab: pick a prior engagement
 * and an item type, import it, then confirm or revert each item. An item with status
 * 'Imported - confirm' does not count toward sign-off until it is confirmed — sign_planning enforces
 * this in the database (migration 0044). Populations, samples, results, conclusions and evidence are
 * never importable (the RPC refuses them).
 */
export const PriorYearImportPanel: React.FC<PriorYearImportPanelProps> = ({ engagementId, sourceEngagements }) => {
  const { currentUser } = useApp();
  const [items, setItems] = useState<PriorYearImportRow[]>([]);
  const [unconfirmed, setUnconfirmed] = useState(0);
  const [sourceId, setSourceId] = useState(sourceEngagements[0]?.id ?? '');
  const [itemType, setItemType] = useState<PriorYearItemType>('risk_control_mapping');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canImport = hasRight(currentUser, 'manage_engagements');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, count] = await Promise.all([
        listPriorYearImports(engagementId),
        unconfirmedPriorYearImports(engagementId),
      ]);
      setItems(rows);
      setUnconfirmed(count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load prior-year imports.');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 p-4 rounded-xl bg-surface-sunken border border-hairline" data-testid="prior-year-panel">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-accent" />
        <h3 className="text-apple-13 font-bold text-primary">Prior-year material</h3>
      </div>

      <InlineError message={error} testId="prior-year-error" onDismiss={() => setError(null)} />

      {unconfirmed > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-apple-12 text-cinnabar bg-cinnabar-subtle border border-cinnabar" data-testid="prior-year-unconfirmed">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {unconfirmed} imported item{unconfirmed === 1 ? '' : 's'} awaiting confirmation. Sign-off is blocked until each is confirmed.
        </div>
      )}

      {canImport && sourceEngagements.length > 0 && (
        <div className="flex flex-wrap items-end gap-3" data-testid="prior-year-controls">
          <label className="space-y-1">
            <span className="block text-apple-11 font-semibold text-secondary uppercase">Source engagement</span>
            <Select
              ariaLabel="Source engagement"
              value={sourceId}
              options={sourceEngagements.map((s) => ({ value: s.id, label: s.label }))}
              onChange={setSourceId}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-apple-11 font-semibold text-secondary uppercase">Item type</span>
            <Select
              ariaLabel="Prior-year item type"
              value={itemType}
              options={ITEM_TYPES.map((t) => ({ value: t.type, label: t.label }))}
              onChange={(v) => setItemType(v as PriorYearItemType)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !sourceId}
            onClick={() => void run(() => importPriorYearItem(sourceId, itemType, engagementId))}
            data-testid="prior-year-import"
            className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-accent-subtle text-primary border border-accent hover:bg-surface-hover disabled:opacity-50"
          >
            Import
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-secondary text-apple-13 py-2" data-testid="prior-year-loading">Loading prior-year items…</p>
      ) : items.length === 0 ? (
        <p className="text-secondary text-apple-13 py-2" data-testid="prior-year-empty">
          {sourceEngagements.length === 0
            ? 'No prior-year material has been imported. Import a prior audit file first, then it can be copied here.'
            : 'No prior-year material has been imported. Pick a source engagement and an item type above to copy material in.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 text-apple-12 border-t border-hairline py-2" data-testid={`prior-year-item-${it.id}`}>
              <span className="flex items-center gap-2">
                <span className="text-primary capitalize">{it.itemType.replace(/_/g, ' ')}</span>
                <span className={`px-2 py-0.5 rounded text-apple-11 font-semibold border ${STATUS_CHIP[it.status]}`} data-testid={`prior-year-status-${it.id}`}>
                  {it.status === 'imported_confirm' ? 'Imported – confirm' : it.status}
                </span>
              </span>
              {canImport && (
                <span className="flex items-center gap-2">
                  {it.status === 'imported_confirm' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => confirmPriorYearItem(it.id))}
                      data-testid={`prior-year-confirm-${it.id}`}
                      className="text-verdigris hover:underline flex items-center gap-1 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
                    </button>
                  )}
                  {it.status !== 'reverted' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => revertPriorYearItem(it.id))}
                      data-testid={`prior-year-revert-${it.id}`}
                      className="text-secondary hover:text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Revert
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
