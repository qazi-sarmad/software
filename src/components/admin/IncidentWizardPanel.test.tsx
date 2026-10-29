import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import type { IntegrityIncidentRow } from '../../lib/incidentWizard';

const listIntegrityIncidents = vi.fn();
const listIntegrityAlerts = vi.fn();
const openIntegrityIncident = vi.fn();
const incidentAction = vi.fn();
const verifyIntegrityIncident = vi.fn();
let storageReadyFlag = true;

vi.mock('../../data/incidents', () => ({
  incidentStorageReady: () => storageReadyFlag,
  listIntegrityIncidents: () => listIntegrityIncidents(),
  openIntegrityIncident: (id: string) => openIntegrityIncident(id),
  incidentAction: (id: string, action: string, reason: string) => incidentAction(id, action, reason),
  verifyIntegrityIncident: (id: string) => verifyIntegrityIncident(id),
}));

vi.mock('../../data/archival', () => ({
  listIntegrityAlerts: () => listIntegrityAlerts(),
}));

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({
    currentUser: { id: 'u1', role: 'cia', rights: { review_and_approve: true }, orgId: 'org-a' },
    rawEngagements: [{ id: 'eng-1', title: 'A-Eng1' }],
  }),
}));

import { IncidentWizardPanel } from './IncidentWizardPanel';

function incident(over: Partial<IntegrityIncidentRow> = {}): IntegrityIncidentRow {
  return {
    id: 'inc-1',
    alertId: 'al-1',
    kind: 'evidence_hash_mismatch',
    severity: 'warning',
    objectType: 'evidence_file',
    objectId: 'e-1',
    engagementId: 'eng-1',
    expectedHash: 'a'.repeat(64),
    actualHash: 'b'.repeat(64),
    detail: {},
    openedBy: 'u1',
    openedAt: '2026-10-20T00:00:00Z',
    actions: [
      { id: 'a-1', action: 'open', reason: 'opened', outcome: 'open', detail: {}, actorId: 'u1', createdAt: '2026-10-20T00:00:00Z' },
    ],
    ...over,
  };
}

describe('OA-31 incident wizard panel (T6)', () => {
  beforeEach(() => {
    listIntegrityIncidents.mockReset();
    listIntegrityAlerts.mockReset();
    openIntegrityIncident.mockReset();
    incidentAction.mockReset();
    verifyIntegrityIncident.mockReset();
    listIntegrityAlerts.mockResolvedValue([]);
    storageReadyFlag = true;
  });

  it('shows the guided empty state when there are no incidents', async () => {
    listIntegrityIncidents.mockResolvedValue([]);
    render(<IncidentWizardPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-31-empty')).toBeTruthy());
    expect(screen.getByTestId('OA-31-headline').textContent).toContain('No integrity incidents');
  });

  it('says the module is not configured rather than showing a healthy empty panel', async () => {
    storageReadyFlag = false;
    listIntegrityIncidents.mockResolvedValue([]);
    render(<IncidentWizardPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-31-unconfigured')).toBeTruthy());
    expect(screen.queryByTestId('OA-31-empty')).toBeNull();
  });

  it('renders an incident with its derived status, what changed and what it affects', async () => {
    listIntegrityIncidents.mockResolvedValue([incident()]);
    render(<IncidentWizardPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-31-list')).toBeTruthy());
    expect(screen.getByTestId('OA-31-incident-status-inc-1').textContent).toBe('Open');
    expect(screen.getByTestId('OA-31-what-changed').textContent).toContain('Stored evidence no longer matches');
    expect(screen.getByTestId('OA-31-affects').textContent).toContain('A-Eng1');
  });

  it('refuses a step with no reason before calling the database', async () => {
    listIntegrityIncidents.mockResolvedValue([incident()]);
    render(<IncidentWizardPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-31-step-annotate')).toBeTruthy());
    fireEvent.click(screen.getByTestId('OA-31-step-annotate'));
    await waitFor(() => expect(screen.getByTestId('OA-31-error').textContent).toContain('A reason is required'));
    expect(incidentAction).not.toHaveBeenCalled();
  });

  it('runs a step with a reason and shows the computed outcome', async () => {
    listIntegrityIncidents.mockResolvedValue([incident()]);
    incidentAction.mockResolvedValue({ ok: true, outcome: 'still_mismatched' });
    render(<IncidentWizardPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-31-step-restore')).toBeTruthy());
    fireEvent.change(screen.getByTestId('OA-31-reason'), { target: { value: 'trying a restore' } });
    fireEvent.click(screen.getByTestId('OA-31-step-restore'));
    await waitFor(() => expect(screen.getByTestId('OA-31-outcome').textContent).toContain('still_mismatched'));
    expect(incidentAction).toHaveBeenCalledWith('inc-1', 'restore', 'trying a restore');
  });

  it('offers restore for evidence but not for a ledger incident', async () => {
    listIntegrityIncidents.mockResolvedValue([
      incident({ id: 'inc-ledger', objectType: 'ledger', objectId: null, engagementId: null }),
    ]);
    render(<IncidentWizardPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-31-detail')).toBeTruthy());
    expect(screen.queryByTestId('OA-31-step-restore')).toBeNull();
    expect(screen.queryByTestId('OA-31-step-freeze')).toBeNull();
    expect(screen.getByTestId('OA-31-step-escalate')).toBeTruthy();
  });

  it('opens an incident from an alert with no incident yet', async () => {
    listIntegrityIncidents.mockResolvedValue([]);
    listIntegrityAlerts.mockResolvedValue([
      {
        id: 'al-2', kind: 'evidence_hash_mismatch', severity: 'warning', objectType: 'evidence_file',
        objectId: 'e-2', expectedHash: 'a'.repeat(64), actualHash: 'b'.repeat(64),
        raisedAt: '2026-10-28T00:00:00Z', acknowledgedAt: null, acknowledgedBy: null,
      },
    ]);
    openIntegrityIncident.mockResolvedValue({ ok: true, id: 'inc-new' });
    render(<IncidentWizardPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-31-open-al-2')).toBeTruthy());
    fireEvent.click(screen.getByTestId('OA-31-open-al-2'));
    await waitFor(() => expect(openIntegrityIncident).toHaveBeenCalledWith('al-2'));
  });
});
