import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const modeRef = { current: 'full_page' as 'full_page' | 'floating_window' };
vi.mock('../../hooks/useRecordViewMode', () => ({
  useRecordViewMode: () => [modeRef.current, () => {}],
}));

import { RecordView } from './RecordView';

describe('RecordView (§27.5 two-mode record view)', () => {
  it('renders nothing in full_page mode (the caller routes instead)', () => {
    modeRef.current = 'full_page';
    const { container } = render(
      <RecordView recordType="engagement" recordId="e1" title="Engagement">
        <div>body</div>
      </RecordView>
    );
    expect(container.querySelector('[data-testid^="floating-window-"]')).toBeNull();
    expect(screen.queryByText('body')).toBeNull();
  });

  it('renders the floating window in floating_window mode, without aria-modal', () => {
    modeRef.current = 'floating_window';
    render(
      <RecordView recordType="engagement" recordId="e1" title="Engagement Audit File" onClose={() => {}}>
        <div>body</div>
      </RecordView>
    );
    const dialog = screen.getByRole('dialog', { name: 'Engagement Audit File' });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(screen.getByTestId('floating-window-engagement:e1')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });
});
