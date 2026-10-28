import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { InlineError } from '../common/InlineError';
import {
  SiraCyclePanel, type AcceptanceView, type CarryForwardPackView, type EmergentRiskView,
  type SiraCycleView,
} from './SiraCyclePanel';
import {
  carryForwardPack, createSiraCycle, decideEmergentRisk, decideSiraAcceptance, endorseSiraCycle,
  listCycles, listEmergentRisks, parseCarryForwardPack, proposeEmergentRisks, publishSiraCycle,
  remindSiraAcceptance, seedNextCycle, siraAcceptanceState, siraPublishBlock,
} from '../../data/sira';
import { isUuid } from '../../lib/ids';

/**
 * The connected SIRA cycles inspector (S18, S19). Loads the cycles, the emergent-risk queue and the
 * two-key acceptance state for one universe through src/data, and wires every write path: create,
 * publish, endorse, accept/reject, propose from findings, and remind. The presentational
 * `SiraCyclePanel` stays pure so it can be tested without a database.
 */
export const SiraCyclesInspector: React.FC<{ universeId?: string }> = ({ universeId }) => {
  const { currentUser } = useApp();
  const [cycles, setCycles] = useState<SiraCycleView[]>([]);
  const [emergent, setEmergent] = useState<EmergentRiskView[]>([]);
  const [acceptances, setAcceptances] = useState<Record<string, AcceptanceView>>({});
  const [packs, setPacks] = useState<Record<string, CarryForwardPackView>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orgId = isUuid(currentUser.orgId) ? currentUser.orgId! : null;
  const uid = universeId && isUuid(universeId) ? universeId : null;

  const load = useCallback(async () => {
    if (!uid) {
      setCycles([]);
      setEmergent([]);
      setAcceptances({});
      return;
    }
    setError(null);
    try {
      const [cs, es] = await Promise.all([listCycles(uid), listEmergentRisks(uid)]);
      setCycles(cs);
      setEmergent(es);
      const acc: Record<string, AcceptanceView> = {};
      for (const c of cs) {
        if (c.status !== 'published') continue;
        const [state, block] = await Promise.all([siraAcceptanceState(c.id), siraPublishBlock(c.id)]);
        if (state) {
          acc[c.id] = {
            acceptanceStatus: state.acceptanceStatus,
            endorsedAt: state.endorsedAt,
            acceptedAt: state.acceptedAt,
            reminderCount: state.reminderCount,
            pendingProposals: state.pendingProposals,
            canPublishNext: state.canPublishNext,
            blockReason: block,
          };
        }
      }
      setAcceptances(acc);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the SIRA cycles.');
    }
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!uid) {
    return (
      <div className="p-6 text-apple-13 text-tertiary" data-testid="sira-cycles-unscoped">
        Select a universe to see its SIRA cycles.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="sira-cycles-inspector">
      <InlineError message={error} testId="sira-cycles-error" onDismiss={() => setError(null)} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-testid="sira-remind"
          disabled={busy}
          onClick={() => orgId && run(() => remindSiraAcceptance(orgId, new Date().toISOString()))}
          className="px-3 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover disabled:opacity-50"
        >
          Remind auditors
        </button>
      </div>
      <SiraCyclePanel
        cycles={cycles}
        emergent={emergent}
        acceptances={acceptances}
        packs={packs}
        onCreateCycle={(year) => run(() => createSiraCycle(uid, year))}
        onPublishCycle={(id) => run(() => publishSiraCycle(id))}
        onEndorseCycle={(id, note) => run(() => endorseSiraCycle(id, note))}
        onDecideAcceptance={(id, status, reason) => run(() => decideSiraAcceptance(id, status, reason))}
        onDecideEmergentRisk={(id, status, reason) => run(() => decideEmergentRisk(id, status, reason))}
        onProposeEmergent={(id) => run(() => proposeEmergentRisks(id))}
        onBuildPack={(id) => run(async () => {
          const pack = parseCarryForwardPack(await carryForwardPack(id));
          if (pack) setPacks((p) => ({ ...p, [id]: pack }));
        })}
        onSeedNext={(id) => run(() => seedNextCycle(id))}
      />
    </div>
  );
};
