import React from 'react';
import type { FrontDoorItem } from '../../lib/frontDoor';
import { ArrowRight } from '../common/Icons';

/**
 * The front door (U3; SPEC-v10 §5, docs/SYSTELIGON.md §11.1c Tier 1 item 3).
 *
 * What needs this user, today, ordered by consequence. It is a list, not a chart, and every row is
 * one click from the action. The ordering and the counting are the pure `buildFrontDoor` rule; this
 * component only renders it.
 *
 * Non-blocking by construction: a plain list inside the Work Queue, never a modal.
 */
export interface FrontDoorProps {
  items: FrontDoorItem[];
  summary: string;
  screenId: string;
  onOpen: (item: FrontDoorItem) => void;
}

export const FrontDoor: React.FC<FrontDoorProps> = ({ items, summary, screenId, onOpen }) => (
  <section
    data-testid={`${screenId}-front-door`}
    aria-label="What needs you"
    className="rounded-2xl bg-surface border border-hairline shadow-apple p-5 space-y-3"
  >
    <div className="flex items-center justify-between">
      <h2 className="text-apple-15 font-semibold text-primary">Needs you today</h2>
      <span data-testid={`${screenId}-front-door-count`} className="text-apple-12 tabular-nums text-secondary">
        {items.length}
      </span>
    </div>
    <p data-testid={`${screenId}-front-door-summary`} className="text-apple-13 text-secondary">
      {summary}
    </p>
    {items.length === 0 ? (
      <p data-testid={`${screenId}-front-door-empty`} className="text-apple-12 text-tertiary">
        Nothing needs you right now.
      </p>
    ) : (
      <ul data-testid={`${screenId}-front-door-list`} className="divide-y divide-hairline">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              data-testid={`${screenId}-front-door-row-${item.id}`}
              data-front-door-kind={item.kind}
              onClick={() => onOpen(item)}
              className="w-full text-left py-2.5 flex items-center justify-between gap-3 hover:bg-surface-hover rounded-lg px-2"
            >
              <span className="min-w-0">
                <span className="block text-apple-13 text-primary truncate">{item.title}</span>
                <span className="block text-apple-11 text-tertiary truncate">{item.detail}</span>
              </span>
              <span className="shrink-0 flex items-center gap-2 text-apple-11 font-medium text-accent">
                {item.actionLabel}
                <ArrowRight className="w-3.5 h-3.5 stroke-[1.5]" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);
