import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SiraModelEditor } from './SiraModelEditor';
import { SiraCyclePanel } from './SiraCyclePanel';
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

const MODEL = {
  aggregation: 'weighted_sum',
  version: 2,
  factors: [{ key: 'f1', label: 'Impact', weight: 40, ordinal: 1 }],
  scales: [{ point: 1, label: 'Low' }],
  bands: [{ name: 'High', min: 60, max: 100, ordinal: 1 }],
};

describe('SiraModelEditor', () => {
  it('shows an empty state without a model', () => {
    wrap('cia', <SiraModelEditor model={null} />);
    expect(screen.getByTestId('sira-model-empty')).toBeTruthy();
  });

  it('renders factors, bands and version', () => {
    wrap('cia', <SiraModelEditor model={MODEL} />);
    expect(screen.getByTestId('sira-model-version').textContent).toBe('v2');
    expect(screen.getByTestId('sira-factors').textContent).toMatch(/Impact/);
    expect(screen.getByTestId('sira-bands').textContent).toMatch(/High/);
  });

  it('is read-only without edit_config', () => {
    wrap('preparer', <SiraModelEditor model={MODEL} />);
    expect(screen.getByTestId('sira-model-locked')).toBeTruthy();
  });

  it('is not read-only for a session with edit_config', () => {
    wrap('cia', <SiraModelEditor model={MODEL} />);
    expect(screen.queryByTestId('sira-model-locked')).toBeNull();
  });
});

describe('SiraCyclePanel', () => {
  it('shows empty states', () => {
    wrap('cia', <SiraCyclePanel cycles={[]} emergent={[]} />);
    expect(screen.getByTestId('sira-cycles-empty')).toBeTruthy();
    expect(screen.getByTestId('emergent-empty')).toBeTruthy();
  });

  it('offers publish only on a draft cycle for a manager', () => {
    wrap('cia', <SiraCyclePanel cycles={[{ id: 'c1', year: 2026, status: 'draft', publishedAt: null }]} emergent={[]} />);
    expect(screen.getByTestId('sira-publish-c1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sira-publish-c1'));
  });

  it('shows no publish control on a published cycle', () => {
    wrap('cia', <SiraCyclePanel cycles={[{ id: 'c1', year: 2026, status: 'published', publishedAt: '2026-01-01' }]} emergent={[]} />);
    expect(screen.queryByTestId('sira-publish-c1')).toBeNull();
  });

  it('shows the mandatory-reason text of an emergent risk', () => {
    wrap('cia', (
      <SiraCyclePanel
        cycles={[]}
        emergent={[{ id: 'r1', title: 'New risk', description: 'd', status: 'rejected', decisionReason: 'not material enough' }]}
      />
    ));
    expect(screen.getByTestId('emergent-reason-r1').textContent).toMatch(/not material enough/);
  });
});
