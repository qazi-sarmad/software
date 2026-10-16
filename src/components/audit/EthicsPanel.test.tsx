import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EthicsPanel } from './EthicsPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const renderAs = (role: Role, members: any[]) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <EthicsPanel members={members} />
      </AppProvider>
    </ThemeProvider>
  );

describe('EthicsPanel', () => {
  it('shows the empty state with no members', () => {
    renderAs('cia', []);
    expect(screen.getByTestId('ethics-empty')).toBeTruthy();
  });

  it('completes when every member acknowledged', () => {
    renderAs('cia', [
      { userId: 'u1', name: 'One', acknowledged: true },
      { userId: 'u2', name: 'Two', acknowledged: true },
    ]);
    expect(screen.getByTestId('ethics-ack-u1')).toBeTruthy();
    expect(screen.getByText('All members acknowledged')).toBeTruthy();
  });

  it('shows a self-only acknowledge button for the current user', () => {
    const me = testUser('preparer');
    render(
      <ThemeProvider>
        <AppProvider user={me} seed={testSeed}>
          <EthicsPanel members={[{ userId: me.id, name: me.name, acknowledged: false }]} />
        </AppProvider>
      </ThemeProvider>
    );
    expect(screen.getByTestId(`ethics-ack-button-${me.id}`)).toBeTruthy();
  });

  it('never lets a member acknowledge on behalf of another', () => {
    const me = testUser('preparer');
    render(
      <ThemeProvider>
        <AppProvider user={me} seed={testSeed}>
          <EthicsPanel members={[{ userId: 'someone-else', name: 'Other', acknowledged: false }]} />
        </AppProvider>
      </ThemeProvider>
    );
    expect(screen.getByTestId('ethics-pending-someone-else')).toBeTruthy();
    expect(screen.queryByTestId('ethics-ack-button-someone-else')).toBeNull();
  });
});
