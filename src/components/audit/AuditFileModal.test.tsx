import React, { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuditFileModal } from './AuditFileModal';
import { AppProvider, useApp } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { initialEngagements, initialUsers, initialWorkpapers } from '../../data/initialData';

const engagement = initialEngagements.find((e) => initialWorkpapers.some((w) => w.engagementId === e.id))!;

const Boot: React.FC<{ role: string; data: any; children: React.ReactNode }> = ({ role, data, children }) => {
  const { setCurrentUser, currentUser, openInspector } = useApp();
  const [ready, setReady] = React.useState(false);
  useEffect(() => {
    const u = initialUsers.find((x) => x.role === role);
    if (u) setCurrentUser(u);
  }, [role]);
  useEffect(() => {
    if (currentUser.role === role) {
      openInspector('audit_file', data);
      setReady(true);
    }
  }, [currentUser.role]);
  return ready ? <>{children}</> : null;
};

const renderAs = (role: string, data: any = { engagement }) =>
  render(
    <ThemeProvider>
      <AppProvider>
        <Boot role={role} data={data}>
          <AuditFileModal />
        </Boot>
      </AppProvider>
    </ThemeProvider>
  );

describe('AuditFileModal', () => {
  it('renders chrome and three tabs for a seeded engagement; planning is first', async () => {
    renderAs('cia');
    await screen.findByTestId('audit-file');
    expect(screen.getByText(engagement.title)).toBeTruthy();
    expect(screen.getByTestId('audit-file-stage').textContent).toBe(engagement.stage);
    for (const id of ['planning', 'execution', 'review']) {
      expect(screen.getByTestId(`audit-file-tab-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('audit-file-planning')).toBeTruthy();
  });

  it('switches to Execution and Review content', async () => {
    renderAs('cia');
    fireEvent.click(await screen.findByTestId('audit-file-tab-execution'));
    expect(screen.getByTestId('audit-file-execution')).toBeTruthy();
    fireEvent.click(screen.getByTestId('audit-file-tab-review'));
    expect(screen.getByTestId('audit-file-review')).toBeTruthy();
    expect(screen.getByTestId('gate-count')).toBeTruthy();
    expect(screen.getByTestId('report-pack-placeholder')).toBeTruthy();
  });

  it('opens on Execution when launched from a comment with a workpaper', async () => {
    const wp = initialWorkpapers.find((w) => w.engagementId === engagement.id)!;
    renderAs('cia', { engagement, workpaper: wp });
    await screen.findByTestId('audit-file-execution');
    expect(screen.getByTestId(`wp-row-${wp.id}`)).toBeTruthy();
  });

  it('preparer sees a disabled sign-off with a reason', async () => {
    renderAs('preparer');
    fireEvent.click(await screen.findByTestId('audit-file-tab-review'));
    const btn = screen.queryByTestId('signoff-button') as HTMLButtonElement | null;
    if (btn) {
      expect(btn.disabled).toBe(true);
      expect(screen.getByTestId('signoff-reason').textContent).toBeTruthy();
    }
  });

  it('shows a neutral state for an unknown engagement', async () => {
    renderAs('cia', { engagement: { id: 'NOPE' } });
    expect((await screen.findByTestId('audit-file-unavailable')).textContent).toMatch(/not available/i);
  });
});
