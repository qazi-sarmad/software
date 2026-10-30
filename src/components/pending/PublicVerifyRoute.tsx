import React, { useEffect, useState } from 'react';
import { verifyBoardPack, verifyCertificate, verifyReportRoot, type ReportRootResult } from '../../data/certificate';
import {
  matchesHash, parseDroppedDocument, statusLabel, type VerifyResult,
} from '../../lib/certificate';
import { ShieldCheck, ShieldAlert, Upload, AlertTriangle } from '../common/Icons';
import { PRODUCT_NAME } from '../../lib/product';

type Phase = 'loading' | 'ready' | 'error';

interface DropResult {
  matches: boolean;
  computed: string;
}

/**
 * WK-06: the public verification page (F11).
 *
 * The ONLY anonymous surface in the product. It needs no session: it calls exactly one of the three
 * anon-callable RPCs (verify_certificate / verify_board_pack / verify_report_root, W10.3) and shows
 * status, issued time, the hash and the counts. Organisation name and title appear only when the
 * tenant turned public_verify_show_title on. A visitor may also drop a certificate JSON or PDF to
 * compare its hash in the browser — nothing is uploaded.
 *
 * kind 'root' is the writing engine's report check: given a graph root it shows existence, the
 * issuance time and the engine, template and phrase-library versions, and no tenant content.
 */
export const PublicVerifyRoute: React.FC<{ kind: 'verify' | 'pack' | 'root'; idFromUrl: string }> = ({ kind, idFromUrl }) => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [cert, setCert] = useState<VerifyResult | null>(null);
  const [pack, setPack] = useState<{ status: string; issuedAt: string | null; dataHash: string | null; organisation: string | null } | null>(null);
  const [root, setRoot] = useState<ReportRootResult | null>(null);
  const [error, setError] = useState('');
  const [drop, setDrop] = useState<DropResult | null>(null);
  const [dropError, setDropError] = useState('');

  useEffect(() => {
    let live = true;
    if (!idFromUrl) { setPhase('ready'); return; }
    const run = kind === 'verify'
      ? verifyCertificate(idFromUrl)
      : kind === 'pack'
        ? verifyBoardPack(idFromUrl)
        : verifyReportRoot(idFromUrl);
    run
      .then((r) => {
        if (!live) return;
        if (!r) { setError('We could not check that reference.'); setPhase('error'); return; }
        if (kind === 'verify') setCert(r as VerifyResult);
        else if (kind === 'pack') setPack(r as typeof pack);
        else setRoot(r as ReportRootResult);
        setPhase('ready');
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'We could not check that reference.');
        setPhase('error');
      });
    return () => { live = false; };
  }, [kind, idFromUrl]);

  const onDrop = async (file: File) => {
    setDrop(null);
    setDropError('');
    const expected = cert?.certHash ?? pack?.dataHash ?? '';
    if (!expected) { setDropError('There is no recorded hash to compare against yet.'); return; }
    const text = await file.text();
    const doc = parseDroppedDocument(text);
    if (!doc) { setDropError('We could not read a certificate from that file.'); return; }
    setDrop(await matchesHash(doc, expected));
  };

  const status = cert?.status ?? pack?.status ?? root?.status ?? 'not_found';
  const good = status === 'valid';

  return (
    <main className="min-h-screen flex items-center justify-center bg-canvas p-6" data-testid="wk-verify">
      <div className="w-full max-w-xl rounded-2xl border border-hairline bg-surface p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-accent" />
          <h1 className="text-apple-17 font-bold text-primary">{PRODUCT_NAME} verification</h1>
        </div>

        {phase === 'loading' && (
          <p className="text-apple-13 text-secondary" data-testid="wk-verify-loading">Checking…</p>
        )}
        {phase === 'error' && <p className="text-apple-13 text-cinnabar" data-testid="wk-verify-error">{error}</p>}

        {phase === 'ready' && (
          <>
            <div
              data-testid="wk-verify-status"
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-apple-13 font-semibold ${
                good ? 'bg-verdigris-subtle text-verdigris' : 'bg-cinnabar-subtle text-cinnabar'
              }`}
            >
              {good ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
              {statusLabel(status)}
            </div>

            {status === 'not_found' && (
              <p className="text-apple-13 text-secondary" data-testid="wk-verify-not-found">
                We have no record of that reference. Check the link, or scan the QR code again.
              </p>
            )}

            {status === 'rate_limited' && (
              <p className="text-apple-13 text-secondary" data-testid="wk-verify-rate-limited">
                Too many checks just now. Please try again in a minute.
              </p>
            )}

            {status !== 'not_found' && status !== 'rate_limited' && (
              <dl className="grid grid-cols-1 gap-1 text-apple-13">
                {(cert?.organisation ?? pack?.organisation ?? root?.organisation) && (
                  <div data-testid="wk-verify-organisation" className="flex justify-between">
                    <dt className="text-secondary">Organisation</dt>
                    <dd className="text-primary">{cert?.organisation ?? pack?.organisation ?? root?.organisation}</dd>
                  </div>
                )}
                {cert?.engagementTitle && (
                  <div data-testid="wk-verify-title" className="flex justify-between">
                    <dt className="text-secondary">Engagement</dt>
                    <dd className="text-primary">{cert.engagementTitle}</dd>
                  </div>
                )}
                <div className="flex justify-between" data-testid="wk-verify-issued">
                  <dt className="text-secondary">Issued</dt>
                  <dd className="text-primary">
                    {cert?.issuedAt ?? pack?.issuedAt ?? root?.issuedAt
                      ? new Date((cert?.issuedAt ?? pack?.issuedAt ?? root?.issuedAt) as string).toLocaleString()
                      : '—'}
                  </dd>
                </div>
                {cert && (
                  <>
                    <div className="flex justify-between" data-testid="wk-verify-workpapers">
                      <dt className="text-secondary">Sealed workpapers</dt>
                      <dd className="text-primary">{cert.sealedWorkpapers ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between" data-testid="wk-verify-findings">
                      <dt className="text-secondary">Findings</dt>
                      <dd className="text-primary">{cert.findingsCount ?? '—'}</dd>
                    </div>
                  </>
                )}
                {root && (
                  <>
                    <div className="flex justify-between" data-testid="wk-verify-model">
                      <dt className="text-secondary">Report model</dt>
                      <dd className="text-primary">{root.modelId ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between" data-testid="wk-verify-engine">
                      <dt className="text-secondary">Engine version</dt>
                      <dd className="text-primary">{root.engineVersion ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between" data-testid="wk-verify-template">
                      <dt className="text-secondary">Template version</dt>
                      <dd className="text-primary">{root.templateVersion ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between" data-testid="wk-verify-phrases">
                      <dt className="text-secondary">Phrase library</dt>
                      <dd className="text-primary">{root.phraseLibraryVersion ?? '—'}</dd>
                    </div>
                  </>
                )}
                {kind !== 'root' && (
                  <div className="flex justify-between gap-3" data-testid="wk-verify-hash">
                    <dt className="text-secondary shrink-0">Hash</dt>
                    <dd className="text-primary font-mono text-apple-11 break-all">
                      {cert?.certHash ?? pack?.dataHash ?? '—'}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {kind !== 'root' && (
              <div className="rounded-xl border border-hairline bg-canvas p-3 space-y-2" data-testid="wk-verify-drop">
              <p className="text-apple-12 text-secondary">
                Drop the certificate file here to compare its hash in your browser. Nothing is uploaded.
              </p>
              <label className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-accent cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Choose a file
                <input type="file" accept=".json,.pdf,application/json,application/pdf" className="hidden"
                  data-testid="wk-verify-file"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onDrop(f); }} />
              </label>
              {dropError && (
                <p className="text-apple-12 text-cinnabar flex items-center gap-1" data-testid="wk-verify-drop-error">
                  <AlertTriangle className="w-3 h-3" />{dropError}
                </p>
              )}
              {drop && (
                <p
                  data-testid="wk-verify-drop-result"
                  className={`text-apple-12 font-medium ${drop.matches ? 'text-verdigris' : 'text-cinnabar'}`}
                >
                  {drop.matches ? 'The file matches the recorded hash.' : 'The file does NOT match the recorded hash.'}
                </p>
              )}
            </div>
            )}

            <p className="text-apple-11 text-secondary">
              This page shows only whether a record is valid and its hash. It never shows audit content.
            </p>
          </>
        )}
      </div>
    </main>
  );
};
