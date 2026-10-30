import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listIcfrConfig = vi.fn();
const runIcfrMonitoring = vi.fn();
const runForensicAnalytics = vi.fn();
const runGapAnalysis = vi.fn();
const runAssuranceOverAssurance = vi.fn();
const saveIcfrControl = vi.fn();
const saveIcfrRule = vi.fn();
const saveIcfrEvidence = vi.fn();
const saveAssuranceMetric = vi.fn();
vi.mock('../../data/assurance', () => ({
  listIcfrConfig: (...a: unknown[]) => listIcfrConfig(...a),
  runIcfrMonitoring: (...a: unknown[]) => runIcfrMonitoring(...a),
  runForensicAnalytics: (...a: unknown[]) => runForensicAnalytics(...a),
  runGapAnalysis: (...a: unknown[]) => runGapAnalysis(...a),
  runAssuranceOverAssurance: (...a: unknown[]) => runAssuranceOverAssurance(...a),
  saveIcfrControl: (...a: unknown[]) => saveIcfrControl(...a),
  saveIcfrRule: (...a: unknown[]) => saveIcfrRule(...a),
  saveIcfrEvidence: (...a: unknown[]) => saveIcfrEvidence(...a),
  saveAssuranceMetric: (...a: unknown[]) => saveAssuranceMetric(...a),
}));

const userRef: { current: unknown } = {
  current: { orgId: 'org-a', role: 'cia', rights: { perform_work: true, view_insights: true } },
};
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { AssuranceCapabilitiesPanel } from './AssuranceCapabilitiesPanel';

const EMPTY_CONFIG = { controls: [], rules: [], evidence: [], thresholds: null };

const BREACH_RESULT = {
  rows: [{ controlId: 'C-01', outcome: 'breach' as const, reason: 'breached' }],
  noEvidence: ['C-07'],
  unmonitored: ['C-08'],
  breaches: [{
    controlId: 'C-01', ruleId: 'icfr.c01', ruleVersion: 2, severity: 'material_weakness' as const,
    deviationPercent: 20, population: 200, deviations: 40, basis: 'the deviation rate is 20%',
    compensatingControlId: null,
  }],
  complete: false,
};

describe('AssuranceCapabilitiesPanel (OA-34): D5 / D7 / D8 / D9', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = { orgId: 'org-a', role: 'cia', rights: { perform_work: true, view_insights: true } };
    listIcfrConfig.mockResolvedValue(EMPTY_CONFIG);
    runIcfrMonitoring.mockResolvedValue({ result: BREACH_RESULT, recorded: { ok: true } });
    runGapAnalysis.mockResolvedValue({
      result: { rows: [], gaps: [{ obligationId: 'O-1', sourceClause: 'CL-9', subject: 's', status: 'gap', coveredBy: [], missingControls: ['C-99'], reason: 'clause CL-9 is a gap' }], notInterpreted: [], coveragePercent: 0 },
      recorded: { ok: true },
    });
    runAssuranceOverAssurance.mockResolvedValue({
      rows: [{ metricId: 'M-2', standard: '8.4', label: 'EQA', state: 'unknown', value: null, evidenceRef: null, reason: 'unknown' }],
      measured: 0, unknown: 1, standards: ['8.4'], complete: false, asOf: '2026-10-30',
    });
    saveIcfrControl.mockResolvedValue({ ok: true });
    saveIcfrRule.mockResolvedValue({ ok: true });
    saveIcfrEvidence.mockResolvedValue({ ok: true });
    saveAssuranceMetric.mockResolvedValue({ ok: true });
  });

  it('happy path: D5 shows the breach with its severity and basis, and the no-evidence list', async () => {
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-d5-run')).toBeTruthy());
    fireEvent.click(screen.getByTestId('assurance-d5-run'));
    await waitFor(() => expect(screen.getByTestId('assurance-d5-result')).toBeTruthy());
    const breach = screen.getByTestId('assurance-d5-breach-C-01');
    expect(breach.textContent).toContain('material_weakness');
    expect(breach.textContent).toContain('the deviation rate is 20%');
    expect(screen.getByTestId('assurance-d5-no-evidence').textContent).toContain('C-07');
    expect(screen.getByTestId('assurance-d5-unmonitored').textContent).toContain('C-08');
    // The incomplete banner is not a pass.
    expect(screen.getByTestId('assurance-d5-complete').textContent).toContain('NOT a pass');
  });

  it('bad path: with no work right, the run button is disabled and the reason is shown', async () => {
    userRef.current = { orgId: 'org-a', role: 'observer', rights: { view_insights: true } };
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-d5-needs-right')).toBeTruthy());
    expect((screen.getByTestId('assurance-d5-run') as HTMLButtonElement).disabled).toBe(true);
    expect(runIcfrMonitoring).not.toHaveBeenCalled();
  });

  it('bad path: a load failure shows the error with a retry', async () => {
    listIcfrConfig.mockRejectedValue(new Error('not configured'));
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-error')).toBeTruthy());
    expect(screen.getByTestId('assurance-error-message').textContent).toContain('not configured');
    expect(screen.getByTestId('assurance-retry')).toBeTruthy();
  });

  it('D8 shows a gap by its clause', async () => {
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-tab-d8')).toBeTruthy());
    fireEvent.click(screen.getByTestId('assurance-tab-d8'));
    fireEvent.click(screen.getByTestId('assurance-d8-run'));
    await waitFor(() => expect(screen.getByTestId('assurance-d8-result')).toBeTruthy());
    expect(screen.getByTestId('assurance-d8-gap-O-1').textContent).toContain('CL-9');
  });

  it('D9 shows an unknown metric as unknown, never 0', async () => {
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-tab-d9')).toBeTruthy());
    fireEvent.click(screen.getByTestId('assurance-tab-d9'));
    fireEvent.click(screen.getByTestId('assurance-d9-run'));
    await waitFor(() => expect(screen.getByTestId('assurance-d9-result')).toBeTruthy());
    expect(screen.getByTestId('assurance-d9-metric-M-2').textContent).toContain('unknown');
    expect(screen.getByTestId('assurance-d9-summary').textContent).toContain('1 unknown');
  });

  it('records a refusal from the writer as an inline error, not a silent success', async () => {
    runIcfrMonitoring.mockResolvedValue({ result: BREACH_RESULT, recorded: { ok: false, reason: 'feature_off: icfr_monitoring' } });
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-d5-run')).toBeTruthy());
    fireEvent.click(screen.getByTestId('assurance-d5-run'));
    await waitFor(() => expect(screen.getByTestId('assurance-run-error')).toBeTruthy());
    expect(screen.getByTestId('assurance-run-error').textContent).toContain('feature_off: icfr_monitoring');
  });

  it('config path: with edit_config, saving a control passes the COSO taxonomy to the writer', async () => {
    userRef.current = { orgId: 'org-a', role: 'org_admin', rights: { perform_work: true, edit_config: true } };
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-d5-save-control')).toBeTruthy());
    fireEvent.change(screen.getByTestId('assurance-d5-control-id'), { target: { value: 'C-42' } });
    fireEvent.change(screen.getByTestId('assurance-d5-owner'), { target: { value: 'Head of Finance' } });
    fireEvent.click(screen.getByTestId('assurance-d5-save-control'));
    await waitFor(() => expect(saveIcfrControl).toHaveBeenCalled());
    const arg = saveIcfrControl.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.orgId).toBe('org-a');
    expect(arg.controlId).toBe('C-42');
    expect(arg.taxonomy).toBe('coso_icif_2013');
    expect(arg.owner).toBe('Head of Finance');
  });

  it('config path: with no edit_config the configuration form is not shown', async () => {
    userRef.current = { orgId: 'org-a', role: 'cia', rights: { perform_work: true, edit_config: false } };
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-d5-run')).toBeTruthy());
    expect(screen.queryByTestId('assurance-d5-config')).toBeNull();
  });

  it('bad path: a blank D9 metric value is saved as null (unknown), never 0', async () => {
    userRef.current = { orgId: 'org-a', role: 'org_admin', rights: { perform_work: true, edit_config: true } };
    render(<AssuranceCapabilitiesPanel />);
    await waitFor(() => expect(screen.getByTestId('assurance-tab-d9')).toBeTruthy());
    fireEvent.click(screen.getByTestId('assurance-tab-d9'));
    fireEvent.change(screen.getByTestId('assurance-d9-metric-id'), { target: { value: 'M-9' } });
    fireEvent.click(screen.getByTestId('assurance-d9-save-metric'));
    await waitFor(() => expect(saveAssuranceMetric).toHaveBeenCalled());
    const arg = saveAssuranceMetric.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.value).toBeNull();
    expect(arg.metricId).toBe('M-9');
  });
});
