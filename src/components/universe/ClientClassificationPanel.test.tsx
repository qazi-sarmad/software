import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const readClassification = vi.fn();
const listClassificationObligations = vi.fn();
const listStandards = vi.fn();
const listDerivedRisks = vi.fn();
const setClassification = vi.fn();
const updateStandard = vi.fn();
const deriveRisks = vi.fn();
vi.mock('../../data/risk', () => ({
  readClassification: (...a: unknown[]) => readClassification(...a),
  listClassificationObligations: (...a: unknown[]) => listClassificationObligations(...a),
  listStandards: (...a: unknown[]) => listStandards(...a),
  listDerivedRisks: (...a: unknown[]) => listDerivedRisks(...a),
  setClassification: (...a: unknown[]) => setClassification(...a),
  updateStandard: (...a: unknown[]) => updateStandard(...a),
  deriveRisks: (...a: unknown[]) => deriveRisks(...a),
}));

const userRef: { current: unknown } = { current: { orgId: 'org-a', role: 'cia', rights: { edit_config: true } } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { ClientClassificationPanel } from './ClientClassificationPanel';

const C6 = {
  classification: 'C6', profile: { code: 'C6', name: 'Banking companies & DFIs', regulator: 'State Bank of Pakistan (SBP)' },
  isIslamic: false, hasItScope: true, internalAuditMandatory: true, internalAuditConditional: false,
  icfrMandatory: true, icfrRigour: 'highest', frameworks: ['COSO ICIF-2013', 'SBP ICFR Roadmap'],
  artifacts: ['Long Form Report (LFR) by the external auditor'], regulatorNumbering: 'SBP BSD Circular No. 7 of 2004; BSD Circular No. 5 of 2009',
  offeredDisciplines: ['management', 'it', 'shariah'], version: 2,
};

describe('ClientClassificationPanel (OA-37): D10', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = { orgId: 'org-a', role: 'cia', rights: { edit_config: true } };
    readClassification.mockResolvedValue(C6);
    listClassificationObligations.mockResolvedValue([
      { obligationId: 'IFCR-02', sourceClause: 'SBP BSD Circular No. 5 of 24 Feb 2009', subject: 'Annual management assessment' },
    ]);
    listStandards.mockResolvedValue([
      { key: 'cobit.2019', discipline: 'it', kind: 'framework', label: 'COBIT 2019', citation: 'COBIT 2019', source: 's', version: 1, overridden: false },
    ]);
    listDerivedRisks.mockResolvedValue([]);
    setClassification.mockResolvedValue({ ok: true });
    updateStandard.mockResolvedValue({ ok: true });
    deriveRisks.mockResolvedValue({ ok: true, added: 3 });
  });

  it('shows the ICFR trigger, the numbering and the offered disciplines', async () => {
    render(<ClientClassificationPanel />);
    await waitFor(() => expect(screen.getByTestId('classification-current')).toBeTruthy());
    expect(screen.getByTestId('classification-icfr').textContent).toContain('Mandatory (highest)');
    expect(screen.getByTestId('classification-numbering').textContent).toContain('SBP BSD Circular No. 7 of 2004');
    expect(screen.getByTestId('classification-disciplines').textContent).toContain('shariah');
  });

  it('shows each obligation with its clause', async () => {
    render(<ClientClassificationPanel />);
    await waitFor(() => expect(screen.getByTestId('classification-obligation-IFCR-02')).toBeTruthy());
    expect(screen.getByTestId('classification-obligation-IFCR-02').textContent).toContain('SBP BSD Circular No. 5');
  });

  it('saves a classification through the data layer', async () => {
    render(<ClientClassificationPanel />);
    await waitFor(() => expect(screen.getByTestId('classification-save')).toBeTruthy());
    fireEvent.change(screen.getByTestId('classification-pick'), { target: { value: 'C7' } });
    fireEvent.click(screen.getByTestId('classification-save'));
    await waitFor(() => expect(setClassification).toHaveBeenCalledWith('org-a', 'C7', false, false));
  });

  it('derives framework risks and reports the count', async () => {
    render(<ClientClassificationPanel />);
    await waitFor(() => expect(screen.getByTestId('classification-derive-run')).toBeTruthy());
    fireEvent.click(screen.getByTestId('classification-derive-run'));
    await waitFor(() => expect(deriveRisks).toHaveBeenCalledWith('org-a', null));
    await waitFor(() => expect(screen.getByTestId('classification-notice').textContent).toContain('3 framework risks'));
  });

  it('bad path: a caller without edit_config is read-only and cannot save', async () => {
    userRef.current = { orgId: 'org-a', role: 'observer', rights: {} };
    render(<ClientClassificationPanel />);
    await waitFor(() => expect(screen.getByTestId('classification-denied')).toBeTruthy());
    expect((screen.getByTestId('classification-save') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('classification-derive-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('bad path: an update refusal is surfaced, not swallowed', async () => {
    updateStandard.mockResolvedValue({ ok: false, reason: 'an organisation may only configure its own standards library' });
    render(<ClientClassificationPanel />);
    await waitFor(() => expect(screen.getByTestId('classification-standard-org-cobit.2019')).toBeTruthy());
    fireEvent.click(screen.getByTestId('classification-standard-org-cobit.2019'));
    await waitFor(() => expect(screen.getByText(/may only configure its own/)).toBeTruthy());
  });

  it('empty state: an organisation with no classification is told so', async () => {
    readClassification.mockResolvedValue(null);
    render(<ClientClassificationPanel />);
    await waitFor(() => expect(screen.getByTestId('classification-empty')).toBeTruthy());
    expect((screen.getByTestId('classification-derive-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('error state: a read failure is shown honestly', async () => {
    readClassification.mockRejectedValue(new Error('the classification could not be read'));
    render(<ClientClassificationPanel />);
    await waitFor(() => expect(screen.getByTestId('classification-error')).toBeTruthy());
  });
});
