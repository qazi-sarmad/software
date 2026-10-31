/**
 * T3/T4 — the portable attestation package.
 *
 * A self-contained artifact a tenant can hand to an outsider (a regulator, a board, a counterparty,
 * an acquirer) so the outsider can re-derive the root and confirm nothing changed WITHOUT trusting
 * the producer. It carries: the roots, the Ed25519 signatures over them, the timestamp tokens, the
 * public keys, the rule/engine/template/phrase-library versions that scored the artifact, the Merkle
 * leaves (so the graph root can be re-folded), and the verification instructions.
 *
 * Laws that shape this file:
 *   - L1: pure. No AI, no model calls. The only randomness is inside an injected WebCrypto keypair,
 *     which this module never generates. Time is an argument (`generatedAt`), never read here.
 *   - L2: only SHA-256 hashes, signatures, timestamps, public keys and version ids leave. The package
 *     carries Merkle LEAF HASHES, never the claim text behind them, so a leaf cannot be reversed to
 *     tenant content. A third party re-derives the ROOT from the hashes; the claim-level inclusion
 *     proof is a separate artifact (`src/lib/writing/merkle.ts`, `verifyInclusion`).
 *   - Platform crypto only (WebCrypto), the same primitive `src/lib/anchoring.ts` and
 *     `src/lib/writing/canonical.ts` use, injected so the module is testable and so the standalone
 *     verifier can substitute Node's `node:crypto`.
 *
 * The package is deliberately described in plain JSON with sorted keys, so a third party can
 * reproduce the canonical bytes with any JSON library and re-derive the root with any SHA-256 —
 * that is what makes it attestation rather than assertion. See `docs/ATTESTATION-VERIFICATION.md`.
 */
import {
  canonicalSigningInput,
  fromHex,
  toHex,
  verifySubject,
  type CryptoLike,
  type SignatureKind,
  type SignatureSubject,
} from './anchoring';

/** The format tag. A verifier refuses a package it does not know how to read. */
export const ATTESTATION_FORMAT = 'provio.attestation/v1' as const;

/** The package format version, bumped only when the canonical form changes. */
export const ATTESTATION_PACKAGE_VERSION = 1;

/** One Merkle leaf, as a hash only. `leafHash = sha256('00' || canonicalClaimText)`. */
export interface AttestationLeaf {
  /** The claim id the leaf belongs to, so a leaf can be located without revealing its text. */
  claimId: string;
  /** The domain-separated leaf hash: sha256('00' + canonical). 64 lowercase hex. */
  leafHash: string;
}

/** A signature over one subject. */
export interface AttestationSignature {
  kind: SignatureKind;
  subjectId: string;
  rootHash: string;
  keyId: string;
  algorithm: 'Ed25519';
  /** The signature, hex. 128 lowercase hex characters. */
  signature: string;
  signedAt: string;
}

/** A public key a verifier needs. Public material only; never a private key. */
export interface AttestationKey {
  keyId: string;
  algorithm: 'Ed25519';
  /** The raw public key, hex. */
  publicKey: string;
}

/** A timestamp token over a root. The token carries no tenant data. */
export interface AttestationTimestamp {
  authority: string;
  genTime: string;
  /** The TimeStampToken, DER, base64. */
  tokenDer: string;
}

/** The engine, template, phrase-library and rule-pack versions that scored the artifact. */
export interface AttestationVersions {
  engine: string;
  template: string;
  phraseLibrary: string;
  /** The rule packs, by id and version. The thing that makes a re-run identical. */
  rulePacks: { id: string; version: number }[];
}

/** The subject the package attests. `label` is a human name for the artifact, never tenant content. */
export interface AttestationSubject {
  kind: SignatureKind;
  id: string;
  label: string;
}

/** The whole package. */
export interface AttestationPackage {
  format: typeof ATTESTATION_FORMAT;
  version: number;
  /** Supplied by the caller. Never read from the clock in this module. */
  generatedAt: string;
  subject: AttestationSubject;
  /** The root(s) the package attests, by name. The first is the primary root. */
  roots: { name: string; hash: string }[];
  versions: AttestationVersions;
  leaves: AttestationLeaf[];
  keys: AttestationKey[];
  signatures: AttestationSignature[];
  timestamps: AttestationTimestamp[];
  /** The ledger sequence the root was anchored at, or null when it was not. */
  ledgerSeq: string | null;
  /**
   * The package root: sha256 of the canonical package with `packageRoot` excluded. It is the single
   * value a verifier re-derives; a change to any field changes it.
   */
  packageRoot: string;
  /** The documented procedure, as data, so the artifact is self-describing. */
  instructions: string[];
}

/** The inputs a caller supplies. Everything the package needs is already fetched and filtered. */
export interface AttestationInput {
  generatedAt: string;
  subject: AttestationSubject;
  roots: { name: string; hash: string }[];
  versions: AttestationVersions;
  leaves: AttestationLeaf[];
  keys: AttestationKey[];
  signatures: AttestationSignature[];
  timestamps: AttestationTimestamp[];
  ledgerSeq?: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export class AttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttestationError';
  }
}

/**
 * The verification instructions, as data. The package carries these so it is self-describing and a
 * third party needs nothing from us but the artifact and a SHA-256. `docs/ATTESTATION-VERIFICATION.md`
 * documents the same procedure in prose and `scripts/verify-attestation.mjs` implements it with
 * nothing but Node's own `node:crypto`.
 */
export const ATTESTATION_INSTRUCTIONS: string[] = [
  'This package is a self-contained attestation. Nothing in it is secret and none of it is tenant content: it holds only hashes, signatures, public keys, timestamp tokens and version identifiers.',
  'Step 1 — Re-derive the package root. Take the package as JSON, remove the "packageRoot" field, serialise every object with its keys sorted by Unicode code point and no insignificant whitespace, and take the SHA-256 of the UTF-8 bytes. The result must equal the "packageRoot" field. Any change to any other field changes it.',
  'Step 2 — Re-derive the Merkle root. For each leaf in order, the leaf hash is already given. Fold the leaf hashes pairwise: an internal node is sha256("01" + left + right); when a level has an odd count, promote the last node unchanged. The single remaining hash must equal the "graph_root" entry in "roots".',
  'Step 3 — Verify each signature. For each entry in "signatures", rebuild the canonical signing input as the JSON object {"key_id","kind","root_hash","signed_at","subject_id"} with keys in that order, serialise with no whitespace, and verify the Ed25519 signature (hex in "signature") against the raw public key whose "keyId" matches. Every signature must verify.',
  'Step 4 — Verify each timestamp. Each token in "timestamps" is an RFC 3161 TimeStampToken (DER, base64). Its message imprint must equal the root hash it covers, and its genTime must fall inside the signing certificate validity window and the certificate chain must validate against a trust anchor you hold. The hash it covers is the only tenant-derived value, and it is a hash.',
  'Step 5 — Compare the roots to what you were told to expect. The "graph_root" must equal the root you were given by the issuing organisation through a channel you trust.',
  'A package that passes steps 1-5 is internally consistent and its roots are signed and stamped. That is what this proves. It does NOT prove the claims behind the leaves were true — the engine proves structure and arithmetic, a human decides what the shape means. It is tamper-EVIDENCE, not tamper-prevention.',
];

/** The canonical serialisation of a value: object keys sorted by code point, no whitespace. */
function canonicalValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalValue(v)}`).join(',')}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return 'null';
}

/** The canonical text of the package with `packageRoot` removed. What a verifier re-derives. */
export function attestationCanonical(pkg: Omit<AttestationPackage, 'packageRoot'>): string {
  const { packageRoot: _omit, ...rest } = pkg as AttestationPackage;
  void _omit;
  return canonicalValue(rest);
}

async function sha256Hex(crypto: CryptoLike, text: string): Promise<string> {
  const digest = crypto.subtle.digest;
  if (!digest) throw new AttestationError('a secure hash is not available');
  const out = await digest.call(crypto.subtle, 'SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(out));
}

/** The package root: SHA-256 of the canonical package. Deterministic for the same contents. */
export function packageRoot(crypto: CryptoLike, pkg: AttestationPackage): Promise<string> {
  return sha256Hex(crypto, attestationCanonical(pkg));
}

/** Validate the shape of a package enough to build or verify it, or throw with a plain reason. */
function assertPackageShape(pkg: AttestationPackage): void {
  if (pkg.format !== ATTESTATION_FORMAT) {
    throw new AttestationError(`unknown package format: ${String(pkg.format)}`);
  }
  if (!pkg.subject?.id) throw new AttestationError('the subject id is required');
  if (!pkg.generatedAt) throw new AttestationError('the generated at time is required');
  if (!Array.isArray(pkg.roots) || pkg.roots.length === 0) {
    throw new AttestationError('at least one root is required');
  }
  for (const r of pkg.roots) {
    if (!HEX64.test(r.hash)) throw new AttestationError(`the ${r.name} root must be 64 lowercase hex characters`);
  }
  for (const l of pkg.leaves) {
    if (!HEX64.test(l.leafHash)) throw new AttestationError(`leaf ${l.claimId} is not a 64-character hex hash`);
  }
  for (const s of pkg.signatures) {
    if (!HEX128.test(s.signature)) throw new AttestationError(`signature for ${s.subjectId} must be 128 lowercase hex characters`);
    if (!HEX64.test(s.rootHash)) throw new AttestationError(`signature for ${s.subjectId} covers a malformed root`);
  }
}

/**
 * Build a package. PURE: every fact is passed in, `generatedAt` is an argument, nothing is fetched
 * and no clock is read. The package root is computed over the finished contents.
 */
export async function buildAttestationPackage(
  crypto: CryptoLike, input: AttestationInput
): Promise<AttestationPackage> {
  const draft: Omit<AttestationPackage, 'packageRoot'> = {
    format: ATTESTATION_FORMAT,
    version: ATTESTATION_PACKAGE_VERSION,
    generatedAt: input.generatedAt,
    subject: input.subject,
    roots: input.roots,
    versions: input.versions,
    leaves: input.leaves,
    keys: input.keys,
    signatures: input.signatures,
    timestamps: input.timestamps,
    ledgerSeq: input.ledgerSeq ?? null,
    instructions: ATTESTATION_INSTRUCTIONS,
  };
  const withRoot = { ...draft, packageRoot: '' } as AttestationPackage;
  assertPackageShape(withRoot);
  const root = await sha256Hex(crypto, canonicalValue(draft));
  return { ...draft, packageRoot: root };
}

// ---------------------------------------------------------------------------
// Merkle fold — the exact mirror of public.report_graph_root_of (0103) and buildMerkleTree.
// ---------------------------------------------------------------------------

/**
 * Fold a list of already-hashed leaves into a Merkle root, using the same rules the database and the
 * writing engine use: an internal node is sha256('01' + left + right), and an odd node at a level is
 * PROMOTED unchanged rather than duplicated (so two different leaf sets cannot share a root). Empty
 * input gives the zero hash. Deterministic.
 */
export async function merkleRootOfLeafHashes(
  crypto: CryptoLike, leafHashes: string[]
): Promise<string> {
  if (leafHashes.length === 0) return '0'.repeat(64);
  let level = [...leafHashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(await sha256Hex(crypto, `01${level[i]}${level[i + 1]}`));
      else next.push(level[i]);
    }
    level = next;
  }
  return level[0];
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface SignatureVerdict {
  subjectId: string;
  keyId: string;
  /** 'valid' when the signature verifies, 'invalid' when it does not, 'unknown_key' when the key is absent. */
  status: 'valid' | 'invalid' | 'unknown_key';
}

export interface TimestampVerdict {
  authority: string;
  /** 'present' when a token is carried; the imprint/chain check is a trust-anchor decision the caller makes. */
  status: 'present' | 'missing_token';
}

export interface AttestationVerdict {
  /** True only when every check passed. */
  ok: boolean;
  /** The package root re-derived from the contents. */
  derivedRoot: string;
  /** True when the re-derived root equals the field the package carries. */
  rootMatches: boolean;
  /** True when the leaf list folds to the primary recorded root. */
  merkleMatches: boolean;
  /** The root the leaves fold to. */
  derivedMerkleRoot: string;
  /** The primary root the package records. */
  recordedMerkleRoot: string;
  signatures: SignatureVerdict[];
  timestamps: TimestampVerdict[];
  /** Every reason a check failed, in plain words. Empty when `ok`. */
  problems: string[];
}

/**
 * Verify a package against itself and its embedded public keys. PURE (crypto is injected, time is an
 * argument for the timestamp window check — which is deliberately NOT applied here, because the trust
 * anchors are the verifier's to hold, not ours; see `docs/ATTESTATION-VERIFICATION.md`).
 *
 * This is what the in-product "verify" surface and the standalone verifier both implement. It never
 * throws on a bad package: it returns a verdict with the reasons.
 */
export async function verifyAttestationPackage(
  crypto: CryptoLike, pkg: AttestationPackage
): Promise<AttestationVerdict> {
  const problems: string[] = [];

  let derivedRoot = '';
  let rootMatches = false;
  try {
    derivedRoot = await packageRoot(crypto, pkg);
    rootMatches = derivedRoot === pkg.packageRoot;
    if (!rootMatches) {
      problems.push('the package root does not match: a field was changed after the package was sealed');
    }
  } catch (err) {
    problems.push(err instanceof Error ? err.message : 'the package root could not be derived');
  }

  const primary = pkg.roots[0]?.hash ?? '';
  let derivedMerkleRoot = '';
  let merkleMatches = false;
  try {
    derivedMerkleRoot = await merkleRootOfLeafHashes(crypto, pkg.leaves.map((l) => l.leafHash));
    merkleMatches = pkg.leaves.length > 0 && derivedMerkleRoot === primary;
    if (pkg.leaves.length > 0 && !merkleMatches) {
      problems.push('the leaves do not fold to the recorded root: the claim set was changed');
    }
  } catch (err) {
    problems.push(err instanceof Error ? err.message : 'the Merkle root could not be derived');
  }

  const keyById = new Map(pkg.keys.map((k) => [k.keyId, k]));
  const signatures: SignatureVerdict[] = [];
  for (const s of pkg.signatures) {
    const key = keyById.get(s.keyId);
    if (!key) {
      signatures.push({ subjectId: s.subjectId, keyId: s.keyId, status: 'unknown_key' });
      problems.push(`no public key for key ${s.keyId}: the signature cannot be checked`);
      continue;
    }
    const subject: SignatureSubject = {
      kind: s.kind,
      subjectId: s.subjectId,
      rootHash: s.rootHash,
      signedAt: s.signedAt,
      keyId: s.keyId,
    };
    let ok = false;
    try {
      ok = await verifySubject(crypto, subject, s.signature, fromHex(key.publicKey));
    } catch {
      ok = false;
    }
    signatures.push({ subjectId: s.subjectId, keyId: s.keyId, status: ok ? 'valid' : 'invalid' });
    if (!ok) {
      problems.push(
        `the signature by key ${s.keyId} over ${canonicalSigningInput(subject)} does not verify`
      );
    }
  }

  const timestamps: TimestampVerdict[] = pkg.timestamps.map((t) => ({
    authority: t.authority,
    status: t.tokenDer ? 'present' : 'missing_token',
  }));

  return {
    ok: rootMatches && (pkg.leaves.length === 0 || merkleMatches) && problems.length === 0,
    derivedRoot,
    rootMatches,
    merkleMatches,
    derivedMerkleRoot,
    recordedMerkleRoot: primary,
    signatures,
    timestamps,
    problems,
  };
}

/** Parse a package from untrusted text. Returns null when it is not a package we can read. */
export function parseAttestationPackage(text: string): AttestationPackage | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as AttestationPackage;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.format !== ATTESTATION_FORMAT) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Serialise a package for export. Pretty-printed for a human reading the file, but the canonical
 * form a verifier re-derives is `attestationCanonical`, not this. Lives here, not in a component:
 * the UI never serialises JSON (spec §23).
 */
export function serialiseAttestationPackage(pkg: AttestationPackage): string {
  return JSON.stringify(pkg, null, 2);
}
