import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const wrap = (role: Role, ui: React.ReactNode) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        {ui}
      </AppProvider>
    </ThemeProvider>
  );

describe('CommandPalette (U2)', () => {
  it('renders nothing when closed', () => {
    wrap('cia', <CommandPalette isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('offers screens, actions and explain entries when open', () => {
    wrap('cia', <CommandPalette isOpen onClose={() => {}} />);
    expect(screen.getByTestId('command-palette')).toBeTruthy();
    expect(screen.getByTestId('command-palette-item-screen.audit_file')).toBeTruthy();
    expect(screen.getByTestId('command-palette-item-action.standards_view')).toBeTruthy();
    expect(screen.getByTestId('command-palette-item-explain.term.coverage')).toBeTruthy();
  });

  it('filters to the analyst engine on "benford"', () => {
    wrap('cia', <CommandPalette isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: 'benford' } });
    expect(screen.getByTestId('command-palette-item-screen.audit_file')).toBeTruthy();
    expect(screen.queryByTestId('command-palette-item-screen.sira')).toBeNull();
  });

  it('says so, honestly, when nothing matches within the caller permissions', () => {
    wrap('cia', <CommandPalette isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: 'zzzz-none' } });
    expect(screen.getByTestId('command-palette-empty').textContent).toMatch(/permissions/i);
  });

  it('jumps to the analyst engine screen and closes on Enter', async () => {
    const onClose = vi.fn();
    wrap('cia', <CommandPalette isOpen onClose={onClose} />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'benford' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('walks the list with ArrowDown and Home/End', () => {
    wrap('cia', <CommandPalette isOpen onClose={() => {}} />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'End' });
    // The active descendant is always a rendered option id.
    expect(input.getAttribute('aria-activedescendant')).toMatch(/^command-palette-opt-/);
  });

  it('opens an explain row inline, never as a modal', () => {
    wrap('cia', <CommandPalette isOpen onClose={() => {}} />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'term.coverage' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const panel = screen.getByTestId('command-palette-explain');
    expect(panel.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('dismisses on Escape', async () => {
    const onClose = vi.fn();
    wrap('cia', <CommandPalette isOpen onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
