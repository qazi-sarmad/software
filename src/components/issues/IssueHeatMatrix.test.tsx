import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IssueHeatMatrix } from './IssueHeatMatrix';
import type { AuditIssue } from '../../types';

const AS_OF = '2026-10-26';

function issue(over: Partial<AuditIssue>): AuditIssue {
  return {
    id: 'i1', entityId: 'e1', universeId: 'u1', department: 'Finance', title: 'T', description: 'D',
    severity: 'medium', status: 'open', ownerId: 'o1', identifiedDate: '2026-10-01', dueDate: '2026-12-01',
    ...over,
  };
}

describe('IssueHeatMatrix (WP-V slice 1)', () => {
  it('draws a cell for every severity × aging bucket and totals them', () => {
    const issues = [
      issue({ id: 'a', severity: 'critical', identifiedDate: '2026-10-20' }),
      issue({ id: 'b', severity: 'high', identifiedDate: '2026-09-01' }),
      issue({ id: 'c', severity: 'medium', identifiedDate: '2026-07-01' }),
    ];
    render(<IssueHeatMatrix issues={issues} asOf={AS_OF} />);
    expect(screen.getByTestId('issues-heat-cell-critical-0-30').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('issues-heat-cell-high-31-60').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('issues-heat-cell-medium-90+').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('issues-heat-grand-total').textContent).toBe('3');
    expect(screen.getByTestId('issues-heat-summary').textContent).toContain('3 open issues');
  });

  it('marks a cell overdue when it holds an overdue open issue', () => {
    render(<IssueHeatMatrix issues={[issue({ severity: 'critical', identifiedDate: '2026-10-20', dueDate: '2026-10-22' })]} asOf={AS_OF} />);
    expect(screen.getByTestId('issues-heat-cell-critical-0-30').getAttribute('data-overdue')).toBe('true');
  });

  it('excludes closed issues from the picture', () => {
    render(<IssueHeatMatrix issues={[issue({ status: 'closed' })]} asOf={AS_OF} />);
    expect(screen.getByTestId('issues-heat-empty')).toBeTruthy();
  });

  it('filters the register to a severity when its row label is clicked', () => {
    const onPick = vi.fn();
    render(<IssueHeatMatrix issues={[issue({ severity: 'high' })]} asOf={AS_OF} onPickSeverity={onPick} />);
    fireEvent.click(screen.getByTestId('issues-heat-row-high'));
    expect(onPick).toHaveBeenCalledWith('high');
  });
});
