import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const engagementsRef: { current: Array<{ id: string; title: string }> } = { current: [] };

vi.mock('../../hooks/useScopedData', () => ({
  useScopedData: () => ({
    filteredIssues: [],
    scopedEngagements: engagementsRef.current,
    can: () => ({ allowed: false }),
    currentUser: { id: 'u1', name: 'Tester', role: 'cia', rights: {} },
  }),
}));

vi.mock('../../context/FilterStore', () => ({
  useFilterStore: () => ({
    searchQuery: '',
    setSearchQuery: vi.fn(),
    severity: null,
    setSeverity: vi.fn(),
  }),
}));

const appRef = { selectedEngagementId: null as string | null };
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ openInspector: vi.fn(), selectedEngagementId: appRef.selectedEngagementId }),
}));

// The register itself is covered by phase6Panels.test.tsx; here we assert the tab wires it up.
vi.mock('../audit/CapRegisterPanel', () => ({
  CapRegisterPanel: ({ engagementId }: { engagementId: string }) => (
    <div data-testid="cap-register-stub">register for {engagementId}</div>
  ),
}));

import { IssuesRegisterTab } from './IssuesRegisterTab';

describe('D10: CAP register in the Issues & CAP tab', () => {
  beforeEach(() => {
    engagementsRef.current = [];
    appRef.selectedEngagementId = null;
  });

  it('shows a designed empty state when no engagement is in scope', () => {
    render(<IssuesRegisterTab />);
    expect(screen.getByTestId('issues-cap-register-section')).toBeTruthy();
    expect(screen.getByTestId('cap-no-engagement')).toBeTruthy();
    expect(screen.queryByTestId('cap-register-stub')).toBeNull();
  });

  it('renders the register for the first in-scope engagement and offers a picker', () => {
    engagementsRef.current = [
      { id: 'e1', title: 'A-Engagement' },
      { id: 'e2', title: 'B-Engagement' },
    ];
    render(<IssuesRegisterTab />);
    const picker = screen.getByTestId('cap-engagement-picker') as HTMLSelectElement;
    expect(picker.value).toBe('e1');
    expect(screen.getByTestId('cap-register-stub').textContent).toContain('e1');
  });

  it('honours a preselected engagement from the app context', () => {
    engagementsRef.current = [
      { id: 'e1', title: 'A-Engagement' },
      { id: 'e2', title: 'B-Engagement' },
    ];
    appRef.selectedEngagementId = 'e2';
    render(<IssuesRegisterTab />);
    expect(screen.getByTestId('cap-register-stub').textContent).toContain('e2');
  });
});
