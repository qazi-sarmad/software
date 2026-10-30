/**
 * Standards-distribution data module (D16, spec docs/STANDARDS-DISTRIBUTION.md). The client half of
 * `standards_pack_publish`, `standards_rollout`, `standards_pin`, `standards_catalogue_list`,
 * `standards_subscriptions_get` and `platform_signing_key_register` (0191). Components never import
 * the Supabase client (rule M8).
 *
 * A standards pack is signed before it is sent: `signStandardsPack` produces the content hash and the
 * signature, this module passes them through, and the server re-checks the shapes and the key. A
 * refusal comes back as `{ok:false, reason}` and the caller stops — never a partial write.
 */
import { callRpcJson, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import {
  signStandardsPack, verifyStandardsPack, buildStandardsPack, standardsPackDef,
  type SignedStandardsPack, type StandardsVerification, type StandardsSubscription,
  type StandardsPack, type StandardsDiscipline,
} from '../lib/systeligon/standards';
import { generateSigningKey, fromHex, type GeneratedSigningKey, type CryptoLike } from '../lib/anchoring';
import { systeligonPopulationRules } from '../lib/systeligon/library';
import { structuralRules } from '../lib/systeligon/rules/structural';
import { documentRules } from '../lib/systeligon/rules/documents';
import { patternRules } from '../lib/systeligon/rules/patterns';
import { sequentialRules } from '../lib/systeligon/rules/sequential';
import type { SysteligonRule } from '../lib/systeligon/types';

/** Every shipped, executable rule. A standards pack is built from these, so it reflects the engine. */
export const SHIPPED_RULES: SysteligonRule[] = [
  ...systeligonPopulationRules,
  ...structuralRules,
  ...documentRules,
  ...patternRules,
  ...sequentialRules,
];

/** One row of the platform standards catalogue, as the reader returns it. */
export interface CatalogueRow {
  packId: string;
  version: number;
  title: string;
  discipline: StandardsDiscipline;
  sources: { doc: string; edition: string; standard?: string }[];
  scopes: string[];
  contentHash: string;
  keyId: string;
  releasedAt: string;
}

/** The platform standards catalogue. Empty when the module is not configured. */
export async function listStandardsCatalogue(): Promise<CatalogueRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('standards_catalogue_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    packId: String(r.pack_id), version: Number(r.version), title: String(r.title),
    discipline: String(r.discipline) as StandardsDiscipline,
    sources: (r.sources ?? []) as CatalogueRow['sources'],
    scopes: (r.scopes ?? []) as string[], contentHash: String(r.content_hash),
    keyId: String(r.key_id), releasedAt: String(r.released_at),
  }));
}

/** The tenant's own subscriptions — the versions it runs, and whether each is pinned. */
export async function listStandardsSubscriptions(): Promise<StandardsSubscription[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('standards_subscriptions_get');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    packId: String(r.pack_id), version: Number(r.version), pinned: Boolean(r.pinned),
    reason: r.reason == null ? null : String(r.reason), appliedAt: String(r.applied_at),
  }));
}

/** The platform registers its public signing key (scope = platform). Only the public half is sent. */
export async function registerPlatformSigningKey(keyId: string, publicKeyHex: string): Promise<DataResult> {
  const res = await callRpcJson('platform_signing_key_register', { p_key_id: keyId, p_public_key: publicKeyHex });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/**
 * Publish a standards pack version. The caller signs (`signStandardsPack`), verifies locally
 * (`verifyStandardsPack`) and only then sends — never send what you cannot verify. Returns the signed
 * artifact's hash on success so the surface can name it.
 */
export async function publishStandardsPack(signed: SignedStandardsPack, keyId: string): Promise<DataResult> {
  const p = signed.pack;
  const res = await callRpcJson('standards_pack_publish', {
    p_pack_id: p.packId, p_version: p.version, p_title: p.title, p_discipline: p.discipline,
    p_sources: p.sources, p_scopes: p.scopes, p_rules: p.rules,
    p_content_hash: signed.contentHash, p_key_id: keyId, p_signature: signed.signatureHex,
    p_released_at: signed.subject.signedAt,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/** The per-tenant outcome of a rollout, as the RPC returns it. */
export interface RolloutOutcome {
  orgId: string;
  outcome: 'applied' | 'skipped-not-entitled' | 'skipped-pinned';
}

export interface RolloutResult {
  applied: number;
  results: RolloutOutcome[];
}

/** Roll a pack version out to a set of tenants. Returns the per-tenant outcome. */
export async function rolloutStandardsPack(
  packId: string, version: number, orgIds: string[],
): Promise<{ ok: true; data: RolloutResult } | { ok: false; reason: string }> {
  const res = await callRpcJson('standards_rollout', { p_pack_id: packId, p_version: version, p_org_ids: orgIds });
  if (!res.ok) return { ok: false, reason: res.reason };
  const data = res.data as { applied?: number; results?: { org_id: string; outcome: string }[] };
  return {
    ok: true,
    data: {
      applied: Number(data.applied ?? 0),
      results: (data.results ?? []).map((r) => ({
        orgId: r.org_id, outcome: r.outcome as RolloutOutcome['outcome'],
      })),
    },
  };
}

/** Pin the version a tenant runs, with a reason. A pinned tenant is not moved forward by a rollout. */
export async function pinStandardsVersion(packId: string, version: number, reason: string): Promise<DataResult> {
  const res = await callRpcJson('standards_pin', { p_pack_id: packId, p_version: version, p_reason: reason });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/**
 * Build, sign and locally verify a standards pack version from the shipped library, ready to publish.
 * Pure beyond the crypto: it reads no clock (the caller passes `signedAt`) and no network.
 */
export async function buildSignedStandardsPack(
  crypto: CryptoLike, packId: string, version: number, keyId: string, signedAt: string,
  privateKey: JsonWebKey,
): Promise<{ ok: true; signed: SignedStandardsPack; verification: StandardsVerification }
  | { ok: false; reason: string }> {
  const def = standardsPackDef(packId);
  if (!def) return { ok: false, reason: `unknown standards pack: ${packId}` };
  if (!def.shipped) {
    return { ok: false, reason: `${packId} has no released rules yet; it is declared in the catalogue but cannot be published` };
  }
  const pack: StandardsPack = buildStandardsPack(def, version, SHIPPED_RULES);
  if (pack.rules.length === 0) return { ok: false, reason: 'this pack covers no released rules' };
  const signed = await signStandardsPack(crypto, pack, keyId, signedAt, privateKey);
  return { ok: true, signed, verification: await verifyStandardsPack(crypto, signed, privateKey) };
}

export {
  signStandardsPack, verifyStandardsPack, buildStandardsPack, standardsPackDef, generateSigningKey, fromHex,
  NOT_CONFIGURED_REASON,
  type SignedStandardsPack, type StandardsVerification, type StandardsPack, type GeneratedSigningKey,
};
