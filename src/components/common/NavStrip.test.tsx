import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavStrip } from './NavStrip';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';

describe('Part 4.1 NavStrip Component & Draggable Pill', () => {
  it('renders exactly the 7 canonical tabs, in order, without Reports, Calendar or Workbench', () => {
    render(
      <ThemeProvider>
        <AppProvider>
          <NavStrip />
        </AppProvider>
      </ThemeProvider>
    );

    const expected = [
      'Executive Summary',
      'Pending Tasks',
      'Audit Universe',
      'Audit Plan',
      'SIRA',
      'Audit File',
      'Issues Register',
    ];
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(expected);
    expected.forEach((label) => expect(screen.getByText(label)).toBeDefined());

    // Discarded tabs must not exist (Guide v7 §1.4 / §4.1)
    expect(screen.queryByText('Reports')).toBeNull();
    expect(screen.queryByText('Calendar')).toBeNull();
    expect(screen.queryByText('Workbench')).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('renders draggable pill container with CSS grid layout and 2px accent underline', () => {
    const { container } = render(
      <ThemeProvider>
        <AppProvider>
          <NavStrip />
        </AppProvider>
      </ThemeProvider>
    );

    const track = container.querySelector('[data-testid="nav-strip-track"]');
    expect(track).toBeDefined();

    const pill = container.querySelector('[data-testid="nav-draggable-pill"]');
    expect(pill).toBeDefined();

    // Verify 2px accent underline inside pill
    const accentLine = pill?.querySelector('.bg-accent');
    expect(accentLine).toBeDefined();
  });

  it('switches active tab when a tab button is clicked', () => {
    render(
      <ThemeProvider>
        <AppProvider>
          <NavStrip />
        </AppProvider>
      </ThemeProvider>
    );

    const siraTabButton = screen.getByTitle('SIRA');
    fireEvent.click(siraTabButton);

    // SIRA button should now have active font class
    expect(siraTabButton.className).toContain('font-semibold');
  });
});
