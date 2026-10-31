import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { isUuid } from '../../lib/ids';
import {
  setSiraAggregation, setSiraBand, siraModelSnapshot, upsertSiraFactor,
} from '../../data/sira';
import { SiraModelEditor, type SiraModelView } from './SiraModelEditor';

/**
 * The connected SIRA model inspector (S18). Loads the organisation's model snapshot through
 * `src/data` and wires the three model-write RPCs — aggregation, factor and band — so the editor's
 * controls are real writes, not a panel that saves a value nothing reads. Every successful write
 * re-reads the snapshot, so the version bump the database records is visible immediately. The
 * presentational editor stays pure and is tested without a database.
 */
export const SiraModelInspector: React.FC = () => {
  const { currentUser } = useApp();
  const orgId = isUuid(currentUser.orgId) ? currentUser.orgId! : null;
  const [model, setModel] = useState<SiraModelView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setModel(null);
      return;
    }
    try {
      setModel(await siraModelSnapshot(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the SIRA model.');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) setError(result.reason ?? 'The change could not be saved.');
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SiraModelEditor
      model={model}
      busy={busy}
      error={error}
      onDismissError={() => setError(null)}
      onSetAggregation={(method) => run(() => setSiraAggregation(method))}
      onUpsertFactor={(key, label, weight, ordinal) => run(() => upsertSiraFactor(key, label, weight, ordinal))}
      onSetBand={(name, min, max, ordinal) => run(() => setSiraBand(name, min, max, ordinal))}
    />
  );
};
