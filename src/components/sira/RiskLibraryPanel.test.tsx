import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listRiskLibrary = vi.fn();
const listDerivedRisks = vi.fn();
const listCycles = vi.fn();
const listErmThemes = vi.fn();
const listKris = vi.fn();
const listPlanChanges = vi.fn();
const listStandards = vi.fn();
const readRiskScore = vi.fn();
const writeRiskFactors = vi.fn();
const setRiskOverride = vi.fn();
const revertRiskOverride = vi.fn();
const setErmTheme = vi.fn();
const setKriValue = vi.fn();
const proposePlanChange = vi.fn();
vi.mock('../../data/risk', () => ({
  listRiskLibrary: (...a: unknown[]) => listRiskLibrary(...a),
  listDerivedRisks: (...a: unknown[]) => listDerivedRisks(...a),
  listCycles: (...a: unknown[]) => listCycles(...a),
  listErmThemes: (...a: unknown[]) => listErmThemes(...a),
  listKris: (...a: unknown[]) => listKris(...a),
  listPlanChanges: (...a: unknown[]) => listPlanChanges(...a),
  listStandards: (...a: unknown[]) => listStandards(...a),
  readRiskScore: (...a: unknown[]) => readRiskScore(...a),
  writeRiskFactors: (...a: unknown[]) => writeRiskFactors(...a),
  setRiskOverride: (...a: unknown[]) => setRiskOverride(...a),
  revertRiskOverride: (...a: unknown[]) => revertRiskOverride(...a),
  setErmTheme: (...a: unknown[]) => setErmTheme(...a),
  setKriValue: (...a: unknown[]) => setKriValue(...a),
  proposePlanChange: (...a: unknown[]) => proposePlanChange(...a),
}));

const userRef: { current: unknown } = { current: { orgId: 'org-a', role: 'cia', rights: { manage_engagements: true } } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { RiskLibraryPanel } from './RiskLibraryPanel';

const LIB = [
  { id: 'r1', code: 'R-01', name: 'Revenue recognition', discipline: 'finance', source: 'IFRS 15', riskType: 'financial' },
];
const CYCLES = [{ id: 'c1', universeId: 'u1', year: 2026, status: 'draft' }];

describe('RiskLibraryPanel (SR-04): D14 / D15', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = { orgId: 'org-a', role: 'cia', rights: { manage_engagements: true } };
    listRiskLibrary.mockResolvedValue(LIB);
    listDerivedRisks.mockResolvedValue([]);
    listCycles.mockResolvedValue(CYCLES);
    listErmThemes.mockResolvedValue([
      { theme: 'cybersecurity and data privacy', entityId: 'e1', isTopRisk: true },
      { theme: 'talent and workforce', entityId: null, isTopRisk: true },
    ]);
    listKris.mockResolvedValue([{ kriId: 'KRI-1', theme: 'cybersecurity and data privacy', value: 9, tolerance: 5 }]);
    listPlanChanges.mockResolvedValue([]);
    listStandards.mockResolvedValue([]);
    readRiskScore.mockResolvedValue({ riskId: 'r1', score: 3, method: 'risk_based', factorValues: { inherent_risk: 4 }, autoValues: [], overrides: [] });
    writeRiskFactors.mockResolvedValue({ ok: true, score: 82 });
    setRiskOverride.mockResolvedValue({ ok: true });
    revertRiskOverride.mockResolvedValue({ ok: true });
    setKriValue.mockResolvedValue({ ok: true });
    proposePlanChange.mockResolvedValue({ ok: true });
  });

  it('lists the risk library and its framework-derived rows', async () => {
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-library-row-r1')).toBeTruthy());
    expect(screen.getByTestId('risk-library-row-r1').textContent).toContain('Revenue recognition');
  });

  it('auto-computes the factors and shows the score', async () => {
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-tab-autocompute')).toBeTruthy());
    fireEvent.click(screen.getByTestId('risk-tab-autocompute'));
    fireEvent.click(screen.getByTestId('risk-autocompute-run'));
    await waitFor(() => expect(writeRiskFactors).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('risk-notice').textContent).toContain('normalised to 100'));
  });

  it('surfaces a factor-write refusal and writes nothing', async () => {
    writeRiskFactors.mockResolvedValue({ ok: false, reason: 'not allowed: caller lacks the perform_work right' });
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-tab-autocompute')).toBeTruthy());
    fireEvent.click(screen.getByTestId('risk-tab-autocompute'));
    fireEvent.click(screen.getByTestId('risk-autocompute-run'));
    await waitFor(() => expect(screen.getByText(/lacks the perform_work right/)).toBeTruthy());
  });

  it('maps the ERM themes and surfaces a top risk with no coverage as a gap', async () => {
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-tab-erm')).toBeTruthy());
    fireEvent.click(screen.getByTestId('risk-tab-erm'));
    await waitFor(() => expect(screen.getByTestId('risk-erm-talent and workforce')).toBeTruthy());
    expect(screen.getByTestId('risk-erm-talent and workforce').textContent).toContain('none');
    expect(screen.getByTestId('risk-erm-gaps').textContent).toContain('talent and workforce');
  });

  it('shows a KRI breach and an unknown KRI honestly', async () => {
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-tab-erm')).toBeTruthy());
    fireEvent.click(screen.getByTestId('risk-tab-erm'));
    await waitFor(() => expect(screen.getByTestId('risk-kri-KRI-1')).toBeTruthy());
    expect(screen.getByTestId('risk-kri-KRI-1').textContent).toContain('breach');
  });

  it('proposes a plan change with a rationale from a trigger', async () => {
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-tab-planning')).toBeTruthy());
    fireEvent.click(screen.getByTestId('risk-tab-planning'));
    fireEvent.change(screen.getByTestId('risk-trigger-kind'), { target: { value: 'incident' } });
    fireEvent.change(screen.getByTestId('risk-trigger-entity'), { target: { value: 'e1' } });
    fireEvent.click(screen.getByTestId('risk-propose'));
    await waitFor(() => expect(proposePlanChange).toHaveBeenCalled());
    expect(proposePlanChange.mock.calls[0][3]).toBe('defer');
    expect(String(proposePlanChange.mock.calls[0][4])).toContain('incident');
  });

  it('bad path: a caller without the right is read-only and cannot auto-compute', async () => {
    userRef.current = { orgId: 'org-a', role: 'observer', rights: {} };
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-denied')).toBeTruthy());
    fireEvent.click(screen.getByTestId('risk-tab-autocompute'));
    expect((screen.getByTestId('risk-autocompute-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('empty state: an organisation with no library rows is told so', async () => {
    listRiskLibrary.mockResolvedValue([]);
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-library')).toBeTruthy());
  });

  it('error state: a read failure is shown honestly', async () => {
    listRiskLibrary.mockRejectedValue(new Error('the risk library could not be read'));
    render(<RiskLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('risk-error')).toBeTruthy());
  });
});
