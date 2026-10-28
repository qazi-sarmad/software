import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listReportTemplates = vi.fn();
const saveReportTemplate = vi.fn();

vi.mock('../../data/governance', () => ({
  REPORT_SECTION_IDS: ['executive_summary', 'scope', 'findings', 'opinion', 'appendices'],
  listReportTemplates: () => listReportTemplates(),
  saveReportTemplate: (...a: unknown[]) => saveReportTemplate(...a),
}));

const userRef = { current: { id: 'u1', role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { ReportTemplatePanel } from './ReportTemplatePanel';

describe('OA-22 report template (Phase 3.4)', () => {
  beforeEach(() => {
    userRef.current = { id: 'u1', role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } as never;
    listReportTemplates.mockResolvedValue([]);
    saveReportTemplate.mockResolvedValue({ ok: true });
  });

  it('shows the default section plan when no template is saved', async () => {
    render(<ReportTemplatePanel />);
    await waitFor(() => expect(screen.getByTestId('report-template-panel')).toBeTruthy());
    for (const id of ['executive_summary', 'scope', 'findings', 'opinion', 'appendices']) {
      expect(screen.getByTestId(`report-template-section-${id}`)).toBeTruthy();
    }
  });

  it('loads the saved template order from the database', async () => {
    listReportTemplates.mockResolvedValue([
      { id: 't1', modelId: 'M1', version: 2, title: 'Lean', sections: [{ id: 'opinion', order: 1 }, { id: 'findings', order: 2 }], updatedAt: null },
    ]);
    render(<ReportTemplatePanel />);
    await waitFor(() => expect(screen.getByTestId('report-template-version').textContent).toContain('version 2'));
    const list = screen.getByTestId('report-template-sections');
    expect(list.textContent).toContain('Overall Opinion');
    expect(screen.queryByTestId('report-template-section-scope')).toBeNull();
  });

  it('removes and re-adds a section, then saves the new plan through the RPC', async () => {
    render(<ReportTemplatePanel />);
    await waitFor(() => expect(screen.getByTestId('report-template-remove-scope')).toBeTruthy());
    fireEvent.click(screen.getByTestId('report-template-remove-scope'));
    expect(screen.queryByTestId('report-template-section-scope')).toBeNull();
    fireEvent.click(screen.getByTestId('report-template-add-scope'));
    expect(screen.getByTestId('report-template-section-scope')).toBeTruthy();
    fireEvent.click(screen.getByTestId('report-template-save'));
    await waitFor(() => expect(saveReportTemplate).toHaveBeenCalled());
    expect(saveReportTemplate.mock.calls[0][0]).toBe('M1');
    expect(saveReportTemplate.mock.calls[0][2]).toContain('scope');
    await waitFor(() => expect(screen.getByTestId('report-template-result').textContent).toContain('saved'));
  });

  it('reports a refusal from the database without losing the draft', async () => {
    saveReportTemplate.mockResolvedValue({ ok: false, reason: 'unknown section id: made_up' });
    render(<ReportTemplatePanel />);
    await waitFor(() => expect(screen.getByTestId('report-template-save')).toBeTruthy());
    fireEvent.click(screen.getByTestId('report-template-save'));
    await waitFor(() => expect(screen.getByTestId('report-template-save-error').textContent).toContain('unknown section id'));
  });

  it('refuses a user without edit_config', () => {
    userRef.current = { id: 'u2', role: 'observer', rights: {}, orgId: 'org-a' } as never;
    render(<ReportTemplatePanel />);
    expect(screen.getByTestId('report-template-denied')).toBeTruthy();
  });
});
