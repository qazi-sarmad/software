import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingWindow } from './FloatingWindow';

describe('FloatingWindow (non-blocking record view chrome, §17.1)', () => {
  it('renders a non-modal dialog with no backdrop scrim', () => {
    const { container } = render(
      <FloatingWindow windowId="engagement:e1" title="Engagement Audit File" onClose={() => {}}>
        <div>content</div>
      </FloatingWindow>
    );
    const dialog = screen.getByRole('dialog', { name: 'Engagement Audit File' });
    expect(dialog).toBeTruthy();
    // No aria-modal: the application behind the window stays usable.
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    // No full-viewport scrim element.
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('closes on Escape and on the close button', () => {
    const onClose = vi.fn();
    render(
      <FloatingWindow windowId="w" title="T" onClose={onClose}>
        <div />
      </FloatingWindow>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Close window'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('minimises when a minimise handler is supplied, and pops out when a URL is given', () => {
    const onMinimise = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <FloatingWindow windowId="w" title="T" onClose={() => {}} onMinimise={onMinimise} popOutUrl="/view/engagement/e1">
        <div />
      </FloatingWindow>
    );
    fireEvent.click(screen.getByLabelText('Minimise window'));
    expect(onMinimise).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Open in its own window'));
    expect(openSpy).toHaveBeenCalledWith('/view/engagement/e1', expect.any(String), expect.any(String));
    openSpy.mockRestore();
  });

  it('never renders wider than the viewport (D15)', () => {
    render(
      <FloatingWindow windowId="w" title="T" width={960} onClose={() => {}}>
        <div />
      </FloatingWindow>
    );
    const dialog = screen.getByRole('dialog', { name: 'T' }) as HTMLElement;
    // The width is a `min()` clamp against the viewport, so a 960px window cannot clip on a phone.
    expect(dialog.style.width).toContain('min(960px');
    expect(dialog.style.width).toContain('100vw');
  });
});
