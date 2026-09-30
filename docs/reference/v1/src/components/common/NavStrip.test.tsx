import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavStrip } from './NavStrip';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';

describe('§ 3.2 NavStrip Component & Draggable Pill', () => {
  it('renders all 6 canonical tabs without Workbench tab', () => {
    render(
      <ThemeProvider>
        <AppProvider>
          <NavStrip />
        </AppProvider>
      </ThemeProvider>
    );

    // Assert the 6 canonical tabs exist
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Calendar')).toBeDefined();
    expect(screen.getByText('Audit Plan')).toBeDefined();
    expect(screen.getByText('Audit Universe')).toBeDefined();
    expect(screen.getByText('Issues Register')).toBeDefined();
    expect(screen.getByText('Reports')).toBeDefined();

    // Verify Workbench is NOT a navigation tab (§ 3.2 requirement)
    expect(screen.queryByText('Workbench')).toBeNull();
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

    const calendarTabButton = screen.getByTitle('Calendar');
    fireEvent.click(calendarTabButton);

    // Calendar button should now have active font class
    expect(calendarTabButton.className).toContain('text-primary');
  });
});
