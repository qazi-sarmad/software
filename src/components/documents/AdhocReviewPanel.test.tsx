import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const userRef = {
  current: {
    id: 'u1', name: 'CIA', email: 'cia@example.test', avatar: '', role: 'cia',
    universeIds: ['*'], entityIds: ['*'],
    rights: { perform_work: true, review_and_approve: true },
  },
};
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: userRef.current }),
}));

import { AdhocReviewPanel } from './AdhocReviewPanel';

beforeEach(() => {
  userRef.current.rights = { perform_work: true, review_and_approve: true };
  (userRef.current as { role: string }).role = 'cia';
});

describe('OA-38 ad-hoc review builder (a separate module)', () => {
  it('is its own screen, distinct from the document review panel', () => {
    render(<AdhocReviewPanel />);
    expect(screen.getByTestId('adhoc-review-panel')).toBeTruthy();
    expect(screen.getByTestId('adhoc-review-panel').getAttribute('data-screen')).toBe('OA-38');
    // It is not the document-review panel; the two are separate UI modules.
    expect(screen.queryByTestId('docreview-panel')).toBeNull();
  });

  it('previews the built rule over the fixed sample, through the real engine', () => {
    render(<AdhocReviewPanel />);
    // The default is amount > 100, and the sample has one row above 100 (amount 120).
    fireEvent.click(screen.getByTestId('adhoc-review-preview'));
    expect(screen.getByTestId('adhoc-review-result')).toBeTruthy();
    expect(screen.getByTestId('adhoc-review-summary').textContent).toContain('1 of 3 sample row(s) match');
    expect(screen.getByTestId('adhoc-review-summary').textContent).toContain('adhoc.review@v1');
    expect(screen.getByTestId('adhoc-review-findings').textContent).toContain('s1');
  });

  it('honours the operator: "missing" matches the row with no value', () => {
    render(<AdhocReviewPanel />);
    fireEvent.change(screen.getByTestId('adhoc-review-source'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByTestId('adhoc-review-condition'), { target: { value: 'missing' } });
    fireEvent.click(screen.getByTestId('adhoc-review-preview'));
    expect(screen.getByTestId('adhoc-review-findings').textContent).toContain('s1');
    expect(screen.getByTestId('adhoc-review-summary').textContent).toContain('1 of 3');
  });

  it('reports no match rather than an empty table when nothing matches', () => {
    render(<AdhocReviewPanel />);
    fireEvent.change(screen.getByTestId('adhoc-review-threshold'), { target: { value: '10000' } });
    fireEvent.click(screen.getByTestId('adhoc-review-preview'));
    expect(screen.getByTestId('adhoc-review-empty')).toBeTruthy();
  });

  it('shows the second bound only for "between", and uses it', () => {
    render(<AdhocReviewPanel />);
    expect(screen.queryByTestId('adhoc-review-threshold2')).toBeNull();
    fireEvent.change(screen.getByTestId('adhoc-review-condition'), { target: { value: 'between' } });
    expect(screen.getByTestId('adhoc-review-threshold2')).toBeTruthy();
    fireEvent.change(screen.getByTestId('adhoc-review-threshold'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('adhoc-review-threshold2'), { target: { value: '200' } });
    fireEvent.click(screen.getByTestId('adhoc-review-preview'));
    // Rows with amount 120 and 5 fall in [1, 200]; the null row does not.
    expect(screen.getByTestId('adhoc-review-summary').textContent).toContain('2 of 3');
  });

  it('refuses to build without perform_work', () => {
    (userRef.current as { rights: Record<string, boolean> }).rights = {};
    (userRef.current as { role: string }).role = 'observer';
    render(<AdhocReviewPanel />);
    expect(screen.getByTestId('adhoc-review-rights-note')).toBeTruthy();
    expect((screen.getByTestId('adhoc-review-preview') as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces the builder’s own refusal when the source is empty', () => {
    render(<AdhocReviewPanel />);
    fireEvent.change(screen.getByTestId('adhoc-review-source'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('adhoc-review-preview'));
    expect(screen.getByTestId('adhoc-review-error')).toBeTruthy();
    expect(screen.queryByTestId('adhoc-review-result')).toBeNull();
  });
});
