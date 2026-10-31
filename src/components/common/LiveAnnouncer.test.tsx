import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveAnnouncerProvider, useAnnouncer } from './LiveAnnouncer';

/** WP12: the global live region announces state changes and is not a modal. */
describe('LiveAnnouncer (WP12)', () => {
  it('renders a polite status region that carries no visible content', () => {
    render(
      <LiveAnnouncerProvider>
        <div>child</div>
      </LiveAnnouncerProvider>
    );
    const region = screen.getByTestId('live-announcer');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('announces a message through the region', async () => {
    const Harness: React.FC = () => {
      const { announce } = useAnnouncer();
      return (
        <button type="button" onClick={() => announce('Report sealed.', true)}>
          go
        </button>
      );
    };
    render(
      <LiveAnnouncerProvider>
        <Harness />
      </LiveAnnouncerProvider>
    );
    screen.getByRole('button', { name: 'go' }).click();
    // requestAnimationFrame runs on the next frame; flush it.
    await vi.waitFor(() => {
      expect(screen.getByTestId('live-announcer').textContent).toBe('Report sealed.');
    });
  });

  it('switches to assertive for a refusal', async () => {
    const Harness: React.FC = () => {
      const { announce } = useAnnouncer();
      return (
        <button type="button" onClick={() => announce('Refused.', false)}>
          go
        </button>
      );
    };
    render(
      <LiveAnnouncerProvider>
        <Harness />
      </LiveAnnouncerProvider>
    );
    screen.getByRole('button', { name: 'go' }).click();
    await vi.waitFor(() => {
      expect(screen.getByTestId('live-announcer').getAttribute('aria-live')).toBe('assertive');
    });
  });
});
