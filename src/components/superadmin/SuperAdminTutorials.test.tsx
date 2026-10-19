import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listTutorialsFn = vi.fn();
const recordTutorialView = vi.fn();

vi.mock('../../data/tutorials', () => ({
  listTutorials: () => listTutorialsFn(),
  recordTutorialView: (key: string, helped: boolean) => recordTutorialView(key, helped),
  tutorialHealth: (rows: { key: string; mediaPath: string | null }[]) => ({
    missing: rows.filter((r) => !r.mediaPath).map((r) => r.key),
    stale: [],
  }),
}));

import { SuperAdminTutorials } from './SuperAdminTutorials';
import { TutorialDrawer } from '../common/TutorialDrawer';

const ROWS = [
  { key: 'oa.profile', audience: 'org_admin', title: 'Profile', steps: ['Open the profile screen'], mediaPath: 'tutorials/oa.profile.gif', uiHash: 'abc', generatedAt: null },
  { key: 'sa.features', audience: 'super_admin', title: 'Features', steps: ['Open features'], mediaPath: null, uiHash: null, generatedAt: null },
];

describe('SA-13 tutorial library (F18)', () => {
  beforeEach(() => {
    listTutorialsFn.mockResolvedValue(ROWS);
    recordTutorialView.mockResolvedValue({ ok: true });
  });

  it('shows ok and missing badges from the media path', async () => {
    render(<SuperAdminTutorials />);
    await waitFor(() => expect(screen.getByTestId('tutorial-oa.profile')).toBeTruthy());
    expect(screen.getByTestId('tutorial-oa.profile').textContent).toContain('ok');
    expect(screen.getByTestId('tutorial-sa.features').textContent).toContain('missing');
  });

  it('shows an empty state when the registry is empty', async () => {
    listTutorialsFn.mockResolvedValue([]);
    render(<SuperAdminTutorials />);
    await waitFor(() => expect(screen.getByTestId('superadmin-tutorials-empty')).toBeTruthy());
  });
});

describe('TUT-01 tutorial drawer (F18)', () => {
  beforeEach(() => {
    listTutorialsFn.mockResolvedValue(ROWS);
    recordTutorialView.mockResolvedValue({ ok: true });
  });

  it('is a complementary side panel, never a dialog', async () => {
    render(<TutorialDrawer tutorialKey="oa.profile" title="Profile" onClose={() => {}} />);
    const drawer = await screen.findByTestId('tutorial-drawer');
    expect(drawer.getAttribute('role')).toBe('complementary');
    expect(drawer.getAttribute('aria-modal')).toBeNull();
    expect(screen.getByTestId('tutorial-drawer-media')).toBeTruthy();
    expect(screen.getByText('Open the profile screen')).toBeTruthy();
  });

  it('says so when the recording is missing', async () => {
    render(<TutorialDrawer tutorialKey="sa.features" title="Features" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('tutorial-drawer-missing')).toBeTruthy());
  });

  it('records the Did this help answer', async () => {
    render(<TutorialDrawer tutorialKey="oa.profile" title="Profile" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('tutorial-drawer-yes')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tutorial-drawer-yes'));
    await waitFor(() => expect(recordTutorialView).toHaveBeenCalledWith('oa.profile', true));
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<TutorialDrawer tutorialKey="oa.profile" title="Profile" onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('tutorial-drawer')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
