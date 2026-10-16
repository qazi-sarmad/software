import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  deleteSamplingRule, listSamplingRules, upsertSamplingRule, type SamplingRuleRow,
} from '../../data/sampling';
import {
  EMAIL_PROVIDERS, SEVERITY_COLOR_TOKENS, deleteSeverityLevel, getEmailSettings,
  listSeverityLevels, setEmailProvider, upsertSeverityLevel,
  type EmailSettingsRow, type SeverityLevelRow,
} from '../../data/orgSettings';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Plus, XCircle, Sliders } from '../common/Icons';

type Tab = 'sampling' | 'severity' | 'email';
type LoadState = 'loading' | 'ready' | 'error';

const METHODS = ['random', 'systematic', 'mus', 'stratified', 'high_value', 'low_value', 'haphazard'] as const;

/**
 * Organisation settings (C5, spec §11.2, §14.4, §16).
 *
 * A full-page Org Admin surface (non-blocking, no modal) that edits the sampling table, severity
 * levels and email provider shape through the RPCs in migration 0032. Every control is gated by
 * hasRight(edit_config), never a role name; the database re-checks the right.
 */
export const OrgSettingsPanel: React.FC = () => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');

  const [tab, setTab] = useState<Tab>('sampling');
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<DataResult | null>(null);

  const [rules, setRules] = useState<SamplingRuleRow[]>([]);
  const [levels, setLevels] = useState<SeverityLevelRow[]>([]);
  const [email, setEmail] = useState<EmailSettingsRow | null>(null);

  const [ruleDraft, setRuleDraft] = useState({ controlType: 'any', frequency: 'any', popBand: 'small', method: 'random', baseSize: '5', pct: '0.10' });
  const [levelDraft, setLevelDraft] = useState({ name: '', colorToken: SEVERITY_COLOR_TOKENS[0] as string, rank: '0' });
  const [provider, setProvider] = useState('stub');
  const [fromAddress, setFromAddress] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [r, l, e] = await Promise.all([listSamplingRules(''), listSeverityLevels(), getEmailSettings()]);
      setRules(r);
      setLevels(l);
      setEmail(e);
      if (e) {
        setProvider(e.provider);
        setFromAddress(e.fromAddress ?? '');
      }
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load organisation settings.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<DataResult>) => {
    setResult(null);
    const r = await action();
    setResult(r);
    if (r.ok) await load();
  };

  if (!canEdit) {
    return (
      <div className="p-6" data-testid="org-settings-no-right">
        <InlineError message="You need the Edit configuration right to change organisation settings." testId="org-settings-denied" />
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="text-secondary text-apple-13 py-12 text-center" data-testid="org-settings-loading">
        Loading organisation settings…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="p-6 space-y-3">
        <InlineError message={loadError} testId="org-settings-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'sampling', label: 'Sampling table' },
    { id: 'severity', label: 'Severity levels' },
    { id: 'email', label: 'Email provider' },
  ];

  return (
    <div className="p-6 space-y-6" data-testid="org-settings-panel">
      <div className="flex items-center gap-2 border-b border-hairline pb-3">
        <Sliders className="w-5 h-5 text-accent" />
        <h2 className="text-apple-16 font-bold text-primary">Organisation settings</h2>
      </div>

      <InlineError message={result && !result.ok ? result.reason : null} testId="org-settings-result" />

      <nav className="flex gap-1" data-testid="org-settings-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-apple-12 font-medium transition-colors ${
              tab === t.id ? 'bg-accent-subtle text-primary' : 'text-secondary hover:text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'sampling' && (
        <section className="space-y-3" data-testid="org-settings-sampling">
          {rules.length === 0 ? (
            <p className="text-secondary text-apple-13 py-6 text-center">No sampling rules are configured.</p>
          ) : (
            <table className="w-full text-apple-12">
              <thead className="text-secondary">
                <tr>
                  <th className="text-left py-1.5 font-semibold">Control type</th>
                  <th className="text-left py-1.5 font-semibold">Frequency</th>
                  <th className="text-left py-1.5 font-semibold">Pop band</th>
                  <th className="text-left py-1.5 font-semibold">Method</th>
                  <th className="text-left py-1.5 font-semibold">Base</th>
                  <th className="text-left py-1.5 font-semibold">Pct</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t border-hairline">
                    <td className="py-1.5 text-primary">{r.controlType}</td>
                    <td className="py-1.5 text-primary">{r.frequency}</td>
                    <td className="py-1.5 text-primary">{r.popBand}</td>
                    <td className="py-1.5 text-primary">
                      <Select
                        ariaLabel={`Method for ${r.popBand}`}
                        value={r.method}
                        options={METHODS.map((m) => ({ value: m, label: m }))}
                        onChange={(v) => void run(() => upsertSamplingRule({ ...r, method: v as SamplingRuleRow['method'] }))}
                      />
                    </td>
                    <td className="py-1.5 text-primary">{r.baseSize}</td>
                    <td className="py-1.5 text-primary">{r.pct}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        aria-label={`Delete rule ${r.popBand}`}
                        onClick={() => void run(() => deleteSamplingRule(r.id))}
                        className="text-cinnabar hover:bg-cinnabar-subtle rounded-lg p-1 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="rounded-xl border border-hairline bg-surface-elevated p-3 flex flex-wrap items-end gap-3">
            {(['controlType', 'frequency', 'popBand'] as const).map((k) => (
              <label key={k} className="space-y-1">
                <span className="text-apple-11 text-secondary capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>
                <input
                  value={ruleDraft[k]}
                  onChange={(e) => setRuleDraft((d) => ({ ...d, [k]: e.target.value }))}
                  className="w-28 p-1.5 rounded-lg bg-surface border border-hairline text-apple-12 text-primary outline-none"
                />
              </label>
            ))}
            <label className="space-y-1">
              <span className="text-apple-11 text-secondary">Method</span>
              <Select
                ariaLabel="New rule method"
                value={ruleDraft.method}
                options={METHODS.map((m) => ({ value: m, label: m }))}
                onChange={(v) => setRuleDraft((d) => ({ ...d, method: v }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-apple-11 text-secondary">Base</span>
              <input
                type="number"
                value={ruleDraft.baseSize}
                onChange={(e) => setRuleDraft((d) => ({ ...d, baseSize: e.target.value }))}
                className="w-20 p-1.5 rounded-lg bg-surface border border-hairline text-apple-12 text-primary outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-apple-11 text-secondary">Pct</span>
              <input
                value={ruleDraft.pct}
                onChange={(e) => setRuleDraft((d) => ({ ...d, pct: e.target.value }))}
                className="w-20 p-1.5 rounded-lg bg-surface border border-hairline text-apple-12 text-primary outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                void run(() =>
                  upsertSamplingRule({
                    controlType: ruleDraft.controlType, frequency: ruleDraft.frequency, popBand: ruleDraft.popBand,
                    method: ruleDraft.method as SamplingRuleRow['method'],
                    baseSize: Number(ruleDraft.baseSize), pct: Number(ruleDraft.pct),
                  })
                )
              }
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-apple-12 font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" /> Add rule
            </button>
          </div>
        </section>
      )}

      {tab === 'severity' && (
        <section className="space-y-3" data-testid="org-settings-severity">
          {levels.length === 0 ? (
            <p className="text-secondary text-apple-13 py-6 text-center">No severity levels are configured.</p>
          ) : (
            <ul className="space-y-2">
              {levels.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-xl border border-hairline bg-surface px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: `var(${l.colorToken})` }} />
                    <span className="text-apple-13 text-primary font-medium">{l.name}</span>
                    <span className="text-apple-11 text-tertiary">rank {l.rank}</span>
                    <span className="text-apple-11 text-tertiary">{l.colorToken}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete severity ${l.name}`}
                    onClick={() => void run(() => deleteSeverityLevel(l.id))}
                    className="text-cinnabar hover:bg-cinnabar-subtle rounded-lg p-1 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-xl border border-hairline bg-surface-elevated p-3 flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="text-apple-11 text-secondary">Name</span>
              <input
                value={levelDraft.name}
                onChange={(e) => setLevelDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-40 p-1.5 rounded-lg bg-surface border border-hairline text-apple-12 text-primary outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-apple-11 text-secondary">Colour token</span>
              <Select
                ariaLabel="Severity colour token"
                value={levelDraft.colorToken}
                options={SEVERITY_COLOR_TOKENS.map((c) => ({ value: c, label: c }))}
                onChange={(v) => setLevelDraft((d) => ({ ...d, colorToken: v }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-apple-11 text-secondary">Rank</span>
              <input
                type="number"
                value={levelDraft.rank}
                onChange={(e) => setLevelDraft((d) => ({ ...d, rank: e.target.value }))}
                className="w-20 p-1.5 rounded-lg bg-surface border border-hairline text-apple-12 text-primary outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void run(() => upsertSeverityLevel(levelDraft.name, levelDraft.colorToken, Number(levelDraft.rank)))}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-apple-12 font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" /> Add level
            </button>
          </div>
        </section>
      )}

      {tab === 'email' && (
        <section className="space-y-3" data-testid="org-settings-email">
          <p className="text-apple-12 text-secondary">
            Provider credentials are deploy secrets and are never shown here. Only the provider and
            the from-address are visible.
          </p>
          <div className="rounded-xl border border-hairline bg-surface-elevated p-3 flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="text-apple-11 text-secondary">Provider</span>
              <Select
                ariaLabel="Email provider"
                value={provider}
                options={EMAIL_PROVIDERS.map((p) => ({ value: p, label: p }))}
                onChange={setProvider}
              />
            </label>
            <label className="space-y-1">
              <span className="text-apple-11 text-secondary">From address</span>
              <input
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                className="w-56 p-1.5 rounded-lg bg-surface border border-hairline text-apple-12 text-primary outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void run(() => setEmailProvider(provider, fromAddress || null))}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-apple-12 font-medium hover:opacity-90 transition-opacity"
            >
              Save provider
            </button>
          </div>
          <p className="text-apple-11 text-tertiary">
            Current: {email ? `${email.provider}${email.fromAddress ? ` · ${email.fromAddress}` : ''}` : 'not set'}
          </p>
        </section>
      )}
    </div>
  );
};
