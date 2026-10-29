import React, { useEffect, useState } from 'react';
import { WorkingPaper } from '../../types';
import { useApp } from '../../context/AppContext';
import { ExplainPopout } from '../explain/ExplainPopout';
import {
  EVIDENCE_MAX_BYTES, evidenceSignedUrl, evidenceStorageReady, listEvidenceFiles, uploadEvidence,
  verifyEvidenceFile, type EvidenceFileRow,
} from '../../data/evidence';
import { Upload, FileCheck, ShieldCheck, Download, Clock, AlertTriangle } from '../common/Icons';

interface EvidenceTabProps {
  workpaper: WorkingPaper;
}

interface SessionItem {
  id: string;
  name: string;
  uploadedAt: string;
  uploadedBy: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Evidence for a workpaper (S20). Bytes go to the private `evidence` bucket and the row + ledger
 * entry follow; a verify re-derives the hash from the stored bytes. When no bucket is wired the tab
 * says "session only" honestly rather than claiming a hash-lock it cannot keep.
 */
export const EvidenceTab: React.FC<EvidenceTabProps> = ({ workpaper }) => {
  const { attachEvidenceToWorkpaper, currentUser } = useApp();
  const [evidenceList, setEvidenceList] = useState<SessionItem[]>(workpaper.evidenceItems || []);
  const [stored, setStored] = useState<EvidenceFileRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [storageReady, setStorageReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyNote, setVerifyNote] = useState<Record<string, string>>({});

  const engagementId = workpaper.engagementId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ready = await evidenceStorageReady();
      if (cancelled) return;
      setStorageReady(ready);
      if (ready) {
        try {
          const rows = await listEvidenceFiles(workpaper.id);
          if (!cancelled) setStored(rows);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load evidence.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [workpaper.id]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || workpaper.sealed) return;

    setIsUploading(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (storageReady && engagementId && currentUser.orgId) {
        // Bytes -> row -> ledger. The tab reloads the stored rows so the screen shows what is kept.
        await uploadEvidence(
          currentUser.orgId, engagementId, workpaper.id,
          { name: file.name, bytes, mimeType: file.type }, 'testing'
        );
        setStored(await listEvidenceFiles(workpaper.id));
      } else {
        // No bucket: keep the honest in-memory path and label it as session-only below.
        let binaryStr = '';
        for (let i = 0; i < bytes.length; i++) binaryStr += String.fromCharCode(bytes[i]);
        const sha256 = await (await import('../../lib/ledger')).computeSha256(binaryStr);
        await attachEvidenceToWorkpaper(
          workpaper.id, { name: file.name, sizeBytes: file.size, sha256 }, currentUser.name
        );
        setEvidenceList((prev) => [{
          id: `ev-${Date.now()}`, name: file.name, uploadedAt: new Date().toISOString(),
          uploadedBy: currentUser.name, sha256, sizeBytes: file.size,
        }, ...prev]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be uploaded.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const onVerify = async (row: EvidenceFileRow) => {
    if (!row.storagePath) return;
    setVerifying(row.id);
    setError(null);
    try {
      const status = await verifyEvidenceFile(row.id, row.storagePath);
      setVerifyNote((prev) => ({ ...prev, [row.id]: status }));
      setStored(await listEvidenceFiles(workpaper.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be verified.');
    } finally {
      setVerifying(null);
    }
  };

  const onDownload = async (row: EvidenceFileRow) => {
    if (!row.storagePath) return;
    const url = await evidenceSignedUrl(row.storagePath);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const maxMb = Math.round(EVIDENCE_MAX_BYTES / (1024 * 1024));
  const sessionOnly = storageReady === false;

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <FileCheck className="w-4 h-4 text-verdigris" />
          <span>Evidence Vault</span>
        </div>
        <p className="text-apple-12 text-secondary" data-testid="evidence-storage-note">
          {sessionOnly
            ? 'Storage is not configured, so evidence is kept for this session only. It is not persisted and cannot be verified later.'
            : 'Each file is stored in the organisation\u2019s private evidence store, then its SHA-256 is recorded in the audit ledger. A verify re-derives the hash from the stored bytes.'}
        </p>
      </div>

      {error && (
        <p data-testid="evidence-error" className="flex items-center gap-1.5 text-apple-12 text-cinnabar">
          <AlertTriangle className="w-4 h-4" /> {error}
        </p>
      )}

      {!workpaper.sealed && (
        <div className="p-6 rounded-xl border border-dashed border-hairline bg-surface hover:bg-surface-hover transition-colors text-center cursor-pointer relative">
          <input
            type="file"
            onChange={handleFileUpload}
            disabled={isUploading}
            data-testid="evidence-upload"
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-6 h-6 text-secondary" />
            <span className="text-apple-13 font-semibold text-primary">
              {isUploading ? 'Storing file…' : 'Drop evidence file or click to browse'}
            </span>
            <span className="text-apple-11 text-secondary">
              PDF, XLSX, CSV, PNG up to {maxMb}MB • SHA-256 recorded on the ledger
            </span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          Attested Workpaper Artifacts ({stored.length + evidenceList.length})
        </h3>
        <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
          {stored.map((row) => (
            <div key={row.id} data-testid={`evidence-row-${row.id}`} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-verdigris shrink-0" />
                  <span className="text-apple-13 font-medium text-primary truncate">{row.filename}</span>
                </div>
                <div className="flex items-center gap-3 text-apple-11 text-secondary">
                  <span>{((row.byteSize ?? 0) / 1024).toFixed(1)} KB</span>
                  <span>•</span>
                  <ExplainPopout explainId="field.evidence.content_sha256" screenId="AF-11" element={`explain-evidence-hash-${row.id}`}>
                    <span className="font-mono text-tertiary">SHA: {(row.contentSha256 ?? '').slice(0, 16)}…</span>
                  </ExplainPopout>
                  {verifyNote[row.id] && (
                    <span
                      data-testid={`evidence-verify-note-${row.id}`}
                      className={verifyNote[row.id] === 'verified' ? 'text-verdigris' : 'text-cinnabar'}
                    >
                      {verifyNote[row.id] === 'verified' ? 'Re-derived: matches' : `Re-derived: ${verifyNote[row.id]}`}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> {row.verifyStatus === 'verified' ? 'Verified' : 'Stored'}
                </span>
                <button
                  type="button"
                  data-testid={`evidence-verify-${row.id}`}
                  disabled={verifying === row.id || !row.storagePath}
                  onClick={() => onVerify(row)}
                  className="px-2 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover disabled:opacity-50 flex items-center gap-1"
                >
                  <Clock className="w-3.5 h-3.5" /> {verifying === row.id ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  data-testid={`evidence-download-${row.id}`}
                  disabled={!row.storagePath}
                  onClick={() => onDownload(row)}
                  className="px-2 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover disabled:opacity-50 flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {evidenceList.map((item) => (
            <div key={item.id} data-testid={`evidence-session-${item.id}`} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-secondary shrink-0" />
                  <span className="text-apple-13 font-medium text-primary truncate">{item.name}</span>
                </div>
                <div className="flex items-center gap-3 text-apple-11 text-secondary">
                  <span>{(item.sizeBytes / 1024).toFixed(1)} KB</span>
                  <span>•</span>
                  <span>Uploaded by {item.uploadedBy}</span>
                  <span>•</span>
                  <ExplainPopout explainId="field.evidence.content_sha256" screenId="AF-11" element={`explain-evidence-hash-${item.id}`}>
                    <span className="font-mono text-tertiary">SHA: {item.sha256.slice(0, 16)}…</span>
                  </ExplainPopout>
                </div>
              </div>
              <span
                data-testid={`evidence-session-badge-${item.id}`}
                className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-surface-sunken text-secondary border border-hairline"
              >
                Session only
              </span>
            </div>
          ))}
          {stored.length === 0 && evidenceList.length === 0 && (
            <div className="p-6 text-center text-apple-12 text-secondary">
              No evidence artifacts attached yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
