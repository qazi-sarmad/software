import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { CheckCircle2, Clock, Plus, XCircle, ShieldCheck, AlertTriangle } from '../common/Icons';

export interface SiraCycleView {
  id: string;
  year: number;
  status: 'draft' | 'published';
  publishedAt: string | null;
}

export interface EmergentRiskView {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  decisionReason: string | null;
  sourceKind?: string | null;
  proposalReason?: string | null;
}

export interface AcceptanceView {
  acceptanceStatus: 'none' | 'awaiting_acceptance' | 'accepted' | 'rejected';
  endorsedAt: string | null;
  acceptedAt: string | null;
  reminderCount: number;
  pendingProposals: number;
  canPublishNext: boolean;
  blockReason: string | null;
}

export interface CarryForwardEntityView {
  entityId: string;
  name: string;
  priorScore: number;
  priorBand: string | null;
  scoreCount: number;
}

export interface CarryForwardPackView {
  fromYear: number;
  toYear: number;
  entities: CarryForwardEntityView[];
  acceptedRiskTitles: string[];
}

/** S18: one persisted carry-forward link (a cycle seeded from the prior year). */
export interface CarryForwardLinkView {
  id: string;
  fromYear: number;
  toYear: number;
  createdAt: string | null;
}

export interface SiraCyclePanelProps {
  cycles: SiraCycleView[];
  emergent: EmergentRiskView[];
  /** S19: the two-key acceptance state, keyed by cycle id. Absent in the presentational tests. */
  acceptances?: Record<string, AcceptanceView>;
  /** S18: the carry-forward pack, keyed by cycle id, once built. */
  packs?: Record<string, CarryForwardPackView>;
  /** S18: the persisted carry-forward chain for the universe, newest first (survives reload). */
  carryForwards?: CarryForwardLinkView[];
  onCreateCycle?: (year: number) => void;
  onPublishCycle?: (cycleId: string) => void;
  onEndorseCycle?: (cycleId: string, note: string) => void;
  onDecideAcceptance?: (cycleId: string, status: 'accepted' | 'rejected', reason: string) => void;
  onDecideEmergentRisk?: (id: string, status: 'accepted' | 'rejected', reason: string) => void;
  onProposeEmergent?: (cycleId: string) => void;
  onBuildPack?: (cycleId: string) => void;
  onSeedNext?: (cycleId: string) => void;
}

const ACCEPTANCE_LABEL: Record<AcceptanceView['acceptanceStatus'], string> = {
  none: 'Not endorsed',
  awaiting_acceptance: 'Awaiting auditor acceptance',
  accepted: 'Accepted by an auditor',
  rejected: 'Rejected by an auditor',
};

/**
 * SIRA cycles and the emergent-risk queue (spec §8.3, S18, S19). Publishing freezes a cycle and
 * seeds the next year from a carry-forward pack. The finaliser ENDORSES a published cycle; a
 * DIFFERENT person holding review_and_approve must ACCEPT it — the finaliser's decision is an
 * endorsement, not a closure. Renders inside the sliding inspector.
 */
export const SiraCyclePanel: React.FC<SiraCyclePanelProps> = ({
  cycles, emergent, acceptances, packs, carryForwards, onCreateCycle, onPublishCycle, onEndorseCycle,
  onDecideAcceptance, onDecideEmergentRisk, onProposeEmergent, onBuildPack, onSeedNext,
}) => {
  const { currentUser } = useApp();
  const canManage = hasRight(currentUser, 'manage_engagements');
  const canEndorse = hasRight(currentUser, 'approve_plan');
  const canDecide = hasRight(currentUser, 'review_and_approve');
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const submitDecision = (cycleId: string, status: 'accepted' | 'rejected') => {
    if (!onDecideAcceptance || reason.trim().length < 10) return;
    onDecideAcceptance(cycleId, status, reason.trim());
    setReasonFor(null);
    setReason('');
  };

  const submitEmergent = (id: string, status: 'accepted' | 'rejected') => {
    if (!onDecideEmergentRisk || reason.trim().length < 10) return;
    onDecideEmergentRisk(id, status, reason.trim());
    setReasonFor(null);
    setReason('');
  };

  return (
    <div data-testid="sira-cycle-panel" className="space-y-5 p-1">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-15 font-semibold text-primary">Annual cycles</h3>
          {canManage && (
            <button
              type="button"
              data-testid="sira-create-cycle"
              onClick={() => onCreateCycle?.(new Date().getFullYear())}
              className="px-3 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5 stroke-[1.5]" /> New cycle
            </button>
          )}
        </div>
        {cycles.length === 0 ? (
          <p data-testid="sira-cycles-empty" className="text-apple-13 text-tertiary">No cycles yet.</p>
        ) : (
          <ul data-testid="sira-cycles" className="divide-y divide-hairline rounded-xl border border-hairline overflow-hidden">
            {cycles.map((c) => {
              const acc = acceptances?.[c.id];
              return (
                <li key={c.id} className="px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-apple-13 text-primary">
                      {c.status === 'published' ? (
                        <CheckCircle2 className="w-4 h-4 text-verdigris stroke-[1.5]" />
                      ) : (
                        <Clock className="w-4 h-4 text-secondary stroke-[1.5]" />
                      )}
                      {c.year}
                      <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold uppercase bg-surface-sunken text-secondary">
                        {c.status}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      {c.status === 'published' && acc && (
                        <span
                          data-testid={`sira-acceptance-${c.id}`}
                          className={`px-2 py-0.5 rounded-full text-apple-11 font-semibold border ${
                            acc.acceptanceStatus === 'accepted'
                              ? 'bg-verdigris-subtle text-verdigris border-verdigris'
                              : acc.acceptanceStatus === 'rejected'
                                ? 'bg-cinnabar-subtle text-cinnabar border-cinnabar'
                                : 'bg-surface-sunken text-secondary border-hairline'
                          }`}
                        >
                          {ACCEPTANCE_LABEL[acc.acceptanceStatus]}
                        </span>
                      )}
                      {c.status === 'draft' && canManage && (
                        <HoldToConfirm
                          label="Publish"
                          testId={`sira-publish-${c.id}`}
                          durationMs={2000}
                          onConfirm={() => onPublishCycle?.(c.id)}
                          className="relative overflow-hidden px-3 py-1 rounded-lg bg-primary text-canvas text-apple-12 font-semibold transition-colors"
                        >
                          Publish
                        </HoldToConfirm>
                      )}
                    </div>
                  </div>

                  {/* S19: the two-key acceptance. The finaliser endorses; a different auditor accepts. */}
                  {c.status === 'published' && acc && (
                    <div className="rounded-lg border border-hairline bg-surface-sunken p-2 space-y-2" data-testid={`sira-two-key-${c.id}`}>
                      <div className="flex flex-wrap items-center gap-2 text-apple-11 text-secondary">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Two-key acceptance: the finaliser endorses, a different person accepts.</span>
                        {acc.reminderCount > 0 && (
                          <span data-testid={`sira-reminders-${c.id}`} className="text-cinnabar">
                            {acc.reminderCount} reminder{acc.reminderCount === 1 ? '' : 's'} sent
                          </span>
                        )}
                      </div>
                      {!acc.canPublishNext && acc.blockReason && (
                        <p data-testid={`sira-publish-block-${c.id}`} className="flex items-center gap-1.5 text-apple-11 text-cinnabar">
                          <AlertTriangle className="w-3.5 h-3.5" /> {acc.blockReason}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {acc.acceptanceStatus === 'none' && canEndorse && onEndorseCycle && (
                          noteFor === c.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Endorsement note"
                                data-testid={`sira-endorse-note-${c.id}`}
                                className="px-2 py-1 rounded border border-hairline bg-surface text-apple-12 text-primary"
                              />
                              <button
                                type="button"
                                data-testid={`sira-endorse-save-${c.id}`}
                                onClick={() => { onEndorseCycle(c.id, note.trim()); setNoteFor(null); setNote(''); }}
                                className="px-2 py-1 rounded-lg bg-primary text-canvas text-apple-12 font-semibold"
                              >
                                Endorse
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-testid={`sira-endorse-${c.id}`}
                              onClick={() => { setNoteFor(c.id); setNote(''); }}
                              className="px-2.5 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
                            >
                              Endorse (finaliser)
                            </button>
                          )
                        )}
                        {acc.acceptanceStatus === 'awaiting_acceptance' && canDecide && onDecideAcceptance && (
                          reasonFor === c.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Reason (10+ characters)"
                                data-testid={`sira-acceptance-reason-${c.id}`}
                                className="px-2 py-1 rounded border border-hairline bg-surface text-apple-12 text-primary"
                              />
                              <button
                                type="button"
                                data-testid={`sira-accept-${c.id}`}
                                onClick={() => submitDecision(c.id, 'accepted')}
                                className="px-2 py-1 rounded-lg bg-verdigris text-canvas text-apple-12 font-semibold"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                data-testid={`sira-reject-${c.id}`}
                                onClick={() => submitDecision(c.id, 'rejected')}
                                className="px-2 py-1 rounded-lg border border-cinnabar text-cinnabar text-apple-12 font-semibold"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-testid={`sira-decide-acceptance-${c.id}`}
                              onClick={() => { setReasonFor(c.id); setReason(''); }}
                              className="px-2.5 py-1 rounded-lg bg-primary text-canvas text-apple-12 font-semibold"
                            >
                              Accept or reject (auditor)
                            </button>
                          )
                        )}
                        {acc.acceptanceStatus === 'awaiting_acceptance' && !canDecide && (
                          <span className="text-apple-11 text-tertiary">{rightReason('review_and_approve')}</span>
                        )}
                        {acc.acceptanceStatus === 'accepted' && acc.acceptedAt && (
                          <span className="text-apple-11 text-tertiary">Accepted {acc.acceptedAt.slice(0, 10)}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* S18: propose emergent risks from this cycle's open findings. */}
                  {c.status === 'published' && canManage && onProposeEmergent && (
                    <button
                      type="button"
                      data-testid={`sira-propose-${c.id}`}
                      onClick={() => onProposeEmergent(c.id)}
                      className="px-2.5 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
                    >
                      Propose emergent risks from findings
                    </button>
                  )}

                  {/* S18: build the carry-forward pack, then seed the next year from it. */}
                  {c.status === 'published' && canManage && (
                    <div className="space-y-2 pt-1">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`sira-pack-${c.id}`}
                          onClick={() => onBuildPack?.(c.id)}
                          className="px-2.5 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
                        >
                          Build carry-forward pack
                        </button>
                        {packs?.[c.id] && (
                          <button
                            type="button"
                            data-testid={`sira-seed-${c.id}`}
                            onClick={() => onSeedNext?.(c.id)}
                            className="px-2.5 py-1 rounded-lg bg-primary text-canvas text-apple-12 font-semibold"
                          >
                            Seed {packs[c.id].toYear} from this cycle
                          </button>
                        )}
                      </div>
                      {packs?.[c.id] && (
                        <div
                          data-testid={`sira-pack-view-${c.id}`}
                          className="rounded-lg border border-hairline bg-surface-sunken p-2 space-y-1"
                        >
                          <p className="text-apple-11 text-secondary">
                            Carry-forward pack: {packs[c.id].fromYear} → {packs[c.id].toYear} ·{' '}
                            {packs[c.id].entities.length} entit{packs[c.id].entities.length === 1 ? 'y' : 'ies'} carried
                          </p>
                          {packs[c.id].entities.slice(0, 5).map((e) => (
                            <p key={e.entityId} data-testid={`sira-pack-entity-${c.id}-${e.entityId}`} className="text-apple-11 text-tertiary">
                              {e.name}: prior {e.priorScore}
                              {e.priorBand ? ` (${e.priorBand})` : ''} from {e.scoreCount} score{e.scoreCount === 1 ? '' : 's'}
                            </p>
                          ))}
                          {packs[c.id].acceptedRiskTitles.length > 0 && (
                            <p data-testid={`sira-pack-risks-${c.id}`} className="text-apple-11 text-tertiary">
                              Accepted risks carried: {packs[c.id].acceptedRiskTitles.join('; ')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {carryForwards && carryForwards.length > 0 && (
          <div data-testid="sira-carry-forward-chain" className="rounded-xl border border-hairline bg-surface-sunken p-2 space-y-1">
            <p className="text-apple-11 font-semibold text-secondary">Carried forward (recorded)</p>
            {carryForwards.map((cf) => (
              <p key={cf.id} data-testid={`sira-carry-forward-${cf.id}`} className="text-apple-11 text-tertiary">
                {cf.fromYear} → {cf.toYear}
                {cf.createdAt ? ` · recorded ${cf.createdAt.slice(0, 10)}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-apple-15 font-semibold text-primary">Emergent risks</h3>
        {emergent.length === 0 ? (
          <p data-testid="emergent-empty" className="text-apple-13 text-tertiary">No emergent risks in the queue.</p>
        ) : (
          <ul data-testid="emergent-risks" className="space-y-2">
            {emergent.map((r) => (
              <li key={r.id} className="rounded-xl border border-hairline p-3 space-y-1">
                <div className="flex items-center gap-2">
                  {r.status === 'accepted' ? (
                    <CheckCircle2 className="w-4 h-4 text-verdigris stroke-[1.5]" />
                  ) : r.status === 'rejected' ? (
                    <XCircle className="w-4 h-4 text-cinnabar stroke-[1.5]" />
                  ) : (
                    <Clock className="w-4 h-4 text-secondary stroke-[1.5]" />
                  )}
                  <span className="text-apple-13 font-semibold text-primary">{r.title}</span>
                  <span
                    data-testid={`emergent-status-${r.id}`}
                    className="px-2 py-0.5 rounded-full text-apple-11 font-semibold uppercase bg-surface-sunken text-secondary"
                  >
                    {r.status}
                  </span>
                </div>
                {r.description && <p className="text-apple-12 text-secondary">{r.description}</p>}
                {r.proposalReason && (
                  <p data-testid={`emergent-proposal-${r.id}`} className="text-apple-11 text-tertiary">
                    Proposed: {r.proposalReason}
                  </p>
                )}
                {r.decisionReason && (
                  <p data-testid={`emergent-reason-${r.id}`} className="text-apple-11 text-tertiary">
                    Reason: {r.decisionReason}
                  </p>
                )}
                {r.status === 'pending' && canDecide && onDecideEmergentRisk && (
                  reasonFor === r.id ? (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (10+ characters)"
                        data-testid={`emergent-reason-input-${r.id}`}
                        className="px-2 py-1 rounded border border-hairline bg-surface text-apple-12 text-primary"
                      />
                      <button
                        type="button"
                        data-testid={`emergent-accept-${r.id}`}
                        onClick={() => submitEmergent(r.id, 'accepted')}
                        className="px-2 py-1 rounded-lg bg-verdigris text-canvas text-apple-12 font-semibold"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        data-testid={`emergent-reject-${r.id}`}
                        onClick={() => submitEmergent(r.id, 'rejected')}
                        className="px-2 py-1 rounded-lg border border-cinnabar text-cinnabar text-apple-12 font-semibold"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`emergent-decide-${r.id}`}
                      onClick={() => { setReasonFor(r.id); setReason(''); }}
                      className="px-2.5 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
                    >
                      Accept or reject
                    </button>
                  )
                )}
                {r.status === 'pending' && !canDecide && (
                  <p className="text-apple-11 text-tertiary">{rightReason('review_and_approve')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
