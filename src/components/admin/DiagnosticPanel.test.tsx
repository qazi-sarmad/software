import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { OrgDiagnosticFacts, PlatformDiagnosticFacts } from '../../lib/diagnostics';

const getOrgDiagnosticSnapshot = vi.fn();
const getPlatformDiagnosticSnapshot = vi.fn();

vi.mock('../../data/diagnostics', () => ({
  getOrgDiagnosticSnapshot: () => getOrgDiagnosticSnapshot(),
  getPlatformDiagnosticSnapshot: () => getPlatformDiagnosticSnapshot(),
}));

import { DiagnosticPanel } from './DiagnosticPanel';

function org(over: Partial<OrgDiagnosticFacts> = {}): OrgDiagnosticFacts {
  return {
    universes: 1, entities: 2, engagements: 1, is_empty: false,
    roles_total: 5, members_total: 3, sampling_rules: 1, populations: 1,
    populations_without_rows: 0, workpapers: 2, workpapers_sampled: 1,
    caps_open: 0, caps_overdue: 0, proposals_pending: 0, acceptances_outstanding: 0,
    sira_cycles: 1, sira_cycles_published: 0, alerts_incident: 0, alerts_warning: 0,
    alerts_unacknowledged: 0, incidents_open: 0, evidence_rows: 1, evidence_without_storage: 0,
    evidence_unverified: 0, connectors_total: 0, connectors_failing: 0,
    ledger_broken_at: null, as_of: '2026-10-28',
    ...over,
  };
}

function platform(over: Partial<PlatformDiagnosticFacts> = {}): PlatformDiagnosticFacts {
  return {
    tenants: 3, tenants_suspended: 0, jobs_total: 4, jobs_failing: 0,
    incidents_open: 0, alerts_incident: 0, alerts_unacknowledged: 0, as_of: '2026-10-28',
    ...over,
  };
}

describe('DiagnosticPanel (self-diagnostic surface)', () => {
  beforeEach(() => {
    getOrgDiagnosticSnapshot.mockReset();
    getPlatformDiagnosticSnapshot.mockReset();
  });

  it('renders the clean state when every check passes', async () => {
    getOrgDiagnosticSnapshot.mockResolvedValue(org());
    render(<DiagnosticPanel scope="org" />);
    await waitFor(() => expect(screen.getByTestId('diagnostic-clean')).toBeTruthy());
    expect(screen.getByTestId('diagnostic-counts').textContent).toContain('0 critical');
  });

  it('renders a finding with its rule id, evidence and the numbers behind it', async () => {
    getOrgDiagnosticSnapshot.mockResolvedValue(org({ ledger_broken_at: 7 }));
    render(<DiagnosticPanel scope="org" />);
    await waitFor(() => expect(screen.getByTestId('diagnostic-finding-ledger.chain_broken')).toBeTruthy());
    expect(screen.getByTestId('diagnostic-rule-ledger.chain_broken').textContent).toBe('ledger.chain_broken');
    expect(screen.getByTestId('diagnostic-evidence-ledger.chain_broken').textContent).toContain('ledger_broken_at=7');
    expect(screen.getByTestId('diagnostic-headline').textContent).toContain('1 critical issue');
  });

  it('opens a finding screen through onOpen with the resolved destination', async () => {
    getOrgDiagnosticSnapshot.mockResolvedValue(org({ ledger_broken_at: 7 }));
    const onOpen = vi.fn();
    render(<DiagnosticPanel scope="org" onOpen={onOpen} />);
    const btn = await waitFor(() => screen.getByTestId('diagnostic-open-ledger.chain_broken'));
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith({ kind: 'inspector', inspector: 'org_control', data: { tab: 'integrity' } });
  });

  it('hides the Open button when no onOpen handler is supplied (platform console)', async () => {
    getOrgDiagnosticSnapshot.mockResolvedValue(org({ ledger_broken_at: 7 }));
    render(<DiagnosticPanel scope="org" />);
    await waitFor(() => expect(screen.getByTestId('diagnostic-finding-ledger.chain_broken')).toBeTruthy());
    expect(screen.queryByTestId('diagnostic-open-ledger.chain_broken')).toBeNull();
    expect(screen.getByTestId('diagnostic-screen-ledger.chain_broken').textContent).toBe('OA-29');
  });

  it('renders the platform scope from the platform snapshot', async () => {
    getPlatformDiagnosticSnapshot.mockResolvedValue(platform({ jobs_failing: 2 }));
    render(<DiagnosticPanel scope="platform" />);
    await waitFor(() => expect(screen.getByTestId('diagnostic-finding-jobs.failing')).toBeTruthy());
    expect(getPlatformDiagnosticSnapshot).toHaveBeenCalled();
    expect(getOrgDiagnosticSnapshot).not.toHaveBeenCalled();
  });

  it('is honest when the snapshot is not available (no Supabase env)', async () => {
    getOrgDiagnosticSnapshot.mockResolvedValue(null);
    render(<DiagnosticPanel scope="org" />);
    await waitFor(() => expect(screen.getByTestId('diagnostic-unavailable')).toBeTruthy());
  });

  it('shows the not-available state for a non-platform caller', async () => {
    getPlatformDiagnosticSnapshot.mockResolvedValue(null);
    render(<DiagnosticPanel scope="platform" />);
    await waitFor(() => expect(screen.getByTestId('diagnostic-unavailable')).toBeTruthy());
  });

  it('re-runs the diagnostic on demand', async () => {
    getOrgDiagnosticSnapshot.mockResolvedValue(org());
    render(<DiagnosticPanel scope="org" />);
    await waitFor(() => expect(screen.getByTestId('diagnostic-refresh')).toBeTruthy());
    fireEvent.click(screen.getByTestId('diagnostic-refresh'));
    await waitFor(() => expect(getOrgDiagnosticSnapshot).toHaveBeenCalledTimes(2));
  });
});
