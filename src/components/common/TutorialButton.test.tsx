import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const listTutorialsFn = vi.fn();
vi.mock('../../data/tutorials', () => ({
  listTutorials: () => listTutorialsFn(),
  recordTutorialView: vi.fn().mockResolvedValue({ ok: true }),
}));

import { TutorialButton, AUTOPLAY_OFF_KEY } from './TutorialButton';

const ROWS = [
  { key: 'oa.branding', audience: 'org_admin', title: 'Branding', steps: ['Open branding'], mediaPath: 'tutorials/oa.branding.gif', uiHash: null, generatedAt: null },
];

describe('TutorialButton (F18, S12)', () => {
  beforeEach(() => {
    listTutorialsFn.mockResolvedValue(ROWS);
    window.localStorage.clear();
  });

  it('opens the drawer when pressed', async () => {
    render(<TutorialButton tutorialKey="oa.branding" title="OA-03 branding" screenId="oa-branding" autoplay={false} />);
    expect(screen.queryByTestId('tutorial-drawer')).toBeNull();
    fireEvent.click(screen.getByTestId('oa-branding-tutorial'));
    await waitFor(() => expect(screen.getByTestId('tutorial-drawer')).toBeTruthy());
  });

  it('autoplays once on the first visit, then not again', async () => {
    const { unmount } = render(<TutorialButton tutorialKey="oa.branding" title="OA-03 branding" screenId="oa-branding" />);
    await waitFor(() => expect(screen.getByTestId('tutorial-drawer')).toBeTruthy());
    expect(window.localStorage.getItem('acp.tutorial.seen.oa.branding')).toBe('1');
    unmount();
    cleanup();
    render(<TutorialButton tutorialKey="oa.branding" title="OA-03 branding" screenId="oa-branding" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('tutorial-drawer')).toBeNull();
  });

  it('does not autoplay when the off switch is set', async () => {
    window.localStorage.setItem(AUTOPLAY_OFF_KEY, 'off');
    render(<TutorialButton tutorialKey="oa.branding" title="OA-03 branding" screenId="oa-branding" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('tutorial-drawer')).toBeNull();
  });

  it('never autoplays when autoplay is false', async () => {
    render(<TutorialButton tutorialKey="oa.branding" title="OA-03 branding" screenId="oa-branding" autoplay={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('tutorial-drawer')).toBeNull();
  });
});
