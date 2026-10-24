import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getFindingDetail = vi.fn();

vi.mock('../../data/observations', () => ({
  getFindingDetail: (id: string) => getFindingDetail(id),
}));

import { FindingDrilldown } from './FindingDrilldown';

const ROW = {
  id: 'f1', entityId: 'e1', entityName: 'Lahore Plant', severity: 'high',
  title: 'Segregation of duties gap', condition: 'One user approves and pays invoices.',
  risk: 'Fraudulent payment.', effect: 'Loss of cash.', recommendation: 'Split the duties.',
};

describe('FindingDrilldown (F15 drill-down)', () => {
  beforeEach(() => {
    getFindingDetail.mockReset();
  });

  it('shows the sealed finding behind a pattern', async () => {
    getFindingDetail.mockResolvedValue(ROW);
    render(<FindingDrilldown findingId="f1" />);
    await waitFor(() => expect(screen.getByTestId('finding-drilldown')).toBeTruthy());
    expect(screen.getByTestId('finding-drilldown-title').textContent).toBe('Segregation of duties gap');
    expect(screen.getByTestId('finding-drilldown-severity').textContent).toContain('high');
    expect(screen.getByTestId('finding-drilldown-entity').textContent).toBe('Lahore Plant');
    expect(screen.getByText('One user approves and pays invoices.')).toBeTruthy();
  });

  it('says the finding is unavailable rather than guessing when it is out of scope', async () => {
    getFindingDetail.mockResolvedValue(null);
    render(<FindingDrilldown findingId="f9" />);
    await waitFor(() => expect(screen.getByTestId('finding-drilldown-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('finding-drilldown')).toBeNull();
  });

  it('shows an inline error when the read fails', async () => {
    getFindingDetail.mockRejectedValue(new Error('network down'));
    render(<FindingDrilldown findingId="f1" />);
    await waitFor(() => expect(screen.getByTestId('finding-drilldown-error')).toBeTruthy());
    expect(screen.getByText('network down')).toBeTruthy();
  });
});
