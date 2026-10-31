import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StandardsAffordance } from './StandardsAffordance';
import { StandardsView } from './StandardsView';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const wrap = (role: Role, children: React.ReactNode) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        {children}
      </AppProvider>
    </ThemeProvider>
  );

describe('StandardsAffordance (E6)', () => {
  it('renders the standards a screen addresses, each with a screen-prefixed testid', () => {
    wrap('cia', <StandardsAffordance kind="screen" target="AF-06" screenId="AF-06" />);
    const row = screen.getByTestId('AF-06-standards');
    expect(row.getAttribute('data-standards-kind')).toBe('screen');
    expect(row.getAttribute('data-standards-target')).toBe('AF-06');
    // AF-06 addresses the sampling standards; each chip carries its own testid.
    expect(screen.getByTestId('AF-06-standards-14.1')).toBeTruthy();
    expect(screen.getByTestId('AF-06-standards-open')).toBeTruthy();
  });

  it('renders a lifecycle step and a report section', () => {
    wrap('cia', <StandardsAffordance kind="step" target="testing" screenId="AF-01" element="standards-step" />);
    expect(screen.getByTestId('AF-01-standards-step')).toBeTruthy();
    expect(screen.getByTestId('AF-01-standards-step-14.2')).toBeTruthy();
    wrap('cia', <StandardsAffordance kind="section" target="findings" screenId="WK-11" element="standards-section" />);
    expect(screen.getByTestId('WK-11-standards-section-14.3')).toBeTruthy();
  });

  it('renders nothing for a surface with no standards rather than an empty box', () => {
    const { container } = wrap('cia', <StandardsAffordance kind="screen" target="NOT-A-SCREEN" screenId="XX-99" />);
    expect(container.querySelector('[data-standards-kind]')).toBeNull();
  });
});

describe('StandardsView (E7)', () => {
  it('is a complementary panel, never a dialog', () => {
    wrap('cia', <StandardsView screenId="OA-19" />);
    const view = screen.getByTestId('OA-19-standards-view');
    expect(view.getAttribute('role')).toBe('complementary');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists every standard and marks implementation honestly', () => {
    wrap('cia', <StandardsView screenId="OA-19" />);
    const row = screen.getByTestId('standards-row-13.2');
    expect(row.getAttribute('data-standard-implemented')).toBe('true');
    // A standard the product does not address is shown as not implemented.
    const notImpl = document.querySelector('[data-standard-implemented="false"]');
    expect(notImpl).toBeTruthy();
  });

  it('drills a standard to its implementation and evidence', () => {
    wrap('cia', <StandardsView screenId="OA-19" />);
    fireEvent.click(screen.getByTestId('standards-row-13.2-toggle'));
    expect(screen.getByTestId('standards-row-13.2-implementation').textContent).not.toContain('Not yet implemented');
    expect(screen.getByTestId('standards-row-13.2-screens')).toBeTruthy();
    expect(screen.getByTestId('standards-row-13.2-evidence')).toBeTruthy();
  });

  it('filters to implemented standards on request', () => {
    wrap('cia', <StandardsView screenId="OA-19" />);
    fireEvent.click(screen.getByTestId('OA-19-standards-only-implemented'));
    expect(document.querySelector('[data-standard-implemented="false"]')).toBeNull();
  });
});
