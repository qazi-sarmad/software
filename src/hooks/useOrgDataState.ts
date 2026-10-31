import { useEffect, useState } from 'react';
import { useScopedData } from './useScopedData';
import { getOrgDataState } from '../data/guidedFirstRun';
import { isNewOrg, type OrgCounts } from '../lib/guidedFirstRun';

/**
 * The organisation's data state (U6). The authoritative answer comes from `get_org_data_state`
 * (migration 0117), which returns COUNTS and a boolean and is readable by any signed-in member —
 * including a member who holds no audit right and so sees zero scoped rows even in a populated org.
 * That is why the first-run decision must NOT be made from the scoped rows alone: doing so would
 * show "create your first universe" to a scoped member of an established tenant.
 *
 * With no configured client the RPC is inert and the hook falls back to the scoped rows the shell
 * already holds, so a bare checkout still renders a sensible guided state.
 */
export interface OrgDataStateHook {
  counts: OrgCounts;
  isNew: boolean;
  /** True until the first authoritative answer arrives (the RPC or the inert fallback). */
  loading: boolean;
}

export function useOrgDataState(): OrgDataStateHook {
  const { scopedUniverses, scopedEntities, scopedEngagements } = useScopedData();
  const [counts, setCounts] = useState<OrgCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    getOrgDataState()
      .then((state) => {
        if (!live) return;
        if (state) {
          setCounts({ universes: state.universes, entities: state.entities, engagements: state.engagements });
        }
        setLoading(false);
      })
      .catch(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // Re-read when the scoped universe count changes: creating a universe must clear the first-run
    // state without a full reload.
  }, [scopedUniverses.length]);

  // The inert fallback (no configured client) answers from the rows in scope.
  const fallback: OrgCounts = {
    universes: scopedUniverses.length,
    entities: scopedEntities.length,
    engagements: scopedEngagements.length,
  };
  const effective = counts ?? fallback;
  return { counts: effective, isNew: isNewOrg(effective), loading };
}
