import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { listActivitySpine, subscribeActivity, type ActivitySpineRow } from '../../data/activity';
import { chooseTransport, pollDue } from '../../lib/liveSync';
import { activityAgeLabel, activityKind, activitySentence, mergeSpineRow } from '../../lib/activitySpine';
import { Activity } from '../common/Icons';

/** Per-kind dot colour. The colour is a property of the rule's kind, never of the row. */
const KIND_DOT: Record<string, string> = {
  approval: 'bg-verdigris',
  seal: 'bg-accent',
  publish: 'bg-accent',
  create: 'bg-tertiary',
  change: 'bg-tertiary',
  notice: 'bg-cinnabar',
};

/**
 * The live activity spine (U4; SYSTELIGON.md §11.1c Tier 1 item 4).
 *
 * A quiet, non-intrusive stream of what is happening in the organisation, on the existing
 * `src/lib/liveSync.ts` transport: Realtime when a socket is available, a bounded poll otherwise. The
 * sentence, the kind and the age are the pure `src/lib/activitySpine.ts` layer's; this component owns
 * only the timers and the markup. It is never a modal and never blocks: a compact `role="log"` list.
 *
 * The stream is rights-gated in the database (`activity_spine_list`): a scoped member gets an empty
 * stream and the designed empty state, never an error.
 */
export const ActivitySpine: React.FC = () => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId;
  const [rows, setRows] = useState<ActivitySpineRow[]>([]);
  const [transport, setTransport] = useState<'realtime' | 'poll'>('poll');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastPollRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      const next = await listActivitySpine(40, null);
      setRows(next);
    } catch {
      // A read failure leaves the last known stream in place; the surface shows what it had.
    }
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    void refresh();

    const sub = subscribeActivity(orgId, (row) => {
      if (!live) return;
      setRows((prev) => mergeSpineRow(prev, row));
    });
    if (sub) setTransport(chooseTransport({ realtimeAvailable: sub.isLive() }));

    const id = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const opts = { realtimeAvailable: sub?.isLive() ?? false };
      if (sub?.isLive()) setTransport('realtime');
      if (pollDue(now - lastPollRef.current, opts)) {
        lastPollRef.current = now;
        void refresh();
      }
    }, 1000);

    return () => {
      live = false;
      window.clearInterval(id);
      sub?.close();
    };
  }, [orgId, refresh]);

  const items = useMemo(
    () => rows.map((r) => ({ row: r, sentence: activitySentence(r), age: activityAgeLabel(r.ts, nowMs), kind: activityKind(r.action) })),
    [rows, nowMs]
  );

  return (
    <section
      className="rounded-2xl bg-surface border border-hairline shadow-apple p-5 space-y-3"
      data-testid="DB-01-activity-spine"
      data-transport={transport}
      aria-label="Live activity"
    >
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-accent" />
        <h2 className="text-apple-15 font-semibold text-primary">Live activity</h2>
        <span className="text-apple-11 text-tertiary" data-testid="DB-01-activity-spine-transport">
          {transport === 'realtime' ? 'Live' : 'Polling'}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-apple-12 text-tertiary" data-testid="DB-01-activity-spine-empty">
          Nothing has happened yet. Activity appears here as your team works.
        </p>
      ) : (
        <ul className="divide-y divide-hairline" role="log" data-testid="DB-01-activity-spine-list">
          {items.map(({ row, sentence, age, kind }) => (
            <li
              key={row.id}
              className="py-2 flex items-start gap-3"
              data-testid={`DB-01-activity-spine-row-${row.id}`}
              data-kind={kind}
            >
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${KIND_DOT[kind] ?? 'bg-tertiary'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-apple-13 text-secondary">{sentence}</span>
              {age && <span className="text-apple-11 text-tertiary tabular-nums shrink-0">{age}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
