/**
 * Systeligon rule-pack data module (S10/S11, spec §4/§8). The client half of `rule_pack_save`,
 * `rule_pack_list`, `rule_pack_release`, `rule_pack_refusals_list` and `signing_key_register`.
 * Components never import the Supabase client.
 *
 * A pack is signed before it is sent: `signPack` (src/lib/systeligon/ota.ts) produces the content
 * hash and the signature, and this module passes them through. The server re-checks the right, the
 * key and the hash shape; an unverifiable pack is refused and the refusal logged server-side and
 * readable through `listRulePackRefusals`.
 */
import { callRpcJson, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import {
  packContentHash, signPack, verifyPack, buildAdhocRule, runAdhocRule,
  type SignedRulePack, type PackVerification, type AdhocRuleSpec,
} from '../lib/systeligon/ota';
import { generateSigningKey, type GeneratedSigningKey } from '../lib/anchoring';
import type { ReleasedPack } from '../lib/systeligon';

export interface RulePackSummary {
  id: string;
  name: string;
  version: number;
  target: string;
  contentHash: string;
  released: boolean;
  signedAt: string;
}

export interface RulePackRefusalRow {
  id: string;
  name: string;
  version: number;
  reason: string;
  detail: string | null;
  createdAt: string;
}

/** The packs this org can run: the newest version of each name. RLS restricts it to the org. */
export async function listRulePacks(): Promise<RulePackSummary[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('rule_pack_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), name: String(r.name), version: Number(r.version), target: String(r.target),
    contentHash: String(r.content_hash), released: Boolean(r.released), signedAt: String(r.signed_at),
  }));
}

/** The refusals this org has recorded — a pack offered and rejected, with the reason (§8). */
export async function listRulePackRefusals(): Promise<RulePackRefusalRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('rule_pack_refusals_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), name: String(r.name), version: Number(r.version), reason: String(r.reason),
    detail: r.detail == null ? null : String(r.detail), createdAt: String(r.created_at),
  }));
}

/**
 * The newest released pack, or null when none is released. The rule-run screen runs this so a
 * released pack genuinely drives the engine rather than the in-code default.
 */
export async function getReleasedRulePack(): Promise<ReleasedPack | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('rule_pack_released_rules');
  if (error) throw new Error(error.message);
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    name: String(d.name), version: Number(d.version), target: String(d.target),
    contentHash: String(d.content_hash), rules: (d.rules ?? []) as ReleasedPack['rules'],
  };
}

/**
 * Persist an already-signed pack. The caller signs (`signPack`), verifies locally (`verifyPack`) and
 * only then sends — the same never-send-what-you-cannot-verify rule the rest of the platform holds to.
 */
export async function saveSignedRulePackArtifact(signed: SignedRulePack, keyId: string): Promise<DataResult> {
  const res = await callRpcJson('rule_pack_save', {
    p_name: signed.pack.name, p_version: signed.pack.version, p_target: signed.pack.target,
    p_rules: signed.pack.rules, p_content_hash: signed.contentHash, p_key_id: keyId,
    p_signature: signed.signatureHex, p_signed_at: signed.subject.signedAt, p_released: false,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/** Release a draft pack so the engine may run it. Idempotent; needs edit_config. */
export async function releaseRulePack(id: string): Promise<DataResult> {
  const res = await callRpcJson('rule_pack_release', { p_id: id });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/**
 * Register a public signing key. The keypair is generated in the browser by `generateSigningKey`
 * (src/lib/anchoring.ts); only the public half is sent. The current live key is retired server-side.
 */
export async function registerSigningKey(keyId: string, publicKeyHex: string): Promise<DataResult> {
  const res = await callRpcJson('signing_key_register', { p_key_id: keyId, p_public_key: publicKeyHex });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

export type CryptoLike = Parameters<typeof signPack>[0];
export {
  packContentHash, signPack, verifyPack, buildAdhocRule, runAdhocRule,
  generateSigningKey,
  type PackVerification, type SignedRulePack, type GeneratedSigningKey, type AdhocRuleSpec,
};
