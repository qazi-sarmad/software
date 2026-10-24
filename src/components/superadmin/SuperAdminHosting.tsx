import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  evaluateFit, requiredChecklist, searchStacks,
  type FitAnswers, type FitRule, type FitResult, type StackOption,
} from '../../lib/hostingFit';
import { getHostingCatalogue, saveHostingRule } from '../../data/hostingFit';
import { InlineError } from '../common/InlineError';
import { Database, Search, AlertTriangle, CheckCircle, Sliders } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';
type Tab = 'check' | 'rules';

const EMPTY_ANSWERS: FitAnswers = {
  engine: 'postgres', hosting_kind: 'supabase_cloud', os: 'debian', ram_gb: 8, cpu_cores: 4,
  disk_gb: 100, docker_available: true, inbound_443: true, outbound_internet: true,
  backup_policy: 'daily', data_residency: 'none', users: 50, largest_population: 5000,
};

const VERDICT_STYLE: Record<string, string> = {
  green: 'text-verdigris', amber: 'text-brass', red: 'text-cinnabar',
};

/**
 * SA-10 hosting fit check and SA-11 hosting rules editor (F16).
 *
 * SA-10: a searchable stack catalogue pre-fills a questionnaire; the deterministic `evaluateFit`
 * produces Red / Amber / Green, a cost tier, plain reasons and a checklist. SA-11: the rules are
 * edited visually, one field, operator, value and severity per row. Nothing here is JSON.
 * Non-blocking; no modal (spec §27.5).
 */
export const SuperAdminHosting: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('check');
  const [catalogue, setCatalogue] = useState<StackOption[]>([]);
  const [rules, setRules] = useState<FitRule[]>([]);
  const [search, setSearch] = useState('');
  const [answers, setAnswers] = useState<FitAnswers>(EMPTY_ANSWERS);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const data = await getHostingCatalogue();
      setCatalogue(data.catalogue);
      setRules(data.rules);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the hosting catalogue.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const matches = useMemo(() => searchStacks(catalogue, search), [catalogue, search]);
  const verdict: FitResult = useMemo(() => evaluateFit(answers, rules), [answers, rules]);

  const pickStack = (s: StackOption) => {
    setAnswers((a) => ({ ...a, engine: s.engine, hosting_kind: s.hostingKind }));
  };

  const setField = (field: keyof FitAnswers, value: string | number | boolean) => {
    setAnswers((a) => ({ ...a, [field]: value }));
  };

  const editRule = async (rule: FitRule, patch: Partial<FitRule>) => {
    const next = { ...rule, ...patch };
    setRules((rs) => rs.map((r) => (r.key === rule.key ? next : r)));
    setSaveResult(null);
    try {
      await saveHostingRule(next);
      setSaveResult(`Saved rule ${next.key}.`);
    } catch (err) {
      setSaveResult(err instanceof Error ? err.message : 'Could not save the rule.');
      await load();
    }
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="sa-hosting-loading">Loading hosting fit…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="sa-hosting-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  const checklist = requiredChecklist(verdict, [], []);

  return (
    <div className="space-y-4" data-testid="sa-hosting">
      <nav className="flex gap-1" data-testid="sa-hosting-tabs">
        {([['check', 'Fit check', Database], ['rules', 'Rules', Sliders]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            data-testid={`sa-hosting-tab-${id}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-apple-12 font-medium ${
              tab === id ? 'bg-accent-subtle text-accent' : 'text-secondary hover:text-primary'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </nav>

      {tab === 'check' ? (
        <div className="space-y-4" data-testid="sa-hosting-fit">
          <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-secondary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search stacks (RDS, Aurora, Docker, SQL Server…)"
                aria-label="Search hosting stacks"
                data-testid="sa-hosting-search"
                className="flex-1 px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
              />
            </div>
            {search.trim() !== '' && (
              matches.length === 0 ? (
                <p className="text-apple-12 text-secondary" data-testid="sa-hosting-search-empty">
                  No stack matches “{search}”. Pick a kind below, or ask QSCorp for a separate quote.
                </p>
              ) : (
                <ul className="divide-y divide-hairline" data-testid="sa-hosting-search-results">
                  {matches.map((s) => (
                    <li key={s.key} className="flex items-center justify-between py-2">
                      <button
                        type="button"
                        onClick={() => pickStack(s)}
                        data-testid={`sa-hosting-stack-${s.key}`}
                        className="text-left text-apple-13 text-primary hover:text-accent"
                      >
                        <span className="font-medium">{s.label}</span>
                        <span className="text-secondary"> · {s.engine}{s.isSupported ? '' : ' · not supported'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {([
              ['engine', 'Engine', 'text', ['postgres', 'mysql', 'sqlserver', 'oracle']],
              ['hosting_kind', 'Hosting kind', 'text', ['supabase_cloud', 'supabase_self_hosted', 'managed_postgres', 'self_managed', 'other']],
              ['os', 'Operating system', 'text', ['debian', 'ubuntu', 'rhel', 'centos', 'windows', 'other']],
              ['backup_policy', 'Backup policy', 'text', ['daily', 'weekly', 'none']],
            ] as const).map(([field, label, , options]) => (
              <label key={field} className="space-y-1">
                <span className="text-apple-12 text-secondary">{label}</span>
                <select
                  value={String(answers[field] ?? '')}
                  onChange={(e) => setField(field, e.target.value)}
                  data-testid={`sa-hosting-field-${field}`}
                  className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                >
                  {options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
            {([
              ['ram_gb', 'RAM (GB)'], ['cpu_cores', 'CPU cores'], ['disk_gb', 'Disk (GB)'],
              ['users', 'Users'], ['largest_population', 'Largest population'],
            ] as const).map(([field, label]) => (
              <label key={field} className="space-y-1">
                <span className="text-apple-12 text-secondary">{label}</span>
                <input
                  type="number"
                  value={Number(answers[field] ?? 0)}
                  onChange={(e) => setField(field, Number(e.target.value))}
                  data-testid={`sa-hosting-field-${field}`}
                  className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                />
              </label>
            ))}
            {([
              ['docker_available', 'Docker available'],
              ['inbound_443', 'Inbound 443'],
              ['outbound_internet', 'Outbound internet'],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center gap-2 text-apple-13 text-primary">
                <input
                  type="checkbox"
                  checked={Boolean(answers[field])}
                  onChange={(e) => setField(field, e.target.checked)}
                  data-testid={`sa-hosting-field-${field}`}
                  className="w-4 h-4 rounded border-hairline"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="sa-hosting-verdict">
            <div className="flex items-center gap-2">
              {verdict.verdict === 'green'
                ? <CheckCircle className="w-4 h-4 text-verdigris" />
                : <AlertTriangle className={`w-4 h-4 ${VERDICT_STYLE[verdict.verdict]}`} />}
              <h3 className={`text-apple-14 font-semibold ${VERDICT_STYLE[verdict.verdict]}`} data-testid="sa-hosting-verdict-value">
                {verdict.verdict.toUpperCase()}
              </h3>
              <span className="text-apple-12 text-secondary" data-testid="sa-hosting-cost">
                Cost tier: {verdict.costTier}
              </span>
            </div>
            {verdict.reasons.length === 0 ? (
              <p className="text-apple-12 text-secondary">No blockers or warnings. This stack is a fit.</p>
            ) : (
              <ul className="space-y-1" data-testid="sa-hosting-reasons">
                {verdict.reasons.map((r) => <li key={r} className="text-apple-12 text-secondary">• {r}</li>)}
              </ul>
            )}
            <div className="pt-2">
              <h4 className="text-apple-12 font-semibold text-primary">What the client must provide</h4>
              <ul className="space-y-1" data-testid="sa-hosting-checklist">
                {checklist.map((c) => <li key={c} className="text-apple-12 text-secondary">– {c}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="sa-hosting-rules">
          {saveResult && <p className="text-apple-12 text-secondary" data-testid="sa-hosting-rule-saved">{saveResult}</p>}
          <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline">
            {rules.map((r) => (
              <li key={r.key} className="px-4 py-2 space-y-1" data-testid={`sa-hosting-rule-${r.key}`}>
                <div className="flex items-center gap-2">
                  <span className="text-apple-13 font-medium text-primary">{r.key}</span>
                  <label className="ml-auto inline-flex items-center gap-1 text-apple-12 text-secondary">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => void editRule(r, { enabled: e.target.checked })}
                      data-testid={`sa-hosting-rule-enabled-${r.key}`}
                      className="w-3.5 h-3.5"
                    />
                    enabled
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-apple-12">
                  <input
                    value={r.field}
                    onChange={(e) => setRules((rs) => rs.map((x) => (x.key === r.key ? { ...x, field: e.target.value } : x)))}
                    onBlur={() => void editRule(r, { field: r.field })}
                    data-testid={`sa-hosting-rule-field-${r.key}`}
                    className="w-32 px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary"
                  />
                  <select
                    value={r.operator}
                    onChange={(e) => void editRule(r, { operator: e.target.value })}
                    data-testid={`sa-hosting-rule-op-${r.key}`}
                    className="px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary"
                  >
                    {['eq', 'neq', 'in', 'not_in', 'lt', 'lte', 'gt', 'gte', 'is_true', 'is_false'].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input
                    value={r.value ?? ''}
                    onChange={(e) => setRules((rs) => rs.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))}
                    onBlur={() => void editRule(r, { value: r.value })}
                    data-testid={`sa-hosting-rule-value-${r.key}`}
                    className="w-40 px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary"
                  />
                  <select
                    value={r.severity}
                    onChange={(e) => void editRule(r, { severity: e.target.value as FitRule['severity'] })}
                    data-testid={`sa-hosting-rule-sev-${r.key}`}
                    className="px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary"
                  >
                    {['blocker', 'warning', 'info'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select
                    value={r.costTier}
                    onChange={(e) => void editRule(r, { costTier: e.target.value as FitRule['costTier'] })}
                    data-testid={`sa-hosting-rule-cost-${r.key}`}
                    className="px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary"
                  >
                    {['standard', 'managed_bundle', 'custom_quote'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {r.message && <p className="text-apple-11 text-secondary">{r.message}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
