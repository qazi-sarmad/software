import React, { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CapInspector } from './CapInspector';
import { AppProvider, useApp } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { initialCapItems, initialUsers } from '../../data/initialData';

const cap = initialCapItems[0];

const AsRole: React.FC<{ role: string; children: React.ReactNode }> = ({ role, children }) => {
  const { setCurrentUser, currentUser } = useApp();
  useEffect(() => {
    const u = initialUsers.find((x) => x.role === role);
    if (u) setCurrentUser(u);
  }, [role]);
  return currentUser.role === role ? <>{children}</> : null;
};

const renderAs = (role: string) =>
  render(
    <ThemeProvider>
      <AppProvider>
        <AsRole role={role}>
          <CapInspector data={{ cap }} />
        </AsRole>
      </AppProvider>
    </ThemeProvider>
  );

describe('CapInspector due-date change', () => {
  it('CIA can change the due date and sees history', async () => {
    renderAs('cia');
    fireEvent.click(await screen.findByTestId('cap-due-edit'));
    fireEvent.change(screen.getByLabelText('New target due date'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByTestId('cap-due-save'));
    await waitFor(() => expect(screen.getByTestId('cap-due-history')).toBeTruthy());
    expect(screen.getByTestId('cap-due-history').textContent).toContain(`${cap.dueDate} → 2026-12-31`);
    expect(screen.queryByTestId('cap-due-editor')).toBeNull();
  });

  it.each(['preparer', 'reviewer', 'observer'])('%s has no edit control', async (role) => {
    renderAs(role);
    await screen.findByText(/Target Due Date/);
    expect(screen.queryByTestId('cap-due-edit')).toBeNull();
  });
});
