import { describe, expect, it } from 'vitest';
import {
  evaluateFit, requiredChecklist, ruleFires, searchStacks,
  type FitAnswers, type FitRule, type StackOption,
} from './hostingFit';

function rule(over: Partial<FitRule> & { key: string }): FitRule {
  return {
    field: 'engine', operator: 'eq', value: 'postgres', severity: 'info',
    message: 'm', costTier: 'standard', enabled: true, ...over,
  };
}

const rules: FitRule[] = [
  rule({ key: 'engine.postgres.required', field: 'engine', operator: 'neq', value: 'postgres',
    severity: 'blocker', costTier: 'custom_quote', message: 'Engine must be PostgreSQL.' }),
  rule({ key: 'supabase.supported', field: 'hosting_kind', operator: 'in',
    value: 'supabase_cloud,supabase_self_hosted', severity: 'info', costTier: 'standard',
    message: 'Supabase is the supported path.' }),
  rule({ key: 'managed.amber', field: 'hosting_kind', operator: 'eq', value: 'managed_postgres',
    severity: 'warning', costTier: 'managed_bundle', message: 'Managed Postgres needs our service layer.' }),
  rule({ key: 'size.ram.blocker', field: 'ram_gb', operator: 'lt', value: '4',
    severity: 'blocker', costTier: 'custom_quote', message: 'Below 4 GB RAM.' }),
  rule({ key: 'size.ram.warning', field: 'ram_gb', operator: 'lt', value: '8',
    severity: 'warning', costTier: 'standard', message: 'Below 8 GB RAM.' }),
  rule({ key: 'os.warning', field: 'os', operator: 'not_in', value: 'debian,ubuntu,rhel',
    severity: 'warning', costTier: 'standard', message: 'Untested OS.' }),
  rule({ key: 'docker.warning', field: 'docker_available', operator: 'is_false', value: null,
    severity: 'warning', costTier: 'standard', message: 'No Docker.' }),
  rule({ key: 'internet.warning', field: 'outbound_internet', operator: 'is_false', value: null,
    severity: 'warning', costTier: 'standard', message: 'No outbound internet.' }),
];

describe('ruleFires', () => {
  it('eq matches case-insensitively', () => {
    expect(ruleFires(rule({ key: 'k', field: 'engine', operator: 'eq', value: 'Postgres' }), { engine: 'postgres' })).toBe(true);
  });
  it('neq fires when the value differs', () => {
    expect(ruleFires(rule({ key: 'k', field: 'engine', operator: 'neq', value: 'postgres' }), { engine: 'mysql' })).toBe(true);
    expect(ruleFires(rule({ key: 'k', field: 'engine', operator: 'neq', value: 'postgres' }), { engine: 'postgres' })).toBe(false);
  });
  it('in / not_in match against the comma list', () => {
    const r = rule({ key: 'k', field: 'os', operator: 'in', value: 'debian, ubuntu' });
    expect(ruleFires(r, { os: 'Ubuntu' })).toBe(true);
    expect(ruleFires(r, { os: 'centos' })).toBe(false);
  });
  it('numeric comparisons fire and do not on absent answers', () => {
    const r = rule({ key: 'k', field: 'ram_gb', operator: 'lt', value: '8' });
    expect(ruleFires(r, { ram_gb: 4 })).toBe(true);
    expect(ruleFires(r, { ram_gb: 16 })).toBe(false);
    expect(ruleFires(r, {})).toBe(false);
  });
  it('is_true / is_false follow the boolean, and absent is not a failure', () => {
    const f = rule({ key: 'k', field: 'docker_available', operator: 'is_false', value: null });
    expect(ruleFires(f, { docker_available: false })).toBe(true);
    expect(ruleFires(f, { docker_available: true })).toBe(false);
    expect(ruleFires(f, {})).toBe(false);
  });
  it('gte and lte are inclusive', () => {
    expect(ruleFires(rule({ key: 'k', field: 'cpu_cores', operator: 'gte', value: '4' }), { cpu_cores: 4 })).toBe(true);
    expect(ruleFires(rule({ key: 'k', field: 'cpu_cores', operator: 'lte', value: '4' }), { cpu_cores: 4 })).toBe(true);
  });
  it('an unknown operator never fires', () => {
    expect(ruleFires(rule({ key: 'k', field: 'engine', operator: 'xor', value: 'postgres' }), { engine: 'postgres' })).toBe(false);
  });
});

describe('evaluateFit', () => {
  it('a Supabase cloud project is green and standard cost', () => {
    const r = evaluateFit({ engine: 'postgres', hosting_kind: 'supabase_cloud', os: 'debian', ram_gb: 8 }, rules);
    expect(r.verdict).toBe('green');
    expect(r.costTier).toBe('standard');
    expect(r.reasons).toEqual([]);
  });
  it('managed Postgres is amber with a managed bundle', () => {
    const r = evaluateFit({ engine: 'postgres', hosting_kind: 'managed_postgres', os: 'ubuntu', ram_gb: 8 }, rules);
    expect(r.verdict).toBe('amber');
    expect(r.costTier).toBe('managed_bundle');
    expect(r.reasons).toContain('Managed Postgres needs our service layer.');
  });
  it('a non-Postgres engine is red with a custom quote', () => {
    const r = evaluateFit({ engine: 'sqlserver', os: 'windows', ram_gb: 32 }, rules);
    expect(r.verdict).toBe('red');
    expect(r.costTier).toBe('custom_quote');
  });
  it('a blocker beats every warning', () => {
    const r = evaluateFit({ engine: 'postgres', hosting_kind: 'supabase_self_hosted', os: 'centos', ram_gb: 2 }, rules);
    expect(r.verdict).toBe('red');
  });
  it('small RAM below 4 is a blocker, between 4 and 8 a warning', () => {
    expect(evaluateFit({ engine: 'postgres', hosting_kind: 'supabase_cloud', os: 'debian', ram_gb: 3 }, rules).verdict).toBe('red');
    expect(evaluateFit({ engine: 'postgres', hosting_kind: 'supabase_cloud', os: 'debian', ram_gb: 6 }, rules).verdict).toBe('amber');
  });
  it('no Docker or no internet is a warning', () => {
    expect(evaluateFit({ engine: 'postgres', hosting_kind: 'supabase_cloud', os: 'debian', ram_gb: 8, docker_available: false }, rules).verdict).toBe('amber');
    expect(evaluateFit({ engine: 'postgres', hosting_kind: 'supabase_cloud', os: 'debian', ram_gb: 8, outbound_internet: false }, rules).verdict).toBe('amber');
  });
  it('a disabled rule is ignored', () => {
    const disabled = rules.map((r) => (r.key === 'engine.postgres.required' ? { ...r, enabled: false } : r));
    expect(evaluateFit({ engine: 'mysql' }, disabled).verdict).toBe('green');
  });
  it('info rules never change the verdict but still record a reason list without them', () => {
    const r = evaluateFit({ engine: 'postgres', hosting_kind: 'supabase_cloud' }, rules);
    expect(r.fired.some((f) => f.severity === 'info')).toBe(true);
    expect(r.reasons).not.toContain('Supabase is the supported path.');
  });
  it('the highest cost tier wins among fired rules', () => {
    const r = evaluateFit({ engine: 'mysql', hosting_kind: 'managed_postgres' }, rules);
    expect(r.costTier).toBe('custom_quote');
  });
  it('is deterministic across repeated calls', () => {
    const answers: FitAnswers = { engine: 'postgres', hosting_kind: 'managed_postgres', os: 'centos', ram_gb: 4 };
    expect(evaluateFit(answers, rules)).toEqual(evaluateFit(answers, rules));
  });
});

describe('requiredChecklist', () => {
  it('lists the extensions, roles and the runner machine', () => {
    const res = evaluateFit({ engine: 'postgres', hosting_kind: 'supabase_cloud' }, rules);
    const list = requiredChecklist(res, ['pg_cron', 'pg_net'], ['anon', 'authenticated']);
    expect(list.join(' ')).toContain('pg_cron');
    expect(list.join(' ')).toContain('authenticated');
    expect(list.join(' ')).toContain('migration runner');
  });
  it('adds a custom-quote line for a custom-quote verdict', () => {
    const res = evaluateFit({ engine: 'mysql' }, rules);
    expect(requiredChecklist(res, [], []).join(' ')).toContain('custom quote');
  });
});

describe('searchStacks', () => {
  const catalogue: StackOption[] = [
    { key: 'supabase_cloud', label: 'Supabase Cloud', aliases: ['supabase'], engine: 'postgres', hostingKind: 'supabase_cloud', notes: '', isSupported: true },
    { key: 'rds', label: 'Amazon RDS', aliases: ['RDS', 'Aurora'], engine: 'postgres', hostingKind: 'managed_postgres', notes: '', isSupported: true },
    { key: 'sql_server', label: 'Microsoft SQL Server', aliases: ['SQL Server', 'MSSQL'], engine: 'sqlserver', hostingKind: 'other', notes: '', isSupported: false },
  ];
  it('matches on the label', () => {
    expect(searchStacks(catalogue, 'amazon').map((s) => s.key)).toEqual(['rds']);
  });
  it('matches on an alias, case-insensitively', () => {
    expect(searchStacks(catalogue, 'aurora').map((s) => s.key)).toEqual(['rds']);
    expect(searchStacks(catalogue, 'MSSQL').map((s) => s.key)).toEqual(['sql_server']);
  });
  it('an empty query returns everything', () => {
    expect(searchStacks(catalogue, '  ')).toHaveLength(3);
  });
  it('no match returns an empty list', () => {
    expect(searchStacks(catalogue, 'oracle')).toEqual([]);
  });
});
