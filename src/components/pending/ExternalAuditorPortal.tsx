import React, { useCallback, useEffect, useState } from 'react';
import {
  getEngagementSummary,
  getLatestCertificate,
  getLatestPack,
  getMyAccess,
  listMyEngagements,
  verifyExternalCertificate,
} from '../../data/externalAuditors';
import { matchesHash, parseDroppedDocument } from '../../lib/certificate';
import { describeExpiry, SIGNUP_DISABLED_HINT, type AuditorEngagement } from '../../lib/externalAuditors';
import { InlineError } from '../common/InlineError';
import { ShieldCheck, ShieldAlert, Upload, FileText, FileCheck } from '../common/Icons';

type Phase = 'loading' | 'ready' | 'error' | 'inactive';

interface Summary {
  title: string; orgName: string; stage: string; sealed: boolean;
  sealedWorkpapers: number; findingsCount: number;
}

/**
 * EX-02/EX-03/EX-04: the external auditor portal (F13).
 *
 * Read-only. The auditor is a separate principal, not an org member: they reach data only through the
 * security-definer ext_ RPCs, which check an active, unexpired grant and log every call. The portal
 * shows the engagements they may see, an engagement summary, the latest Board Pack and certificate
 * hashes, and a hash-verification tool. There is no write control anywhere on this screen.
 */
export const ExternalAuditorPortal: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [engagements, setEngagements] = useState<AuditorEngagement[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [packHash, setPackHash] = useState<string | null>(null);
  const [certHash, setCertHash] = useState<string | null>(null);
  const [certId, setCertId] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ matches: boolean; computed: string } | null>(null);
  const [dropError, setDropError] = useState('');

  const load = useCallback(async () => {
    setPhase('loading');
    setLoadError('');
    try {
      const me = await getMyAccess();
      if (!me || !me.active) { setPhase('inactive'); return; }
      setEmail(me.email);
      const list = await listMyEngagements();
      setEngagements(list);
      if (list.length > 0) setSelected(list[0].engagementId);
      setPhase('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your portal.');
      setPhase('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    Promise.all([
      getEngagementSummary(selected), getLatestPack(selected), getLatestCertificate(selected),
    ]).then(([s, p, c]) => {
      if (!live) return;
      setSummary(s);
      setPackHash(p?.dataHash ?? null);
      setCertHash(c?.certHash ?? null);
      setCertId(c?.certificateId ?? null);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [selected]);

  const verify = async () => {
    if (!certId) return;
    setVerifyStatus(null);
    const r = await verifyExternalCertificate(certId);
    setVerifyStatus(r?.status ?? 'not_found');
  };

  const onDrop = async (file: File) => {
    setDrop(null);
    setDropError('');
    const expected = certHash ?? packHash ?? '';
    if (!expected) { setDropError('There is no recorded hash to compare against yet.'); return; }
    const doc = parseDroppedDocument(await file.text());
    if (!doc) { setDropError('We could not read a document from that file.'); return; }
    setDrop(await matchesHash(doc, expected));
  };

  if (phase === 'loading') {
    return <div className="py-16 text-center text-secondary text-apple-13" data-testid="ex-portal-loading">Loading your portal…</div>;
  }

  if (phase === 'inactive') {
    return (
      <div className="max-w-2xl mx-auto py-16 px-6 text-center" data-testid="ex-portal-inactive">
        <ShieldAlert className="w-8 h-8 mx-auto text-cinnabar" />
        <h2 className="text-apple-16 font-semibold text-primary mt-3">Your access is not active</h2>
        <p className="text-apple-13 text-secondary mt-2">
          Your access has been revoked or has expired. Ask the organisation that invited you to
          renew it. {SIGNUP_DISABLED_HINT}
        </p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="max-w-2xl mx-auto py-16 px-6">
        <InlineError message={loadError} testId="ex-portal-error" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-4" data-testid="ex-portal">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-apple-18 font-semibold text-primary">External auditor portal</h1>
          <p className="text-apple-12 text-secondary">{email} · read-only access</p>
        </div>
        <ShieldCheck className="w-6 h-6 text-accent" />
      </header>

      {engagements.length === 0 ? (
        <p className="text-apple-13 text-tertiary" data-testid="ex-portal-empty">
          You have no engagements to view yet.
        </p>
      ) : (
        <>
          <section className="rounded-2xl border border-hairline bg-surface p-4" data-testid="ex-portal-engagements">
            <h2 className="text-apple-14 font-semibold text-primary mb-2">Your engagements</h2>
            <ul className="divide-y divide-hairline">
              {engagements.map((e) => (
                <li key={e.engagementId} className="py-2">
                  <button
                    type="button"
                    onClick={() => setSelected(e.engagementId)}
                    data-testid={`ex-portal-engagement-${e.engagementId}`}
                    className={`text-apple-13 ${selected === e.engagementId ? 'text-accent' : 'text-primary'}`}
                  >
                    {e.title}
                  </button>
                  <span className="text-apple-11 text-tertiary ml-2">{describeExpiry({
                    userId: '', email: '', active: true, engagementId: e.engagementId, title: e.title,
                    canViewSummary: true, canDownloadPack: e.canDownloadPack,
                    canDownloadCertificate: e.canDownloadCertificate, canVerify: true,
                    expiresAt: e.expiresAt, revokedAt: null,
                  })}</span>
                </li>
              ))}
            </ul>
          </section>

          {summary && (
            <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="ex-portal-summary">
              <h2 className="text-apple-14 font-semibold text-primary">{summary.title}</h2>
              <dl className="grid grid-cols-2 gap-2 text-apple-12">
                <dt className="text-secondary">Organisation</dt><dd className="text-primary">{summary.orgName}</dd>
                <dt className="text-secondary">Stage</dt><dd className="text-primary">{summary.stage}</dd>
                <dt className="text-secondary">Sealed workpapers</dt><dd className="text-primary">{summary.sealedWorkpapers}</dd>
                <dt className="text-secondary">Findings</dt><dd className="text-primary">{summary.findingsCount}</dd>
              </dl>
            </section>
          )}

          <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="ex-portal-downloads">
            <h2 className="text-apple-14 font-semibold text-primary">Documents</h2>
            <div className="flex items-center justify-between text-apple-12">
              <span className="flex items-center gap-2 text-primary">
                <FileText className="w-4 h-4 stroke-[1.5]" /> Board Pack
              </span>
              <span className="text-tertiary" data-testid="ex-portal-pack-hash">{packHash ?? 'No pack yet'}</span>
            </div>
            <div className="flex items-center justify-between text-apple-12">
              <span className="flex items-center gap-2 text-primary">
                <FileCheck className="w-4 h-4 stroke-[1.5]" /> Certificate
              </span>
              <span className="text-tertiary" data-testid="ex-portal-cert-hash">{certHash ?? 'No certificate yet'}</span>
            </div>
            <button
              type="button"
              disabled={!certId}
              onClick={() => void verify()}
              data-testid="ex-portal-verify"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-12 disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4 stroke-[1.5]" /> Verify certificate hash
            </button>
            {verifyStatus && (
              <p className="text-apple-12 text-secondary" data-testid="ex-portal-verify-result">
                Recorded status: {verifyStatus}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="ex-portal-drop">
            <h2 className="text-apple-14 font-semibold text-primary">Verify a document</h2>
            <p className="text-apple-12 text-secondary">
              Drop a certificate or pack file to compare its hash here, in your browser. Nothing is
              uploaded.
            </p>
            <label className="inline-flex items-center gap-2 text-apple-12 text-primary cursor-pointer">
              <Upload className="w-4 h-4 stroke-[1.5]" /> Choose a file
              <input
                type="file"
                className="sr-only"
                data-testid="ex-portal-drop-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onDrop(f);
                }}
              />
            </label>
            {dropError && <InlineError message={dropError} testId="ex-portal-drop-error" />}
            {drop && (
              <p className={`text-apple-12 ${drop.matches ? 'text-accent' : 'text-cinnabar'}`} data-testid="ex-portal-drop-result">
                {drop.matches ? 'This document matches the recorded hash.' : 'This document does not match the recorded hash.'}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
};
