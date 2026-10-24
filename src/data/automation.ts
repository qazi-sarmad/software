/**
 * Automation rules and notification templates data module (F7, S2).
 *
 * The rule engine runs on the server. This module reads the rules a caller may see (its own plus the
 * platform templates), saves a tenant rule, tests a rule with a sample event, and reads the event
 * catalogue the editors build their dropdowns from. Components never import the database client.
 */
import { callRpc, getClient, type DataResult } from './db';
import type { AutomationRule, RuleAction, RuleCondition } from '../lib/automationRules';
import type { TemplateBlock } from '../lib/notifications';
import { EVENT_CATALOGUE } from '../lib/automationRules';
import type { EventDef } from '../lib/automationRules';

const NOT_CONFIGURED = 'The automation module is not configured.';

interface RawRule {
  id: string;
  rule_key: string;
  name: string;
  event_key: string;
  conditions: RuleCondition[] | null;
  actions: RuleAction[] | null;
  enabled: boolean;
  is_platform_template: boolean;
  paused_at: string | null;
  pause_reason: string | null;
}

function mapRule(r: RawRule): AutomationRule {
  return {
    id: r.id,
    ruleKey: r.rule_key,
    name: r.name,
    eventKey: r.event_key,
    conditions: r.conditions ?? [],
    actions: r.actions ?? [],
    enabled: r.enabled,
    isPlatformTemplate: r.is_platform_template,
    pausedAt: r.paused_at,
    pauseReason: r.pause_reason,
  };
}

/** The rules a caller may see: its own organisation's plus the platform templates. */
export async function listRules(orgId: string | null): Promise<AutomationRule[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('automation_rule_list', { p_org: orgId || null });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawRule[]).map(mapRule);
}

export function saveRule(
  orgId: string | null, ruleKey: string, name: string, eventKey: string,
  conditions: RuleCondition[], actions: RuleAction[], enabled: boolean
): Promise<DataResult> {
  return callRpc('automation_rule_save', {
    p_org: orgId || null, p_rule_key: ruleKey, p_name: name, p_event_key: eventKey,
    p_conditions: conditions, p_actions: actions, p_enabled: enabled,
  }, NOT_CONFIGURED);
}

/** Test with a sample event: a dry run that sends nothing. */
export async function testRule(
  ruleId: string, sample: Record<string, unknown>
): Promise<{ recipients: string[]; subject: string; bodyText: string } | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('automation_rule_test', { p_rule_id: ruleId, p_sample: sample });
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { recipients: string[]; subject: string; body_text: string } | undefined;
  if (!row) return null;
  return { recipients: row.recipients ?? [], subject: row.subject ?? '', bodyText: row.body_text ?? '' };
}

/** The event catalogue, with each event's field list, for the editor dropdowns (F1). */
export async function listEventCatalogue(): Promise<EventDef[]> {
  const sb = getClient();
  if (!sb) return EVENT_CATALOGUE;
  const { data, error } = await sb.from('automation_events_catalogue').select('event_key, label, category');
  if (error) return EVENT_CATALOGUE;
  const rows = (data ?? []) as { event_key: string; label: string; category: string }[];
  if (!rows.length) return EVENT_CATALOGUE;
  const fieldsByKey = new Map(EVENT_CATALOGUE.map((e) => [e.eventKey, e.fields]));
  return rows.map((r) => ({
    eventKey: r.event_key,
    label: r.label,
    category: r.category,
    fields: fieldsByKey.get(r.event_key) ?? [],
  }));
}

export interface NotificationTemplate {
  id: string;
  eventKey: string;
  subject: string;
  blocks: TemplateBlock[];
  isPlatformTemplate: boolean;
}

interface RawTemplate {
  id: string;
  event_key: string;
  subject: string | null;
  blocks: TemplateBlock[] | null;
  is_platform_template: boolean;
}

export async function listTemplates(orgId: string | null): Promise<NotificationTemplate[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('notification_template_list', { p_org: orgId || null });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawTemplate[]).map((t) => ({
    id: t.id,
    eventKey: t.event_key,
    subject: t.subject ?? '',
    blocks: t.blocks ?? [],
    isPlatformTemplate: t.is_platform_template,
  }));
}

export function saveTemplate(
  orgId: string | null, eventKey: string, subject: string, blocks: TemplateBlock[]
): Promise<DataResult> {
  return callRpc('notification_template_save', {
    p_org: orgId, p_event_key: eventKey, p_subject: subject, p_blocks: blocks,
  }, NOT_CONFIGURED);
}
