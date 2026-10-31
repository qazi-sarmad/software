import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderBar } from './HeaderBar';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';

// HeaderBar only reads `signOut` from the auth context; no session resolution is needed here.
vi.mock('../../context/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../context/AuthContext')>(
    '../../context/AuthContext'
  );
  return { ...actual, useAuth: () => ({ signOut: vi.fn() }) };
});

const renderHeader = (onOpenCommandPalette = vi.fn()) => {
  render(
    <ThemeProvider>
      <AppProvider user={testUser()} seed={testSeed}>
        <HeaderBar onOpenCommandPalette={onOpenCommandPalette} />
      </AppProvider>
    </ThemeProvider>
  );
  return onOpenCommandPalette;
};

describe('HeaderBar responsive entry points (D15)', () => {
  it('offers a compact search button that is hidden from `sm` upward', () => {
    renderHeader();
    const compact = screen.getByTestId('header-search-compact');
    expect(compact.className).toContain('sm:hidden');
    expect(compact.getAttribute('aria-label')).toBe('Search or jump to');
  });

  it('opens the command palette from the compact search button', () => {
    const onOpen = renderHeader();
    fireEvent.click(screen.getByTestId('header-search-compact'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('reflows the universe switcher into the profile menu on narrow screens', () => {
    renderHeader();
    // The inline switcher is hidden below `md`. The accessible name now carries the selection
    // (WCAG 2.5.3), so match the prefix.
    const inline = screen.getByLabelText(/^Select audit universe/);
    expect(inline.closest('.hidden')).not.toBeNull();
    // Opening the profile menu reveals a `md:hidden` copy of the same switcher.
    fireEvent.click(screen.getByLabelText(/^Open user profile menu/));
    const switchers = screen.getAllByLabelText(/^Select audit universe/);
    expect(switchers.length).toBe(2);
    expect(screen.getByTestId('mobile-universe-switcher').className).toContain('md:hidden');
  });
});
