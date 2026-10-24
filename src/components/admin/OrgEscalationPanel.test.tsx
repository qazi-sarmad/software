import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listRules = vi.fn();
const listEventCatalogue = vi.fn();
const listEscalations = vi.fn();
const saveEscalationRule = vi.fn();

vi.mock('../../data/automation', () => ({
  listRules: (o: string) => listRules(o),
  listEventCatalogue: () => listEventCatalogue(),
}));
vi.mock('../../data/escalation', () => ({
  listEscalations: (o: string) => listEscalations(o),
  saveEscalationRule: (...a: unknown[]) => saveEscalationRule(...a),
}));

import { OrgEscalationPanel } from './OrgEscalationPanel';

describe('OA-13 escalation rules (F12)', () => {
  beforeEach(() => {
    listRules.mockResolvedValue([
      {
        id: 'r1', ruleKey: 'platform.escalation.high_anomaly', name: 'High anomaly',
        eventKey: 'anomaly.raised', conditions: [], enabled: true, isPlatformTemplate: true,
        pausedAt: null, pauseReason: null,
        actions: [{ type: 'escalate', toRoles: ['cia'], recommendation: [
          { field: 'severity', equals: 'critical', recommend: 'Yes', reason: 'A critical anomaly.' },
          { defaultRecommend: 'Needs review', defaultReason: 'Review it.' },
        ] }],
      },
    ]);
    listEventCatalogue.mockResolvedValue([
      { eventKey: 'anomaly.raised', label: 'An anomaly was raised', category: 'anomaly',
        fields: [{ field: 'severity', label: 'Severity', kind: 'select' }] },
    ]);
    listEscalations.mockResolvedValue([]);
    saveEscalationRule.mockResolvedValue({ ok: true });
  });

  it('renders the escalation panel and the platform template', async () => {
    render(<OrgEscalationPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-escalation')).toBeTruthy());
    expect(screen.getByTestId('oa-escalation-rule-platform.escalation.high_anomaly')).toBeTruthy();
  });

  it('opens the editor and shows a deterministic recommendation preview', async () => {
    render(<OrgEscalationPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-escalation-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-escalation-new'));
    expect(screen.getByTestId('oa-escalation-editor')).toBeTruthy();
    expect(screen.getByTestId('oa-escalation-preview').textContent).toContain('Yes');
  });

  it('saves a rule through the escalation RPC and confirms', async () => {
    render(<OrgEscalationPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-escalation-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-escalation-new'));
    fireEvent.click(screen.getByTestId('oa-escalation-save'));
    await waitFor(() => expect(saveEscalationRule).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('oa-escalation-saved')).toBeTruthy());
  });

  it('shows the server message when the feature is not included in the plan', async () => {
    saveEscalationRule.mockResolvedValue({ ok: false, reason: 'This feature is not included in your plan.' });
    render(<OrgEscalationPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-escalation-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-escalation-new'));
    fireEvent.click(screen.getByTestId('oa-escalation-save'));
    await waitFor(() => expect(screen.getByTestId('oa-escalation-result').textContent)
      .toContain('not included in your plan'));
  });

  it('adds and removes a recommendation branch', async () => {
    render(<OrgEscalationPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-escalation-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-escalation-new'));
    expect(screen.getByTestId('oa-escalation-branch-0')).toBeTruthy();
    expect(screen.getByTestId('oa-escalation-branch-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('oa-escalation-branch-remove-0'));
    expect(screen.queryByTestId('oa-escalation-branch-1')).toBeNull();
  });
});
