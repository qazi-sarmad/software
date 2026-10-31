import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const storageReady = vi.fn();
const getConfig = vi.fn();
const saveConfig = vi.fn();
const listRuns = vi.fn();
const recordRun = vi.fn();

vi.mock('../../data/capabilities', async () => {
  const actual = await vi.importActual<typeof import('../../data/capabilities')>('../../data/capabilities');
  return {
    ...actual,
    capabilityStorageReady: () => storageReady(),
    getCapabilityConfig: () => getConfig(),
    saveCapabilityConfig: (...a: unknown[]) => saveConfig(...a),
    listCapabilityRuns: (...a: unknown[]) => listRuns(...a),
    recordCapabilityRun: (...a: unknown[]) => recordRun(...a),
  };
});

const scoped = {
  currentUser: { id: 'u1', role: 'cia', rights: { edit_config: true } as Record<string, boolean> },
  scopedEntities: [],
  scopedControls: [],
  scopedEngagements: [],
  scopedIssues: [],
  scopedWorkpapers: [],
};
vi.mock('../../hooks/useScopedData', () => ({
  useScopedData: () => scoped,
}));

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ openInspector: vi.fn() }),
}));

import { CapabilityLibraryPanel } from './CapabilityLibraryPanel';

beforeEach(() => {
  storageReady.mockReset().mockResolvedValue(true);
  getConfig.mockReset().mockResolvedValue({ riskTolerance: 'high', stratificationSample: 25, reviewerAgeingDays: 14 });
  saveConfig.mockReset().mockResolvedValue({ ok: true });
  listRuns.mockReset().mockResolvedValue([]);
  recordRun.mockReset().mockResolvedValue({ ok: true });
  scoped.currentUser.role = 'cia'; scoped.currentUser.rights = { edit_config: true };
});

describe('CapabilityLibraryPanel (D1-D4, DB-02)', () => {
  it('says "not configured" rather than a wall of zeros when there is no tenant database', async () => {
    storageReady.mockResolvedValue(false);
    render(<CapabilityLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('DB-02-unconfigured')).toBeTruthy());
  });

  it('renders the four families and the twenty capabilities', async () => {
    render(<CapabilityLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('DB-02-list')).toBeTruthy());
    for (const kind of ['risk_control', 'population_evidence', 'process_governance', 'assurance_ops']) {
      expect(screen.getByTestId(`DB-02-kind-${kind}`)).toBeTruthy();
    }
    // The first family's five capabilities are rendered.
    for (const id of ['risk.residual_drift', 'risk.coverage_matrix', 'risk.effectiveness_history', 'risk.key_control', 'risk.appetite_breach']) {
      expect(screen.getByTestId(`DB-02-cap-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`DB-02-cap-${id}-status`).textContent).toContain('awaiting input');
    }
  });

  it('switches family when a tab is clicked', async () => {
    render(<CapabilityLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('DB-02-kind-assurance_ops')).toBeTruthy());
    fireEvent.click(screen.getByTestId('DB-02-kind-assurance_ops'));
    expect(screen.getByTestId('DB-02-cap-ops.engagement_health')).toBeTruthy();
  });

  it('opens a capability to show its rule and what it is awaiting', async () => {
    render(<CapabilityLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('DB-02-cap-risk.residual_drift-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('DB-02-cap-risk.residual_drift-toggle'));
    expect(screen.getByTestId('DB-02-cap-risk.residual_drift-rule').textContent).toContain('Rule:');
    expect(screen.getByTestId('DB-02-cap-risk.residual_drift-needs').textContent).toContain('Awaiting');
  });

  it('saves thresholds when the caller holds edit_config', async () => {
    render(<CapabilityLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('DB-02-save')).toBeTruthy());
    fireEvent.click(screen.getByTestId('DB-02-save'));
    await waitFor(() => expect(saveConfig).toHaveBeenCalled());
  });

  it('denies the threshold save when the caller lacks edit_config', async () => {
    scoped.currentUser.role = 'observer'; scoped.currentUser.rights = {};
    render(<CapabilityLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('DB-02-save-denied')).toBeTruthy());
    expect((screen.getByTestId('DB-02-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('records the runnable capabilities as evidence', async () => {
    render(<CapabilityLibraryPanel />);
    await waitFor(() => expect(screen.getByTestId('DB-02-kind-process_governance')).toBeTruthy());
    // The SoD matrix is runnable from the seed rights, so switching to its family makes the
    // record action available.
    fireEvent.click(screen.getByTestId('DB-02-kind-process_governance'));
    await waitFor(() => expect((screen.getByTestId('DB-02-record') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('DB-02-record'));
    await waitFor(() => expect(recordRun).toHaveBeenCalled());
  });
});
