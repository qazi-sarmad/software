import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewCommentsGlobalDock } from './ReviewCommentsGlobalDock';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';

describe('§ 3.5 Global Review Comments Dock', () => {
  it('renders floating launcher button and opens dock on click', () => {
    render(
      <ThemeProvider>
        <AppProvider>
          <ReviewCommentsGlobalDock />
        </AppProvider>
      </ThemeProvider>
    );

    // Assert floating launcher button is rendered
    const launcherBtn = screen.getByLabelText('Open review comments dock');
    expect(launcherBtn).toBeDefined();

    // Click to open dock
    fireEvent.click(launcherBtn);

    // Verify dock panel header is visible
    expect(screen.getByText('Review Comments')).toBeDefined();
    expect(screen.getByText('View full comment history across all cycles')).toBeDefined();
  });
});
