import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getPatternSettings = vi.fn();
const listPatternFindings = vi.fn();
const savePatternSettings = vi.fn();

vi.mock('../../data/patterns', async (orig) => {
  const actual = await orig<typeof import('../../data/patterns')>();
  return {
    ...actual,
    getPatternSettings: (o: string) => getPatternSettings(o),
    listPatternFindings: (o: string) => listPatternFindings(o),
    savePatternSettings: (...a: unknown[]) => savePatternSettings(...a),
  };
});

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: { orgId: 'org-a', role: 'cia' } }),
}));

// vi.mock is hoisted above the imports, so the mutable holder must be hoisted too.
const { rights } = vi.hoisted(() => ({ rights: { view_insights: true, edit_config: true } as Record<string, boolean> }));
vi.mock('../../lib/rights', () => ({ hasRight: (_u: unknown, k: string) => rights[k] !== false }));

import { PatternsPanel } from './PatternsPanel';

const FINDINGS = [
  {
    findingId: 'f1', entityId: 'e1', entityName: 'Lahore Plant', year: 2024, severity: 'high',
    title: 'Segregation of duties gap', conditionText: 'One user approves and pays invoices.',
    riskText: 'Fraudulent payment.', effectText: 'Loss of cash.',
    controlTags: ['Segregation of duties'], riskTags: [], categoryTags: ['Procurement'], entityType: 'process',
  },
  {
    findingId: 'f2', entityId: 'e1', entityName: 'Lahore Plant', year: 2024, severity: 'high',
    title: 'Segregation of duties gap again', conditionText: 'One user approves and pays invoices too.',
    riskText: 'Fraudulent payment risk.', effectText: 'Loss of cash again.',
    controlTags: ['Segregation of duties'], riskTags: [], categoryTags: ['Procurement'], entityType: 'process',
  },
  {
    findingId: 'f3', entityId: 'e2', entityName: 'Payroll', year: 2023, severity: 'medium',
    title: 'Backup restore untested', conditionText: 'Restore never rehearsed.',
    riskText: 'Data loss.', effectText: 'Downtime.',
    controlTags: ['Backups'], riskTags: [], categoryTags: ['Technology'], entityType: 'process',
  },
];

describe('WK-10 / OA-21 patterns (F15)', () => {
  beforeEach(() => {
    rights.view_insights = true;
    rights.edit_config = true;
    getPatternSettings.mockResolvedValue({
      similarityThreshold: 0.4, minClusterSize: 2, yearsBack: 5, severities: [], visibilityRight: 'view_insights',
    });
    listPatternFindings.mockResolvedValue(FINDINGS);
    savePatternSettings.mockResolvedValue({ ok: true });
  });

  it('renders the clusters view and links each finding', async () => {
    render(<PatternsPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-patterns')).toBeTruthy());
    expect(screen.getByTestId('wk-patterns-clusters')).toBeTruthy();
    // f1 and f2 share a control tag and text, so they cluster; f3 does not.
    expect(screen.getByTestId('wk-patterns-finding-f1')).toBeTruthy();
    expect(screen.getByTestId('wk-patterns-finding-f2')).toBeTruthy();
    expect(screen.getByTestId('wk-patterns-unclustered')).toBeTruthy();
  });

  it('opens the original finding when a cluster member is clicked', async () => {
    const onOpenFinding = vi.fn();
    render(<PatternsPanel onOpenFinding={onOpenFinding} />);
    await waitFor(() => expect(screen.getByTestId('wk-patterns-finding-f1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-patterns-finding-f1'));
    expect(onOpenFinding).toHaveBeenCalledWith('f1');
  });

  it('plots the heat map by year and drills into a cell', async () => {
    const onOpenFinding = vi.fn();
    render(<PatternsPanel onOpenFinding={onOpenFinding} />);
    await waitFor(() => expect(screen.getByTestId('wk-patterns-tab-heatmap')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-patterns-tab-heatmap'));
    await waitFor(() => expect(screen.getByTestId('wk-patterns-heatmap')).toBeTruthy());
    expect(screen.getByTestId('wk-patterns-cell-count-e1-2024').textContent).toBe('2');
    fireEvent.click(screen.getByTestId('wk-patterns-cell-e1-2024'));
    expect(onOpenFinding).toHaveBeenCalledWith('f1');
  });

  it('draws the deterministic graph', async () => {
    render(<PatternsPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-patterns-tab-graph')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-patterns-tab-graph'));
    await waitFor(() => expect(screen.getByTestId('wk-patterns-node-f1')).toBeTruthy());
  });

  it('saves the settings through the data module', async () => {
    render(<PatternsPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-patterns-tab-settings')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-patterns-tab-settings'));
    await waitFor(() => expect(screen.getByTestId('oa-patterns-config')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-patterns-threshold'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByTestId('oa-patterns-save'));
    await waitFor(() => expect(savePatternSettings).toHaveBeenCalled());
    expect(savePatternSettings.mock.calls[0][0]).toBe('org-a');
    expect(savePatternSettings.mock.calls[0][1]).toMatchObject({ similarityThreshold: 0.5 });
  });

  it('shows the plain notice when the caller holds neither right', async () => {
    rights.view_insights = false;
    rights.edit_config = false;
    render(<PatternsPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-patterns-denied')).toBeTruthy());
    // Neither the data nor the settings RPC is attempted for such a caller.
    expect(getPatternSettings).not.toHaveBeenCalled();
    expect(listPatternFindings).not.toHaveBeenCalled();
  });

  it('falls back to the documented defaults when the settings read is refused', async () => {
    // An Audit Manager holds view_insights but not edit_config, so pattern_settings_get is refused.
    // That is not an error for the data: the panel renders with the documented defaults.
    rights.edit_config = false;
    getPatternSettings.mockRejectedValue(new Error('not allowed: the caller cannot view insight settings'));
    render(<PatternsPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-patterns')).toBeTruthy());
    expect(screen.queryByTestId('wk-patterns-error')).toBeNull();
    expect(screen.getByTestId('wk-patterns-clusters')).toBeTruthy();
  });
});
