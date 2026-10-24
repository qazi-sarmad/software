/**
 * Feature entitlements (F25).
 *
 * A feature is switched per organisation by the Super Admin, enforced on the server by
 * `has_feature`. The app never decides entitlement itself: it reads the effective set through this
 * module to hide or disable a surface, and it always shows the server's refusal in plain words.
 * Components never import the database client; every call goes through a data module (rule M8).
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';

export type PriceClass = 'free' | 'included' | 'add_on' | 'custom';
export type FeatureStatus = 'live' | 'beta' | 'parked';

export interface FeatureRow {
  key: string;
  label: string;
  description: string;
  group: string;
  priceClass: PriceClass;
  defaultOn: boolean;
  requires: string[];
  status: FeatureStatus;
}

export interface PlanRow {
  name: string;
  includedFeatures: string[];
  priceText: string;
}

export interface EntitlementRow {
  featureKey: string;
  enabled: boolean;
  planName: string | null;
  reason: string | null;
}

const NOT_CONFIGURED = 'The entitlements module is not configured.';

/** The platform feature catalogue. Empty when the module is not configured. */
export async function listFeatureCatalogue(): Promise<FeatureRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('list_feature_catalogue');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    key: r.key as string,
    label: (r.label as string) ?? '',
    description: (r.description as string) ?? '',
    group: (r.group_name as string) ?? '',
    priceClass: (r.price_class as PriceClass) ?? 'free',
    defaultOn: Boolean(r.default_on),
    requires: (r.requires as string[]) ?? [],
    status: (r.status as FeatureStatus) ?? 'live',
  }));
}

export async function listPlans(): Promise<PlanRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('list_plans');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    name: r.name as string,
    includedFeatures: (r.included_features as string[]) ?? [],
    priceText: (r.price_text as string) ?? '',
  }));
}

/** The effective entitlements of one organisation (read-only for a tenant). */
export async function listTenantEntitlements(orgId: string): Promise<EntitlementRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('list_tenant_entitlements', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    featureKey: r.feature_key as string,
    enabled: Boolean(r.enabled),
    planName: (r.plan_name as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
  }));
}

export function setEntitlement(
  orgId: string, featureKey: string, enabled: boolean, plan: string | null, reason: string
): Promise<DataResult> {
  return callRpc(
    'platform_set_entitlement',
    { p_org: orgId, p_feature: featureKey, p_enabled: enabled, p_plan: plan, p_reason: reason },
    NOT_CONFIGURED
  );
}

/**
 * The plain-words refusal a server returns when a feature is off. The UI shows this verbatim rather
 * than deciding entitlement itself.
 */
export const FEATURE_REFUSAL = 'This feature is not included in your plan.';

/** True when a server error message is the entitlement refusal (F25 enforcement rule 3). */
export function isFeatureRefusal(message: string): boolean {
  return message.includes(FEATURE_REFUSAL) || message.includes('not included in your plan');
}

export { NOT_CONFIGURED_REASON };
