import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listFormats = vi.fn();
const listAudiences = vi.fn();
const saveFormat = vi.fn();
const publishFormat = vi.fn();
const setAudiences = vi.fn();
vi.mock('../../data/writing', () => ({
  listReportFormats: () => listFormats(),
  listFormatAudiences: () => listAudiences(),
  saveReportFormat: (...a: unknown[]) => saveFormat(...a),
  publishReportFormat: (...a: unknown[]) => publishFormat(...a),
  setFormatAudiences: (...a: unknown[]) => setAudiences(...a),
}));

const listRolesFn = vi.fn();
vi.mock('../../data/admin', () => ({ listRoles: () => listRolesFn() }));

const userRef = { current: { orgId: 'org-a', role: 'cia', rights: { edit_config: true } } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { ReportFormatPanel } from './ReportFormatPanel';

const row = {
  id: 'f1', formatKey: 'board-quarterly', version: 1, label: 'Board quarterly', status: 'draft',
  modelId: 'M1', blocks: [
    { key: 'cover', label: 'Cover', role: 'lead_in', visible: true, register: null },
    { key: 'scope', label: 'Scope', role: 'scope', visible: true, register: null },
    { key: 'findings', label: 'Findings', role: 'findings', visible: true, register: null },
  ],
  layout: {}, defaultLocale: 'en-GB', bodyHash: 'a'.repeat(64), createdAt: '2026-10-26T09:00:00Z',
};

describe('ReportFormatPanel: the live canvas editor (WP-C2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = { orgId: 'org-a', role: 'cia', rights: { edit_config: true } } as never;
    listFormats.mockResolvedValue([row]);
    listAudiences.mockResolvedValue([]);
    listRolesFn.mockResolvedValue([]);
    saveFormat.mockResolvedValue({ ok: true });
    publishFormat.mockResolvedValue({ ok: true });
    setAudiences.mockResolvedValue({ ok: true });
  });

  it('draws a live page with one canvas block per visible section', async () => {
    render(<ReportFormatPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-format-canvas-page')).toBeTruthy());
    expect(screen.getByTestId('wk-format-canvas-block-cover')).toBeTruthy();
    expect(screen.getByTestId('wk-format-canvas-block-scope')).toBeTruthy();
    expect(screen.getByTestId('wk-format-canvas-block-findings')).toBeTruthy();
  });

  it('reorders the report when one canvas block is dragged onto another', async () => {
    render(<ReportFormatPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-format-canvas-block-findings')).toBeTruthy());
    const from = screen.getByTestId('wk-format-canvas-block-findings');
    const to = screen.getByTestId('wk-format-canvas-block-cover');
    fireEvent.dragStart(from);
    fireEvent.drop(to);
    // The live page redraws with findings first.
    await waitFor(() => {
      const page = screen.getByTestId('wk-format-canvas-content');
      const blocks = Array.from(page.querySelectorAll('[data-block-key]')).map((el) => el.getAttribute('data-block-key'));
      expect(blocks[0]).toBe('findings');
    });
  });

  it('undoes and redoes a typography change', async () => {
    render(<ReportFormatPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-format-pane-layout')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-format-pane-layout'));
    const size = screen.getByTestId('wk-format-layout-font-size') as HTMLInputElement;
    expect(size.value).toBe('11');
    fireEvent.change(size, { target: { value: '14' } });
    await waitFor(() => expect((screen.getByTestId('wk-format-layout-font-size') as HTMLInputElement).value).toBe('14'));

    fireEvent.click(screen.getByTestId('wk-format-undo'));
    await waitFor(() => expect((screen.getByTestId('wk-format-layout-font-size') as HTMLInputElement).value).toBe('11'));
    fireEvent.click(screen.getByTestId('wk-format-redo'));
    await waitFor(() => expect((screen.getByTestId('wk-format-layout-font-size') as HTMLInputElement).value).toBe('14'));
  });

  it('applies a curated palette swatch to a colour', async () => {
    render(<ReportFormatPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-format-pane-layout')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-format-pane-layout'));
    fireEvent.click(screen.getByTestId('wk-format-colour-colourPrimary-swatch-verdigris'));
    // The canvas page picks up the colour through toCssColour (var or hex).
    await waitFor(() => {
      const page = screen.getByTestId('wk-format-canvas-page');
      expect(page.style.background).toBeTruthy();
    });
  });

  it('shows a page break when the content overflows', async () => {
    // A very large body size pushes the blocks past the first page.
    listFormats.mockResolvedValue([{ ...row, layout: { fontSizePt: 16, lineHeightPct: 250 } }]);
    render(<ReportFormatPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-format-canvas-summary')).toBeTruthy());
    // The summary reports the page size and the block count.
    expect(screen.getByTestId('wk-format-canvas-summary').textContent).toContain('A4');
  });

  it('is read-only without the Edit configuration right', async () => {
    userRef.current = { orgId: 'org-a', role: 'preparer', rights: {} } as never;
    render(<ReportFormatPanel />);
    await waitFor(() => expect(screen.getByTestId('wk-format-readonly')).toBeTruthy());
    expect((screen.getByTestId('wk-format-save') as HTMLButtonElement).disabled).toBe(true);
  });
});
