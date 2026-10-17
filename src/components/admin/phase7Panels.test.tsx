import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listExportsFn = vi.fn();
const logExportFn = vi.fn();
const exportWorkpaperFn = vi.fn();
const exportCapFn = vi.fn();
const exportLedgerFn = vi.fn();
const exportActivityFn = vi.fn();

vi.mock('../../data/exports', () => ({
  listExports: () => listExportsFn(),
  logExport: (...a: unknown[]) => logExportFn(...a),
  exportWorkpaper: (...a: unknown[]) => exportWorkpaperFn(...a),
  exportEngagementBundle: () => Promise.resolve({}),
  exportSiraResults: () => Promise.resolve({}),
  exportAuditPlan: () => Promise.resolve({}),
  exportCapRegister: (...a: unknown[]) => exportCapFn(...a),
  exportLedger: (...a: unknown[]) => exportLedgerFn(...a),
  exportActivityLog: (...a: unknown[]) => exportActivityFn(...a),
  exportFullTenant: () => Promise.resolve({}),
}));

const listJobsFn = vi.fn();
const startImportFn = vi.fn();
const validateImportFn = vi.fn();
const commitImportFn = vi.fn();
const listPriorYearFn = vi.fn();
const importPriorYearItemFn = vi.fn();
const confirmPriorYearFn = vi.fn();

vi.mock('../../data/imports', () => ({
  listImportJobs: () => listJobsFn(),
  startImport: (...a: unknown[]) => startImportFn(...a),
  validateImport: (...a: unknown[]) => validateImportFn(...a),
  commitImport: (...a: unknown[]) => commitImportFn(...a),
  listPriorYearImports: () => listPriorYearFn(),
  unconfirmedPriorYearImports: () => Promise.resolve(0),
  importPriorYearItem: (...a: unknown[]) => importPriorYearItemFn(...a),
  confirmPriorYearItem: (...a: unknown[]) => confirmPriorYearFn(...a),
  revertPriorYearItem: () => Promise.resolve(),
}));

const listActivityFn = vi.fn();
const listArchiveFn = vi.fn();
const archiveFn = vi.fn();

vi.mock('../../data/archival', () => ({
  listActivityLog: (...a: unknown[]) => listActivityFn(...a),
  listArchiveJobs: () => listArchiveFn(),
  archiveActivityPeriod: (...a: unknown[]) => archiveFn(...a),
}));

const userRef = { current: { role: 'cia', rights: { perform_work: true, manage_engagements: true }, orgId: 'org-1' } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { ExportPanel } from './ExportPanel';
import { ImportWizardPanel } from './ImportWizardPanel';
import { ActivityLogPanel } from './ActivityLogPanel';
import { PriorYearImportPanel } from '../plan/PriorYearImportPanel';

const admin = { role: 'cia', rights: { perform_work: true, manage_engagements: true }, orgId: 'org-1' };
const observer = { role: 'observer', rights: { read_only: true } };

/** jsdom's File has no arrayBuffer(); the panel reads raw bytes, so supply a minimal file-like. */
function fakeFile(name: string, text: string) {
  return { name, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
}

describe('Phase 7 UI panels (7G)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = admin as never;
    listExportsFn.mockResolvedValue([]);
    listJobsFn.mockResolvedValue([]);
    listActivityFn.mockResolvedValue([]);
    listArchiveFn.mockResolvedValue([]);
    listPriorYearFn.mockResolvedValue([]);
  });

  describe('ExportPanel', () => {
    it('refuses a session without a working right', () => {
      userRef.current = observer as never;
      render(<ExportPanel />);
      expect(screen.getByTestId('export-denied')).toBeTruthy();
    });

    it('shows a designed empty state for the export history', async () => {
      render(<ExportPanel workpaperId="wp-1" />);
      await waitFor(() => expect(screen.getByTestId('export-history-empty')).toBeTruthy());
    });

    it('exports, records the hash and shows a confirmation chip', async () => {
      exportWorkpaperFn.mockResolvedValue([{ ref: 'R-1', result: 'tick' }]);
      logExportFn.mockResolvedValue('log-1');
      render(<ExportPanel workpaperId="wp-1" />);
      await waitFor(() => expect(screen.getByTestId('export-history-empty')).toBeTruthy());
      fireEvent.click(screen.getByTestId('export-run'));
      await waitFor(() => expect(screen.getByTestId('export-confirmation')).toBeTruthy());
      expect(logExportFn).toHaveBeenCalled();
      expect(screen.getByTestId('export-confirmation-hash').textContent).toContain('…');
    });

    it('reports an inline error when the object needs an id it does not have', async () => {
      render(<ExportPanel />);
      await waitFor(() => expect(screen.getByTestId('export-history-empty')).toBeTruthy());
      fireEvent.click(screen.getByTestId('export-run'));
      await waitFor(() => expect(screen.getByTestId('export-error')).toBeTruthy());
    });
  });

  describe('ImportWizardPanel', () => {
    it('refuses a session without manage_engagements', () => {
      userRef.current = observer as never;
      render(<ImportWizardPanel />);
      expect(screen.getByTestId('import-denied')).toBeTruthy();
    });

    it('starts on the upload step with a designed empty history', async () => {
      render(<ImportWizardPanel />);
      expect(screen.getByTestId('import-upload')).toBeTruthy();
      await waitFor(() => expect(screen.getByTestId('import-history-empty')).toBeTruthy());
    });

    it('validates and shows the valid/invalid counts and inline row errors', async () => {
      startImportFn.mockResolvedValue('job-1');
      validateImportFn.mockResolvedValue({ valid: 2, invalid: 1, errors: [{ row: 3, field: 'risk_id', reason: 'required' }] });
      render(<ImportWizardPanel />);
      const file = fakeFile('rcm.csv', 'risk_id,control_id\nR-1,C-1\n,C-2\n');
      fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [file] } });
      await waitFor(() => expect(screen.getByTestId('import-mapping')).toBeTruthy());
      fireEvent.click(screen.getByTestId('import-validate'));
      await waitFor(() => expect(screen.getByTestId('import-confirm')).toBeTruthy());
      expect(screen.getByTestId('import-valid-count').textContent).toContain('2');
      expect(screen.getByTestId('import-invalid-count').textContent).toContain('1');
      expect(screen.getByTestId('import-errors').textContent).toContain('risk_id');
    });

    it('commits and shows the imported count', async () => {
      startImportFn.mockResolvedValue('job-1');
      validateImportFn.mockResolvedValue({ valid: 1, invalid: 0, errors: [] });
      commitImportFn.mockResolvedValue(1);
      render(<ImportWizardPanel />);
      const file = fakeFile('rcm.csv', 'risk_id\nR-1\n');
      fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [file] } });
      await waitFor(() => expect(screen.getByTestId('import-mapping')).toBeTruthy());
      fireEvent.click(screen.getByTestId('import-validate'));
      await waitFor(() => expect(screen.getByTestId('import-confirm')).toBeTruthy());
      fireEvent.click(screen.getByTestId('import-commit'));
      await waitFor(() => expect(screen.getByTestId('import-done')).toBeTruthy());
    });
  });

  describe('PriorYearImportPanel', () => {
    it('shows a designed empty state when no prior-year material exists', async () => {
      render(<PriorYearImportPanel engagementId="e-1" sourceEngagements={[{ id: 'e-0', label: 'FY2025' }]} />);
      await waitFor(() => expect(screen.getByTestId('prior-year-empty')).toBeTruthy());
    });

    it('hides the import controls for a session without manage_engagements', async () => {
      userRef.current = observer as never;
      render(<PriorYearImportPanel engagementId="e-1" sourceEngagements={[{ id: 'e-0', label: 'FY2025' }]} />);
      await waitFor(() => expect(screen.getByTestId('prior-year-empty')).toBeTruthy());
      expect(screen.queryByTestId('prior-year-controls')).toBeNull();
    });

    it('imports an item and shows the Imported - confirm badge', async () => {
      importPriorYearItemFn.mockResolvedValue(undefined);
      listPriorYearFn
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 'py-1', itemType: 'risk_control_mapping', sourceEngagementId: 'e-0', status: 'imported_confirm', importedAt: '2026-01-01T00:00:00Z' }]);
      render(<PriorYearImportPanel engagementId="e-1" sourceEngagements={[{ id: 'e-0', label: 'FY2025' }]} />);
      await waitFor(() => expect(screen.getByTestId('prior-year-empty')).toBeTruthy());
      fireEvent.click(screen.getByTestId('prior-year-import'));
      await waitFor(() => expect(screen.getByTestId('prior-year-item-py-1')).toBeTruthy());
      expect(screen.getByTestId('prior-year-status-py-1').textContent).toContain('confirm');
    });

    it('confirms an imported item', async () => {
      confirmPriorYearFn.mockResolvedValue(undefined);
      listPriorYearFn
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 'py-1', itemType: 'scope', sourceEngagementId: 'e-0', status: 'imported_confirm', importedAt: '2026-01-01T00:00:00Z' }]);
      render(<PriorYearImportPanel engagementId="e-1" sourceEngagements={[{ id: 'e-0', label: 'FY2025' }]} />);
      await waitFor(() => expect(screen.getByTestId('prior-year-empty')).toBeTruthy());
      fireEvent.click(screen.getByTestId('prior-year-import'));
      await waitFor(() => expect(screen.getByTestId('prior-year-confirm-py-1')).toBeTruthy());
      fireEvent.click(screen.getByTestId('prior-year-confirm-py-1'));
      await waitFor(() => expect(confirmPriorYearFn).toHaveBeenCalledWith('py-1'));
    });
  });

  describe('ActivityLogPanel', () => {
    it('shows a designed empty state when there is no activity', async () => {
      render(<ActivityLogPanel />);
      await waitFor(() => expect(screen.getByTestId('activity-empty')).toBeTruthy());
    });

    it('renders activity rows and filters by action', async () => {
      listActivityFn.mockResolvedValue([
        { id: 'a1', actorId: 'u1', action: 'sign_off_workpaper', objectType: 'workpaper', objectId: 'wp-1', detail: {}, ts: '2026-01-01T00:00:00Z' },
        { id: 'a2', actorId: 'u1', action: 'create_observation', objectType: 'observation', objectId: 'obs-1', detail: {}, ts: '2026-01-02T00:00:00Z' },
      ]);
      render(<ActivityLogPanel />);
      await waitFor(() => expect(screen.getByTestId('activity-table')).toBeTruthy());
      expect(screen.getByTestId('activity-row-a1')).toBeTruthy();
      fireEvent.change(screen.getByTestId('activity-filter'), { target: { value: 'create' } });
      expect(screen.queryByTestId('activity-row-a1')).toBeNull();
      expect(screen.getByTestId('activity-row-a2')).toBeTruthy();
    });

    it('shows the archived notice after a successful archival', async () => {
      archiveFn.mockResolvedValue({ ok: true });
      listArchiveFn
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 'j1', periodStart: '2025-12-01', periodEnd: '2025-12-31', archivedRowCount: 5, storagePath: 's', contentHash: 'abc123def4567890', status: 'done', createdAt: '2026-01-01T00:00:00Z' }]);
      render(<ActivityLogPanel />);
      await waitFor(() => expect(screen.getByTestId('archive-jobs-empty')).toBeTruthy());
      fireEvent.click(screen.getByTestId('activity-archive'));
      await waitFor(() => expect(screen.getByTestId('activity-archived-notice')).toBeTruthy());
    });
  });
});
