import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { holdToConfirm } from '../../test/holdToConfirm';

const listPops = vi.fn();
const lockPop = vi.fn();
const listRules = vi.fn();
const getSize = vi.fn();
const compute = vi.fn();
const getSamp = vi.fn();
const getCoverage = vi.fn();
const getPrec = vi.fn();
const getTested = vi.fn();
const waive = vi.fn();
const listRowsFn = vi.fn();
const getWp = vi.fn();
const recordFn = vi.fn();
const signOffWp = vi.fn();
const listResults = vi.fn();
const raise = vi.fn();
const listRecords = vi.fn();
const importRowsFn = vi.fn();
const listRowsPage = vi.fn();

vi.mock('../../data/population', () => ({
  listPopulations: () => listPops(),
  listPopulationRecords: (...a: unknown[]) => listRecords(...a),
  listPopulationRows: (...a: unknown[]) => listRowsPage(...a),
  importPopulationRows: (...a: unknown[]) => importRowsFn(...a),
  lockPopulation: (...a: unknown[]) => lockPop(...a),
  registerPopulation: () => Promise.resolve({ ok: true }),
  sha256Hex: () => Promise.resolve('deadbeef'),
}));
vi.mock('../../data/sampling', () => ({
  listSamplingRules: () => listRules(),
  getSampleSize: () => getSize(),
  computeSample: (...a: unknown[]) => compute(...a),
  lockSample: () => Promise.resolve({ ok: true }),
  getSample: () => getSamp(),
  getValueCoverage: () => getCoverage(),
  getSamplePrecision: () => getPrec(),
  listSampleTestedRows: () => getTested(),
  waiveValueCoverage: (...a: unknown[]) => waive(...a),
}));
vi.mock('../../data/rowTesting', () => ({
  listRows: () => listRowsFn(),
  getWorkpaper: () => getWp(),
  recordWorkpaperRow: (...a: unknown[]) => recordFn(...a),
  recordRow: (...a: unknown[]) => recordFn(...a),
  signOffWorkpaper: (...a: unknown[]) => signOffWp(...a),
  reopenWorkpaper: () => Promise.resolve({ ok: true }),
}));
vi.mock('../../data/analytics', () => ({
  listAnalysisResults: () => listResults(),
  raiseFinding: (...a: unknown[]) => raise(...a),
}));
vi.mock('../../data/db', () => ({ getClient: () => null }));

const userRef = { current: { role: 'cia', rights: { perform_work: true, review_and_approve: true } } };
const createWp = vi.fn();
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: userRef.current, createWorkpaper: (...a: unknown[]) => createWp(...a) }),
}));

import { PopulationPanel } from '../audit/PopulationPanel';
import { SamplingPanel } from '../audit/SamplingPanel';
import { RowTestingPanel } from '../audit/RowTestingPanel';
import { AnalystEnginePanel } from '../audit/AnalystEnginePanel';
import { WorkpaperCreatePanel } from '../audit/WorkpaperCreatePanel';

const preparer = { role: 'cia', rights: { perform_work: true, review_and_approve: true } };

describe('Phase 4 UI panels (4I)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = preparer as never;
    listPops.mockResolvedValue([]);
    lockPop.mockResolvedValue({ ok: true });
    listRules.mockResolvedValue([]);
    getSize.mockResolvedValue(20);
    compute.mockResolvedValue({ ok: true });
    getSamp.mockResolvedValue(null);
    getCoverage.mockResolvedValue(null);
    getPrec.mockResolvedValue(null);
    getTested.mockResolvedValue([]);
    waive.mockResolvedValue({ ok: true });
    listRowsFn.mockResolvedValue([]);
    getWp.mockResolvedValue(null);
    recordFn.mockResolvedValue({ ok: true });
    signOffWp.mockResolvedValue({ ok: true });
    listResults.mockResolvedValue([]);
    raise.mockResolvedValue({ ok: true });
    listRecords.mockResolvedValue([]);
    importRowsFn.mockResolvedValue({ ok: true });
    listRowsPage.mockResolvedValue([]);
    createWp.mockResolvedValue({ ok: true, id: 'w-new' });
  });

  it('population: designed empty state and no population is sampled', async () => {
    render(<PopulationPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('population-empty')).toBeTruthy());
    expect(screen.getByTestId('population-dropzone')).toBeTruthy();
  });

  it('population: lists a verified population with a lock action', async () => {
    listPops.mockResolvedValue([
      { id: 'p1', engagementId: 'e1', workpaperId: null, filename: 'gl.csv', rowCount: 500, sha256: 'abc', status: 'verified', verifiedAt: null, verifiedBy: null },
    ]);
    render(<PopulationPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('population-row-p1')).toBeTruthy());
    expect(screen.getByTestId('population-status-p1').textContent).toBe('verified');
    vi.useFakeTimers();
    holdToConfirm(screen.getByTestId('population-lock-p1'));
    vi.useRealTimers();
    await waitFor(() => expect(lockPop).toHaveBeenCalledWith('p1'));
  });

  it('population: profiles a locked population with the pure populationProfile rule', async () => {
    listPops.mockResolvedValue([
      { id: 'p1', engagementId: 'e1', workpaperId: null, filename: 'gl.csv', rowCount: 3, sha256: 'abc', status: 'locked', verifiedAt: null, verifiedBy: null },
    ]);
    listRecords.mockResolvedValue([
      { rowRef: 1, amountCents: 100, date: '2026-01-01', category: 'sales' },
      { rowRef: 2, amountCents: 100, date: '2026-01-01', category: 'sales' },
      { rowRef: 3, amountCents: null, date: '2026-01-02', category: 'sales' },
    ]);
    render(<PopulationPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('population-row-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('population-profile-p1'));
    await waitFor(() => expect(listRecords).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByTestId('population-profile-view-p1')).toBeTruthy());
    const summary = screen.getByTestId('population-profile-summary-p1').textContent ?? '';
    expect(summary).toContain('3 rows');
    expect(summary).toContain('2 with a value');
    expect(summary).toContain('1 missing a value');
    expect(summary).toContain('1 duplicate');
    expect(screen.getByTestId('population-profile-flags-p1').textContent).toContain('duplicates');
  });

  it('population: stores a pasted block positionally through importPopulationRows', async () => {
    listPops.mockResolvedValue([
      { id: 'p1', engagementId: 'e1', workpaperId: null, filename: 'gl.csv', rowCount: 0, sha256: 'abc', status: 'verified', verifiedAt: null, verifiedBy: null },
    ]);
    render(<PopulationPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('population-row-p1')).toBeTruthy());

    fireEvent.change(screen.getByTestId('population-paste-input'), {
      target: { value: 'ref,amount\n1,100\n2,250\n' },
    });
    expect(screen.getByTestId('population-paste-columns').textContent).toContain('ref | amount');
    expect(screen.getByTestId('population-paste-count').textContent).toContain('2 row(s) parsed');

    fireEvent.change(screen.getByTestId('population-paste-target'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByTestId('population-paste-import'));

    await waitFor(() => expect(importRowsFn).toHaveBeenCalledWith(
      'p1',
      [
        { row_ref: 1, data: { ref: '1', amount: '100' } },
        { row_ref: 2, data: { ref: '2', amount: '250' } },
      ],
      false,
    ));
  });

  it('population: reports a line below the header width rather than storing it', async () => {
    listPops.mockResolvedValue([
      { id: 'p1', engagementId: 'e1', workpaperId: null, filename: 'gl.csv', rowCount: 0, sha256: 'abc', status: 'verified', verifiedAt: null, verifiedBy: null },
    ]);
    render(<PopulationPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('population-row-p1')).toBeTruthy());
    fireEvent.change(screen.getByTestId('population-paste-input'), {
      target: { value: 'ref,amount\n1,100\n2\n' },
    });
    expect(screen.getByTestId('population-paste-count').textContent).toContain('1 row(s) parsed');
    expect(screen.getByTestId('population-paste-errors').textContent).toContain('Line 3');
  });

  it('population: reads the stored rows back through listPopulationRows', async () => {
    listPops.mockResolvedValue([
      { id: 'p1', engagementId: 'e1', workpaperId: null, filename: 'gl.csv', rowCount: 2, sha256: 'abc', status: 'verified', verifiedAt: null, verifiedBy: null },
    ]);
    listRowsPage.mockResolvedValue([
      { rowRef: 1, data: { ref: '1', amount: '100' } },
      { rowRef: 2, data: { ref: '2', amount: '250' } },
    ]);
    render(<PopulationPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('population-row-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('population-rows-p1'));
    await waitFor(() => expect(listRowsPage).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByTestId('population-rows-view-p1')).toBeTruthy());
    expect(screen.getByTestId('population-row-item-p1-2').textContent).toContain('250');
  });

  it('population: an empty stored-row set says so rather than showing a wall of zeros', async () => {
    listPops.mockResolvedValue([
      { id: 'p1', engagementId: 'e1', workpaperId: null, filename: 'gl.csv', rowCount: 0, sha256: 'abc', status: 'verified', verifiedAt: null, verifiedBy: null },
    ]);
    listRowsPage.mockResolvedValue([]);
    render(<PopulationPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('population-row-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('population-rows-p1'));
    await waitFor(() => expect(screen.getByTestId('population-rows-empty-p1')).toBeTruthy());
  });

  it('sampling: shows a designed empty rule state and a seed preview', async () => {
    render(<SamplingPanel workpaperId="w1" />);
    await waitFor(() => expect(screen.getByTestId('sampling-rules-empty')).toBeTruthy());
    expect(screen.getByTestId('sampling-seed-preview').textContent).toMatch(/sha256/);
  });

  it('sampling: computes a system sample', async () => {
    render(<SamplingPanel workpaperId="w1" />);
    await waitFor(() => expect(screen.getByTestId('sampling-compute')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sampling-compute'));
    await waitFor(() => expect(compute).toHaveBeenCalledWith('w1', 'system', undefined));
  });

  it('sampling: a pasted id list becomes {row_ref} items and a non-integer line is reported', async () => {
    render(<SamplingPanel workpaperId="w1" />);
    await waitFor(() => expect(screen.getByTestId('sampling-compute')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sampling-mode-auditor_paste'));
    fireEvent.change(screen.getByTestId('sampling-paste'), { target: { value: '1\n2\nheader\n' } });
    expect(screen.getByTestId('sampling-paste-count').textContent).toContain('2 items parsed');
    expect(screen.getByTestId('sampling-paste-invalid').textContent).toContain('3');
    fireEvent.click(screen.getByTestId('sampling-compute'));
    await waitFor(() => expect(compute).toHaveBeenCalledWith('w1', 'auditor_paste', [
      { row_ref: 1 }, { row_ref: 2 },
    ]));
  });

  it('sampling: shows the method, the calculation and the tested rows (2.7/2.8)', async () => {
    getSamp.mockResolvedValue({
      id: 's1', workpaperId: 'w1', populationId: 'p1', mode: 'system', seed: 'abc',
      sizeFloor: 20, sampleRows: [{ row_ref: 1 }], lockedAt: '2026-01-01', lockedBy: 'u1',
      method: 'systematic', calculation: { method: 'systematic', mode: 'system', formula: 'every k-th row', inputs: {}, result: { size: 1 } },
    });
    getCoverage.mockResolvedValue({ highValueRows: [1], included: [1], missing: [], waived: [], covered: true });
    getPrec.mockResolvedValue({ n: 20, k: 1, confidence: 0.95, lower: 0.001, upper: 0.279 });
    getTested.mockResolvedValue([{ id: 'r1', rowRef: '1', result: 'tick', rationale: null, exceptionFlag: false, reviewedResult: null }]);
    render(<SamplingPanel workpaperId="w1" />);
    await waitFor(() => expect(screen.getByTestId('sampling-method')).toBeTruthy());
    expect(screen.getByTestId('sampling-method').textContent).toMatch(/systematic/);
    expect(screen.getByTestId('sampling-calculation').textContent).toMatch(/every k-th row/);
    expect(screen.getByTestId('sampling-tested-row-1')).toBeTruthy();
    expect(screen.getByTestId('sampling-precision').textContent).toMatch(/Clopper-Pearson/);
  });

  it('sampling: a missing high-value item is named and can be waived (2.9)', async () => {
    getSamp.mockResolvedValue({
      id: 's1', workpaperId: 'w1', populationId: 'p1', mode: 'auditor_paste', seed: null,
      sizeFloor: 20, sampleRows: [{ row_ref: 2 }], lockedAt: null, lockedBy: null,
      method: 'random', calculation: null,
    });
    getCoverage.mockResolvedValue({ highValueRows: [1], included: [], missing: [1], waived: [], covered: false });
    render(<SamplingPanel workpaperId="w1" />);
    await waitFor(() => expect(screen.getByTestId('sampling-coverage-status')).toBeTruthy());
    expect(screen.getByTestId('sampling-coverage-status').textContent).toMatch(/neither in the sample nor waived/);
    const waiveBtn = screen.getByTestId('sampling-waive-1') as HTMLButtonElement;
    expect(waiveBtn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('sampling-waive-reason'), { target: { value: 'Immaterial: tested elsewhere in the cash workpaper.' } });
    expect((screen.getByTestId('sampling-waive-1') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('sampling-waive-1'));
    await waitFor(() => expect(waive).toHaveBeenCalledWith('s1', 1, 'Immaterial: tested elsewhere in the cash workpaper.'));
  });

  it('row testing: designed empty state', async () => {
    render(<RowTestingPanel workpaperId="w1" />);
    await waitFor(() => expect(screen.getByTestId('rowtesting-empty')).toBeTruthy());
  });

  it('row testing: a cross needs a rationale before it is recorded', async () => {
    listRowsFn.mockResolvedValue([
      { id: 'r1', workpaperId: 'w1', rowRef: '1', result: null, rationale: null, exceptionFlag: false, preparedBy: null, preparedAt: null, reviewedBy: null, reviewedAt: null, reviewedResult: null },
    ]);
    getWp.mockResolvedValue({ id: 'w1', engagementId: 'e1', stage: 'testing', status: 'open', preparedAt: null, preparedBy: null, signedOffAt: null, signedOffBy: null });
    render(<RowTestingPanel workpaperId="w1" />);
    await waitFor(() => expect(screen.getByTestId('rowtesting-cross-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('rowtesting-cross-1'));
    await waitFor(() => expect(screen.getByTestId('rowtesting-error')).toBeTruthy());
    expect(recordFn).not.toHaveBeenCalled();
  });

  it('row testing: pre-flight lists an incomplete row and blocks sign-off', async () => {
    listRowsFn.mockResolvedValue([
      { id: 'r1', workpaperId: 'w1', rowRef: '1', result: null, rationale: null, exceptionFlag: false, preparedBy: null, preparedAt: null, reviewedBy: null, reviewedAt: null, reviewedResult: null },
    ]);
    getWp.mockResolvedValue({ id: 'w1', engagementId: 'e1', stage: 'testing', status: 'open', preparedAt: null, preparedBy: null, signedOffAt: null, signedOffBy: null });
    render(<RowTestingPanel workpaperId="w1" />);
    await waitFor(() => expect(screen.getByTestId('rowtesting-preflight')).toBeTruthy());
    expect((screen.getByTestId('rowtesting-signoff') as HTMLButtonElement).disabled).toBe(true);
  });

  it('analyst: designed empty state', async () => {
    render(<AnalystEnginePanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('analyst-empty')).toBeTruthy());
  });

  // Phase 6 (G1): before the workpaper-creation path existed, the sampling and row-testing panels
  // were gated on workpapers[0] and simply vanished in production. They must render a designed empty
  // state when the engagement has no workpaper, and never disappear.
  it('sampling: renders a designed no-workpaper state instead of vanishing', async () => {
    render(<SamplingPanel workpaperId={null} />);
    await waitFor(() => expect(screen.getByTestId('sampling-panel')).toBeTruthy());
    expect(screen.getByTestId('sampling-no-workpaper')).toBeTruthy();
    expect(screen.queryByTestId('sampling-compute')).toBeNull();
  });

  it('row testing: renders a designed no-workpaper state instead of vanishing', async () => {
    render(<RowTestingPanel workpaperId={null} />);
    await waitFor(() => expect(screen.getByTestId('rowtesting-panel')).toBeTruthy());
    expect(screen.getByTestId('rowtesting-no-workpaper')).toBeTruthy();
  });

  it('workpaper create: opens the form, requires a title and calls the write path', async () => {
    render(<WorkpaperCreatePanel engagementId="e1" />);
    fireEvent.click(screen.getByTestId('workpaper-create-open'));
    const submit = screen.getByTestId('workpaper-create-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('workpaper-title'), { target: { value: 'Cash count' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(createWp).toHaveBeenCalledWith('e1', 'Cash count', null));
  });

  it('workpaper create: a refusal is shown inline, not swallowed', async () => {
    createWp.mockResolvedValue({ ok: false, reason: 'testing_locked: planning must be signed off' });
    render(<WorkpaperCreatePanel engagementId="e1" />);
    fireEvent.click(screen.getByTestId('workpaper-create-open'));
    fireEvent.change(screen.getByTestId('workpaper-title'), { target: { value: 'Cash count' } });
    fireEvent.click(screen.getByTestId('workpaper-create-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('workpaper-create-error').textContent).toMatch(/testing_locked/)
    );
  });

  it('workpaper create: a caller without perform_work sees the reason, not the form', async () => {
    userRef.current = { role: 'auditee', rights: { perform_work: false } } as never;
    render(<WorkpaperCreatePanel engagementId="e1" />);
    expect((screen.getByTestId('workpaper-create-open') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('workpaper-create-reason')).toBeTruthy();
  });

  it('analyst: expands a check and raises a finding from a row', async () => {
    listResults.mockResolvedValue([
      { id: 'a1', engagementId: 'e1', workpaperId: null, populationId: 'p1', ruleId: 'duplicates', params: {}, rowRefs: [3, 4], createdAt: '2026-01-01' },
    ]);
    render(<AnalystEnginePanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('analyst-check-duplicates')).toBeTruthy());
    fireEvent.click(screen.getByTestId('analyst-check-duplicates').querySelector('button')!);
    await waitFor(() => expect(screen.getByTestId('analyst-raise-a1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('analyst-raise-a1'));
    await waitFor(() => expect(raise).toHaveBeenCalledWith('e1', 'p1', 'duplicates', {}, [3, 4]));
  });
});
