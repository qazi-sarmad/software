import React, { useCallback, useEffect, useState } from 'react';
import { getOrgSettingsExtra } from '../../data/boardPack';
import {
  getCertificate, getCertificateConfig, issueCertificate, listCertificates, revokeCertificate,
  saveCertificateConfig,
} from '../../data/certificate';
import {
  certificateVerifyUrl, enabledFields, statusLabel, type CertificateConfigField, type CertificateRow,
} from '../../lib/certificate';
import { renderPdf } from '../../lib/render/pdf';
import { renderQrDataUrl } from '../../lib/render/qr';
import { getBranding } from '../../data/branding';
import type { BrandingSpec } from '../../lib/render/branding';
import type { DataResult } from '../../data/db';
import { hasRight } from '../../lib/rights';
import { useApp } from '../../context/AppContext';
import { InlineError } from '../common/InlineError';
import { Download, FileCheck, RefreshCw, ShieldCheck, ShieldAlert, XCircle } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

function download(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * WK-05: the engagement certificate panel (F11).
 *
 * Issue, revoke and download a certificate as a human-readable PDF with a large QR code. Issuing
 * needs manage_engagements and the certificates feature; revoking needs can_reopen and a reason. The
 * field list (OA-10) is configurable here too. The certificate document and its hash are built in the
 * database; this panel only renders and downloads.
 */
export const CertificatePanel: React.FC<{ engagementId?: string }> = ({ engagementId }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canIssue = hasRight(currentUser, 'manage_engagements');
  const canRevoke = hasRight(currentUser, 'can_reopen');
  const canConfig = hasRight(currentUser, 'edit_config');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<CertificateRow[]>([]);
  const [fields, setFields] = useState<CertificateConfigField[]>([]);
  const [branding, setBranding] = useState<BrandingSpec | null>(null);
  const [appBaseUrl, setAppBaseUrl] = useState('');
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) { setState('ready'); return; }
    setState('loading');
    setLoadError('');
    try {
      const [c, f, b, extra] = await Promise.all([
        listCertificates(orgId), getCertificateConfig(orgId), getBranding(orgId),
        getOrgSettingsExtra(orgId),
      ]);
      setRows(c);
      setFields(f);
      setBranding(b);
      setAppBaseUrl(extra?.appBaseUrl ?? '');
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the certificates.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const visible = rows.filter((r) => !engagementId || r.engagementId === engagementId);

  const issue = async () => {
    if (!engagementId) return;
    setBusy(true);
    setResult(null);
    const r = await issueCertificate(engagementId);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setResult(null);
    const r = await revokeCertificate(id, reason);
    setBusy(false);
    setResult(r);
    if (r.ok) { setRevokingId(null); setReason(''); await load(); }
  };

  const downloadPdf = async (row: CertificateRow) => {
    const full = await getCertificate(row.id);
    if (!full || !branding) { setResult({ ok: false, reason: 'That certificate is not available to you.' }); return; }
    setBusy(true);
    try {
      const showFields = enabledFields(fields).map((f) => ({
        label: f.label,
        value: String((full.canonical as Record<string, unknown>)[f.fieldKey] ?? '—'),
      }));
      const qrDataUrl = await renderQrDataUrl(certificateVerifyUrl(appBaseUrl, row.id), { size: 320 });
      const bytes = await renderPdf(branding, {
        title: 'Engagement certificate',
        subtitle: full.canonical.engagement_title ? String(full.canonical.engagement_title) : undefined,
        sections: [{
          heading: 'Certificate',
          blocks: showFields.map((f) => ({ kind: 'paragraph' as const, text: `${f.label}: ${f.value}` })),
        }],
        qrDataUrl,
        qrCaption: 'Scan to verify this certificate',
        templateVars: { certHash: row.certHash },
      });
      download(bytes, `certificate-${row.id}.pdf`, 'application/pdf');
      setResult({ ok: true });
    } catch (err) {
      setResult({ ok: false, reason: err instanceof Error ? err.message : 'Could not build the certificate PDF.' });
    }
    setBusy(false);
  };

  const toggleField = async (key: string) => {
    const next = fields.map((f) => (f.fieldKey === key ? { ...f, enabled: !f.enabled } : f));
    setFields(next);
    const r = await saveCertificateConfig(orgId, next);
    setResult(r);
  };

  if (state === 'loading') {
    return <p className="text-sm opacity-70" data-testid="wk-certificate-loading">Loading the certificates…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="wk-certificate-error" />;
  }

  return (
    <div className="space-y-4" data-testid="wk-certificate">
      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <h3 className="text-apple-14 font-semibold text-primary">Engagement certificate</h3>
        </div>
        <p className="text-apple-12 text-secondary">
          A certificate freezes the engagement&apos;s sealing position — its ledger root hash, the sealed
          workpaper count and the findings count — and gives the reader a QR code that opens the public
          verification page.
        </p>
        {engagementId && (
          <button type="button" onClick={() => void issue()} disabled={busy || !canIssue}
            data-testid="wk-certificate-issue"
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50">
            <FileCheck className="w-3.5 h-3.5" />Issue a certificate
          </button>
        )}
        {!canIssue && (
          <p className="text-apple-12 text-secondary" data-testid="wk-certificate-no-issue">
            Your role can read a certificate but not issue one.
          </p>
        )}
      </div>

      <InlineError message={result && !result.ok ? result.reason : null} testId="wk-certificate-result" />
      {result?.ok && <p className="text-apple-12 text-positive" data-testid="wk-certificate-ok">Done.</p>}

      {visible.length === 0 ? (
        <p className="text-apple-13 text-secondary" data-testid="wk-certificate-empty">
          No certificate has been issued for this engagement.
        </p>
      ) : (
        <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline" data-testid="wk-certificate-list">
          {visible.map((r) => (
            <li key={r.id} className="px-4 py-3 space-y-1" data-testid={`wk-certificate-${r.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-apple-13 text-primary font-medium">
                  Version {r.version} · {new Date(r.issuedAt).toLocaleString()}
                </span>
                <span
                  data-testid={`wk-certificate-status-${r.id}`}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-apple-11 font-semibold ${
                    r.status === 'valid' ? 'bg-verdigris-subtle text-verdigris' : 'bg-cinnabar-subtle text-cinnabar'
                  }`}
                >
                  {r.status === 'valid' ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                  {statusLabel(r.status)}
                </span>
              </div>
              <span className="block text-apple-11 text-tertiary font-mono">hash {r.certHash.slice(0, 24)}…</span>
              {r.revokeReason && (
                <span className="block text-apple-11 text-cinnabar">Reason: {r.revokeReason}</span>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={() => void downloadPdf(r)} disabled={busy || !appBaseUrl}
                  data-testid={`wk-certificate-pdf-${r.id}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-apple-12 border border-hairline text-accent disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" />PDF
                </button>
                {r.status === 'valid' && canRevoke && (
                  <button type="button" onClick={() => setRevokingId(r.id)}
                    data-testid={`wk-certificate-revoke-${r.id}`}
                    className="px-2.5 py-1 rounded-lg text-apple-12 border border-hairline text-cinnabar">
                    Revoke
                  </button>
                )}
              </div>
              {revokingId === r.id && (
                <div className="pt-1 space-y-1" data-testid={`wk-certificate-revoke-form-${r.id}`}>
                  <input value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this being revoked?"
                    data-testid={`wk-certificate-revoke-reason-${r.id}`}
                    className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13" />
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={busy || reason.trim().length < 5}
                      onClick={() => void revoke(r.id)}
                      data-testid={`wk-certificate-revoke-confirm-${r.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent text-white text-apple-12 font-medium disabled:opacity-50">
                      <RefreshCw className="w-3.5 h-3.5" />Revoke
                    </button>
                    <button type="button" onClick={() => { setRevokingId(null); setReason(''); }}
                      className="text-apple-12 text-secondary hover:text-primary">
                      <XCircle className="w-3.5 h-3.5 inline" /> Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canConfig && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="oa-certificate-config">
          <h4 className="text-apple-13 font-semibold text-primary">Which fields appear on a certificate</h4>
          <p className="text-apple-12 text-secondary">Turn a field on or off. Order is fixed by the platform.</p>
          {fields.map((f) => (
            <label key={f.fieldKey} className="flex items-center gap-2 text-apple-13 text-primary"
              data-testid={`oa-certificate-field-${f.fieldKey}`}>
              <input type="checkbox" checked={f.enabled} onChange={() => void toggleField(f.fieldKey)}
                data-testid={`oa-certificate-enabled-${f.fieldKey}`} />
              {f.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
