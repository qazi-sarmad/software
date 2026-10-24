import React, { useCallback, useEffect, useState } from 'react';
import { listEventCatalogue, listRules } from '../../data/automation';
import { listEscalations, saveEscalationRule, type EscalationEvent } from '../../data/escalation';
import {
  describeBranch, PLATFORM_ESCALATION_KEYS, recommend, RECOMMENDATION_OPTIONS,
  type RecommendationBranch,
} from '../../lib/escalation';
import type { AutomationRule, RuleAction, RuleCondition } from '../../lib/automationRules';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { AlertTriangle, Check, Plus, XCircle } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-13 escalation rules (F12).
 *
 * The Org Admin builds a rule that watches an event, tests it against conditions, and escalates to
 * configured roles with a DETERMINISTIC recommendation ("Audit required: Yes / No / Needs review")
 * filled from the event fields. There is no AI in the decision (L1). A rule can also create a Work
 * Queue proposal a CIA converts through the normal plan and deployment-gate flow.
 */
export const OrgEscalationPanel: React.FC<{ orgId: string }> = ({ orgId }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof listEventCatalogue>>>([]);
  const [escalations, setEscalations] = useState<EscalationEvent[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [branches, setBranches] = useState<RecommendationBranch[]>([
    { field: 'severity', equals: 'critical', recommend: 'Yes', reason: 'A critical-severity anomaly was raised.' },
    { defaultRecommend: 'Needs review', defaultReason: 'An anomaly was raised; a person should review it.' },
  ]);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [r, e, esc] = await Promise.all([
        listRules(orgId), listEventCatalogue(), listEscalations(orgId),
      ]);
      setRules(r.filter((x) => x.actions.some((a) => a.type === 'escalate') || x.isPlatformTemplate));
      setEvents(e);
      setEscalations(esc);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the escalation rules.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startNew = () => {
    setResult(null);
    setEditing({
      id: '', ruleKey: `tenant.escalation.${Date.now()}`, name: 'Escalate', eventKey: 'anomaly.raised',
      conditions: [], actions: [{ type: 'escalate', toRoles: ['cia'], roleTarget: 'cia', createProposal: true }],
      enabled: true, isPlatformTemplate: false, pausedAt: null, pauseReason: null,
    });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setResult(null);
    const action: RuleAction = {
      type: 'escalate',
      toRoles: editing.actions[0]?.toRoles ?? ['cia'],
      roleTarget: editing.actions[0]?.roleTarget ?? 'cia',
      createProposal: editing.actions[0]?.createProposal ?? true,
      recommendation: branches,
    };
    const r = await saveEscalationRule(
      orgId, editing.ruleKey, editing.name, editing.eventKey, editing.conditions, [action], editing.enabled
    );
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setEditing(null);
      await load();
    }
  };

  const fields = events.find((e) => e.eventKey === (editing?.eventKey ?? 'anomaly.raised'))?.fields ?? [];
  const preview = recommend(
    Object.fromEntries(fields.map((f) => [f.field, f.field === 'severity' ? 'critical' : 'sample'])),
    branches
  );

  if (state === 'loading') {
    return <p className="text-sm opacity-70" data-testid="oa-escalation-loading">Loading the escalation rules…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="oa-escalation-error" />;
  }

  return (
    <div className="space-y-4" data-testid="oa-escalation">
      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-accent" />
          <h3 className="text-apple-14 font-semibold text-primary">Escalation rules</h3>
        </div>
        <p className="text-apple-12 text-secondary">
          An escalation watches an event and tells the right roles, with a recommendation decided by the
          rule itself — never by AI. It can also raise a Work Queue proposal a CIA turns into a plan.
        </p>
        <button
          type="button"
          onClick={startNew}
          data-testid="oa-escalation-new"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90"
        >
          <Plus className="w-3.5 h-3.5" /> New escalation rule
        </button>
      </div>

      {editing && (
        <div className="rounded-2xl border border-accent-subtle bg-surface p-4 space-y-3" data-testid="oa-escalation-editor">
          <h4 className="text-apple-13 font-semibold text-primary">Escalation rule</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Name</span>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                data-testid="oa-escalation-name"
                className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
              />
            </label>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>When this happens</span>
              <select
                value={editing.eventKey}
                onChange={(e) => setEditing({ ...editing, eventKey: e.target.value, conditions: [] })}
                data-testid="oa-escalation-event"
                className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
              >
                {events.map((e) => <option key={e.eventKey} value={e.eventKey}>{e.label}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-apple-12 font-medium text-primary">Only when</h5>
              <button
                type="button"
                onClick={() => setEditing({
                  ...editing,
                  conditions: [...editing.conditions,
                    { field: fields[0]?.field ?? 'severity', operator: 'eq', value: '' }],
                })}
                data-testid="oa-escalation-add-condition"
                className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {editing.conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`oa-escalation-condition-${i}`}>
                <select
                  value={c.field}
                  onChange={(e) => setEditing({ ...editing, conditions: editing.conditions.map((x, j) => j === i ? { ...x, field: e.target.value } : x) })}
                  data-testid={`oa-escalation-condition-field-${i}`}
                  className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                >
                  {fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                </select>
                <input
                  value={c.value}
                  onChange={(e) => setEditing({ ...editing, conditions: editing.conditions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })}
                  placeholder="value"
                  data-testid={`oa-escalation-condition-value-${i}`}
                  className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                />
                <button
                  type="button"
                  aria-label="Remove condition"
                  onClick={() => setEditing({ ...editing, conditions: editing.conditions.filter((_, j) => j !== i) })}
                  data-testid={`oa-escalation-condition-remove-${i}`}
                  className="text-cinnabar"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h5 className="text-apple-12 font-medium text-primary">Recommendation (decided by this rule, never AI)</h5>
            {branches.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`oa-escalation-branch-${i}`}>
                {b.defaultRecommend === undefined ? (
                  <>
                    <span className="text-apple-12 text-tertiary">If</span>
                    <select
                      value={b.field ?? ''}
                      onChange={(e) => setBranches(branches.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}
                      data-testid={`oa-escalation-branch-field-${i}`}
                      className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                    >
                      {fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                    </select>
                    <span className="text-apple-12 text-tertiary">is</span>
                    <input
                      value={b.equals ?? ''}
                      onChange={(e) => setBranches(branches.map((x, j) => j === i ? { ...x, equals: e.target.value } : x))}
                      data-testid={`oa-escalation-branch-equals-${i}`}
                      className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                    />
                  </>
                ) : (
                  <span className="text-apple-12 text-tertiary">Otherwise</span>
                )}
                <span className="text-apple-12 text-tertiary">recommend</span>
                <select
                  value={b.recommend ?? b.defaultRecommend ?? 'Needs review'}
                  onChange={(e) => setBranches(branches.map((x, j) => j === i
                    ? (x.defaultRecommend !== undefined
                      ? { ...x, defaultRecommend: e.target.value }
                      : { ...x, recommend: e.target.value })
                    : x))}
                  data-testid={`oa-escalation-branch-recommend-${i}`}
                  className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                >
                  {RECOMMENDATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {branches.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove branch"
                    onClick={() => setBranches(branches.filter((_, j) => j !== i))}
                    data-testid={`oa-escalation-branch-remove-${i}`}
                    className="text-cinnabar"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setBranches([
                ...branches.slice(0, -1),
                { field: fields[0]?.field ?? 'severity', equals: '', recommend: 'Yes', reason: '' },
                branches[branches.length - 1],
              ])}
              data-testid="oa-escalation-add-branch"
              className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline"
            >
              <Plus className="w-3 h-3" /> Add a condition to the recommendation
            </button>
          </div>

          <p className="text-apple-12 text-secondary" data-testid="oa-escalation-preview">
            Sample result: <strong>{preview.recommendation}</strong> — {preview.reason}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              data-testid="oa-escalation-save"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              data-testid="oa-escalation-cancel"
              className="text-apple-12 text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div
          data-testid={result.ok ? 'oa-escalation-saved' : 'oa-escalation-result'}
          className={`text-apple-12 ${result.ok ? 'text-positive' : 'text-cinnabar'}`}
        >
          {result.ok ? 'Saved.' : result.reason}
        </div>
      )}

      {rules.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="oa-escalation-empty">
          No escalation rules yet.
        </div>
      ) : (
        <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline" data-testid="oa-escalation-list">
          {rules.map((r) => (
            <li key={r.id || r.ruleKey} className="px-4 py-3 space-y-1" data-testid={`oa-escalation-rule-${r.ruleKey}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-apple-13 font-medium text-primary">{r.name}</span>
                <span className="text-apple-11 text-tertiary">
                  {PLATFORM_ESCALATION_KEYS.includes(r.ruleKey) ? 'platform template' : r.isPlatformTemplate ? 'platform' : 'yours'}
                </span>
              </div>
              <p className="text-apple-12 text-secondary">
                {r.actions.flatMap((a) => (a.recommendation ?? []).map(describeBranch)).join(' ')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {escalations.length > 0 && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="oa-escalation-log">
          <h4 className="text-apple-13 font-semibold text-primary">Recent escalations</h4>
          <ul className="divide-y divide-hairline">
            {escalations.map((e) => (
              <li key={e.id} className="py-2 text-apple-12" data-testid={`oa-escalation-${e.id}`}>
                <span className="font-medium text-primary">{e.recommendation}</span>
                <span className="text-secondary"> — {e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
