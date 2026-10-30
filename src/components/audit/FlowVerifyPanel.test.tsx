import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FlowVerifyPanel } from './FlowVerifyPanel';

const listEvidence = vi.fn();

vi.mock('../../data/population', () => ({
  listEvidenceRecords: (...a: unknown[]) => listEvidence(...a),
}));

let userRef: { role: string; rights: Record<string, boolean> } = { role: 'cia', rights: { perform_work: true } };
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: userRef }),
}));

const workpaper = { engagementId: 'e1', refCode: 'WP-1' };

const finding = (refs: string[]) => ({
  ruleId: 'numeric.duplicates', ruleVersion: 1, reason: 'Exact duplicate of another row', refs,
});

describe('FlowVerifyPanel — the accepted/declined flow and Mode A/B (S3/S4/S5/S12, F132)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef = { role: 'cia', rights: { perform_work: true } };
    listEvidence.mockResolvedValue({});
  });

  it('builds the accepted set from the rows the run named, and never drops a required row', async () => {
    render(
      <FlowVerifyPanel
        workpaper={workpaper}
        findings={[finding(['r1', 'r2'])]}
        rows={[{ ref: 'r1', values: {} }, { ref: 'r2', values: {} }, { ref: 'r3', values: {} }]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('flow-verify-build')).toBeTruthy());
    fireEvent.click(screen.getByTestId('flow-verify-build'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-note')).toBeTruthy());
    expect(screen.getByTestId('flow-verify-note').textContent).toContain('2 required row(s)');
    // r3 was not required, so the accepted flow does not add it.
    expect(screen.queryByText('r3')).toBeNull();
  });

  it('reports an empty accepted set honestly when no finding named a row', async () => {
    render(<FlowVerifyPanel workpaper={workpaper} findings={[]} rows={[{ ref: 'r1', values: {} }]} />);
    await waitFor(() => expect(screen.getByTestId('flow-verify-build')).toBeTruthy());
    fireEvent.click(screen.getByTestId('flow-verify-build'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-note')).toBeTruthy());
    expect(screen.getByTestId('flow-verify-note').textContent).toContain('Nothing is tested and nothing passes');
  });

  it('treats the declined flow floor as a minimum, never a ceiling', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ref: `r${i}`, values: {} }));
    render(<FlowVerifyPanel workpaper={workpaper} findings={[]} rows={rows} />);
    await waitFor(() => expect(screen.getByTestId('flow-verify-flow')).toBeTruthy());
    fireEvent.change(screen.getByTestId('flow-verify-flow'), { target: { value: 'declined' } });
    fireEvent.change(screen.getByTestId('flow-verify-floor'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('flow-verify-build'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-note')).toBeTruthy());
    expect(screen.getByTestId('flow-verify-note').textContent).toContain('4 row(s) under test');
    expect(screen.getByTestId('flow-verify-note').textContent).toContain('minimum, never a ceiling');
  });

  it('Mode A fails a row left open or with no remark — an open row is not a pass', async () => {
    render(<FlowVerifyPanel workpaper={workpaper} findings={[finding(['r1'])]} rows={[{ ref: 'r1', values: {} }]} />);
    await waitFor(() => expect(screen.getByTestId('flow-verify-build')).toBeTruthy());
    fireEvent.click(screen.getByTestId('flow-verify-build'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-verify')).toBeTruthy());
    fireEvent.click(screen.getByTestId('flow-verify-verify'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-result')).toBeTruthy());
    const fail = screen.getByTestId('flow-verify-fail-r1').textContent ?? '';
    expect(fail).toContain('no closed decision');
    expect(fail).toContain('no remark');
  });

  it('Mode A passes a row with a closed decision and a remark', async () => {
    render(<FlowVerifyPanel workpaper={workpaper} findings={[finding(['r1'])]} rows={[{ ref: 'r1', values: {} }]} />);
    await waitFor(() => expect(screen.getByTestId('flow-verify-build')).toBeTruthy());
    fireEvent.click(screen.getByTestId('flow-verify-build'));
    fireEvent.change(screen.getByLabelText('remark r1'), { target: { value: 'Checked against the invoice.' } });
    fireEvent.change(screen.getByLabelText('decision r1'), { target: { value: 'effective' } });
    fireEvent.click(screen.getByTestId('flow-verify-verify'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-result')).toBeTruthy());
    expect(screen.getByTestId('flow-verify-failed').textContent).toContain('0 not verified');
  });

  it('Mode B fails a row with no evidence attached, and names the reason', async () => {
    render(<FlowVerifyPanel workpaper={workpaper} findings={[finding(['r1'])]} rows={[{ ref: 'r1', values: {} }]} />);
    await waitFor(() => expect(screen.getByTestId('flow-verify-build')).toBeTruthy());
    fireEvent.click(screen.getByTestId('flow-verify-build'));
    fireEvent.change(screen.getByTestId('flow-verify-mode'), { target: { value: 'evidence' } });
    fireEvent.change(screen.getByLabelText('remark r1'), { target: { value: 'Agreed to the statement.' } });
    fireEvent.change(screen.getByLabelText('decision r1'), { target: { value: 'effective' } });
    fireEvent.click(screen.getByTestId('flow-verify-verify'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-result')).toBeTruthy());
    expect(screen.getByTestId('flow-verify-fail-r1').textContent).toContain('no evidence attached');
  });

  it('carries an override forward when a row is closed despite a failed verification (§2.2)', async () => {
    render(<FlowVerifyPanel workpaper={workpaper} findings={[finding(['r1'])]} rows={[{ ref: 'r1', values: {} }]} />);
    await waitFor(() => expect(screen.getByTestId('flow-verify-build')).toBeTruthy());
    fireEvent.click(screen.getByTestId('flow-verify-build'));
    // Closed with a remark, but Mode B still fails it (no evidence) — this is the override.
    fireEvent.change(screen.getByTestId('flow-verify-mode'), { target: { value: 'evidence' } });
    fireEvent.change(screen.getByLabelText('remark r1'), { target: { value: "Closed on the preparer's word." } });
    fireEvent.change(screen.getByLabelText('decision r1'), { target: { value: 'effective' } });
    fireEvent.click(screen.getByTestId('flow-verify-verify'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-overrides')).toBeTruthy());
    expect(screen.getByTestId('flow-verify-overrides').textContent).toContain('r1');
  });

  it('paste-to-fill maps a tab-separated block onto the tested rows', async () => {
    render(<FlowVerifyPanel workpaper={workpaper} findings={[finding(['r1'])]} rows={[{ ref: 'r1', values: {} }]} />);
    await waitFor(() => expect(screen.getByTestId('flow-verify-build')).toBeTruthy());
    fireEvent.click(screen.getByTestId('flow-verify-build'));
    fireEvent.change(screen.getByTestId('flow-verify-paste'), { target: { value: 'r1\tAgreed to the ledger\teffective' } });
    fireEvent.click(screen.getByTestId('flow-verify-paste-apply'));
    await waitFor(() => expect(screen.getByTestId('flow-verify-note')).toBeTruthy());
    expect(screen.getByTestId('flow-verify-note').textContent).toContain('Pasted 1 row(s)');
    expect((screen.getByLabelText('remark r1') as HTMLInputElement).value).toBe('Agreed to the ledger');
  });

  it('refuses to build without perform_work and says why', async () => {
    userRef = { role: 'observer', rights: {} };
    render(<FlowVerifyPanel workpaper={workpaper} findings={[]} rows={[]} />);
    await waitFor(() => expect(screen.getByTestId('flow-verify-rights-note')).toBeTruthy());
    expect((screen.getByTestId('flow-verify-build') as HTMLButtonElement).disabled).toBe(true);
  });
});
