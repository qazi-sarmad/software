import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEngagementAsOf, listAsOfEvents } from '../../data/timeTravel';
import {
  asOfBanner, diffStates, nearestSnap, nextSnap, previousSnap, snapPoints,
  type AsOfEvent, type AsOfState,
} from '../../lib/asOfTimeline';
import { InlineError } from '../common/InlineError';
import { TutorialButton } from '../common/TutorialButton';
import { ArrowLeft, ArrowRight, Clock, GitCommit, RotateCcw } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * WK-09 Time-Travel (F14, S10).
 *
 * A read-only as-of view of one engagement inside the Audit File window. The handle SNAPS to
 * recorded events; previous/next buttons and the arrow keys move between them. Everything shown is
 * reconstructed from append-only history by `engagement_as_of` (0068): what history did not record is
 * reported as "Not recorded before <date>", never guessed. Requires view_insights and the time_travel
 * entitlement; the server refuses otherwise and the refusal is shown in place.
 */
export const AsOfTimeline: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [events, setEvents] = useState<AsOfEvent[]>([]);
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString());
  const [current, setCurrent] = useState<AsOfState | null>(null);
  const [compare, setCompare] = useState<AsOfState | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  const points = useMemo(() => snapPoints(events), [events]);

  const loadEvents = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const list = await listAsOfEvents(engagementId, new Date().toISOString());
      setEvents(list);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the engagement history.');
      setState('error');
    }
  }, [engagementId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const reconstruct = useCallback(async (ts: string) => {
    setBusy(true);
    setLoadError('');
    try {
      const next = await getEngagementAsOf(engagementId, ts);
      setCurrent(next);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not reconstruct the engagement.');
      setCurrent(null);
      setState('error');
    } finally {
      setBusy(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void reconstruct(asOf);
  }, [asOf, reconstruct]);

  const move = (dir: -1 | 1) => {
    const next = dir < 0 ? previousSnap(points, asOf) : nextSnap(points, asOf);
    if (next) setAsOf(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
    if (e.key === 'Escape') { e.preventDefault(); setCompareOn(false); }
  };

  const backToNow = () => {
    setAsOf(new Date().toISOString());
    setCompareOn(false);
    setCompare(null);
  };

  const toggleCompare = async () => {
    if (compareOn) { setCompareOn(false); setCompare(null); return; }
    setBusy(true);
    try {
      const now = await getEngagementAsOf(engagementId, new Date().toISOString());
      setCompare(now);
      setCompareOn(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the current state.');
    } finally {
      setBusy(false);
    }
  };

  // The handle position along the timeline, as a percentage of the recorded span.
  const span = useMemo(() => {
    if (points.length < 2) return { start: 0, end: 0 };
    return { start: Date.parse(points[0].at), end: Date.parse(points[points.length - 1].at) };
  }, [points]);
  const handlePct = useMemo(() => {
    if (span.end === span.start) return 0;
    const t = Date.parse(asOf);
    return Math.max(0, Math.min(100, ((t - span.start) / (span.end - span.start)) * 100));
  }, [asOf, span]);

  const diff = useMemo(
    () => (compareOn && current && compare ? diffStates(current, compare).filter((r) => r.kind !== 'unchanged') : []),
    [compareOn, current, compare],
  );

  if (state === 'loading') {
    return <p className="text-apple-12 text-secondary" data-testid="wk-timetravel-loading">Loading the engagement history…</p>;
  }

  return (
    <div className="space-y-4" data-testid="wk-timetravel">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
        <Clock className="w-4 h-4 text-accent mt-0.5" />
        <div>
          <h3 className="text-apple-14 font-semibold text-primary">Time-Travel</h3>
          <p className="text-apple-12 text-secondary">
            A read-only view of the engagement at a past moment. The handle snaps to recorded events.
            What history did not record is reported as not recorded, never guessed.
          </p>
        </div>
        </div>
        <TutorialButton tutorialKey="oa.timetravel" title="WK-09 Time-Travel" screenId="wk-timetravel" autoplay={false} />
      </div>

      <InlineError message={loadError} testId="wk-timetravel-error" />

      {/* Persistent banner: what moment is shown, and the honesty note (F14). */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-elevated px-4 py-2"
        data-testid="wk-timetravel-banner"
      >
        <span className="text-apple-13 font-semibold text-primary" data-testid="wk-timetravel-asof">
          {current ? asOfBanner(current) : `As of ${asOf}`}
        </span>
        <button
          type="button"
          onClick={backToNow}
          data-testid="wk-timetravel-now"
          className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Back to now
        </button>
      </div>

      {/* The timeline. The handle snaps to events; arrows and buttons move between them. */}
      <div
        ref={sliderRef}
        tabIndex={0}
        role="slider"
        aria-label="Engagement as-of timeline"
        aria-valuemin={0}
        aria-valuemax={points.length}
        aria-valuenow={Math.max(0, points.findIndex((p) => p.at === asOf))}
        aria-valuetext={asOf}
        onKeyDown={onKeyDown}
        data-testid="wk-timetravel-track"
        className="relative h-14 rounded-xl border border-hairline bg-surface px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="absolute left-2 right-2 top-1/2 h-px bg-hairline" />
        {points.map((p) => {
          const pct = span.end === span.start
            ? 0
            : ((Date.parse(p.at) - span.start) / (span.end - span.start)) * 100;
          const on = p.at === asOf;
          return (
            <button
              key={p.at + p.action}
              type="button"
              title={p.label}
              aria-label={p.label}
              onClick={() => setAsOf(p.at)}
              data-testid={`wk-timetravel-event-${p.action}`}
              style={{ left: `calc(${pct}% * 0.92 + 4%)` }}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border ${
                on ? 'bg-accent border-accent' : 'bg-surface border-secondary'
              }`}
            />
          );
        })}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent ring-2 ring-accent-subtle motion-reduce:transition-none"
          style={{ left: `calc(${handlePct}% * 0.92 + 4%)` }}
          data-testid="wk-timetravel-handle"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={previousSnap(points, asOf) === null}
          data-testid="wk-timetravel-prev"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-hairline bg-surface text-apple-12 text-primary disabled:opacity-40"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Previous event
        </button>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={nextSnap(points, asOf) === null}
          data-testid="wk-timetravel-next"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-hairline bg-surface text-apple-12 text-primary disabled:opacity-40"
        >
          Next event <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <label className="text-apple-12 text-secondary space-y-1">
          <span className="sr-only">Pick a date and time</span>
          <input
            type="datetime-local"
            data-testid="wk-timetravel-date"
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              setAsOf(new Date(v).toISOString());
            }}
            className="px-3 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
          />
        </label>
        <button
          type="button"
          onClick={() => void toggleCompare()}
          disabled={busy}
          data-testid="wk-timetravel-compare"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-hairline bg-surface text-apple-12 text-primary disabled:opacity-40"
        >
          <GitCommit className="w-3.5 h-3.5" /> {compareOn ? 'Hide comparison' : 'Compare with now'}
        </button>
      </div>

      {/* The reconstruction at the chosen moment. Read-only. */}
      {current && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="wk-timetravel-state">
          {current.status !== 'ok' ? (
            <p className="text-apple-12 text-secondary" data-testid="wk-timetravel-not-recorded">
              {current.note ?? 'Not recorded before this date.'}
            </p>
          ) : (
            <>
              <div className="text-apple-12 text-primary">
                <span className="font-semibold" data-testid="wk-timetravel-seal">
                  {current.seal?.sealed ? 'Sealed' : 'Not sealed'}
                </span>
                {current.seal?.at ? <span className="text-tertiary"> · {current.seal.at}</span> : null}
              </div>
              <div>
                <div className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
                  Working papers
                </div>
                {(current.workpapers ?? []).length === 0 ? (
                  <p className="text-apple-12 text-tertiary">No working papers recorded at this moment.</p>
                ) : (
                  <ul className="divide-y divide-hairline" data-testid="wk-timetravel-workpapers">
                    {(current.workpapers ?? []).map((w) => (
                      <li key={w.id + w.at} className="flex items-center justify-between py-1.5 text-apple-12">
                        <span className="text-primary font-mono text-apple-11">{w.id}</span>
                        <span className="text-secondary">{w.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Compare with now: added / changed / removed. */}
      {compareOn && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="wk-timetravel-diff">
          <div className="text-apple-12 font-semibold text-primary">Compared with now</div>
          {diff.length === 0 ? (
            <p className="text-apple-12 text-tertiary" data-testid="wk-timetravel-diff-empty">
              Nothing has changed since this moment.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {diff.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5 text-apple-12" data-testid={`wk-timetravel-diff-${r.id}`}>
                  <span className="text-primary">{r.label}</span>
                  <span className={r.kind === 'removed' ? 'text-cinnabar' : 'text-accent'}>
                    {r.kind}{r.before !== null && r.after !== null ? ` (${r.before} → ${r.after})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
