/**
 * Hosting Fit Check (F16, S11). Deterministic verdict maths (L1): no randomness, no AI, no network.
 *
 * A questionnaire is turned into a verdict by the rules the platform administrator edits. Each rule
 * tests one field of the answer. Any blocker makes the verdict Red, else any warning makes it Amber,
 * else Green. The cost tier is the highest effect among the firing rules. The rules and the
 * catalogue are read from the database (src/data/hostingFit.ts); this module only evaluates them.
 */

export type FitSeverity = 'blocker' | 'warning' | 'info';
export type FitVerdict = 'green' | 'amber' | 'red';
export type CostTier = 'standard' | 'managed_bundle' | 'custom_quote';

export interface FitRule {
  key: string;
  field: string;
  operator: string;
  value: string | null;
  severity: FitSeverity;
  message: string;
  costTier: CostTier;
  enabled: boolean;
}

export interface StackOption {
  key: string;
  label: string;
  aliases: string[];
  engine: string;
  hostingKind: string;
  notes: string;
  isSupported: boolean;
}

/** The answers a client fills in. Every field is optional so a partial answer is still evaluable. */
export interface FitAnswers {
  engine?: string;
  hosting_kind?: string;
  os?: string;
  ram_gb?: number;
  cpu_cores?: number;
  disk_gb?: number;
  docker_available?: boolean;
  inbound_443?: boolean;
  outbound_internet?: boolean;
  backup_policy?: string;
  data_residency?: string;
  users?: number;
  largest_population?: number;
}

export interface FiredRule {
  key: string;
  severity: FitSeverity;
  message: string;
  costTier: CostTier;
}

export interface FitResult {
  verdict: FitVerdict;
  costTier: CostTier;
  fired: FiredRule[];
  reasons: string[];
}

const COST_ORDER: Record<CostTier, number> = { standard: 0, managed_bundle: 1, custom_quote: 2 };

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Does one rule fire for these answers? Deterministic and total: an absent answer never fires a
 * value rule (an unanswered question is not a failure), but is_false / is_true rules still evaluate
 * when the field is present.
 */
export function ruleFires(rule: FitRule, answers: FitAnswers): boolean {
  const raw = (answers as Record<string, unknown>)[rule.field];
  const op = rule.operator;
  const target = splitList(rule.value);

  if (op === 'is_true') return asBool(raw) === true;
  if (op === 'is_false') return asBool(raw) === false;

  if (raw === undefined || raw === null || raw === '') return false;

  const num = asNumber(raw);
  const numTarget = asNumber(rule.value);
  if (op === 'lt') return num !== null && numTarget !== null && num < numTarget;
  if (op === 'lte') return num !== null && numTarget !== null && num <= numTarget;
  if (op === 'gt') return num !== null && numTarget !== null && num > numTarget;
  if (op === 'gte') return num !== null && numTarget !== null && num >= numTarget;

  const text = String(raw).trim().toLowerCase();
  if (op === 'eq') return text === (rule.value ?? '').trim().toLowerCase();
  if (op === 'neq') return text !== (rule.value ?? '').trim().toLowerCase();
  if (op === 'in') return target.includes(text);
  if (op === 'not_in') return !target.includes(text);
  return false;
}

/** Evaluate every enabled rule and roll the fired rules up into one verdict and one cost tier. */
export function evaluateFit(answers: FitAnswers, rules: FitRule[]): FitResult {
  const fired: FiredRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (ruleFires(rule, answers)) {
      fired.push({ key: rule.key, severity: rule.severity, message: rule.message, costTier: rule.costTier });
    }
  }

  let verdict: FitVerdict = 'green';
  if (fired.some((r) => r.severity === 'blocker')) verdict = 'red';
  else if (fired.some((r) => r.severity === 'warning')) verdict = 'amber';

  let costTier: CostTier = 'standard';
  for (const r of fired) {
    if (COST_ORDER[r.costTier] > COST_ORDER[costTier]) costTier = r.costTier;
  }

  const reasons = fired
    .filter((r) => r.severity !== 'info')
    .map((r) => r.message);

  return { verdict, costTier, fired, reasons };
}

/** The plain checklist of what the client must provide before a migration (F16). */
export function requiredChecklist(results: FitResult, extensions: string[], roles: string[]): string[] {
  const out: string[] = [];
  if (results.verdict === 'red') {
    out.push('Resolve the blocking reasons above before a migration is possible.');
  }
  out.push(`Install these PostgreSQL extensions on the target: ${extensions.join(', ') || 'none beyond the defaults'}.`);
  out.push(`Create these database roles on the target: ${roles.join(', ') || 'the Supabase defaults'}.`);
  out.push('A machine that can reach both databases, to run the migration runner.');
  out.push('A window of read-only time for the source during the final cutover.');
  if (results.costTier === 'custom_quote') {
    out.push('Ask QSCorp for a custom quote for this stack.');
  }
  return out;
}

/** Search the stack catalogue by name or alias (SA-10). Deterministic, case-insensitive. */
export function searchStacks(catalogue: StackOption[], query: string): StackOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return catalogue;
  return catalogue.filter((s) => {
    if (s.label.toLowerCase().includes(q)) return true;
    if (s.key.toLowerCase().includes(q)) return true;
    return s.aliases.some((a) => a.toLowerCase().includes(q));
  });
}
