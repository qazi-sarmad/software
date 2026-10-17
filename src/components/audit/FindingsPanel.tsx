import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  listObservations,
  listIssues,
  listSeverityLevels,
  promoteToFinding,
  missingReadabilitySections,
  createIssue,
  MANDATORY_SECTIONS,
  type ObservationRow,
  type IssueRow,
  type SeverityLevelRow,
} from '../../data/observations';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Plus, RefreshCw } from '../common/Icons';

const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-surface-sunken border-hairline text-secondary',
  submitted: 'bg-surface-sunken border-hairline text-primary',
  finding: 'bg-cinnabar-subtle border-cinnabar text-cinnabar',
  issue: 'bg-cinnabar-subtle border-cinnabar text-cinnabar',
};

/** A severity chip. The colour comes from the org's severity level token, never a hex (spec §14.4). */
const SeverityChip: React.FC<{ level: SeverityLevelRow | undefined }> = ({ level }) => {
  if (!level) return null;
  return (
    <span
      data-testid={`severity-chip-${level.id}`}
      className="px-2 py-0.5 rounded text-apple-11 font-semibold border border-hairline"
      style={{ color: `var(${level.colorToken})` }}
    >
      {level.name}
    </span>
  );
};

/**
 * Findings and observations panel (5G, spec §14). Observation cards with status chips and a
 * promote-to-finding action that is disabled with an inline list of the mandatory sections the
 * observation is still missing. The readability gate itself lives in the database (0030).
 */
export const FindingsPanel: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const { currentUser } = useApp();
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [levels, setLevels] = useState<SeverityLevelRow[]>([]);
  const [missing, setMissing] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [issueTitle, setIssueTitle] = useState('');

  const canWrite = hasRight(currentUser, 'perform_work');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [obs, iss, lv] = await Promise.all([listObservations(engagementId), listIssues(), listSeverityLevels()]);
      setObservations(obs);
      setIssues(iss);
      setLevels(lv);
      const gaps: Record<string, string[]> = {};
      await Promise.all(
        obs
          .filter((o) => o.status === 'draft' || o.status === 'submitted')
          .map(async (o) => {
            gaps[o.id] = await missingReadabilitySections(o.id);
          })
      );
      setMissing(gaps);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load observations.');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const levelById = useMemo(() => new Map(levels.map((l) => [l.id, l])), [levels]);
  const findings = observations.filter((o) => o.status === 'finding' || o.status === 'issue');

  const promote = async (o: ObservationRow) => {
    setBusy(true);
    setError(null);
    const res = await promoteToFinding(o.id, null);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  const makeIssue = async () => {
    const title = issueTitle.trim();
    if (title.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await createIssue(title, null, findings.map((f) => f.id));
    if (!res.ok) setError(res.reason);
    else {
      setIssueTitle('');
      await load();
    }
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="findings-loading" />;
  }

  return (
    <div className="space-y-5" data-testid="findings-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> Observations &amp; findings ({observations.length})
        </h3>
        <button type="button" onClick={() => void load()} className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover" aria-label="Refresh">
          <RefreshCw className="w-4 h-4 stroke-[1.5]" />
        </button>
      </div>

      <InlineError message={error} testId="findings-error" />

      {observations.length === 0 ? (
        <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="findings-empty">
          No observations have been recorded for this engagement yet. Raise one from a flagged analyst
          result or a sample exception.
        </div>
      ) : (
        <div className="space-y-2">
          {observations.map((o) => {
            const gaps = missing[o.id] ?? [];
            const promotable = gaps.length === 0;
            const isOpen = open[o.id];
            return (
              <div key={o.id} className="border border-hairline rounded-xl bg-surface overflow-hidden" data-testid={`observation-${o.id}`}>
                <button
                  type="button"
                  onClick={() => setOpen((p) => ({ ...p, [o.id]: !p[o.id] }))}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                    <span className="text-apple-13 font-medium text-primary truncate">{o.title}</span>
                  </span>
                  <span
                    data-testid={`observation-status-${o.id}`}
                    className={`px-2 py-0.5 rounded text-apple-11 font-semibold border capitalize ${STATUS_CHIP[o.status] ?? STATUS_CHIP.draft}`}
                  >
                    {o.status}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-3 border-t border-hairline pt-3">
                    <dl className="grid gap-2 sm:grid-cols-2">
                      {[...MANDATORY_SECTIONS, 'criteria', 'cause', 'recommendation'].map((tag) => (
                        <div key={tag}>
                          <dt className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">{tag}</dt>
                          <dd className="text-apple-12 text-primary">{o.sections[tag] || <span className="text-tertiary italic">not provided</span>}</dd>
                        </div>
                      ))}
                    </dl>
                    {o.status !== 'finding' && o.status !== 'issue' && (
                      <div className="space-y-2">
                        {!promotable && (
                          <div className="px-3 py-2 rounded-xl text-apple-12 text-cinnabar bg-cinnabar-subtle border border-cinnabar" data-testid={`observation-missing-${o.id}`}>
                            Cannot promote: missing {gaps.join(', ')}
                          </div>
                        )}
                        <button
                          type="button"
                          data-testid={`observation-promote-${o.id}`}
                          onClick={() => promote(o)}
                          disabled={busy || !canWrite || !promotable}
                          title={!canWrite ? 'You do not hold the perform_work right.' : undefined}
                          className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Promote to finding
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Issues: group findings under an issue (spec §14.5). */}
      <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-3">
        <div className="text-apple-13 font-semibold text-primary">Issues ({issues.length})</div>
        {issues.length === 0 ? (
          <div className="text-apple-12 text-secondary" data-testid="issues-empty">
            No issues have been grouped yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {issues.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-sunken" data-testid={`issue-${i.id}`}>
                <span className="text-apple-12 text-primary">{i.title}</span>
                <span className="text-apple-11 text-secondary tabular-nums">
                  {i.linkedFindingIds.length} finding{i.linkedFindingIds.length === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="block text-apple-11 text-secondary" htmlFor="issue-title">New issue title</label>
            <input
              id="issue-title"
              data-testid="issue-title"
              value={issueTitle}
              onChange={(e) => setIssueTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary"
            />
          </div>
          <button
            type="button"
            data-testid="issue-create"
            onClick={makeIssue}
            disabled={busy || !canWrite || issueTitle.trim().length === 0 || findings.length === 0}
            className="px-3 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Group findings
          </button>
        </div>
        {levels.length > 0 && (
          <div className="flex items-center gap-2 pt-1" data-testid="severity-legend">
            <span className="text-apple-11 text-secondary">Severity levels:</span>
            {levels.map((l) => <SeverityChip key={l.id} level={levelById.get(l.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
};
