/**
 * Attestation package data module (T3, T5).
 *
 * The one read that gathers a subject's facts (roots, versions, Merkle leaves, signatures, public
 * keys, timestamp tokens) is the security-definer RPC `attestation_input_get` (migration 0113). This
 * module maps its JSON to the package model in `src/lib/attestation.ts`; the pure layer builds and
 * verifies the package. Components never import the database client (rule M8).
 *
 * With no Supabase environment the module is inert: the read returns null and reports not-configured.
 */
import { getClient } from './db';
import type {
  AttestationInput,
  AttestationKey,
  AttestationLeaf,
  AttestationSignature,
  AttestationTimestamp,
  AttestationVersions,
} from '../lib/attestation';
import type { SignatureKind } from '../lib/anchoring';

/** Everything `attestation_input_get` returns, mapped to the package input shape. */
export interface AttestationSubjectInput {
  label: string;
  roots: { name: string; hash: string }[];
  versions: AttestationVersions;
  leaves: AttestationLeaf[];
  signatures: AttestationSignature[];
  keys: AttestationKey[];
  timestamps: AttestationTimestamp[];
  ledgerSeq: string | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toVersions(raw: unknown): AttestationVersions {
  const v = (raw ?? {}) as Record<string, unknown>;
  return {
    engine: String(v.engine ?? ''),
    template: String(v.template ?? ''),
    phraseLibrary: String(v.phraseLibrary ?? ''),
    rulePacks: asArray<{ id: string; version: number }>(v.rulePacks).map((p) => ({
      id: String(p.id),
      version: Number(p.version),
    })),
  };
}

/** Fetch the package input for one subject, or null when it is not visible / not configured. */
async function getAttestationInput(
  kind: SignatureKind, subjectId: string
): Promise<AttestationSubjectInput | null> {
  const sb = getClient();
  if (!sb || !subjectId) return null;
  const { data, error } = await sb.rpc('attestation_input_get', {
    p_kind: kind, p_subject_id: subjectId,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  return {
    label: String(raw.label ?? ''),
    roots: asArray<{ name: string; hash: string }>(raw.roots).map((r) => ({
      name: String(r.name), hash: String(r.hash),
    })),
    versions: toVersions(raw.versions),
    leaves: asArray<{ claimId: string; leafHash: string }>(raw.leaves).map((l) => ({
      claimId: String(l.claimId), leafHash: String(l.leafHash),
    })),
    signatures: asArray<Record<string, unknown>>(raw.signatures).map((s) => ({
      kind: s.kind as SignatureKind,
      subjectId: String(s.subjectId),
      rootHash: String(s.rootHash),
      keyId: String(s.keyId),
      algorithm: 'Ed25519' as const,
      signature: String(s.signature),
      signedAt: String(s.signedAt),
    })),
    keys: asArray<{ keyId: string; publicKey: string }>(raw.keys).map((k) => ({
      keyId: String(k.keyId), algorithm: 'Ed25519' as const, publicKey: String(k.publicKey),
    })),
    timestamps: asArray<{ authority: string; genTime: string; tokenDer: string }>(raw.timestamps)
      .map((t) => ({
        authority: String(t.authority), genTime: String(t.genTime), tokenDer: String(t.tokenDer),
      })),
    ledgerSeq: raw.ledgerSeq == null ? null : String(raw.ledgerSeq),
  };
}

/** The package input, ready to hand to `buildAttestationPackage`. Returns null when not configured. */
export async function loadAttestationInput(
  kind: SignatureKind, subjectId: string, generatedAt: string
): Promise<AttestationInput | null> {
  const subject = await getAttestationInput(kind, subjectId);
  if (!subject) return null;
  return {
    generatedAt,
    subject: { kind, id: subjectId, label: subject.label },
    roots: subject.roots,
    versions: subject.versions,
    leaves: subject.leaves,
    keys: subject.keys,
    signatures: subject.signatures,
    timestamps: subject.timestamps,
    ledgerSeq: subject.ledgerSeq,
  };
}

/** One signed subject, as `attestation_subjects_list` returns it. */
export interface AttestationSubjectRow {
  kind: SignatureKind;
  subjectId: string;
  rootHash: string;
  keyId: string;
  signedAt: string;
  hasTimestamp: boolean;
}

/** The signed subjects an integrity owner can build a package for, newest first. */
export async function listAttestationSubjects(): Promise<AttestationSubjectRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('attestation_subjects_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    kind: r.kind as SignatureKind,
    subjectId: String(r.subject_id),
    rootHash: String(r.root_hash),
    keyId: String(r.key_id),
    signedAt: String(r.signed_at),
    hasTimestamp: r.has_timestamp === true,
  }));
}
