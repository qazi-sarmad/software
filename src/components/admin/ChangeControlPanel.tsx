import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  DEFAULT_CHANGE_CONTROL, decideChange, getChangeControlSettings, listChanges, requestChange,
  saveChangeControlSettings, type ChangeControlSettings, type ChangeRow,
} from '../../data/changeControl';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';

type LoadState = 'loading' | 'ready' | 'error';

/** The change classes the spec §21 names as material, plus the routine one. */
export const CHANGE_CLASSES = [
  'workpaper_reassign', 'planned_dates', 'team_members', 'scope', 'tested_controls', 'locked_sample', 'other',
] as const;

const RIGHTS = [
  'approve_plan', 'review_and_approve', 'edit_config', 'manage_engagements', 'manage_users', 'view_all_scopes',
] as const;

const label = (c: string) => c.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

/**
 * Change control (C3.2-A, spec §21).
 *
 * Two modes in one component: `settings` edits the org's approver right and routine classes (Org
 * Admin, edit_config); `engagement` lists and raises changes for one engagement and lets an approver
 * decide a material one. Non-blocking; every interactive element carries a testid.
 */
export const ChangeControlPanel: React.FC<{
  mode: 'settings' | 'engagement';
  engagementId?: string;
}> = ({ mode, engagementId }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canEdit = hasRight(currentUser, 'edit_config');
  const prefix = mode === 'settings' ? 'oa-changes' : 'wk-changes';

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<DataResult | null>(null);
  const [settings, setSettings] = useState<ChangeControlSettings>({ ...DEFAULT_CHANGE_CONTROL });
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [draft, setDraft] = useState({ changeClass: 'planned_dates', title: '', reason: '' });
  const [decision, setDecision] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      if (mode === 'settings') {
        setSettings(await getChangeControlSettings(orgId));
      } else {
        setChanges(await listChanges(engagementId ?? null));
      }
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load change control.');
      setState('error');
    }
  }, [mode, orgId, engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<DataResult>) => {
    setResult(null);
    const r = await action();
    setResult(r);
    if (r.ok) await load();
  };

  if (mode === 'settings' && !canEdit) {
    return (
      <div className="p-4" data-testid={`${prefix}-denied`}>
        <InlineError message="You need the Edit configuration right to change these settings." testId={`${prefix}-denied-error`} />
      </div>
    );
  }
  if (state === 'loading') {
    return <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-loading`}>Loading change control…</div>;
  }
  if (state === 'error') {
    return (
      <div className="p-4 space-y-2" data-testid={`${prefix}-error`}>
        <InlineError message={loadError} testId={`${prefix}-error-message`} />
        <button type="button" className="text-apple-12 underline text-secondary" data-testid={`${prefix}-retry`} onClick={() => void load()}>Retry</button>
      </div>
    );
  }

  if (mode === 'settings') {
    return (
      <div className="p-4 space-y-4" data-testid={`${prefix}-panel`}>
        <InlineError message={result && !result.ok ? result.reason : null} testId={`${prefix}-result`} />
        <div className="space-y-3" data-testid={`${prefix}-form`}>
          <label className="block text-apple-12 text-secondary">
            Approver right
            <Select
              ariaLabel="Approver right"
              testId={`${prefix}-approver-right`}
              value={settings.approverRight}
              onChange={(v) => setSettings((s) => ({ ...s, approverRight: v }))}
              options={RIGHTS.map((r) => ({ value: r, label: label(r) }))}
            />
          </label>
          <label className="block text-apple-12 text-secondary">
            Approval SLA (hours)
            <input
              type="number" min={1} max={720} data-testid={`${prefix}-sla-hours`}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
              value={settings.slaHours}
              onChange={(e) => setSettings((s) => ({ ...s, slaHours: Number(e.target.value) }))}
            />
          </label>
          <fieldset className="space-y-1" data-testid={`${prefix}-routine-classes`}>
            <legend className="text-apple-12 text-secondary">Routine classes (applied immediately)</legend>
            {CHANGE_CLASSES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-apple-13 text-primary">
                <input
                  type="checkbox" data-testid={`${prefix}-routine-${c}`}
                  checked={settings.routineClasses.includes(c)}
                  onChange={(e) => setSettings((s) => ({
                    ...s,
                    routineClasses: e.target.checked
                      ? [...new Set([...s.routineClasses, c])]
                      : s.routineClasses.filter((x) => x !== c),
                  }))}
                />
                {label(c)}
              </label>
            ))}
          </fieldset>
          <button
            type="button" data-testid={`${prefix}-save`}
            className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-13 font-semibold"
            onClick={() => void run(() => saveChangeControlSettings(orgId, {
              approverRight: settings.approverRight,
              routineClasses: settings.routineClasses,
              slaHours: settings.slaHours,
            }))}
          >
            Save change control
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`${prefix}-panel`}>
      <InlineError message={result && !result.ok ? result.reason : null} testId={`${prefix}-result`} />
      <div className="p-4 rounded-2xl bg-surface border border-hairline space-y-3" data-testid={`${prefix}-new`}>
        <div className="text-apple-13 font-semibold text-primary">Raise a change</div>
        <Select
          ariaLabel="Change class"
          testId={`${prefix}-class`}
          value={draft.changeClass}
          onChange={(v) => setDraft((d) => ({ ...d, changeClass: v }))}
          options={CHANGE_CLASSES.map((c) => ({ value: c, label: label(c) }))}
        />
        <input
          type="text" placeholder="What is changing" data-testid={`${prefix}-title`}
          className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
          value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
        <button
          type="button" data-testid={`${prefix}-raise`}
          disabled={!draft.title.trim() || !engagementId}
          className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-13 font-semibold disabled:opacity-50"
          onClick={() => void run(() => requestChange(engagementId ?? '', draft.changeClass, draft.title))}
        >
          Raise change
        </button>
      </div>

      {changes.length === 0 ? (
        <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-empty`}>No changes recorded for this engagement.</div>
      ) : (
        <ul className="space-y-2" data-testid={`${prefix}-list`}>
          {changes.map((c) => (
            <li key={c.id} className="p-3 rounded-xl border border-hairline bg-surface space-y-2" data-testid={`${prefix}-row-${c.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-apple-13 text-primary font-medium">{c.title || label(c.changeClass)}</span>
                <span className="text-apple-11 uppercase tracking-wide text-secondary" data-testid={`${prefix}-row-${c.id}-status`}>
                  {c.klass} · {c.status}
                </span>
              </div>
              {c.status === 'pending' && (
                <div className="flex items-center gap-2">
                  <input
                    type="text" placeholder="Reason" data-testid={`${prefix}-row-${c.id}-reason`}
                    className="flex-1 rounded-lg border border-hairline bg-surface px-2 py-1 text-apple-12 text-primary"
                    value={decision?.id === c.id ? decision.reason : ''}
                    onChange={(e) => setDecision({ id: c.id, reason: e.target.value })}
                  />
                  <button
                    type="button" data-testid={`${prefix}-row-${c.id}-approve`}
                    className="px-3 py-1 rounded-lg bg-verdigris-subtle text-verdigris text-apple-12 font-semibold"
                    onClick={() => void run(() => decideChange(c.id, true, decision?.reason ?? ''))}
                  >Approve</button>
                  <button
                    type="button" data-testid={`${prefix}-row-${c.id}-reject`}
                    className="px-3 py-1 rounded-lg bg-cinnabar-subtle text-cinnabar text-apple-12 font-semibold"
                    onClick={() => void run(() => decideChange(c.id, false, decision?.reason ?? ''))}
                  >Reject</button>
                </div>
              )}
              {c.rejectReason && (
                <div className="text-apple-11 text-cinnabar" data-testid={`${prefix}-row-${c.id}-reject-reason`}>{c.rejectReason}</div>
              )}
              {c.ledgerSeq !== null && (
                <div className="text-apple-11 text-secondary font-mono" data-testid={`${prefix}-row-${c.id}-ledger`}>ledger #{c.ledgerSeq}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
