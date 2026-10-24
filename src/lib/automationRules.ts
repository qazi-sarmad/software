/**
 * Automation rules, conditions and actions as data (F7).
 *
 * Pure and deterministic (L1). The rule engine on the server evaluates the same shape; this module
 * is what the visual editors use to build and describe a rule, and what the unit tests exercise.
 * Nothing here calls the network.
 */

export type ConditionOperator = 'eq' | 'ne' | 'gte' | 'lte' | 'contains' | 'in';

export interface RuleCondition {
  field: string;
  operator: ConditionOperator;
  value: string;
}

export type ActionType = 'notify' | 'set_flag' | 'webhook' | 'proposal' | 'escalate';

export interface RuleAction {
  type: ActionType;
  /** Roles whose members receive the notification, by slug. */
  toRoles?: string[];
  /** Named users by id. */
  toUsers?: string[];
  /** Fixed addresses. */
  toAddresses?: string[];
  /** The platform recipients list (SA-05). */
  toPlatformRecipients?: boolean;
  /** Work Queue target role. */
  roleTarget?: string;
  message?: string;
  link?: string;
  url?: string;
  /** Escalate only (F12): the severity recorded on the escalation. */
  severity?: string;
  /** Escalate only: whether to also raise a Work Queue proposal. */
  createProposal?: boolean;
  /** Escalate only: the proposal title. */
  proposalTitle?: string;
  /** Escalate only: the deterministic recommendation template. Never AI (L1). */
  recommendation?: import('./escalation').RecommendationBranch[];
}

export interface AutomationRule {
  id: string;
  ruleKey: string;
  name: string;
  eventKey: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  enabled: boolean;
  isPlatformTemplate: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
}

export const CONDITION_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'gte', label: 'is at least' },
  { value: 'lte', label: 'is at most' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'is one of' },
];

export const ACTION_TYPES: { value: ActionType; label: string }[] = [
  { value: 'notify', label: 'Send a notification' },
  { value: 'set_flag', label: 'Set a flag' },
  { value: 'proposal', label: 'Create a Work Queue proposal' },
  { value: 'webhook', label: 'Call a web address' },
  { value: 'escalate', label: 'Escalate to roles with a recommendation' },
];

/** Field catalogue for one event, so the editor offers dropdowns rather than free text (F1). */
export interface EventField {
  field: string;
  label: string;
  kind: 'text' | 'number' | 'select';
}

export interface EventDef {
  eventKey: string;
  label: string;
  category: string;
  fields: EventField[];
}

/**
 * The events this build wires, with the fields each one carries. Kept in step with
 * automation_events_catalogue and automation_event_fields in the migrations.
 */
export const EVENT_CATALOGUE: EventDef[] = [
  {
    eventKey: 'config.changed', label: 'A configuration changed', category: 'configuration',
    fields: [
      { field: 'area', label: 'Area', kind: 'text' },
      { field: 'area_label', label: 'Area name', kind: 'text' },
    ],
  },
  {
    eventKey: 'ai_model.changed', label: 'An AI model changed', category: 'ai',
    fields: [
      { field: 'area', label: 'Area', kind: 'text' },
      { field: 'area_label', label: 'Area name', kind: 'text' },
    ],
  },
  {
    eventKey: 'anomaly.raised', label: 'An anomaly was raised', category: 'anomaly',
    fields: [
      { field: 'severity', label: 'Severity', kind: 'select' },
      { field: 'amount', label: 'Amount', kind: 'number' },
      { field: 'entity', label: 'Entity', kind: 'text' },
    ],
  },
  {
    eventKey: 'finding.sealed', label: 'A finding was sealed', category: 'finding',
    fields: [
      { field: 'severity', label: 'Severity', kind: 'select' },
      { field: 'entity', label: 'Entity', kind: 'text' },
    ],
  },
  {
    eventKey: 'cap.overdue', label: 'A corrective action is overdue', category: 'cap',
    fields: [
      { field: 'severity', label: 'Severity', kind: 'select' },
      { field: 'days_overdue', label: 'Days overdue', kind: 'number' },
    ],
  },
  {
    eventKey: 'cap.due_soon', label: 'A corrective action is due soon', category: 'cap',
    fields: [
      { field: 'days_due', label: 'Days until due', kind: 'number' },
    ],
  },
  {
    eventKey: 'feature.changed', label: 'A feature entitlement changed', category: 'feature',
    fields: [
      { field: 'feature_key', label: 'Feature', kind: 'text' },
      { field: 'enabled', label: 'Enabled', kind: 'select' },
    ],
  },
];

export function eventDef(eventKey: string): EventDef | undefined {
  return EVENT_CATALOGUE.find((e) => e.eventKey === eventKey);
}

/** Compare one condition against a payload. Mirrors rule_condition_ok in SQL. */
export function conditionMatches(
  payload: Record<string, unknown>, condition: RuleCondition
): boolean {
  const have = payload[condition.field];
  if (have === undefined || have === null) return false;
  const haveText = String(have);
  const want = condition.value;

  switch (condition.operator) {
    case 'eq':
      return haveText === want;
    case 'ne':
      return haveText !== want;
    case 'contains':
      return haveText.toLowerCase().includes(want.toLowerCase());
    case 'in':
      return want.split(',').map((s) => s.trim()).includes(haveText);
    case 'gte':
    case 'lte': {
      const a = Number(haveText);
      const b = Number(want);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return condition.operator === 'gte' ? a >= b : a <= b;
    }
    default:
      return false;
  }
}

/** Every condition must pass (an empty list passes). */
export function conditionsMatch(
  payload: Record<string, unknown>, conditions: RuleCondition[]
): boolean {
  return conditions.every((c) => conditionMatches(payload, c));
}

/** A plain-language sentence for a condition, for the rule list. */
export function describeCondition(condition: RuleCondition): string {
  const label = condition.field.replace(/_/g, ' ');
  const op = CONDITION_OPERATORS.find((o) => o.value === condition.operator)?.label ?? condition.operator;
  return `${label} ${op} ${condition.value}`;
}

/** A plain-language sentence for a rule. */
export function describeRule(rule: AutomationRule): string {
  const event = eventDef(rule.eventKey)?.label ?? rule.eventKey;
  const when = rule.conditions.length
    ? `, but only when ${rule.conditions.map(describeCondition).join(' and ')}`
    : '';
  const then = rule.actions.map((a) => a.message ?? a.type).join('; ');
  return `When "${event}" happens${when}, then ${then || 'nothing'}.`;
}

/** The loop-guard ceiling, matching rule_loop_guard in SQL. */
export const LOOP_GUARD_PER_HOUR = 20;

/**
 * Whether the loop guard would pause a rule given how many events it has seen this hour. Used by the
 * editor to warn before saving and by the tests.
 */
export function wouldPause(eventCountLastHour: number): boolean {
  return eventCountLastHour > LOOP_GUARD_PER_HOUR;
}
