import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listPops = vi.fn();
const listRecords = vi.fn();
const recordFindings = vi.fn();

vi.mock('../../data/population', () => ({
  listPopulations: (...a: unknown[]) => listPops(...a),
  listPopulationRecords: (...a: unknown[]) => listRecords(...a),
}));
vi.mock('../../data/systeligon', () => ({
  recordSysteligonFindings: (...a: unknown[]) => recordFindings(...a),
}));

const userRef = { current: { role: 'cia', rights: { perform_work: true } } };
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: userRef.current }),
}));

import { RuleRunTab } from '../audit/RuleRunTab';

const workpaper = { engagementId: 'e1', refCode: 'WP-1' };
const population = {
  id: 'p1', engagementId: 'e1', workpaperId: null, filename: 'gl.csv', rowCount: 3,
  sha256: 'abcdef0123456789', status: 'locked', verifiedAt: null, verifiedBy: null,
};

describe('RuleRunTab — the rule-run screen (S1/S6/S13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = { role: 'cia', rights: { perform_work: true } } as never;
    listPops.mockResolvedValue([population]);
    listRecords.mockResolvedValue([]);
    recordFindings.mockResolvedValue({ ok: true });
  });

  it('shows the designed empty state when the engagement has no population', async () => {
    listPops.mockResolvedValue([]);
    render(<RuleRunTab workpaper={workpaper} />);
    await waitFor(() => expect(screen.getByTestId('rule-run-empty')).toBeTruthy());
  });

  it('runs the real engine over the population and shows a finding with rule id, version and rows', async () => {
    // Two identical rows: `numeric.duplicates` flags each, one finding per row, citing its ref.
    listRecords.mockResolvedValue([
      { rowRef: 1, amountCents: 5000, date: '2026-01-01', category: 'sales' },
      { rowRef: 2, amountCents: 5000, date: '2026-01-01', category: 'sales' },
      { rowRef: 3, amountCents: 777, date: '2026-01-02', category: 'sales' },
    ]);
    render(<RuleRunTab workpaper={workpaper} />);
    const runBtn = () => screen.getByTestId('rule-run-run') as HTMLButtonElement;
    await waitFor(() => expect(runBtn().disabled).toBe(false));
    fireEvent.click(runBtn());
    await waitFor(() => expect(screen.getByTestId('rule-run-findings')).toBeTruthy());
    const table = screen.getByTestId('rule-run-findings').textContent ?? '';
    expect(table).toContain('numeric.duplicates');
    expect(table).toContain('v1');
    // The exact source rows the rule flagged are shown, not a count: rows 1 and 2 each appear.
    expect(table).toContain('Exact duplicate of another row');
    expect(table).toContain('Source rows');
  });

  it('reports a population that flags nothing honestly rather than inventing a finding', async () => {
    // An empty population has no digits, no duplicates and no dates — no rule flags it.
    listRecords.mockResolvedValue([]);
    render(<RuleRunTab workpaper={workpaper} />);
    const runBtn = () => screen.getByTestId('rule-run-run') as HTMLButtonElement;
    await waitFor(() => expect(runBtn().disabled).toBe(false));
    fireEvent.click(runBtn());
    await waitFor(() => expect(screen.getByTestId('rule-run-findings-empty')).toBeTruthy());
  });

  it('records the run to the ledger and confirms the count', async () => {
    listRecords.mockResolvedValue([
      { rowRef: 1, amountCents: 5000, date: '2026-01-01', category: 'sales' },
      { rowRef: 2, amountCents: 5000, date: '2026-01-01', category: 'sales' },
    ]);
    render(<RuleRunTab workpaper={workpaper} />);
    const runBtn = () => screen.getByTestId('rule-run-run') as HTMLButtonElement;
    await waitFor(() => expect(runBtn().disabled).toBe(false));
    fireEvent.click(runBtn());
    await waitFor(() => expect(screen.getByTestId('rule-run-record')).toBeTruthy());
    fireEvent.click(screen.getByTestId('rule-run-record'));
    await waitFor(() => expect(recordFindings).toHaveBeenCalled());
    const [engagementId, evaluatedAt, findings] = recordFindings.mock.calls[0];
    expect(engagementId).toBe('e1');
    expect(typeof evaluatedAt).toBe('string');
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId('rule-run-recorded')).toBeTruthy());
  });

  it('refuses to run without perform_work and says why', async () => {
    userRef.current = { role: 'viewer', rights: {} } as never;
    render(<RuleRunTab workpaper={workpaper} />);
    await waitFor(() => expect(screen.getByTestId('rule-run-rights-note')).toBeTruthy());
    expect((screen.getByTestId('rule-run-run') as HTMLButtonElement).disabled).toBe(true);
  });
});
