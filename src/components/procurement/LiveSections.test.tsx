import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveContext, type LiveStore } from '../../context/liveContext';
import { LiveBanner, LiveIssuedReports, LiveSummary } from './LiveSections';

const store: LiveStore = {
  userId: 'u1', error: '', busy: false, retryAvailable: false, retry: async () => {}, signOut: async () => {},
  snapshot: {
    cases: [{}, {}], entities: [{ id: 'e1', name: 'Procurement' }],
    issued: [{ id: 'a1', report: { id: 'r1', title: 'Payments audit' }, issues: [{ id: 'i1', severity: 'high', condition: 'Duplicate', status: 'open' }, { id: 'i2', severity: 'low', condition: 'Tax ID', status: 'closed' }] }],
  },
};

describe('Live (Supabase) sections alongside the demo app', () => {
  it('render nothing in demo mode (no live store)', () => {
    const { container } = render(<><LiveBanner /><LiveSummary /><LiveIssuedReports /></>);
    expect(container.textContent).toBe('');
  });
  it('show live counts and issued reports when a live store exists', () => {
    render(<LiveContext.Provider value={store}><LiveBanner /><LiveSummary /><LiveIssuedReports /></LiveContext.Provider>);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getByTestId('live-summary').textContent).toMatch(/2 audit cases · 1 issued reports · 1 unresolved issues · 1 independently validated/);
    expect(screen.getByText('Payments audit')).toBeTruthy();
    expect(screen.getByText(/Synthetic demo issues/)).toBeTruthy();
  });
});
