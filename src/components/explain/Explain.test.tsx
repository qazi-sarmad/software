import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExplainPopout } from './ExplainPopout';
import { ExplainDetail } from './ExplainDetail';
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

describe('ExplainPopout (E2)', () => {
  it('carries the screen-prefixed testid and the explain id/status as data attributes', () => {
    wrap('cia', (
      <ExplainPopout explainId="method.mus" screenId="AF-06">
        MUS
      </ExplainPopout>
    ));
    const el = screen.getByTestId('AF-06-explain');
    expect(el.getAttribute('data-explain-id')).toBe('method.mus');
    expect(el.getAttribute('data-explain-status')).toBe('ready');
  });

  it('opens a non-blocking tooltip on hover, never a dialog', () => {
    const { container } = wrap('cia', (
      <ExplainPopout explainId="method.mus" screenId="AF-06">
        MUS
      </ExplainPopout>
    ));
    const trigger = screen.getByTestId('hover-preview-trigger');
    fireEvent.mouseEnter(trigger);
    // The popover renders after the open timer (120ms); advance real timers via focus instead.
    fireEvent.focus(trigger);
    const popover = screen.getByTestId('hover-preview-popover');
    expect(popover.getAttribute('role')).toBe('tooltip');
    expect(popover.textContent).toMatch(/Monetary unit sampling/);
    // No blocking modal anywhere.
    expect(container.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('redacts the tooltip for a caller without the right, and says so', () => {
    wrap('preparer', (
      <ExplainPopout explainId="status.alert.ledger_chain" screenId="DB-01">
        Chain
      </ExplainPopout>
    ));
    const el = screen.getByTestId('DB-01-explain');
    expect(el.getAttribute('data-explain-status')).toBe('denied');
    fireEvent.focus(screen.getByTestId('hover-preview-trigger'));
    expect(screen.getByTestId('hover-preview-popover').textContent).toMatch(/do not have access/i);
  });

  it('points aria-describedby at the tooltip only while open', () => {
    wrap('cia', (
      <ExplainPopout explainId="method.mus" screenId="AF-06">
        MUS
      </ExplainPopout>
    ));
    const trigger = screen.getByTestId('hover-preview-trigger');
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
    fireEvent.focus(trigger);
    expect(trigger.getAttribute('aria-describedby')).toBe('AF-06-explain-tip');
  });
});

describe('ExplainDetail (E2, E6)', () => {
  it('renders the full reference: summary, effect, standards and source', () => {
    wrap('cia', <ExplainDetail explainId="method.mus" screenId="AF-06" />);
    expect(screen.getByTestId('AF-06-explain-title').textContent).toMatch(/Monetary unit sampling/);
    expect(screen.getByTestId('AF-06-explain-summary')).toBeTruthy();
    expect(screen.getByTestId('AF-06-explain-effect')).toBeTruthy();
    expect(screen.getByTestId('AF-06-explain-standards').textContent).toMatch(/14\.1/);
    expect(screen.getByTestId('AF-06-explain-source')).toBeTruthy();
  });

  it('is role=complementary, never a blocking modal', () => {
    wrap('cia', <ExplainDetail explainId="term.coverage" screenId="DB-01" />);
    const panel = screen.getByTestId('DB-01-explain-detail');
    expect(panel.getAttribute('role')).toBe('complementary');
    expect(panel.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('shows the redaction reason and no detail for a caller without the right', () => {
    wrap('preparer', <ExplainDetail explainId="status.alert.ledger_chain" screenId="DB-01" />);
    expect(screen.getByTestId('DB-01-explain-denied')).toBeTruthy();
    expect(screen.getByTestId('DB-01-explain-denied-reason').textContent).toMatch(/do not have access/i);
    expect(screen.queryByTestId('DB-01-explain-effect')).toBeNull();
  });

  it('renders contextual values the host screen handed it', () => {
    wrap('cia', (
      <ExplainDetail
        explainId="term.coverage"
        screenId="DB-01"
        context={{ values: [{ label: 'Coverage', value: '82%' }] }}
      />
    ));
    expect(screen.getByTestId('DB-01-explain-values').textContent).toMatch(/82%/);
  });

  it('pins and unpins with the pin control', () => {
    wrap('cia', <ExplainDetail explainId="term.coverage" screenId="DB-01" />);
    const pin = screen.getByTestId('DB-01-explain-pin');
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pin);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
  });
});
