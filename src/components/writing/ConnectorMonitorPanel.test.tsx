import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listConnectorInstances = vi.fn();
const listConnectorRuns = vi.fn();
const listStagedRecords = vi.fn();
const listMonitorRules = vi.fn();
const listAlerts = vi.fn();
vi.mock('../../data/writing', () => ({
  listConnectorInstances: () => listConnectorInstances(),
  listConnectorRuns: () => listConnectorRuns(),
  listStagedRecords: () => listStagedRecords(),
  listMonitorRules: () => listMonitorRules(),
  listAlerts: () => listAlerts(),
  releaseMonitorRule: vi.fn(), saveConnectorInstance: vi.fn(), saveMonitorRule: vi.fn(),
  triageAlert: vi.fn(), connectorEgressAllowed: vi.fn(),
}));

const runConnector = vi.fn();
const browserTransport = vi.fn(() => ({}));
vi.mock('../../data/connectors', () => ({
  runConnector: (...a: unknown[]) => runConnector(...a),
  browserTransport: (...a: unknown[]) => browserTransport(...a),
}));

const connectorById = vi.fn();
vi.mock('../../lib/writing/connectorCatalogue', () => ({
  catalogue: () => [],
  connectorById: (id: string) => connectorById(id),
}));

const userRef = { current: { orgId: 'org-a', role: 'org_admin', rights: { edit_config: true } } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { ConnectorMonitorPanel } from './ConnectorMonitorPanel';

const ADAPTER = { entry: { id: 'http-rest' }, fetch: vi.fn(), healthCheck: vi.fn(), map: vi.fn() };

const INSTANCE = {
  id: 'inst-1', connectorId: 'http-rest', label: 'Payments', config: { base_url: 'https://mock.local' },
  enabled: true, health: 'ok', healthDetail: null, lastCheckedAt: null,
};

describe('ConnectorMonitorPanel: the connector run (S5 / F57, F58)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = { orgId: 'org-a', role: 'org_admin', rights: { edit_config: true } } as never;
    listConnectorInstances.mockResolvedValue([INSTANCE]);
    listConnectorRuns.mockResolvedValue([]);
    listStagedRecords.mockResolvedValue([]);
    listMonitorRules.mockResolvedValue([]);
    listAlerts.mockResolvedValue([]);
    connectorById.mockReturnValue(ADAPTER);
    browserTransport.mockReturnValue({});
    runConnector.mockResolvedValue({ ok: true, runId: 'run-1', fetched: 2, staged: 2, skipped: 0 });
  });

  it('runs the instance through the runtime and reports the counts', async () => {
    render(<ConnectorMonitorPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-connectors-instance-inst-1-run')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-connectors-instance-inst-1-run'));
    await waitFor(() => expect(runConnector).toHaveBeenCalled());
    const arg = runConnector.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.orgId).toBe('org-a');
    expect(arg.connector).toBe(ADAPTER);
    expect((arg.instance as { id: string }).id).toBe('inst-1');
    await waitFor(() => expect(screen.getByTestId('wk-connectors-run-result').textContent).toContain('fetched 2, staged 2, skipped 0'));
  });

  it('shows the exact reason when the runtime refuses the run', async () => {
    runConnector.mockResolvedValue({ ok: false, reason: 'a run is already in progress for this connector instance', runId: null, fetched: 0, staged: 0, skipped: 0 });
    render(<ConnectorMonitorPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-connectors-instance-inst-1-run')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-connectors-instance-inst-1-run'));
    await waitFor(() => expect(screen.getByTestId('wk-connectors-run-result').textContent).toContain('already in progress'));
  });

  it('refuses to run an instance with no base URL and calls nothing', async () => {
    listConnectorInstances.mockResolvedValue([{ ...INSTANCE, config: {} }]);
    render(<ConnectorMonitorPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-connectors-instance-inst-1-run')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-connectors-instance-inst-1-run'));
    await waitFor(() => expect(screen.getByTestId('wk-connectors-run-result').textContent).toContain('no valid base URL'));
    expect(runConnector).not.toHaveBeenCalled();
  });
});
