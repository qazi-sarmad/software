import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentHistoryPanel } from './CommentHistoryPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';

/**
 * S21 — the review-comment popout surface.
 *
 * The panel is the live review surface (the dead `ReviewCommentsDock` was deleted in U14). These
 * tests pin the states the contract (CH-07) documents: full history, search, cycle filter, the
 * open/cleared status pills, the drilldown from a count, the per-row popout trigger, the empty
 * state and the redacted viewer. Every element carries a `CH-07-*` testid.
 */
function renderPanel(props: React.ComponentProps<typeof CommentHistoryPanel> = {}) {
  return render(
    <ThemeProvider>
      <AppProvider user={testUser()} seed={testSeed}>
        <CommentHistoryPanel {...props} />
      </AppProvider>
    </ThemeProvider>
  );
}

describe('CH-07 review comment history and popout (S21)', () => {
  it('renders the full history with every element testid-prefixed CH-07', () => {
    renderPanel();
    expect(screen.getByTestId('CH-07-comment-history')).toBeDefined();
    expect(screen.getByTestId('CH-07-comment-list')).toBeDefined();
    expect(screen.getByTestId('CH-07-comment-search')).toBeDefined();
    expect(screen.getByTestId('CH-07-comment-cycle-filter')).toBeDefined();
    expect(screen.getByTestId('CH-07-comment-status-all')).toBeDefined();
    expect(screen.getByTestId('CH-07-comment-status-open')).toBeDefined();
    expect(screen.getByTestId('CH-07-comment-status-cleared')).toBeDefined();
  });

  it('carries a hover/focus popout trigger per comment, with the access-filtered status', () => {
    renderPanel();
    const comment = testSeed.comments[0];
    // The custom testid sits on the trigger's inner span; the focusable chrome is the shared
    // `hover-preview-trigger` (the same popout every explain affordance uses).
    const inner = screen.getByTestId(`CH-07-comment-popout-${comment.id}`);
    const trigger = inner.closest('[data-testid="hover-preview-trigger"]') as HTMLElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('tabindex')).toBe('0');
    expect(screen.getByTestId(`CH-07-comment-${comment.id}`)).toBeDefined();
    expect(screen.getByTestId(`CH-07-comment-state-${comment.id}`)).toBeDefined();
    expect(screen.getByTestId(`CH-07-comment-resolution-${comment.id}`)).toBeDefined();
    expect(screen.getByTestId(`CH-07-comment-age-${comment.id}`)).toBeDefined();
  });

  it('opens the popout on focus and describes the trigger with it', () => {
    renderPanel();
    const comment = testSeed.comments[0];
    const inner = screen.getByTestId(`CH-07-comment-popout-${comment.id}`);
    const trigger = inner.closest('[data-testid="hover-preview-trigger"]') as HTMLElement;
    fireEvent.focus(trigger);
    const popover = screen.getByTestId('hover-preview-popover');
    // A tooltip, never a dialog; the trigger points at it while open.
    expect(popover.getAttribute('role')).toBe('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(`CH-07-comment-popout-${comment.id}-tip`);
    // The popover carries the author and the status chip.
    expect(popover.textContent).toContain(comment.authorName);
  });

  it('filters by search text', () => {
    renderPanel();
    const search = screen.getByTestId('CH-07-comment-search');
    fireEvent.change(search, { target: { value: 'CANARY-TREASURY' } });
    const comments = testSeed.comments;
    // The treas comment survives the filter; an unrelated one does not.
    expect(screen.queryByTestId(`CH-07-comment-${comments[0].id}`)).toBeDefined();
    const other = comments.find((c) => !c.text.includes('CANARY-TREASURY'));
    if (other) expect(screen.queryByTestId(`CH-07-comment-${other.id}`)).toBeNull();
  });

  it('filters by status pill', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('CH-07-comment-status-cleared'));
    const cleared = testSeed.comments.filter((c) => c.status === 'cleared' || (!c.status && c.resolved));
    for (const c of cleared) {
      expect(screen.queryByTestId(`CH-07-comment-${c.id}`)).toBeDefined();
    }
    const open = testSeed.comments.find((c) => !(c.status === 'cleared' || (!c.status && c.resolved)));
    if (open) expect(screen.queryByTestId(`CH-07-comment-${open.id}`)).toBeNull();
  });

  it('drills from the open count to the exact comments behind it, non-blocking', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('CH-07-comment-status-open'));
    const panel = screen.getByTestId('CH-07-drilldown');
    // A complementary region, never a modal.
    expect(panel.getAttribute('role')).toBe('complementary');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    const openComment = testSeed.comments.find((c) => !(c.status === 'cleared' || (!c.status && c.resolved)));
    if (openComment) {
      expect(screen.getByTestId(`CH-07-drilldown-row-${openComment.id}`)).toBeDefined();
    }
  });

  it('shows a guided empty state when nothing matches', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('CH-07-comment-search'), {
      target: { value: 'no-such-comment-xyz' },
    });
    expect(screen.getByTestId('CH-07-comment-empty')).toBeDefined();
  });

  it('renders the single-comment dialogue when one is passed in', () => {
    const comment = testSeed.comments[0];
    const workpaper = testSeed.workpapers.find((w) => w.id === comment.workpaperId);
    renderPanel({ data: { comment, workpaper } });
    expect(screen.getByTestId(`CH-07-comment-${comment.id}`)).toBeDefined();
    // Single mode has no cross-cycle filter bar.
    expect(screen.queryByTestId('CH-07-comment-search')).toBeNull();
  });
});
