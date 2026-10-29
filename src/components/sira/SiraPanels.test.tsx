import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SiraModelEditor } from './SiraModelEditor';
import { SiraCyclePanel } from './SiraCyclePanel';
import { SiraScoringPanel } from './SiraScoringPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const wrap = (role: Role, children: React.ReactNode) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        {children}
      </AppProvider>
    </ThemeProvider>
  );

const MODEL = {
  aggregation: 'weighted_sum',
  version: 2,
  factors: [{ key: 'f1', label: 'Impact', weight: 40, ordinal: 1 }],
  scales: [{ point: 1, label: 'Low' }],
  bands: [{ name: 'High', min: 60, max: 100, ordinal: 1 }],
};

describe('SiraModelEditor', () => {
  it('shows an empty state without a model', () => {
    wrap('cia', <SiraModelEditor model={null} />);
    expect(screen.getByTestId('sira-model-empty')).toBeTruthy();
  });

  it('renders factors, bands and version', () => {
    wrap('cia', <SiraModelEditor model={MODEL} />);
    expect(screen.getByTestId('sira-model-version').textContent).toBe('v2');
    expect(screen.getByTestId('sira-factors').textContent).toMatch(/Impact/);
    expect(screen.getByTestId('sira-bands').textContent).toMatch(/High/);
  });

  it('is read-only without edit_config', () => {
    wrap('preparer', <SiraModelEditor model={MODEL} />);
    expect(screen.getByTestId('sira-model-locked')).toBeTruthy();
  });

  it('is not read-only for a session with edit_config', () => {
    wrap('cia', <SiraModelEditor model={MODEL} />);
    expect(screen.queryByTestId('sira-model-locked')).toBeNull();
  });
});

describe('SiraCyclePanel', () => {
  it('shows empty states', () => {
    wrap('cia', <SiraCyclePanel cycles={[]} emergent={[]} />);
    expect(screen.getByTestId('sira-cycles-empty')).toBeTruthy();
    expect(screen.getByTestId('emergent-empty')).toBeTruthy();
  });

  it('offers publish only on a draft cycle for a manager', () => {
    wrap('cia', <SiraCyclePanel cycles={[{ id: 'c1', year: 2026, status: 'draft', publishedAt: null }]} emergent={[]} />);
    expect(screen.getByTestId('sira-publish-c1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sira-publish-c1'));
  });

  it('shows no publish control on a published cycle', () => {
    wrap('cia', <SiraCyclePanel cycles={[{ id: 'c1', year: 2026, status: 'published', publishedAt: '2026-01-01' }]} emergent={[]} />);
    expect(screen.queryByTestId('sira-publish-c1')).toBeNull();
  });

  it('shows the mandatory-reason text of an emergent risk', () => {
    wrap('cia', (
      <SiraCyclePanel
        cycles={[]}
        emergent={[{ id: 'r1', title: 'New risk', description: 'd', status: 'rejected', decisionReason: 'not material enough' }]}
      />
    ));
    expect(screen.getByTestId('emergent-reason-r1').textContent).toMatch(/not material enough/);
  });

  it('shows the two-key acceptance state and the publication block (S19)', () => {
    wrap('cia', (
      <SiraCyclePanel
        cycles={[{ id: 'c1', year: 2026, status: 'published', publishedAt: '2026-01-01' }]}
        emergent={[]}
        acceptances={{
          c1: {
            acceptanceStatus: 'awaiting_acceptance', endorsedAt: null, acceptedAt: null,
            reminderCount: 2, pendingProposals: 1, canPublishNext: false,
            blockReason: '1 emergent-risk proposal is outstanding',
          },
        }}
      />
    ));
    expect(screen.getByTestId('sira-acceptance-c1').textContent).toMatch(/Awaiting auditor acceptance/);
    expect(screen.getByTestId('sira-publish-block-c1').textContent).toMatch(/outstanding/);
    expect(screen.getByTestId('sira-reminders-c1').textContent).toMatch(/2 reminders/);
  });

  it('offers endorse to the finaliser and accept to an auditor, never the same control', () => {
    const acc = {
      c1: {
        acceptanceStatus: 'none' as const, endorsedAt: null, acceptedAt: null,
        reminderCount: 0, pendingProposals: 0, canPublishNext: true, blockReason: null,
      },
    };
    wrap('cia', <SiraCyclePanel cycles={[{ id: 'c1', year: 2026, status: 'published', publishedAt: 'x' }]} emergent={[]} acceptances={acc} onEndorseCycle={() => {}} />);
    expect(screen.getByTestId('sira-endorse-c1')).toBeTruthy();
    expect(screen.queryByTestId('sira-decide-acceptance-c1')).toBeNull();
  });

  it('offers the auditor accept control once endorsed, not the finaliser control', () => {
    const acc = {
      c1: {
        acceptanceStatus: 'awaiting_acceptance' as const, endorsedAt: '2026-02-01', acceptedAt: null,
        reminderCount: 0, pendingProposals: 0, canPublishNext: true, blockReason: null,
      },
    };
    wrap('cia', <SiraCyclePanel cycles={[{ id: 'c1', year: 2026, status: 'published', publishedAt: 'x' }]} emergent={[]} acceptances={acc} onDecideAcceptance={() => {}} />);
    expect(screen.getByTestId('sira-decide-acceptance-c1')).toBeTruthy();
    expect(screen.queryByTestId('sira-endorse-c1')).toBeNull();
  });

  it('records the proposal provenance of an emergent risk (S18)', () => {
    wrap('cia', (
      <SiraCyclePanel
        cycles={[]}
        emergent={[{ id: 'r1', title: 'From a finding', description: null, status: 'pending', decisionReason: null, sourceKind: 'finding', proposalReason: 'an open finding on this universe' }]}
      />
    ));
    expect(screen.getByTestId('emergent-proposal-r1').textContent).toMatch(/an open finding/);
  });

  it('offers the carry-forward pack builder on a published cycle (S18)', () => {
    wrap('cia', (
      <SiraCyclePanel
        cycles={[{ id: 'c1', year: 2026, status: 'published', publishedAt: 'x' }]}
        emergent={[]}
        onBuildPack={() => {}}
      />
    ));
    expect(screen.getByTestId('sira-pack-c1')).toBeTruthy();
    // The seed control appears only once the pack has been built.
    expect(screen.queryByTestId('sira-seed-c1')).toBeNull();
  });

  it('renders the pack and offers seeding once it is built (S18)', () => {
    wrap('cia', (
      <SiraCyclePanel
        cycles={[{ id: 'c1', year: 2026, status: 'published', publishedAt: 'x' }]}
        emergent={[]}
        packs={{
          c1: {
            fromYear: 2026,
            toYear: 2027,
            entities: [{ entityId: 'e1', name: 'Treasury', priorScore: 72.5, priorBand: 'High', scoreCount: 3 }],
            acceptedRiskTitles: ['Vendor concentration'],
          },
        }}
        onSeedNext={() => {}}
      />
    ));
    expect(screen.getByTestId('sira-pack-view-c1').textContent).toMatch(/2026 → 2027/);
    expect(screen.getByTestId('sira-pack-entity-c1-e1').textContent).toMatch(/Treasury: prior 72.5 \(High\) from 3 scores/);
    expect(screen.getByTestId('sira-pack-risks-c1').textContent).toMatch(/Vendor concentration/);
    expect(screen.getByTestId('sira-seed-c1')).toBeTruthy();
  });
});

const SCORING_MODEL = {
  aggregation: 'weighted_sum',
  factors: [
    { key: 'inherent_risk', label: 'Inherent risk', weight: 1, ordinal: 1 },
    { key: 'materiality', label: 'Materiality', weight: 1, ordinal: 2 },
  ],
  scales: [{ point: 1, label: 'Low' }, { point: 5, label: 'High' }],
  bands: [{ name: 'High', min: 60, max: 100, ordinal: 1 }],
};

describe('SiraScoringPanel (S18 write path)', () => {
  it('refuses to score without a draft cycle, and says so', () => {
    wrap('cia', (
      <SiraScoringPanel cycle={null} universeId="u1" model={SCORING_MODEL} entities={[]} risks={[]} scores={[]} />
    ));
    expect(screen.getByTestId('sira-scoring-no-cycle')).toBeTruthy();
  });

  it('freezes a published cycle rather than offering a dead control', () => {
    wrap('cia', (
      <SiraScoringPanel cycle={{ id: 'c1', year: 2026, status: 'published' }} universeId="u1"
        model={SCORING_MODEL} entities={[]} risks={[]} scores={[]} />
    ));
    expect(screen.getByTestId('sira-scoring-frozen')).toBeTruthy();
    expect(screen.queryByTestId('sira-record-score')).toBeNull();
  });

  it('records a score through the callback with the factor values chosen', () => {
    const seen: unknown[] = [];
    wrap('cia', (
      <SiraScoringPanel
        cycle={{ id: 'c1', year: 2026, status: 'draft' }}
        universeId="u1"
        model={SCORING_MODEL}
        entities={[{ id: 'e1', name: 'Treasury' }]}
        risks={[{ id: 'r1', name: 'Fraud' }]}
        scores={[]}
        onRecordScore={(cycleId, entityId, riskId, fv) => seen.push({ cycleId, entityId, riskId, fv })}
      />
    ));
    fireEvent.change(screen.getByTestId('sira-score-entity'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByTestId('sira-score-risk'), { target: { value: 'r1' } });
    fireEvent.click(screen.getByTestId('sira-factor-materiality-5'));
    fireEvent.click(screen.getByTestId('sira-record-score'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ cycleId: 'c1', entityId: 'e1', riskId: 'r1' });
    expect((seen[0] as { fv: Record<string, number> }).fv).toMatchObject({ materiality: 5, inherent_risk: 1 });
  });

  it('submits an emergent risk through the callback', () => {
    const seen: unknown[] = [];
    wrap('cia', (
      <SiraScoringPanel cycle={null} universeId="u1" model={SCORING_MODEL} entities={[]} risks={[]} scores={[]}
        onSubmitEmergentRisk={(universeId, title, description) => seen.push({ universeId, title, description })} />
    ));
    fireEvent.change(screen.getByTestId('emergent-submit-title'), { target: { value: 'New vendor risk' } });
    fireEvent.change(screen.getByTestId('emergent-submit-description'), { target: { value: 'Concentration' } });
    fireEvent.click(screen.getByTestId('emergent-submit'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ universeId: 'u1', title: 'New vendor risk', description: 'Concentration' });
  });

  it('is read-only for a session without manage_engagements', () => {
    wrap('preparer', (
      <SiraScoringPanel cycle={{ id: 'c1', year: 2026, status: 'draft' }} universeId="u1"
        model={SCORING_MODEL} entities={[{ id: 'e1', name: 'Treasury' }]} risks={[{ id: 'r1', name: 'Fraud' }]} scores={[]} />
    ));
    expect(screen.getByTestId('sira-scoring-locked')).toBeTruthy();
    expect(screen.queryByTestId('sira-record-score')).toBeNull();
  });
});
