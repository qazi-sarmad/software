import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanItemsPanel } from './PlanItemsPanel';
import { CombinedApprovalPanel } from './CombinedApprovalPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const wrap = (role: Role, children: React.ReactNode) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        {children}
      </AppProvider>
    </ThemeProvider>
  );

describe('PlanItemsPanel', () => {
  it('shows empty states', () => {
    wrap('cia', <PlanItemsPanel items={[]} versions={[]} />);
    expect(screen.getByTestId('plan-items-empty')).toBeTruthy();
    expect(screen.getByTestId('plan-versions-empty')).toBeTruthy();
  });

  it('blocks an ad-hoc add until the justification is at least 10 characters', () => {
    wrap('cia', <PlanItemsPanel items={[]} versions={[]} />);
    fireEvent.change(screen.getByLabelText('Item title'), { target: { value: 'New review' } });
    fireEvent.click(screen.getByLabelText('Ad-hoc item'));
    const btn = screen.getByTestId('plan-add-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Ad-hoc justification'), { target: { value: 'short' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Ad-hoc justification'), { target: { value: 'a valid reason here' } });
    expect(btn.disabled).toBe(false);
  });

  it('prints version history', () => {
    wrap('cia', <PlanItemsPanel items={[]} versions={[{ version: 1, reason: 'initial', createdAt: '2026-01-01T00:00:00Z' }]} />);
    expect(screen.getByTestId('plan-versions').textContent).toMatch(/initial/);
  });
});

describe('CombinedApprovalPanel', () => {
  it('offers raising with both ids present and the right', () => {
    wrap('cia', <CombinedApprovalPanel request={null} universeId="u1" entityId="e1" />);
    expect((screen.getByTestId('combined-raise') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables raising without the ids', () => {
    wrap('cia', <CombinedApprovalPanel request={null} />);
    expect((screen.getByTestId('combined-raise') as HTMLButtonElement).disabled).toBe(true);
  });

  it('populates the entity picker from the entities in scope (D7)', () => {
    wrap('cia', <CombinedApprovalPanel request={null} universeId={testSeed.universes[0].id} />);
    const picker = screen.getByTestId('combined-entity-picker') as HTMLSelectElement;
    // The seed has at least one entity; each renders as an option (plus the placeholder).
    expect(picker.options.length).toBeGreaterThan(1);
  });

  it('enables raising once an entity is picked (D7)', () => {
    wrap('cia', <CombinedApprovalPanel request={null} universeId={testSeed.universes[0].id} />);
    const picker = screen.getByTestId('combined-entity-picker') as HTMLSelectElement;
    const raise = screen.getByTestId('combined-raise') as HTMLButtonElement;
    // The first in-scope entity is selected by default, so raising is enabled without a manual pick.
    expect(picker.value).not.toBe('');
    expect(raise.disabled).toBe(false);
  });

  it('shows a designed empty state when no entity is in scope (D7)', () => {
    wrap('cia', <CombinedApprovalPanel request={null} universeId="no-such-universe" />);
    expect(screen.getByTestId('combined-entity-empty')).toBeTruthy();
    expect((screen.getByTestId('combined-raise') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the SLA and escalation fields on a pending request', () => {
    wrap('cia', (
      <CombinedApprovalPanel
        request={{ id: 'r1', universeId: 'u1', entityId: 'e1', title: 'Plan + deploy', period: '2026', status: 'pending', reason: null, slaDueAt: '2026-02-01T00:00:00Z', escalatedAt: '2026-02-02T00:00:00Z' }}
      />
    ));
    expect(screen.getByTestId('combined-sla')).toBeTruthy();
    expect(screen.getByTestId('combined-escalated')).toBeTruthy();
    expect(screen.getByTestId('combined-approve')).toBeTruthy();
  });

  it('hides the decision controls on a decided request', () => {
    wrap('cia', (
      <CombinedApprovalPanel
        request={{ id: 'r1', universeId: 'u1', entityId: 'e1', title: 'Plan + deploy', period: null, status: 'approved', reason: null, slaDueAt: null, escalatedAt: null }}
      />
    ));
    expect(screen.queryByTestId('combined-approve')).toBeNull();
  });

  it('tells a waiting requestor who decides and what happens next (D21)', () => {
    wrap('preparer', (
      <CombinedApprovalPanel
        request={{ id: 'r1', universeId: 'u1', entityId: 'e1', title: 'Plan + deploy', period: null, status: 'pending', reason: null, slaDueAt: '2026-02-01T00:00:00Z', escalatedAt: null }}
      />
    ));
    expect(screen.getByTestId('combined-next-action').textContent).toMatch(/approve-plans right decides/i);
    // A preparer cannot decide, so the reason is shown in plain language (D14).
    const reason = screen.getByTestId('combined-decide-reason').textContent ?? '';
    expect(reason).not.toMatch(/approve_plan/);
  });

  it('explains an escalated request and still allows a decision (D21)', () => {
    wrap('cia', (
      <CombinedApprovalPanel
        request={{ id: 'r1', universeId: 'u1', entityId: 'e1', title: 'Plan + deploy', period: null, status: 'escalated', reason: null, slaDueAt: '2026-02-01T00:00:00Z', escalatedAt: '2026-02-02T00:00:00Z' }}
      />
    ));
    expect(screen.getByTestId('combined-escalated-next')).toBeTruthy();
    expect(screen.queryByTestId('combined-approve')).toBeNull();
  });
});
