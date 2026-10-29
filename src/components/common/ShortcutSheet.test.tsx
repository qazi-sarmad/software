import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShortcutSheet } from './ShortcutSheet';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';

const renderSheet = (user = testUser('cia'), onClose = () => {}) =>
  render(
    <ThemeProvider>
      <AppProvider user={user} seed={testSeed}>
        <ShortcutSheet isOpen onClose={onClose} />
      </AppProvider>
    </ThemeProvider>
  );

const SRC = readFileSync(resolve(process.cwd(), 'src/components/common/ShortcutSheet.tsx'), 'utf-8');

describe('ShortcutSheet (U8)', () => {
  it('lists the shortcuts a CIA may use, grouped, with a key sequence', () => {
    renderSheet();
    expect(screen.getByTestId('shortcut-sheet')).toBeDefined();
    expect(screen.getByTestId('shortcut-sheet-group-navigate')).toBeDefined();
    expect(screen.getByTestId('shortcut-sheet-item-palette.open')).toBeDefined();
    expect(screen.getByTestId('shortcut-sheet-item-go.dashboard')).toBeDefined();
    expect(screen.getByTestId('shortcut-sheet-item-help.shortcuts')).toBeDefined();
  });

  it('dismisses on Escape and on the close button', () => {
    const onClose = vi.fn();
    renderSheet(testUser('cia'), onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(
      <ThemeProvider>
        <AppProvider user={testUser('cia')} seed={testSeed}>
          <ShortcutSheet isOpen={false} onClose={() => {}} />
        </AppProvider>
      </ThemeProvider>
    );
    expect(screen.queryByTestId('shortcut-sheet')).toBeNull();
  });

  // §27.5: no blocking modals. The sheet is a complementary panel, never a dialog or a scrim.
  it('is non-blocking by construction', () => {
    expect(SRC).not.toMatch(/fixed inset-0/);
    expect(SRC).not.toMatch(/aria-modal/);
    expect(SRC).not.toMatch(/role\s*=\s*["']dialog["']/);
    expect(SRC).toMatch(/role="complementary"/);
    expect(SRC).toMatch(/fixed top-14/);
  });
});
