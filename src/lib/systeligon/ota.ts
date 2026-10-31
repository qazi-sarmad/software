/**
 * Systeligon signed rule-pack distribution (S11, spec §4/§8). Rule packs are signed with the org's
 * `signing_keys` (0096), versioned and append-only. An unsigned or unverifiable pack is **refused and
 * the refusal is logged** — whoever can push a pack can change what the engine concludes (§8), so the
 * signature is the control.
 *
 * The signing subject is the pack's content hash, not its bytes: a pack's rules are hashed into a
 * canonical digest, and that digest is the signed root. Reuses `signSubject`/`verifySubject` so a rule
 * pack and a report root agree by construction.
 */
import { canonicalSigningInput, signSubject, verifySubject, type CryptoLike, type SignatureSubject } from '../anchoring';
import { ruleFingerprint } from './versioning';
import { assertValidPack, runRules } from './runner';
import type { RuleRunResult } from './types';
import type { RulePack, RuleStatus, SysteligonRule } from './types';

/**
 * The canonical content hash of a pack: name, version, target and every rule's fingerprint, in a
 * stable order. Two packs with the same rules produce the same digest; a change to any rule changes it.
 */
export async function packContentHash(pack: RulePack): Promise<string> {
  const material = [
    `name=${pack.name}`,
    `version=${pack.version}`,
    `target=${pack.target}`,
    ...pack.rules
      .map((r) => `${r.id}@${r.version}:${r.status}:${ruleFingerprint(r)}`)
      .sort(),
  ].join('\n');
  const bytes = new TextEncoder().encode(material);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A signed pack artifact: the pack, its content hash, and the signature over the pack subject. */
export interface SignedRulePack {
  pack: RulePack;
  contentHash: string;
  signatureHex: string;
  subject: SignatureSubject;
}

/** Sign a pack. `signedAt` is an argument; this module never reads a clock. */
export async function signPack(
  crypto: CryptoLike, pack: RulePack, keyId: string, signedAt: string, privateKey: Uint8Array | JsonWebKey,
): Promise<SignedRulePack> {
  assertValidPack(pack);
  const contentHash = await packContentHash(pack);
  const subject: SignatureSubject = { kind: 'rule_pack', subjectId: `${pack.name}@${pack.version}`, rootHash: contentHash, signedAt, keyId };
  const signatureHex = await signSubject(crypto, subject, privateKey);
  return { pack, contentHash, signatureHex, subject };
}

export type PackRefusal = 'content_changed' | 'signature_invalid' | 'subject_mismatch';

export interface PackVerification {
  ok: boolean;
  /** Present only when `ok` is false. */
  refusal: PackRefusal | null;
  /** Present only when `ok` is false: the reason, ready to log. */
  reason: string | null;
}

/**
 * Verify a signed pack. Refuses (never silently accepts) when the content hash no longer matches, when
 * the subject is not this pack, or when the signature is invalid. A refusal carries the reason so the
 * caller can log it; the engine never carries on with an unverified pack.
 */
export async function verifyPack(
  crypto: CryptoLike, signed: SignedRulePack, publicKey: Uint8Array | JsonWebKey,
): Promise<PackVerification> {
  const expected = await packContentHash(signed.pack);
  if (expected !== signed.contentHash || signed.subject.rootHash !== signed.contentHash) {
    return { ok: false, refusal: 'content_changed', reason: `pack ${signed.pack.name}@${signed.pack.version}: content hash does not match the signed hash` };
  }
  if (signed.subject.subjectId !== `${signed.pack.name}@${signed.pack.version}`) {
    return { ok: false, refusal: 'subject_mismatch', reason: `pack ${signed.pack.name}@${signed.pack.version}: signature covers a different pack` };
  }
  const valid = await verifySubject(crypto, signed.subject, signed.signatureHex, publicKey);
  if (!valid) {
    return { ok: false, refusal: 'signature_invalid', reason: `pack ${signed.pack.name}@${signed.pack.version}: signature is not valid for the stated key` };
  }
  return { ok: true, refusal: null, reason: null };
}

// ---------------------------------------------------------------------------
// S10 — the adhoc rule builder and packs per audit type
// ---------------------------------------------------------------------------

/** What the caller picks: a source, a condition, a threshold. Deterministic; saved as a versioned rule. */
export interface AdhocRuleSpec {
  id: string;
  version: number;
  title: string;
  /** The population attribute the condition reads. */
  source: string;
  condition: 'gt' | 'lt' | 'eq' | 'ne' | 'between' | 'missing';
  threshold: number;
  /** The second bound, for `between`. */
  threshold2?: number;
  severity: SysteligonRule['severity'];
  standards?: string[];
}

/**
 * Build a rule from a spec. The built rule is a normal versioned rule: it runs through the same runner
 * and its findings carry its id and version like any shipped rule. Throws on an incomplete spec.
 */
export function buildAdhocRule(spec: AdhocRuleSpec, status: RuleStatus = 'draft'): SysteligonRule {
  if (!spec.id || !Number.isInteger(spec.version) || spec.version < 1) throw new Error('an adhoc rule needs an id and a version');
  if (!spec.source) throw new Error('an adhoc rule needs a source attribute');
  const params = spec;
  return {
    id: spec.id, version: spec.version, kind: 'pattern', appliesTo: 'population',
    title: spec.title, params: params as unknown as Record<string, unknown>, standards: spec.standards ?? [], status, severity: spec.severity,
    evaluate: (input, ctx) => {
      const out = [];
      for (const row of input.rows) {
        const raw = row.values[spec.source];
        const num = raw == null || raw === '' ? null : Number(raw);
        let hit = false;
        switch (spec.condition) {
          case 'missing': hit = raw == null || raw === '' || (typeof raw === 'string' && raw.trim() === ''); break;
          case 'gt': hit = num != null && Number.isFinite(num) && num > spec.threshold; break;
          case 'lt': hit = num != null && Number.isFinite(num) && num < spec.threshold; break;
          case 'eq': hit = num != null && num === spec.threshold; break;
          case 'ne': hit = num != null && num !== spec.threshold; break;
          case 'between': hit = num != null && spec.threshold2 != null && num >= spec.threshold && num <= spec.threshold2; break;
        }
        if (hit) out.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'pattern' as const, severity: ctx.severity,
          reason: `${spec.source} ${spec.condition} ${spec.threshold}${spec.threshold2 != null ? `–${spec.threshold2}` : ''}`, refs: [row.ref],
        });
      }
      return out;
    },
  };
}

/** Run an adhoc rule over a population. Thin wrapper so a caller does not hand-roll the runner call. */
export function runAdhocRule(spec: AdhocRuleSpec, rows: { ref: string; values: Record<string, unknown> }[], evaluatedAt: string): RuleRunResult {
  return runRules([buildAdhocRule(spec)], { rows }, { evaluatedAt, includeDrafts: true });
}

/** The canonical signing input for a pack subject, exposed for tests and audit display. */
export function packSigningInput(signed: SignedRulePack): string {
  return canonicalSigningInput(signed.subject);
}
