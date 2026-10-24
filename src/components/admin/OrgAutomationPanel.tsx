import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { listEventCatalogue, listRules, listTemplates, saveRule, testRule } from '../../data/automation';
import {
  ACTION_TYPES, CONDITION_OPERATORS, describeRule, type AutomationRule, type EventDef,
  type RuleAction, type RuleCondition,
} from '../../lib/automationRules';
import { describeBlock } from '../../lib/notifications';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Check, Plus, XCircle, Zap } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-12 notification rules and OA-13 escalation rules (F7, F12).
 *
 * The Org Admin sees the platform templates and its own rules. Copying a template makes a tenant rule
 * with a new key; editing a tenant rule changes only the tenant. Escalation rules are ordinary rules
 * on the escalation events, and the deterministic recommendation is filled from the event fields, so
 * the screen shows the recommendation rule rather than asking for free text.
 */
export const OrgAutomationPanel: React.FC = () => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [events, setEvents] = useState<EventDef[]>([]);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof listTemplates>>>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [testOutput, setTestOutput] = useState<{ recipients: string[]; subject: string; bodyText: string } | null>(null);
  const [editing, setEditing] = useState<AutomationRule | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [r, e, t] = await Promise.all([listRules(orgId), listEventCatalogue(), listTemplates(orgId)]);
      setRules(r);
      setEvents(e);
      setTemplates(t);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the rules.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyTemplate = (rule: AutomationRule) => {
    setEditing({
      ...rule,
      id: '',
      ruleKey: `${rule.ruleKey}.copy`,
      name: `${rule.name} (copy)`,
      isPlatformTemplate: false,
    });
  };

  const startNew = () => {
    setEditing({
      id: '', ruleKey: '', name: '', eventKey: 'cap.overdue', conditions: [], actions: [],
      enabled: true, isPlatformTemplate: false, pausedAt: null, pauseReason: null,
    });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.ruleKey.trim() || !editing.name.trim()) {
      setResult({ ok: false, reason: 'Give the rule a key and a name.' });
      return;
    }
    setBusy(true);
    setResult(null);
    const r = await saveRule(orgId, editing.ruleKey.trim(), editing.name.trim(), editing.eventKey,
      editing.conditions, editing.actions, editing.enabled);
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setEditing(null);
      await load();
    }
  };

  const runTest = async (ruleId: string) => {
    setBusy(true);
    setResult(null);
    setTestOutput(null);
    try {
      setTestOutput(await testRule(ruleId, { severity: 'high', amount: 5000, summary: 'Sample event' }));
    } catch (err) {
      setResult({ ok: false, reason: err instanceof Error ? err.message : 'The test could not run.' });
    }
    setBusy(false);
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="org-automation-loading">Loading rules…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="org-automation-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  const fields = events.find((e) => e.eventKey === editing?.eventKey)?.fields ?? [];

  return (
    <div className="space-y-4" data-testid="org-automation">
      <InlineError message={result && !result.ok ? result.reason : null} testId="org-automation-result" />
      {result?.ok && <p className="text-apple-12 text-moss" data-testid="org-automation-saved">Saved.</p>}

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" />
          <h3 className="text-apple-14 font-semibold text-primary">Notification and escalation rules</h3>
        </div>
        <p className="text-apple-12 text-secondary">
          A rule watches for something happening and then does something: tell the right people, raise a
          Work Queue card, or set a flag. Copy a platform rule and change it, or start a new one.
        </p>
        <button
          type="button"
          onClick={startNew}
          data-testid="org-automation-new"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90"
        >
          <Plus className="w-3.5 h-3.5" /> New rule
        </button>
      </div>

      {editing && (
        <div className="rounded-2xl border border-accent-subtle bg-surface p-4 space-y-3" data-testid="org-automation-editor">
          <h4 className="text-apple-13 font-semibold text-primary">{editing.id ? 'Edit rule' : 'New rule'}</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Key</span>
              <input
                value={editing.ruleKey}
                onChange={(e) => setEditing({ ...editing, ruleKey: e.target.value })}
                data-testid="org-rule-key"
                className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
              />
            </label>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Name</span>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                data-testid="org-rule-name"
                className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
              />
            </label>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>When this happens</span>
              <select
                value={editing.eventKey}
                onChange={(e) => setEditing({ ...editing, eventKey: e.target.value, conditions: [] })}
                data-testid="org-rule-event"
                className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
              >
                {events.map((e) => <option key={e.eventKey} value={e.eventKey}>{e.label}</option>)}
              </select>
            </label>
            <label className="text-apple-12 text-secondary space-y-1 flex items-end gap-2">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                data-testid="org-rule-enabled"
                className="mb-2.5"
              />
              <span className="mb-2">Enabled</span>
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
                data-testid="org-rule-add-condition"
                className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {editing.conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`org-rule-condition-${i}`}>
                <select
                  value={c.field}
                  onChange={(e) => setEditing({ ...editing, conditions: editing.conditions.map((x, j) => j === i ? { ...x, field: e.target.value } : x) })}
                  data-testid={`org-rule-condition-field-${i}`}
                  className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                >
                  {fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                </select>
                <select
                  value={c.operator}
                  onChange={(e) => setEditing({ ...editing, conditions: editing.conditions.map((x, j) => j === i ? { ...x, operator: e.target.value as RuleCondition['operator'] } : x) })}
                  data-testid={`org-rule-condition-op-${i}`}
                  className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                >
                  {CONDITION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  value={c.value}
                  onChange={(e) => setEditing({ ...editing, conditions: editing.conditions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })}
                  data-testid={`org-rule-condition-value-${i}`}
                  className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                />
                <button
                  type="button"
                  aria-label="Remove condition"
                  onClick={() => setEditing({ ...editing, conditions: editing.conditions.filter((_, j) => j !== i) })}
                  data-testid={`org-rule-condition-remove-${i}`}
                  className="text-cinnabar"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-apple-12 font-medium text-primary">Then</h5>
              <button
                type="button"
                onClick={() => setEditing({
                  ...editing,
                  actions: [...editing.actions, { type: 'notify', toRoles: [], message: '' }],
                })}
                data-testid="org-rule-add-action"
                className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {editing.actions.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`org-rule-action-${i}`}>
                <select
                  value={a.type}
                  onChange={(e) => setEditing({ ...editing, actions: editing.actions.map((x, j) => j === i ? { ...x, type: e.target.value as RuleAction['type'] } : x) })}
                  data-testid={`org-rule-action-type-${i}`}
                  className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                >
                  {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input
                  value={a.message ?? ''}
                  onChange={(e) => setEditing({ ...editing, actions: editing.actions.map((x, j) => j === i ? { ...x, message: e.target.value } : x) })}
                  placeholder="Message"
                  data-testid={`org-rule-action-message-${i}`}
                  className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                />
                <button
                  type="button"
                  aria-label="Remove action"
                  onClick={() => setEditing({ ...editing, actions: editing.actions.filter((_, j) => j !== i) })}
                  data-testid={`org-rule-action-remove-${i}`}
                  className="text-cinnabar"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              data-testid="org-rule-save"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              data-testid="org-rule-cancel"
              className="text-apple-12 text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="org-automation-empty">
          No rules yet. Copy a platform rule to get started.
        </div>
      ) : (
        <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline" data-testid="org-rule-list">
          {rules.map((r) => (
            <li key={r.id} className="px-4 py-3 space-y-1" data-testid={`org-rule-${r.ruleKey}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-apple-13 font-medium text-primary">{r.name}</span>
                <span className="text-apple-11 text-tertiary">
                  {r.isPlatformTemplate ? 'platform template' : 'yours'}
                  {r.enabled ? '' : ' · off'}
                </span>
              </div>
              <p className="text-apple-12 text-secondary">{describeRule(r)}</p>
              <div className="flex items-center gap-3">
                {r.isPlatformTemplate ? (
                  <button
                    type="button"
                    onClick={() => copyTemplate(r)}
                    data-testid={`org-rule-copy-${r.ruleKey}`}
                    className="text-apple-12 text-accent hover:underline"
                  >
                    Copy and change
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    data-testid={`org-rule-edit-${r.ruleKey}`}
                    className="text-apple-12 text-accent hover:underline"
                  >
                    Change
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runTest(r.id)}
                  data-testid={`org-rule-test-${r.ruleKey}`}
                  className="text-apple-12 text-secondary hover:text-primary disabled:opacity-50"
                >
                  Test with a sample event
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {testOutput && (
        <div className="rounded-2xl border border-hairline bg-canvas p-4 space-y-1" data-testid="org-rule-test-output">
          <h4 className="text-apple-12 font-medium text-primary">Test result (nothing was sent)</h4>
          <p className="text-apple-12 text-secondary">Subject: {testOutput.subject}</p>
          <p className="text-apple-12 text-secondary">
            Recipients: {testOutput.recipients.length ? testOutput.recipients.join(', ') : 'none'}
          </p>
          <pre className="text-apple-11 text-tertiary whitespace-pre-wrap">{testOutput.bodyText}</pre>
        </div>
      )}

      {templates.length > 0 && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
          <h4 className="text-apple-13 font-semibold text-primary">Message templates</h4>
          <ul className="divide-y divide-hairline" data-testid="org-template-list">
            {templates.map((t) => (
              <li key={t.id} className="py-2" data-testid={`org-template-${t.eventKey}`}>
                <div className="text-apple-12 font-medium text-primary">{t.subject || '(no subject)'}</div>
                <div className="text-apple-11 text-tertiary">{t.blocks.map(describeBlock).join(' · ')}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
