import React, { useCallback, useEffect, useState } from 'react';
import {
  buildAttestationPackage,
  parseAttestationPackage,
  serialiseAttestationPackage,
  verifyAttestationPackage,
  type AttestationPackage,
  type AttestationVerdict,
} from '../../lib/attestation';
import type { CryptoLike } from '../../lib/anchoring';
import {
  listAttestationSubjects,
  loadAttestationInput,
  type AttestationSubjectRow,
} from '../../data/attestation';
import { downloadExport } from '../../lib/exportSerialise';
import { PRODUCT_NAME } from '../../lib/product';
import { InlineError } from '../common/InlineError';
import { ExplainPopout } from '../explain/ExplainPopout';
import { AlertCircle, Check, Download, FileCheck, ShieldCheck, Upload } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-30 attestation screen (T5; docs/SYSTELIGON.md §11.3).
 *
 * View, export and verify a portable attestation package. It lists the organisation's signed subjects
 * (report graph roots, engagement certificates, board-pack hashes), builds a self-contained package
 * for one, shows what the package proves, exports it as JSON, and verifies a package — one this
 * session built or one dropped in from elsewhere — against its own contents and its embedded public
 * keys.
 *
 * The verification here is the SAME procedure the standalone verifier implements
 * (`scripts/verify-attestation.mjs`); a divergence between the two is a defect and is covered by a
 * test. The screen never claims more than the package proves: it is tamper-EVIDENCE, and it proves
 * structure and provenance, not the truth of the underlying claims.
 *
 * Non-blocking: this is a panel, not a modal. Every interactive element carries a
 * `OA-30-*` testid.
 */
export interface AttestationPanelProps {
  screenId?: string;
}

const KIND_LABELS: Record<string, string> = {
  report_graph_root: 'Report graph root',
  engagement_certificate: 'Engagement certificate',
  board_pack_data_hash: 'Board-pack data hash',
  ledger_daily_root: 'Daily ledger root',
};

export const AttestationPanel: React.FC<AttestationPanelProps> = ({ screenId = 'OA-30' }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [subjects, setSubjects] = useState<AttestationSubjectRow[]>([]);
  const [selected, setSelected] = useState<AttestationSubjectRow | null>(null);
  const [pkg, setPkg] = useState<AttestationPackage | null>(null);
  const [verdict, setVerdict] = useState<AttestationVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setSubjects(await listAttestationSubjects());
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the signed subjects.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const build = useCallback(async (subject: AttestationSubjectRow) => {
    setBusy(true);
    setActionError(null);
    setPkg(null);
    setVerdict(null);
    try {
      const generatedAt = new Date().toISOString();
      const input = await loadAttestationInput(subject.kind, subject.subjectId, generatedAt);
      if (!input) {
        setActionError('No signed material is available for that subject.');
        return;
      }
      const built = await buildAttestationPackage(crypto as unknown as CryptoLike, input);
      setPkg(built);
      setSelected(subject);
      setVerdict(await verifyAttestationPackage(crypto as unknown as CryptoLike, built));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not build the attestation package.');
    } finally {
      setBusy(false);
    }
  }, []);

  const exportPackage = useCallback(() => {
    if (!pkg) return;
    downloadExport(serialiseAttestationPackage(pkg), `attestation-${pkg.subject.kind}-${pkg.subject.id}.json`);
  }, [pkg]);

  const verifyDropped = useCallback(async (file: File) => {
    setBusy(true);
    setActionError(null);
    setPkg(null);
    setVerdict(null);
    try {
      const text = await file.text();
      const parsed = parseAttestationPackage(text);
      if (!parsed) {
        setActionError(`That file is not a ${PRODUCT_NAME} attestation package.`);
        return;
      }
      setPkg(parsed);
      setVerdict(await verifyAttestationPackage(crypto as unknown as CryptoLike, parsed));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-4" data-testid={`${screenId}-panel`}>
      <div className="flex items-start gap-3 rounded-2xl border border-hairline bg-surface p-5">
        <span className="text-accent">
          <ShieldCheck className="w-5 h-5" data-testid={`${screenId}-icon`} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-apple-14 font-semibold text-primary" data-testid={`${screenId}-headline`}>
            Portable attestation packages
          </h3>
          <p className="text-apple-12 text-secondary">
            Hand an outsider a self-contained artifact they can check without trusting us: the roots,
            the signatures over them, the timestamps, the versions that scored it, and the procedure
            to re-derive it all with their own tooling.
          </p>
        </div>
        <ExplainPopout explainId="term.attestation" screenId={screenId} element="explain-attestation">
          <span className="text-apple-12 text-accent cursor-help shrink-0">What is this?</span>
        </ExplainPopout>
      </div>

      <InlineError message={actionError} testId={`${screenId}-error`} onDismiss={() => setActionError(null)} />
      <InlineError message={state === 'error' ? loadError : null} testId={`${screenId}-load-error`} />

      <div className="flex items-center gap-2">
        <label
          htmlFor={`${screenId}-file`}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline bg-surface text-apple-12 font-medium text-secondary hover:text-primary cursor-pointer"
          data-testid={`${screenId}-verify-drop-label`}
        >
          <Upload className="w-3.5 h-3.5" />
          Verify a package file
        </label>
        <input
          id={`${screenId}-file`}
          type="file"
          accept="application/json,.json"
          data-testid={`${screenId}-verify-drop`}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void verifyDropped(f);
          }}
        />
      </div>

      {state === 'loading' ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid={`${screenId}-loading`}>
          Loading signed subjects…
        </div>
      ) : subjects.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface p-6 text-center" data-testid={`${screenId}-empty`}>
          <p className="text-apple-13 text-primary font-medium">Nothing signed yet.</p>
          <p className="text-apple-12 text-tertiary mt-1">
            A subject appears here once a report root, certificate or board pack has been signed.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid={`${screenId}-subjects`}>
          {subjects.map((s) => {
            const isSelected = selected?.subjectId === s.subjectId && selected?.kind === s.kind;
            return (
              <li
                key={`${s.kind}:${s.subjectId}`}
                data-testid={`${screenId}-subject-${s.subjectId}`}
                className={`rounded-2xl border p-4 flex items-center gap-3 ${
                  isSelected ? 'border-accent bg-accent-subtle' : 'border-hairline bg-surface'
                }`}
              >
                <FileCheck className="w-4 h-4 shrink-0 text-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="text-apple-13 text-primary font-medium">
                    {KIND_LABELS[s.kind] ?? s.kind}
                  </p>
                  <p className="text-apple-11 text-tertiary font-mono truncate">{s.subjectId}</p>
                  <p className="text-apple-11 text-tertiary mt-0.5">
                    Signed {s.signedAt}
                    {s.hasTimestamp ? ' · timestamped' : ' · no timestamp yet'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void build(s)}
                  data-testid={`${screenId}-build-${s.subjectId}`}
                  className="text-apple-12 text-accent hover:underline shrink-0 disabled:opacity-50"
                >
                  Build package
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pkg && verdict && (
        <div className="rounded-2xl border border-hairline bg-surface-elevated p-5 space-y-3" data-testid={`${screenId}-package`}>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-apple-13 font-semibold text-primary" data-testid={`${screenId}-package-title`}>
              {KIND_LABELS[pkg.subject.kind] ?? pkg.subject.kind}
            </h4>
            <button
              type="button"
              onClick={exportPackage}
              data-testid={`${screenId}-export`}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          </div>

          <p
            role="status"
            data-testid={`${screenId}-verdict`}
            className={`flex items-center gap-2 text-apple-12 ${
              verdict.ok ? 'text-verdigris' : 'text-cinnabar'
            }`}
          >
            {verdict.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {verdict.ok
              ? 'Verified: the package is internally consistent and its roots are signed.'
              : `Not verified: ${verdict.problems[0] ?? 'a check failed.'}`}
          </p>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-apple-11">
            <div className="min-w-0">
              <dt className="text-tertiary">Package root</dt>
              <dd className="font-mono text-secondary break-all" data-testid={`${screenId}-package-root`}>
                {pkg.packageRoot}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-tertiary">Merkle root</dt>
              <dd className="font-mono text-secondary break-all" data-testid={`${screenId}-merkle-root`}>
                {verdict.derivedMerkleRoot}
              </dd>
            </div>
            <div>
              <dt className="text-tertiary">Leaves</dt>
              <dd className="text-secondary" data-testid={`${screenId}-leaf-count`}>{pkg.leaves.length}</dd>
            </div>
            <div>
              <dt className="text-tertiary">Signatures</dt>
              <dd className="text-secondary" data-testid={`${screenId}-signature-count`}>
                {verdict.signatures.filter((s) => s.status === 'valid').length} of {verdict.signatures.length} valid
              </dd>
            </div>
            <div>
              <dt className="text-tertiary">Timestamps</dt>
              <dd className="text-secondary" data-testid={`${screenId}-timestamp-count`}>{pkg.timestamps.length}</dd>
            </div>
            <div>
              <dt className="text-tertiary">Versions</dt>
              <dd className="text-secondary" data-testid={`${screenId}-versions`}>
                engine {pkg.versions.engine || '—'} · template {pkg.versions.template || '—'} · phrases{' '}
                {pkg.versions.phraseLibrary || '—'} · {pkg.versions.rulePacks.length} rule pack(s)
              </dd>
            </div>
          </dl>

          {verdict.problems.length > 0 && (
            <ul className="text-apple-11 text-cinnabar space-y-0.5" data-testid={`${screenId}-problems`}>
              {verdict.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}

          <p className="text-apple-11 text-tertiary">
            This is tamper-evidence. It proves the package is internally consistent and its roots are
            signed and stamped; it does not prove the claims behind the leaves were true, and it does
            not prevent a change — it makes one provable.
          </p>
        </div>
      )}
    </div>
  );
};
