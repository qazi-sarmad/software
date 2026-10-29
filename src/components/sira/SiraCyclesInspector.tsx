import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { InlineError } from '../common/InlineError';
import {
  SiraCyclePanel, type AcceptanceView, type CarryForwardLinkView, type CarryForwardPackView,
  type EmergentRiskView, type SiraCycleView,
} from './SiraCyclePanel';
import { SiraScoringPanel } from './SiraScoringPanel';
import type { SiraModelView } from './SiraModelEditor';
import {
  carryForwardPack, createSiraCycle, decideEmergentRisk, decideSiraAcceptance, endorseSiraCycle,
  listCarryForward, listCycles, listEmergentRisks, listRisks, listScores, parseCarryForwardPack,
  proposeEmergentRisks, publishSiraCycle, recordSiraScore, remindSiraAcceptance, seedNextCycle,
  siraAcceptanceState, siraModelSnapshot, siraPublishBlock, submitEmergentRisk,
  type SiraRisk, type SiraScore,
} from '../../data/sira';
import { listEntities, type EntityRow } from '../../data/universe';
import { isUuid } from '../../lib/ids';

/**
 * The connected SIRA cycles inspector (S18, S19). Loads the cycles, the emergent-risk queue, the
 * two-key acceptance state and the scoring inputs (model, entities, risks, scores) for one universe
 * through src/data, and wires every write path: create, publish, endorse, accept/reject, propose from
 * findings, record a score, submit an emergent risk and remind. The presentational panels stay pure
 * so they can be tested without a database.
 */
export const SiraCyclesInspector: React.FC<{ universeId?: string }> = ({ universeId }) => {
  const { currentUser } = useApp();
  const [cycles, setCycles] = useState<SiraCycleView[]>([]);
  const [emergent, setEmergent] = useState<EmergentRiskView[]>([]);
  const [acceptances, setAcceptances] = useState<Record<string, AcceptanceView>>({});
  const [packs, setPacks] = useState<Record<string, CarryForwardPackView>>({});
  const [carryForwards, setCarryForwards] = useState<CarryForwardLinkView[]>([]);
  const [model, setModel] = useState<SiraModelView | null>(null);
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [risks, setRisks] = useState<SiraRisk[]>([]);
  const [scores, setScores] = useState<SiraScore[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orgId = isUuid(currentUser.orgId) ? currentUser.orgId! : null;
  const uid = universeId && isUuid(universeId) ? universeId : null;

  const load = useCallback(async () => {
    if (!uid) {
      setCycles([]);
      setEmergent([]);
      setAcceptances({});
      setCarryForwards([]);
      setEntities([]);
      setRisks([]);
      setScores([]);
      return;
    }
    setError(null);
    try {
      const [cs, es, ents, rks, mdl, cfs] = await Promise.all([
        listCycles(uid),
        listEmergentRisks(uid),
        listEntities(uid),
        listRisks(),
        orgId ? siraModelSnapshot(orgId) : Promise.resolve(null),
        listCarryForward(uid),
      ]);
      setCycles(cs);
      setEmergent(es);
      setEntities(ents);
      setRisks(rks);
      setModel(mdl);
      // S18: the persisted carry-forward chain — the provenance that a cycle was seeded from the
      // prior year, read back so it survives a reload rather than living only in this session.
      setCarryForwards(cfs.map((cf) => ({
        id: cf.id, fromYear: cf.fromYear, toYear: cf.toYear, createdAt: cf.createdAt,
      })));
      // The scores of the newest DRAFT cycle: the one the scoring panel can change.
      const draft = cs.find((c) => c.status === 'draft');
      setScores(draft ? await listScores(draft.id) : []);
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
  }, [uid, orgId]);

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

  const draftCycle = cycles.find((c) => c.status === 'draft') ?? null;

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
        carryForwards={carryForwards}
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
      <SiraScoringPanel
        cycle={draftCycle}
        universeId={uid}
        model={model}
        entities={entities.map((e) => ({ id: e.id, name: e.name }))}
        risks={risks.map((r) => ({ id: r.id, name: r.name }))}
        scores={scores.map((s) => ({ entityId: s.entityId, riskId: s.riskId, score: s.score, band: s.band }))}
        onRecordScore={(cycleId, entityId, riskId, factorValues) =>
          run(() => recordSiraScore(cycleId, entityId, riskId, factorValues))}
        onSubmitEmergentRisk={(universeId, title, description) =>
          run(() => submitEmergentRisk(universeId, title, undefined, undefined, undefined, description ?? undefined))}
      />
    </div>
  );
};
