/**
 * A: integrity anchoring. The pure layer: the canonical signing input, Ed25519 sign/verify, and the
 * RFC 3161 timestamp request and token checks.
 *
 * Laws that shape this file:
 *   - L1: no AI, no model calls. The only randomness is a keypair generation inside the injected
 *     crypto, and the RFC 3161 nonce, which is DERIVED from the root hash and key id (never random),
 *     so the same input always produces the same request.
 *   - L2: only the SHA-256 hash leaves the tenant. The timestamp request carries the hash, never the
 *     document.
 *   - Time is always an argument: `signedAt` is passed in. This module never reads the clock.
 *   - Platform crypto only: WebCrypto (`crypto.subtle`) for Ed25519, the primitive already used by
 *     `src/lib/writing/canonical.ts` and `src/lib/ledger.ts`.
 *
 * The private key never appears in this module's outputs. Signing takes a private key as input and
 * returns only the signature; verification takes a public key.
 */

/** The kinds of subject that can be signed and stamped. */
export const SIGNATURE_KINDS = [
  'report_graph_root',
  'board_pack_data_hash',
  'engagement_certificate',
  'ledger_daily_root',
] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

/** The canonical input that is signed. Its serialisation is the exact bytes the signature covers. */
export interface SignatureSubject {
  kind: SignatureKind;
  subjectId: string;
  rootHash: string;
  /** Supplied by the caller. Never read from the clock inside this module. */
  signedAt: string;
  keyId: string;
}

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnchorError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

/** A 64-character lowercase hex string, or throw. Used for every root hash. */
export function assertRootHash(hash: string, label = 'root hash'): void {
  if (!HEX64.test(hash)) throw new AnchorError(`the ${label} must be 64 lowercase hex characters`);
}

/**
 * The canonical signing input. Keys are sorted, values are strings, and the fields are separated so
 * that no two different subjects can produce the same bytes. Deterministic: the same subject always
 * produces the same string.
 */
export function canonicalSigningInput(subject: SignatureSubject): string {
  assertRootHash(subject.rootHash);
  if (!subject.subjectId) throw new AnchorError('the subject id is required');
  if (!subject.keyId) throw new AnchorError('the key id is required');
  if (!subject.signedAt) throw new AnchorError('the signed at time is required');
  // Sorted keys, JSON with no insignificant whitespace. This mirrors src/lib/writing/canonical.ts.
  return JSON.stringify({
    key_id: subject.keyId,
    kind: subject.kind,
    root_hash: subject.rootHash,
    signed_at: subject.signedAt,
    subject_id: subject.subjectId,
  });
}

/** The minimal WebCrypto surface this module needs, so it is testable under Node without Deno. */
export interface CryptoLike {
  subtle: {
    importKey(
      format: 'raw' | 'jwk', keyData: Uint8Array | JsonWebKey, algorithm: { name: string },
      extractable: boolean, keyUsages: string[]
    ): Promise<unknown>;
    sign(algorithm: { name: string } | null, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
    verify(
      algorithm: { name: string } | null, key: unknown, signature: Uint8Array, data: Uint8Array
    ): Promise<boolean>;
  };
}

const enc = new TextEncoder();

/** Sign the canonical input with an Ed25519 private key (raw 32 bytes or a JWK). Returns hex. */
export async function signSubject(
  crypto: CryptoLike, subject: SignatureSubject, privateKey: Uint8Array | JsonWebKey
): Promise<string> {
  const key = await crypto.subtle.importKey(
    privateKey instanceof Uint8Array ? 'raw' : 'jwk', privateKey,
    { name: 'Ed25519' }, false, ['sign']
  );
  // Node's WebCrypto requires the algorithm object for Ed25519; browsers accept either, so the
  // explicit form is used and works in both runtimes.
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, enc.encode(canonicalSigningInput(subject)));
  return toHex(new Uint8Array(sig));
}

/** Verify a signature over the canonical input with an Ed25519 public key. Never throws on a bad
 *  signature: it returns false. It throws only when the key itself cannot be imported. */
export async function verifySubject(
  crypto: CryptoLike, subject: SignatureSubject, signatureHex: string, publicKey: Uint8Array | JsonWebKey
): Promise<boolean> {
  if (!/^[0-9a-f]+$/.test(signatureHex) || signatureHex.length % 2 !== 0) return false;
  const key = await crypto.subtle.importKey(
    publicKey instanceof Uint8Array ? 'raw' : 'jwk', publicKey,
    { name: 'Ed25519' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    { name: 'Ed25519' }, key, fromHex(signatureHex), enc.encode(canonicalSigningInput(subject))
  );
  return ok === true;
}

// ---------------------------------------------------------------------------
// RFC 3161
// ---------------------------------------------------------------------------

/**
 * The deterministic nonce for a timestamp request. Derived from the root hash and key id, so the same
 * subject always produces the same request (L1: no randomness in logic). The result is a positive
 * integer with the high bit clear, so it is a valid ASN.1 INTEGER.
 */
export function timestampNonce(rootHash: string, keyId: string): string {
  assertRootHash(rootHash);
  if (!keyId) throw new AnchorError('the key id is required');
  // Fold the hash and the key id into a 64-bit-safe positive integer, hex-encoded.
  let acc = 0n;
  const material = `${rootHash}:${keyId}`;
  for (let i = 0; i < material.length; i++) {
    acc = (acc * 131n + BigInt(material.charCodeAt(i))) % (2n ** 63n);
  }
  // Keep it non-zero and positive.
  return (acc === 0n ? 1n : acc).toString(16);
}

/** The fields the caller supplies to build a request. The time is an argument, never read here. */
export interface TimestampRequestInput {
  rootHash: string;
  keyId: string;
}

/**
 * The parts of a TimeStampReq this module needs to assert. The DER encoder lives in the Edge
 * Function; this describes the shape so the pure tests can check the derivation rules.
 */
export interface TimestampRequestParts {
  version: 1;
  messageImprintAlgorithm: 'sha256';
  messageImprint: string;
  nonce: string;
  certReq: true;
}

/** The request parts for a subject. Deterministic for a given root hash and key id. */
export function timestampRequestParts(input: TimestampRequestInput): TimestampRequestParts {
  assertRootHash(input.rootHash);
  return {
    version: 1,
    messageImprintAlgorithm: 'sha256',
    messageImprint: input.rootHash,
    nonce: timestampNonce(input.rootHash, input.keyId),
    certReq: true,
  };
}

/** The fields read out of a verified TimeStampToken. */
export interface TimestampTokenFacts {
  /** The hash the authority signed over. Must equal the root hash that was submitted. */
  messageImprint: string;
  /** The authority's time, as a UTC instant. */
  genTime: string;
  /** The authority's certificate, DER, hex. */
  tsaCertificate: string;
  /** True when the chain validates against a supplied trust anchor. */
  chainValid: boolean;
  /** The trust anchor that validated the chain, when it did. */
  anchorId: string | null;
}

export type TimestampCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Check a parsed token against the root hash that was submitted, the trust anchors held, and the
 * authority certificate's validity window. Pure: every fact is passed in, including `now`.
 *
 * A token is accepted only when the imprint matches, the chain validated against a known anchor, and
 * the authority's signing time falls inside the certificate's validity window.
 */
export function checkTimestampToken(
  token: TimestampTokenFacts,
  expectedRootHash: string,
  certificateValidity: { notBefore: string; notAfter: string },
  now: string
): TimestampCheck {
  assertRootHash(expectedRootHash, 'expected root hash');
  if (token.messageImprint !== expectedRootHash) {
    return { ok: false, reason: 'the token message imprint does not match the submitted root hash' };
  }
  if (!token.chainValid || token.anchorId === null) {
    return { ok: false, reason: 'the authority certificate chain does not validate against a trust anchor' };
  }
  const gen = Date.parse(token.genTime);
  const notBefore = Date.parse(certificateValidity.notBefore);
  const notAfter = Date.parse(certificateValidity.notAfter);
  const at = Date.parse(now);
  if ([gen, notBefore, notAfter, at].some((n) => Number.isNaN(n))) {
    return { ok: false, reason: 'a timestamp fact is not a valid instant' };
  }
  if (gen < notBefore || gen > notAfter) {
    return { ok: false, reason: 'the authority signed outside its certificate validity window' };
  }
  if (at < notBefore || at > notAfter) {
    return { ok: false, reason: 'the authority certificate is not valid now' };
  }
  return { ok: true };
}

/**
 * The stamping policy verdict: how many authorities have stamped a root, against the minimum the org
 * requires. One success is `partial`; the minimum or more is `stamped`; none is `queued`.
 */
export type StampStatus = 'queued' | 'stamped' | 'partial' | 'failed';

export function stampStatus(succeeded: number, attempted: number, minAuthorities: number): StampStatus {
  if (succeeded >= minAuthorities) return 'stamped';
  if (succeeded > 0) return 'partial';
  return attempted > 0 ? 'failed' : 'queued';
}

/** The backoff ladder for a failed stamp, in minutes. Index is the attempt count (1-based). */
export const STAMP_BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const;
export const STAMP_MAX_ATTEMPTS = 8;

/** The delay before the next attempt, in minutes, or null when the ladder is exhausted. */
export function stampBackoffMinutes(attempts: number): number | null {
  if (attempts >= STAMP_MAX_ATTEMPTS) return null;
  return STAMP_BACKOFF_MINUTES[Math.min(attempts, STAMP_BACKOFF_MINUTES.length - 1)];
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new AnchorError('a hex string must have an even length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
