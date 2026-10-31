import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FrontDoor } from './FrontDoor';
import type { FrontDoorItem } from '../../lib/frontDoor';

const items: FrontDoorItem[] = [
  {
    id: 'cap:CAP-1',
    kind: 'cap_overdue',
    title: 'Fix the pipeline',
    detail: 'Treasury · was due 2026-01-01',
    actionLabel: 'Validate the CAP',
    engagementId: 'g1',
  },
  {
    id: 'cmt:cm1',
    kind: 'comment',
    title: 'Attach the statement',
    detail: 'Rashid · on WP-01',
    actionLabel: 'Answer the comment',
    workpaperId: 'w1',
  },
];

describe('FrontDoor (U3)', () => {
  it('renders the ordered rows with their action verb and consequence kind', () => {
    render(<FrontDoor items={items} summary="1 CAP overdue. 1 comment unanswered." screenId="WQ-01" onOpen={() => {}} />);
    expect(screen.getByTestId('WQ-01-front-door-count').textContent).toBe('2');
    expect(screen.getByTestId('WQ-01-front-door-summary').textContent).toMatch(/1 CAP overdue/);
    const row = screen.getByTestId('WQ-01-front-door-row-cap:CAP-1');
    expect(row.getAttribute('data-front-door-kind')).toBe('cap_overdue');
    expect(row.textContent).toMatch(/Validate the CAP/);
  });

  it('opens a row through the host callback', () => {
    const onOpen = vi.fn();
    render(<FrontDoor items={items} summary="x" screenId="WQ-01" onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('WQ-01-front-door-row-cmt:cm1'));
    expect(onOpen).toHaveBeenCalledWith(items[1]);
  });

  it('shows an honest empty state when nothing needs the user', () => {
    render(<FrontDoor items={[]} summary="Nothing needs you right now." screenId="WQ-01" onOpen={() => {}} />);
    expect(screen.getByTestId('WQ-01-front-door-empty').textContent).toMatch(/Nothing needs you/);
  });
});
