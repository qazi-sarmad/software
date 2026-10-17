import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listPops = vi.fn();
const lockPop = vi.fn();
const listRules = vi.fn();
const getSize = vi.fn();
const compute = vi.fn();
const getSamp = vi.fn();
const listRowsFn = vi.fn();
const getWp = vi.fn();
const recordFn = vi.fn();
const signOffWp = vi.fn();
const listResults = vi.fn();
const raise = vi.fn();

vi.mock('../../data/population', () => ({
  listPopulations: () => listPops(),
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
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { PopulationPanel } from '../audit/PopulationPanel';
import { SamplingPanel } from '../audit/SamplingPanel';
import { RowTestingPanel } from '../audit/RowTestingPanel';
import { AnalystEnginePanel } from '../audit/AnalystEnginePanel';

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
    listRowsFn.mockResolvedValue([]);
    getWp.mockResolvedValue(null);
    recordFn.mockResolvedValue({ ok: true });
    signOffWp.mockResolvedValue({ ok: true });
    listResults.mockResolvedValue([]);
    raise.mockResolvedValue({ ok: true });
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
    fireEvent.click(screen.getByTestId('population-lock-p1'));
    await waitFor(() => expect(lockPop).toHaveBeenCalledWith('p1'));
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
