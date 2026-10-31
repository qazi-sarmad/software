import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const searchGlobal = vi.fn();

vi.mock('../../data/globalSearch', () => ({
  searchDocumentsGlobal: (...a: unknown[]) => searchGlobal(...a),
}));

const setActiveTab = vi.fn();
const setSelectedEngagementId = vi.fn();
const openInspector = vi.fn();

const userRef: { current: Record<string, unknown> & { rights: Record<string, boolean>; role: string } } = {
  current: {
    id: 'u1', name: 'CIA', email: 'cia@example.test', avatar: '', role: 'cia',
    universeIds: ['*'], entityIds: ['*'],
    rights: { perform_work: true, review_and_approve: true },
  },
};
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({
    currentUser: userRef.current,
    setActiveTab,
    setSelectedEngagementId,
    openInspector,
  }),
}));

import { GlobalSearchPanel } from './GlobalSearchPanel';

const HIT = {
  fileId: 'f1',
  filename: 'u1-reg.pdf',
  stage: 'planning',
  engagementId: 'e1',
  engagementTitle: 'A-Eng1',
  entityId: 'en1',
  entityName: 'A-E1',
  universeId: 'u1',
  universeName: 'A-U1',
  headline: 'Section 4: the bank shall comply with <mark>REGULATION 12</mark> on capital adequacy.',
  rank: 0.5,
};

beforeEach(() => {
  searchGlobal.mockReset();
  setActiveTab.mockReset();
  setSelectedEngagementId.mockReset();
  openInspector.mockReset();
  userRef.current.rights = { perform_work: true, review_and_approve: true };
});

describe('OA-39 global access-based document search', () => {
  it('is its own screen, distinct from the document review panel', () => {
    render(<GlobalSearchPanel />);
    expect(screen.getByTestId('globalsearch-panel')).toBeTruthy();
    expect(screen.getByTestId('globalsearch-panel').getAttribute('data-screen-id')).toBe('OA-39');
    expect(screen.queryByTestId('docreview-panel')).toBeNull();
  });

  it('offers no search box to a principal with no read right, and says why', () => {
    // org_admin is a configuration-only role: manage_users / manage_roles / edit_config, no read right.
    userRef.current.role = 'org_admin';
    userRef.current.rights = { edit_config: true, manage_users: true };
    render(<GlobalSearchPanel />);
    expect(screen.queryByTestId('globalsearch-input')).toBeNull();
    expect(screen.getByTestId('globalsearch-rights-note')).toBeTruthy();
  });

  it('searches the whole tenant and renders the hit with its place', async () => {
    searchGlobal.mockResolvedValue({ ok: true, count: 1, hits: [HIT] });
    render(<GlobalSearchPanel />);
    fireEvent.change(screen.getByTestId('globalsearch-input'), { target: { value: 'regulation 12' } });
    await waitFor(() => expect(screen.getByTestId('globalsearch-results')).toBeTruthy());
    expect(searchGlobal).toHaveBeenCalledWith('regulation 12');
    expect(screen.getByTestId('globalsearch-hit-f1').textContent).toContain('u1-reg.pdf');
    expect(screen.getByTestId('globalsearch-count').textContent).toContain('1 document');
    // The placement line names the engagement, entity and universe.
    const place = screen.getByTestId('globalsearch-place-f1').textContent ?? '';
    expect(place).toContain('A-Eng1');
    expect(place).toContain('A-E1');
    expect(place).toContain('A-U1');
    // The matched term is rendered as a <mark>, and the surrounding text as plain text.
    const snippet = screen.getByTestId('globalsearch-snippet-f1');
    expect(snippet.querySelector('mark')?.textContent).toBe('REGULATION 12');
    expect(snippet.textContent).toContain('capital adequacy');
  });

  it('does not treat document text as HTML (no injection)', async () => {
    searchGlobal.mockResolvedValue({
      ok: true, count: 1,
      hits: [{ ...HIT, headline: '<img src=x onerror=alert(1)> <mark>REGULATION 12</mark>' }],
    });
    render(<GlobalSearchPanel />);
    fireEvent.change(screen.getByTestId('globalsearch-input'), { target: { value: 'regulation 12' } });
    await waitFor(() => expect(screen.getByTestId('globalsearch-results')).toBeTruthy());
    const snippet = screen.getByTestId('globalsearch-snippet-f1');
    expect(snippet.querySelector('img')).toBeNull();
    expect(snippet.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(snippet.querySelector('mark')?.textContent).toBe('REGULATION 12');
  });

  it('shows the named refusal, never an empty list', async () => {
    searchGlobal.mockResolvedValue({ ok: false, reason: 'a search term is required' });
    render(<GlobalSearchPanel />);
    fireEvent.change(screen.getByTestId('globalsearch-input'), { target: { value: '   ' } });
    // A blank query is not sent at all; the RPC-level refusal is proven separately.
    await waitFor(() => expect(searchGlobal).not.toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('globalsearch-input'), { target: { value: 'x' } });
    await waitFor(() => expect(screen.getByTestId('globalsearch-refusal')).toBeTruthy());
    expect(screen.getByTestId('globalsearch-refusal').textContent).toContain('a search term is required');
    expect(screen.queryByTestId('globalsearch-results')).toBeNull();
  });

  it('says so, honestly, when nothing within the caller access matches', async () => {
    searchGlobal.mockResolvedValue({ ok: true, count: 0, hits: [] });
    render(<GlobalSearchPanel />);
    fireEvent.change(screen.getByTestId('globalsearch-input'), { target: { value: 'zzz-none' } });
    await waitFor(() => expect(screen.getByTestId('globalsearch-empty')).toBeTruthy());
    expect(screen.getByTestId('globalsearch-empty').textContent).toMatch(/within your access/i);
  });

  it('shows a load error inline', async () => {
    searchGlobal.mockRejectedValue(new Error('the search could not be run'));
    render(<GlobalSearchPanel />);
    fireEvent.change(screen.getByTestId('globalsearch-input'), { target: { value: 'regulation' } });
    await waitFor(() => expect(screen.getByTestId('globalsearch-error')).toBeTruthy());
    expect(screen.getByTestId('globalsearch-error').textContent).toContain('the search could not be run');
  });

  it('opens the hit in the existing engagement drilldown', async () => {
    searchGlobal.mockResolvedValue({ ok: true, count: 1, hits: [HIT] });
    render(<GlobalSearchPanel />);
    fireEvent.change(screen.getByTestId('globalsearch-input'), { target: { value: 'regulation 12' } });
    await waitFor(() => expect(screen.getByTestId('globalsearch-hit-f1')).toBeTruthy());
    // The row is a button; clicking the filename (inside it) bubbles to the row's handler.
    fireEvent.click(screen.getByTestId('globalsearch-snippet-f1'));
    expect(setSelectedEngagementId).toHaveBeenCalledWith('e1');
    expect(setActiveTab).toHaveBeenCalledWith('audit_file');
    expect(openInspector).toHaveBeenCalledWith('audit_file', { engagement: { id: 'e1' } });
  });
});
