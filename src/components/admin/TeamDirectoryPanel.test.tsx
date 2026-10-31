import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const listDirectoryFn = vi.fn();
const saveProfileFn = vi.fn();
const saveTravelFn = vi.fn();
const addTripFn = vi.fn();
const addAssignmentFn = vi.fn();

vi.mock('../../data/teamDirectory', () => ({
  listTeamDirectory: (...a: unknown[]) => listDirectoryFn(...a),
  saveTeamProfile: (...a: unknown[]) => saveProfileFn(...a),
  saveTeamTravel: (...a: unknown[]) => saveTravelFn(...a),
  addTeamTrip: (...a: unknown[]) => addTripFn(...a),
  removeTeamTrip: () => Promise.resolve({ ok: true }),
  addTeamAssignment: (...a: unknown[]) => addAssignmentFn(...a),
  removeTeamAssignment: () => Promise.resolve({ ok: true }),
  listDirectoryEngagements: () => Promise.resolve([]),
  tagEngagementTravel: () => Promise.resolve({ ok: true }),
}));

const listRolesFn = vi.fn();
vi.mock('../../data/admin', () => ({ listRoles: () => listRolesFn() }));

let rights: Record<string, boolean> = { manage_team: true };
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: { id: 'u-1', orgId: 'org-1', rights } }),
}));

import { TeamDirectoryPanel } from './TeamDirectoryPanel';

const ayesha = {
  userId: 'u-1', displayName: 'Ayesha Khan', roleSlug: 'cia', roleName: 'Chief Audit Executive',
  avatarUrl: null, capacityHours: 100,
  assignments: [{ engagementId: 'e1', engagementName: 'Treasury', from: '2026-11-01', to: '2026-11-30', hours: 40, role: 'lead' }],
  travel: { homeBase: 'Karachi', willingness: 'limited', preferredRegions: ['Karachi'], blackoutDates: [] },
  trips: [{ engagementId: 'e2', location: 'Lahore', from: '2026-11-10', to: '2026-11-14' }],
  rights: ['perform_work', 'manage_team'],
};
const bilal = {
  userId: 'u-2', displayName: 'Bilal Ahmed', roleSlug: 'senior', roleName: 'Senior Auditor',
  avatarUrl: 'https://x/y.png', capacityHours: 100,
  assignments: [], travel: { homeBase: 'Lahore', willingness: 'none', preferredRegions: [], blackoutDates: [] },
  trips: [], rights: ['perform_work'],
};

const engagements = [
  { id: 'e9', name: 'Payroll review', location: 'Karachi', from: '2026-12-01', to: '2026-12-05', rights: ['perform_work'] },
];

describe('the team directory (glass hover, workload, travel, resourcing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rights = { manage_team: true };
    listRolesFn.mockResolvedValue([{ id: 'r1', slug: 'cia', name: 'Chief Audit Executive', isSeed: true, rights: { manage_team: true } }]);
    listDirectoryFn.mockResolvedValue([ayesha, bilal]);
    saveProfileFn.mockResolvedValue({ ok: true });
    saveTravelFn.mockResolvedValue({ ok: true });
    addTripFn.mockResolvedValue({ ok: true });
    addAssignmentFn.mockResolvedValue({ ok: true });
  });

  it('draws every member with a generated avatar and a workload band', async () => {
    render(<TeamDirectoryPanel engagements={engagements} />);
    await waitFor(() => expect(screen.getByTestId('team-directory')).toBeTruthy());
    expect(screen.getByTestId('team-avatar-u-1')).toBeTruthy();
    expect(screen.getByTestId('team-summary').textContent).toContain('2 member');
  });

  it('shows a glass hover card with the workload, home base and trips on hover', async () => {
    render(<TeamDirectoryPanel engagements={engagements} />);
    await waitFor(() => expect(screen.getByTestId('team-avatar-u-1')).toBeTruthy());
    fireEvent.mouseEnter(screen.getByTestId('team-avatar-u-1').parentElement!);
    await waitFor(() => expect(screen.getByTestId('team-hover-u-1')).toBeTruthy());
    expect(screen.getByTestId('team-hover-u-1').textContent).toContain('40h');
    expect(screen.getByTestId('team-hover-base-u-1').textContent).toContain('Karachi');
    expect(screen.getByTestId('team-hover-trips-u-1').textContent).toContain('Lahore');
  });

  it('opens the detail and saves a travel preference through the data module', async () => {
    render(<TeamDirectoryPanel engagements={engagements} />);
    await waitFor(() => expect(screen.getByTestId('team-avatar-u-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('team-avatar-u-1'));
    await waitFor(() => expect(screen.getByTestId('team-detail')).toBeTruthy());
    expect(screen.getByTestId('team-detail-name').textContent).toBe('Ayesha Khan');
    const home = screen.getByTestId('team-home-base');
    fireEvent.blur(home, { target: { value: 'Islamabad' } });
    await waitFor(() => expect(saveTravelFn).toHaveBeenCalled());
  });

  it('ranks who should take an engagement and explains each verdict', async () => {
    render(<TeamDirectoryPanel engagements={engagements} />);
    await waitFor(() => expect(screen.getByTestId('team-req-engagement')).toBeTruthy());
    // Choose the engagement (a listbox: open it, then click the option) and mark it as travel.
    fireEvent.click(screen.getByTestId('team-req-engagement'));
    fireEvent.click(screen.getByText('Payroll review'));
    fireEvent.click(screen.getByTestId('team-req-travel'));
    await waitFor(() => expect(screen.getByTestId('team-recommendations')).toBeTruthy());
    // Ayesha holds perform_work and will travel to Karachi; Bilal will not travel at all.
    await waitFor(() => expect(screen.getByTestId('team-rec-u-1').textContent).toContain('recommended'));
    expect(screen.getByTestId('team-rec-u-2').textContent).toContain('excluded');
    expect(screen.getByTestId('team-rec-u-2').textContent).toContain('will not travel');
  });

  it('lets only a manager assign an engagement', async () => {
    render(<TeamDirectoryPanel engagements={engagements} />);
    await waitFor(() => expect(screen.getByTestId('team-avatar-u-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('team-avatar-u-1'));
    await waitFor(() => expect(screen.getByTestId('team-assignment-add')).toBeTruthy());
    fireEvent.click(screen.getByTestId('team-assignment-add'));
    await waitFor(() => expect(addAssignmentFn).toHaveBeenCalled());
  });

  it('is read-only for a caller without a team-management right', async () => {
    rights = { perform_work: true };
    render(<TeamDirectoryPanel engagements={engagements} />);
    await waitFor(() => expect(screen.getByTestId('team-readonly')).toBeTruthy());
    fireEvent.click(screen.getByTestId('team-avatar-u-2'));
    await waitFor(() => expect(screen.getByTestId('team-detail')).toBeTruthy());
    expect(screen.queryByTestId('team-assignment-add')).toBeNull();
  });
});
