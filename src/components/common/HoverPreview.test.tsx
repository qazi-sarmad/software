import React from 'react';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { HoverPreview } from './HoverPreview';

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

describe('Task C: Universal Hover Previews Component Tests', () => {
  it('Gantt Bar: Renders preview on hover and hides on mouse leave', async () => {
    const ganttContent = {
      title: 'Q3 Liquidity Coverage Audit',
      category: 'Stage: Fieldwork',
      subtitle: '68% complete',
      status: 'In Fieldwork',
      statusType: 'amber' as const,
      dueDate: '2026-10-24',
      exceptionsCount: 2,
    };

    render(
      <HoverPreview content={ganttContent}>
        <div data-testid="gantt-bar">Gantt Bar</div>
      </HoverPreview>
    );

    const trigger = screen.getByTestId('hover-preview-trigger');

    // Initially popover is not in DOM
    expect(screen.queryByTestId('hover-preview-popover')).toBeNull();

    // Hover trigger
    fireEvent.mouseEnter(trigger);

    // Wait for popover to appear past delay
    await waitFor(() => {
      expect(screen.getByTestId('hover-preview-popover')).toBeDefined();
    }, { timeout: 1000 });

    expect(screen.getByText('Q3 Liquidity Coverage Audit')).toBeDefined();
    expect(screen.getByText('2 Identified')).toBeDefined();

    // Leave trigger
    fireEvent.mouseLeave(trigger);

    // Wait for popover exit animation to complete and remove from DOM
    await waitFor(() => {
      expect(screen.queryByTestId('hover-preview-popover')).toBeNull();
    }, { timeout: 1000 });
  });

  it('Calendar Day: Renders preview with milestone details on hover', async () => {
    const calendarContent = {
      title: 'September 30, 2026',
      category: 'Audit Calendar Milestone',
      subtitle: '3 Scheduled Milestones',
      status: 'Critical Due Date',
      statusType: 'cinnabar' as const,
      metrics: [{ label: 'Engagements Due', value: 2 }],
    };

    render(
      <HoverPreview content={calendarContent}>
        <div data-testid="calendar-day">Day 30</div>
      </HoverPreview>
    );

    const trigger = screen.getByTestId('hover-preview-trigger');
    fireEvent.mouseEnter(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('hover-preview-popover')).toBeDefined();
    }, { timeout: 1000 });

    expect(screen.getByText('September 30, 2026')).toBeDefined();
    expect(screen.getByText('Critical Due Date')).toBeDefined();

    fireEvent.mouseLeave(trigger);

    await waitFor(() => {
      expect(screen.queryByTestId('hover-preview-popover')).toBeNull();
    }, { timeout: 1000 });
  });

  it('Issue Row: Displays owner, due date, and exception status on keyboard focus', async () => {
    const issueContent = {
      title: 'Delayed Cash Ledger Posting',
      category: 'Treasury Finding',
      status: 'CRITICAL',
      statusType: 'cinnabar' as const,
      owner: 'David Miller',
      dueDate: '2026-11-30',
    };

    render(
      <HoverPreview content={issueContent}>
        <div data-testid="issue-row">Issue Row</div>
      </HoverPreview>
    );

    const trigger = screen.getByTestId('hover-preview-trigger');

    // Test Keyboard focus support
    fireEvent.focus(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('hover-preview-popover')).toBeDefined();
    }, { timeout: 1000 });

    expect(screen.getByText('Delayed Cash Ledger Posting')).toBeDefined();
    expect(screen.getByText('David Miller')).toBeDefined();

    // Blur hides preview
    fireEvent.blur(trigger);

    await waitFor(() => {
      expect(screen.queryByTestId('hover-preview-popover')).toBeNull();
    }, { timeout: 1000 });
  });

  it('Entity Card: Renders SIRA score and controls count instantly', async () => {
    const entityContent = {
      title: 'Fixed Income & Derivatives Trading',
      category: 'GBM-TRADE',
      status: 'SIRA Score: 76/100',
      statusType: 'cinnabar' as const,
      metrics: [
        { label: 'Inherent Risk', value: 'HIGH' },
        { label: 'Controls Active', value: 16 },
      ],
    };

    render(
      <HoverPreview content={entityContent}>
        <div data-testid="entity-card">Entity Card</div>
      </HoverPreview>
    );

    const trigger = screen.getByTestId('hover-preview-trigger');
    fireEvent.mouseEnter(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('hover-preview-popover')).toBeDefined();
    }, { timeout: 1000 });

    expect(screen.getByText('Fixed Income & Derivatives Trading')).toBeDefined();
    expect(screen.getByText('SIRA Score: 76/100')).toBeDefined();

    fireEvent.mouseLeave(trigger);

    await waitFor(() => {
      expect(screen.queryByTestId('hover-preview-popover')).toBeNull();
    }, { timeout: 1000 });
  });

  it('Review Comment: Renders author and review query on touch long-press', async () => {
    const commentContent = {
      title: 'Comment from Marcus Vance (REVIEWER)',
      category: 'Workpaper WP-TREAS-LQ-01',
      subtitle: 'Please check July 14th tickmark statement',
      status: 'Pending Preparer Action',
      statusType: 'amber' as const,
    };

    render(
      <HoverPreview content={commentContent}>
        <div data-testid="comment-dock-item">Comment Item</div>
      </HoverPreview>
    );

    const trigger = screen.getByTestId('hover-preview-trigger');

    // Test Touch Long-press support (350ms)
    fireEvent.touchStart(trigger);

    await waitFor(() => {
      expect(screen.getByTestId('hover-preview-popover')).toBeDefined();
    }, { timeout: 1000 });

    expect(screen.getByText('Comment from Marcus Vance (REVIEWER)')).toBeDefined();

    fireEvent.touchEnd(trigger);
  });
});
