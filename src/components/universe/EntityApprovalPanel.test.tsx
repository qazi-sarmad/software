import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntityApprovalPanel } from './EntityApprovalPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const renderAs = (role: Role, entity: any) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <EntityApprovalPanel entity={entity} />
      </AppProvider>
    </ThemeProvider>
  );

const draft = { id: 'e1', universeId: 'u1', name: 'Payroll', kind: 'process', status: 'draft', approved: false, rejectionReason: null };

describe('EntityApprovalPanel', () => {
  it('offers submit for a draft entity', () => {
    renderAs('cia', draft);
    expect(screen.getByTestId('entity-status').textContent).toBe('draft');
    expect(screen.getByTestId('entity-submit')).toBeTruthy();
  });

  it('disables submit for a session without the right', () => {
    renderAs('observer', draft);
    const btn = screen.getByTestId('entity-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('offers approve/reject for a pending entity', () => {
    renderAs('cia', { ...draft, status: 'pending' });
    expect(screen.getByTestId('entity-approve')).toBeTruthy();
    expect(screen.getByTestId('entity-reject')).toBeTruthy();
  });

  it('requires a rejection reason of at least 10 characters', () => {
    renderAs('cia', { ...draft, status: 'pending' });
    expect((screen.getByTestId('entity-reject') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the rejection reason on a rejected entity', () => {
    renderAs('cia', { ...draft, status: 'rejected', rejectionReason: 'duplicate of another entity' });
    expect(screen.getByText(/duplicate of another entity/)).toBeTruthy();
  });
});
