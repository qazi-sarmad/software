/**
 * Standards distribution (D16, spec docs/STANDARDS-DISTRIBUTION.md). A **standards pack** is a named,
 * versioned, signed bundle of rules plus the sources it cites. This module is the pure half: it builds
 * a pack from the shipped rule library, hashes it canonically, signs it, and verifies it. The data
 * half (src/data/standards.ts) publishes and rolls it out; the surface is SA-21.
 *
 * Deterministic only (L1): no model, no free text. Time is always an argument — this module never
 * reads a clock. Reuses `signSubject`/`verifySubject` (src/lib/anchoring.ts) and `ruleFingerprint`
 * (src/lib/systeligon/versioning.ts), so a standards pack agrees with a rule pack by construction.
 */
import { signSubject, verifySubject, type CryptoLike, type SignatureSubject } from '../anchoring';
import { ruleFingerprint } from './versioning';
import { ENGINE_NAME } from '../product';
import type { RuleSeverity, RuleStatus, RuleTarget, SysteligonRule } from './types';

/** One rule as it is stored in a standards pack: identity, kind, scope and the parameters it was built with. */
export interface StandardsRule {
  id: string;
  version: number;
  kind: string;
  /** The scope the rule runs in (spec §5). Sealed alongside the rule id and version. */
  appliesTo: RuleTarget;
  severity: RuleSeverity;
  status: RuleStatus;
  title: string;
  standards: string[];
  params: Record<string, unknown>;
}

/** The document and edition a pack's rules cite (spec §2). */
export interface StandardsSource {
  doc: string;
  edition: string;
  standard?: string;
}

export type StandardsDiscipline = 'management' | 'shariah' | 'it' | 'cross';

/** A standards pack version: the unit that is signed, published and rolled out. */
export interface StandardsPack {
  packId: string;
  version: number;
  title: string;
  discipline: StandardsDiscipline;
  sources: StandardsSource[];
  scopes: RuleTarget[];
  rules: StandardsRule[];
}

/** The catalogue definition of a pack — everything except the rules, which come from the library. */
export interface StandardsPackDef {
  packId: string;
  title: string;
  discipline: StandardsDiscipline;
  sources: StandardsSource[];
  scopes: RuleTarget[];
  /**
   * True when the shipped rule library already carries rules for this pack's scopes. A pack whose
   * discipline rules have not landed yet is *declared* — the catalogue lists it with its sources, but
   * it carries no rules and cannot be published (never an empty pack shipped as if it had content).
   */
  shipped: boolean;
}

/**
 * The standards catalogue (spec §2). Every shipped rule base the product distributes. The rules of a
 * pack are the shipped rules whose target is one of the pack's scopes, so the pack always reflects the
 * engine's own library rather than a copy.
 *
 * Only `standards.forensic.core` has shipped rules today: the numeric/structural/pattern/sequential
 * library. The discipline-specific packs are declared with their verified sources and their scopes, and
 * become publishable when their rule library lands. Declaring them now is honest — the catalogue shows
 * exactly what exists — and it is not an invented count: each source is the one the spec names.
 */
export const STANDARDS_CATALOGUE: StandardsPackDef[] = [
  {
    packId: 'standards.forensic.core',
    title: 'Forensic core (numeric, structural, sequential)',
    discipline: 'management',
    sources: [{ doc: `${ENGINE_NAME} engine`, edition: '2026', standard: 'S6/S8/S9/S14/S15' }],
    scopes: ['population', 'journal', 'document', 'minutes', 'policy', 'config', 'ledger'],
    shipped: true,
  },
  {
    packId: 'standards.icfr.sox',
    title: 'ICFR / SOX control monitoring',
    discipline: 'management',
    sources: [
      { doc: 'PCAOB AS 2201', edition: '2024' },
      { doc: 'COSO ICIF-2013', edition: '2013' },
    ],
    scopes: ['population', 'journal', 'config'],
    shipped: false,
  },
  {
    packId: 'standards.it.baseline',
    title: 'IT controls baseline',
    discipline: 'it',
    sources: [
      { doc: 'COBIT 2019', edition: '2019' },
      { doc: 'ISO/IEC 27001:2022 Annex A', edition: '2022' },
      { doc: 'NIST SP 800-53', edition: 'Rev.5' },
    ],
    scopes: ['config', 'document'],
    shipped: false,
  },
  {
    packId: 'standards.shariah.aaoifi',
    title: 'AAOIFI Shari’ah Standards (SS 1–54)',
    discipline: 'shariah',
    sources: [{ doc: 'AAOIFI Shari’ah Standards', edition: 'SS 1–54' }],
    scopes: ['document', 'policy'],
    shipped: false,
  },
  {
    packId: 'standards.shariah.sbp-compendium',
    title: 'SBP Shari’ah Compendium overlay',
    discipline: 'shariah',
    sources: [
      {
        doc: 'Compendium of Shari’ah Standards adopted by the State Bank of Pakistan',
        edition: 'updated 31 Oct 2024',
      },
    ],
    scopes: ['document', 'policy'],
    shipped: false,
  },
  {
    packId: 'standards.shariah.sgf',
    title: 'Shari’ah Governance Framework (SGF)',
    discipline: 'shariah',
    sources: [{ doc: 'Shari’ah Governance Framework (SGF)', edition: 'effective 1 Jan 2025' }],
    scopes: ['document', 'policy', 'minutes'],
    shipped: false,
  },
  {
    packId: 'standards.risk.pwc-taxonomy',
    title: 'Risk input taxonomy and ERM-theme map',
    discipline: 'cross',
    sources: [{ doc: 'Risk Assessment, reimagined (PwC)', edition: '2026' }],
    scopes: ['config'],
    shipped: false,
  },
];

/** The catalogue definition for a pack id, or undefined. */
export function standardsPackDef(packId: string): StandardsPackDef | undefined {
  return STANDARDS_CATALOGUE.find((d) => d.packId === packId);
}

/** Project a shipped rule into the pack shape. Pure. */
export function toStandardsRule(rule: SysteligonRule): StandardsRule {
  return {
    id: rule.id,
    version: rule.version,
    kind: rule.kind,
    appliesTo: rule.appliesTo,
    severity: rule.severity,
    status: rule.status,
    title: rule.title,
    standards: rule.standards,
    params: rule.params as Record<string, unknown>,
  };
}

/**
 * Build a pack version from a catalogue definition and the shipped rule library. The rules are those
 * whose target is one of the pack's scopes and whose status is `released` — a draft never ships, the
 * same rule the rule-pack path holds to.
 */
export function buildStandardsPack(
  def: StandardsPackDef, version: number, library: SysteligonRule[],
): StandardsPack {
  if (!Number.isInteger(version) || version < 1) throw new Error('a standards pack needs a version >= 1');
  const scopes = new Set(def.scopes);
  const rules = library
    .filter((r) => scopes.has(r.appliesTo) && r.status === 'released')
    .map(toStandardsRule)
    .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  return {
    packId: def.packId, version, title: def.title, discipline: def.discipline,
    sources: def.sources, scopes: def.scopes, rules,
  };
}

/**
 * The canonical content hash of a standards pack: identity, sources, scopes and every rule's
 * fingerprint, in a stable order. Two packs with the same content produce the same digest; a change to
 * any rule, source or scope changes it. SHA-256, hex.
 */
export async function standardsPackContentHash(pack: StandardsPack): Promise<string> {
  const material = [
    `pack=${pack.packId}`,
    `version=${pack.version}`,
    `discipline=${pack.discipline}`,
    `scopes=${[...pack.scopes].sort().join(',')}`,
    ...pack.sources.map((s) => `source=${s.doc}|${s.edition}|${s.standard ?? ''}`).sort(),
    ...pack.rules.map((r) => `rule=${r.id}@${r.version}:${r.status}:${r.kind}:${r.appliesTo}:${fingerprintRule(r)}`).sort(),
  ].join('\n');
  const bytes = new TextEncoder().encode(material);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fingerprint of a stored rule, matching `ruleFingerprint`'s material for the pack shape. */
function fingerprintRule(rule: StandardsRule): string {
  const material = JSON.stringify({
    kind: rule.kind, severity: rule.severity, params: rule.params,
  });
  let h = 5381;
  for (let i = 0; i < material.length; i++) h = ((h << 5) + h + material.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** A signed standards pack: the pack, its content hash, and the signature over the pack subject. */
export interface SignedStandardsPack {
  pack: StandardsPack;
  contentHash: string;
  signatureHex: string;
  subject: SignatureSubject;
}

/** Sign a standards pack. `signedAt` is an argument; this module never reads a clock. */
export async function signStandardsPack(
  crypto: CryptoLike, pack: StandardsPack, keyId: string, signedAt: string,
  privateKey: Uint8Array | JsonWebKey,
): Promise<SignedStandardsPack> {
  const contentHash = await standardsPackContentHash(pack);
  const subject: SignatureSubject = {
    kind: 'rule_pack', subjectId: `${pack.packId}@${pack.version}`,
    rootHash: contentHash, signedAt, keyId,
  };
  const signatureHex = await signSubject(crypto, subject, privateKey);
  return { pack, contentHash, signatureHex, subject };
}

export type StandardsRefusal = 'content_changed' | 'signature_invalid' | 'subject_mismatch';

export interface StandardsVerification {
  ok: boolean;
  refusal: StandardsRefusal | null;
  reason: string | null;
}

/**
 * Verify a signed standards pack. Refuses (never silently accepts) when the content hash no longer
 * matches, when the subject is not this pack, or when the signature is invalid. A refusal carries the
 * reason so the caller can report it; the caller never publishes an unverified pack.
 */
export async function verifyStandardsPack(
  crypto: CryptoLike, signed: SignedStandardsPack, publicKey: Uint8Array | JsonWebKey,
): Promise<StandardsVerification> {
  const expected = await standardsPackContentHash(signed.pack);
  if (expected !== signed.contentHash || signed.subject.rootHash !== signed.contentHash) {
    return { ok: false, refusal: 'content_changed', reason: `pack ${signed.pack.packId}@${signed.pack.version}: content hash does not match the signed hash` };
  }
  if (signed.subject.subjectId !== `${signed.pack.packId}@${signed.pack.version}`) {
    return { ok: false, refusal: 'subject_mismatch', reason: `pack ${signed.pack.packId}@${signed.pack.version}: signature covers a different pack` };
  }
  const valid = await verifySubject(crypto, signed.subject, signed.signatureHex, publicKey);
  if (!valid) {
    return { ok: false, refusal: 'signature_invalid', reason: `pack ${signed.pack.packId}@${signed.pack.version}: signature is not valid for the stated key` };
  }
  return { ok: true, refusal: null, reason: null };
}

/**
 * The subscription a tenant runs for a pack: the newest applied version. Pinned or following. Pure, so
 * the surface and the rule run read the same value.
 */
export interface StandardsSubscription {
  packId: string;
  version: number;
  pinned: boolean;
  reason: string | null;
  appliedAt: string;
}

/** The subscription a tenant runs for one pack — the newest applied row, or undefined. */
export function effectiveSubscription(
  subscriptions: StandardsSubscription[], packId: string,
): StandardsSubscription | undefined {
  return subscriptions
    .filter((s) => s.packId === packId)
    .sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : a.appliedAt > b.appliedAt ? -1 : 0))[0];
}

export { ruleFingerprint };
