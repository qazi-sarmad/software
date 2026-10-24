import React, { useCallback, useEffect, useState } from 'react';
import {
  listEventCatalogue, listRules, listTemplates, saveRule, saveTemplate, testRule,
} from '../../data/automation';
import {
  ACTION_TYPES, CONDITION_OPERATORS, describeRule, type AutomationRule, type EventDef,
  type RuleAction, type RuleCondition,
} from '../../lib/automationRules';
import {
  describeBlock, moveBlock, type TemplateBlock,
} from '../../lib/notifications';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Check, Plus, Sliders, XCircle, Zap } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';
type Tab = 'rules' | 'templates';

/**
 * SA-07 automation templates and SA-08 notification templates (F7).
 *
 * Both editors are visual: events, conditions and actions come from dropdowns built from the event
 * catalogue, and a template is a list of blocks moved with up and down buttons. Nothing here accepts
 * JSON (F1). "Test with a sample event" is a dry run: it shows the recipients and the rendered
 * message and sends nothing.
 */
export const SuperAdminAutomation: React.FC = () => {
  const [tab, setTab] = useState<Tab>('rules');
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [events, setEvents] = useState<EventDef[]>([]);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof listTemplates>>>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [testOutput, setTestOutput] = useState<{ recipients: string[]; subject: string; bodyText: string } | null>(null);

  const [draft, setDraft] = useState<{
    ruleKey: string; name: string; eventKey: string;
    conditions: RuleCondition[]; actions: RuleAction[]; enabled: boolean;
  }>({
    ruleKey: '', name: '', eventKey: 'config.changed', conditions: [], actions: [], enabled: true,
  });

  const [tplDraft, setTplDraft] = useState<{ eventKey: string; subject: string; blocks: TemplateBlock[] }>({
    eventKey: 'config.changed', subject: '', blocks: [{ type: 'paragraph', text: 'What changed: ' }],
  });

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [r, e, t] = await Promise.all([listRules(''), listEventCatalogue(), listTemplates('')]);
      setRules(r);
      setEvents(e);
      setTemplates(t);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the automation settings.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addCondition = () => {
    const first = events.find((e) => e.eventKey === draft.eventKey)?.fields[0]?.field ?? 'severity';
    setDraft({ ...draft, conditions: [...draft.conditions, { field: first, operator: 'eq', value: '' }] });
  };

  const updateCondition = (i: number, patch: Partial<RuleCondition>) => {
    setDraft({ ...draft, conditions: draft.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  };

  const removeCondition = (i: number) => {
    setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) });
  };

  const addAction = () => {
    setDraft({ ...draft, actions: [...draft.actions, { type: 'notify', toRoles: [], message: '' }] });
  };

  const updateAction = (i: number, patch: Partial<RuleAction>) => {
    setDraft({ ...draft, actions: draft.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  };

  const removeAction = (i: number) => {
    setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) });
  };

  const save = async () => {
    if (!draft.ruleKey.trim() || !draft.name.trim()) {
      setResult({ ok: false, reason: 'Give the rule a key and a name.' });
      return;
    }
    setBusy(true);
    setResult(null);
    const r = await saveRule('', draft.ruleKey.trim(), draft.name.trim(), draft.eventKey,
      draft.conditions, draft.actions, draft.enabled);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
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

  const saveTpl = async () => {
    setBusy(true);
    setResult(null);
    const r = await saveTemplate(null, tplDraft.eventKey, tplDraft.subject, tplDraft.blocks);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  const fields = events.find((e) => e.eventKey === draft.eventKey)?.fields ?? [];

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="superadmin-automation-loading">Loading automation…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-automation-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="superadmin-automation">
      <nav className="flex gap-1" data-testid="superadmin-automation-tabs">
        {([
          { id: 'rules' as Tab, label: 'Rules' },
          { id: 'templates' as Tab, label: 'Message templates' },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            data-testid={`superadmin-automation-tab-${t.id}`}
            className={`px-3 py-2 rounded-xl text-apple-13 font-medium transition-colors ${tab === t.id ? 'bg-accent-subtle text-primary' : 'text-secondary hover:text-primary'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <InlineError message={result && !result.ok ? result.reason : null} testId="superadmin-automation-result" />
      {result?.ok && <p className="text-apple-12 text-moss" data-testid="superadmin-automation-saved">Saved.</p>}

      {tab === 'rules' && (
        <>
          <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-accent" />
              <h3 className="text-apple-14 font-semibold text-primary">Platform rule template</h3>
            </div>
            <p className="text-apple-12 text-secondary">
              A rule is an event, some conditions, and what to do. A tenant can copy this rule, change
              it, or switch it off. A tenant rule with the same key wins.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-apple-12 text-secondary space-y-1">
                <span>Rule key</span>
                <input
                  value={draft.ruleKey}
                  onChange={(e) => setDraft({ ...draft, ruleKey: e.target.value })}
                  placeholder="platform.config.changed"
                  data-testid="rule-key"
                  className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                />
              </label>
              <label className="text-apple-12 text-secondary space-y-1">
                <span>Name</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Tell Org Admins a setting changed"
                  data-testid="rule-name"
                  className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                />
              </label>
              <label className="text-apple-12 text-secondary space-y-1">
                <span>When this happens</span>
                <select
                  value={draft.eventKey}
                  onChange={(e) => setDraft({ ...draft, eventKey: e.target.value, conditions: [] })}
                  data-testid="rule-event"
                  className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                >
                  {events.map((e) => <option key={e.eventKey} value={e.eventKey}>{e.label}</option>)}
                </select>
              </label>
              <label className="text-apple-12 text-secondary space-y-1 flex items-end gap-2">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  data-testid="rule-enabled"
                  className="mb-2.5"
                />
                <span className="mb-2">Enabled</span>
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-apple-12 font-medium text-primary">Only when</h4>
                <button type="button" onClick={addCondition} data-testid="rule-add-condition" className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline">
                  <Plus className="w-3 h-3" /> Add condition
                </button>
              </div>
              {draft.conditions.length === 0 && (
                <p className="text-apple-11 text-tertiary" data-testid="rule-no-conditions">No conditions: the rule runs on every event of this kind.</p>
              )}
              {draft.conditions.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`rule-condition-${i}`}>
                  <select
                    value={c.field}
                    onChange={(e) => updateCondition(i, { field: e.target.value })}
                    data-testid={`rule-condition-field-${i}`}
                    className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                  >
                    {fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                  </select>
                  <select
                    value={c.operator}
                    onChange={(e) => updateCondition(i, { operator: e.target.value as RuleCondition['operator'] })}
                    data-testid={`rule-condition-op-${i}`}
                    className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                  >
                    {CONDITION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input
                    value={c.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder="value"
                    data-testid={`rule-condition-value-${i}`}
                    className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                  />
                  <button type="button" onClick={() => removeCondition(i)} data-testid={`rule-condition-remove-${i}`} className="text-cinnabar">
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-apple-12 font-medium text-primary">Then</h4>
                <button type="button" onClick={addAction} data-testid="rule-add-action" className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline">
                  <Plus className="w-3 h-3" /> Add action
                </button>
              </div>
              {draft.actions.length === 0 && (
                <p className="text-apple-11 text-tertiary" data-testid="rule-no-actions">No actions yet.</p>
              )}
              {draft.actions.map((a, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`rule-action-${i}`}>
                  <select
                    value={a.type}
                    onChange={(e) => updateAction(i, { type: e.target.value as RuleAction['type'] })}
                    data-testid={`rule-action-type-${i}`}
                    className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                  >
                    {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input
                    value={a.message ?? ''}
                    onChange={(e) => updateAction(i, { message: e.target.value })}
                    placeholder="Message"
                    data-testid={`rule-action-message-${i}`}
                    className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                  />
                  <button type="button" onClick={() => removeAction(i)} data-testid={`rule-action-remove-${i}`} className="text-cinnabar">
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              data-testid="rule-save"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> Save rule
            </button>
          </div>

          {rules.length === 0 ? (
            <div className="py-8 text-center text-secondary text-apple-13" data-testid="superadmin-automation-empty">
              No rules are set. Nothing is notified automatically.
            </div>
          ) : (
            <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline" data-testid="rule-list">
              {rules.map((r) => (
                <li key={r.id} className="px-4 py-3 space-y-1" data-testid={`rule-${r.ruleKey}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-apple-13 font-medium text-primary">{r.name}</span>
                    <span className="text-apple-11 text-tertiary">
                      {r.isPlatformTemplate ? 'platform template' : 'tenant'}
                      {r.enabled ? '' : ' · off'}
                      {r.pausedAt ? ' · paused by the loop guard' : ''}
                    </span>
                  </div>
                  <p className="text-apple-12 text-secondary">{describeRule(r)}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runTest(r.id)}
                    data-testid={`rule-test-${r.ruleKey}`}
                    className="text-apple-12 text-accent hover:underline disabled:opacity-50"
                  >
                    Test with a sample event
                  </button>
                </li>
              ))}
            </ul>
          )}

          {testOutput && (
            <div className="rounded-2xl border border-hairline bg-canvas p-4 space-y-1" data-testid="rule-test-output">
              <h4 className="text-apple-12 font-medium text-primary">Test result (nothing was sent)</h4>
              <p className="text-apple-12 text-secondary">Subject: {testOutput.subject}</p>
              <p className="text-apple-12 text-secondary">
                Recipients: {testOutput.recipients.length ? testOutput.recipients.join(', ') : 'none'}
              </p>
              <pre className="text-apple-11 text-tertiary whitespace-pre-wrap">{testOutput.bodyText}</pre>
            </div>
          )}
        </>
      )}

      {tab === 'templates' && (
        <>
          <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-accent" />
              <h3 className="text-apple-14 font-semibold text-primary">Message template</h3>
            </div>
            <p className="text-apple-12 text-secondary">
              A template is a subject and a list of blocks. Every value is escaped when the message is
              built, and a value that looks like a secret is never included.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-apple-12 text-secondary space-y-1">
                <span>For this event</span>
                <select
                  value={tplDraft.eventKey}
                  onChange={(e) => setTplDraft({ ...tplDraft, eventKey: e.target.value })}
                  data-testid="template-event"
                  className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                >
                  {events.map((e) => <option key={e.eventKey} value={e.eventKey}>{e.label}</option>)}
                </select>
              </label>
              <label className="text-apple-12 text-secondary space-y-1">
                <span>Subject</span>
                <input
                  value={tplDraft.subject}
                  onChange={(e) => setTplDraft({ ...tplDraft, subject: e.target.value })}
                  placeholder="A setting changed"
                  data-testid="template-subject"
                  className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                />
              </label>
            </div>

            <div className="space-y-2" data-testid="template-blocks">
              {tplDraft.blocks.map((b, i) => (
                <div key={i} className="flex items-center gap-2" data-testid={`template-block-${i}`}>
                  <span className="text-apple-11 text-tertiary w-20">{b.type}</span>
                  <input
                    value={b.text ?? b.href ?? ''}
                    onChange={(e) => setTplDraft({
                      ...tplDraft,
                      blocks: tplDraft.blocks.map((x, j) => (j === i
                        ? { ...x, ...(x.type === 'link' ? { href: e.target.value } : { text: e.target.value }) }
                        : x)),
                    })}
                    data-testid={`template-block-text-${i}`}
                    className="flex-1 px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
                  />
                  <button type="button" aria-label="Move up" onClick={() => setTplDraft({ ...tplDraft, blocks: moveBlock(tplDraft.blocks, i, -1) })} data-testid={`template-block-up-${i}`} className="text-secondary">↑</button>
                  <button type="button" aria-label="Move down" onClick={() => setTplDraft({ ...tplDraft, blocks: moveBlock(tplDraft.blocks, i, 1) })} data-testid={`template-block-down-${i}`} className="text-secondary">↓</button>
                  <button type="button" aria-label="Remove block" onClick={() => setTplDraft({ ...tplDraft, blocks: tplDraft.blocks.filter((_, j) => j !== i) })} data-testid={`template-block-remove-${i}`} className="text-cinnabar">
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {(['heading', 'paragraph', 'link', 'divider'] as TemplateBlock['type'][]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTplDraft({ ...tplDraft, blocks: [...tplDraft.blocks, { type: t, text: '' }] })}
                  data-testid={`template-add-${t}`}
                  className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline"
                >
                  <Plus className="w-3 h-3" /> {t}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void saveTpl()}
              data-testid="template-save"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> Save template
            </button>
          </div>

          {templates.length > 0 && (
            <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline" data-testid="template-list">
              {templates.map((t) => (
                <li key={t.id} className="px-4 py-3" data-testid={`template-${t.eventKey}`}>
                  <div className="text-apple-13 font-medium text-primary">{t.subject || '(no subject)'}</div>
                  <div className="text-apple-11 text-tertiary">
                    {t.eventKey} · {t.blocks.map(describeBlock).join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
