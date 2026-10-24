import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingTasksTab } from './PendingTasksTab';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const renderAs = (role: Role) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <PendingTasksTab />
      </AppProvider>
    </ThemeProvider>
  );

describe('Work Queue user-specific work (§5)', () => {
  it('renders the user-specific sections for a preparer', () => {
    renderAs('preparer');
    expect(screen.getByText('What needs you')).toBeDefined();
    expect(screen.getByTestId('pending-workpapers')).toBeDefined();
    expect(screen.getByTestId('pending-signoff')).toBeDefined();
    expect(screen.getByTestId('pending-approval')).toBeDefined();
  });

  it('shows the approval section to a reviewer (review_and_approve right)', () => {
    renderAs('reviewer');
    expect(screen.getByTestId('pending-approval')).toBeDefined();
  });

  it("shows the team section to a manager but not to a preparer", () => {
    const { unmount } = renderAs('audit_manager');
    expect(screen.getByTestId('pending-team')).toBeDefined();
    unmount();

    renderAs('preparer');
    expect(screen.queryByTestId('pending-team')).toBeNull();
  });
});
