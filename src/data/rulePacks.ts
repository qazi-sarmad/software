/**
 * Systeligon rule-pack data module (S10/S11, spec §4/§8). The client half of `rule_pack_save` and
 * `rule_pack_list` from 0117. Components never import the Supabase client.
 *
 * A pack is signed before it is sent: `signPack` (src/lib/systeligon/ota.ts) produces the content
 * hash and the signature, and this module passes them through. The server re-checks the right, the
 * key and the hash shape; an unverifiable pack is refused and the refusal logged server-side.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import { packContentHash, signPack, type SignedRulePack, type PackVerification } from '../lib/systeligon/ota';
import type { RulePack } from '../lib/systeligon/types';

export interface RulePackSummary {
  id: string;
  name: string;
  version: number;
  target: string;
  contentHash: string;
  released: boolean;
  signedAt: string;
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

/**
 * Sign and save a pack. `crypto` and the signing material are supplied by the caller (the same
 * WebCrypto surface the anchoring path uses), so this module never reads a key or a clock.
 */
export async function saveSignedRulePack(
  crypto: CryptoLike, pack: RulePack, keyId: string, signedAt: string, privateKey: Uint8Array | JsonWebKey,
): Promise<DataResult> {
  if (!getClient()) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const signed: SignedRulePack = await signPack(crypto, pack, keyId, signedAt, privateKey);
  return callRpc('rule_pack_save', {
    p_name: pack.name, p_version: pack.version, p_target: pack.target, p_rules: pack.rules,
    p_content_hash: signed.contentHash, p_key_id: keyId, p_signature: signed.signatureHex,
    p_signed_at: signedAt, p_released: false,
  });
}

export type CryptoLike = Parameters<typeof signPack>[0];
export { packContentHash, signPack, type PackVerification, type SignedRulePack };
