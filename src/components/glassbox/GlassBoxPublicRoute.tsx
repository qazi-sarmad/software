import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  validateGlassBoxToken,
  validateEvidenceFile,
} from '../../lib/glassbox';
import { computeSha256 } from '../../lib/ledger';
import { GlassBoxToken } from '../../types';
import {
  ShieldCheck,
  ShieldAlert,
  Upload,
  FileCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Lock,
} from '../common/Icons';

interface GlassBoxPublicRouteProps {
  tokenFromUrl?: string;
}

export const GlassBoxPublicRoute: React.FC<GlassBoxPublicRouteProps> = ({ tokenFromUrl }) => {
  const { glassBoxTokens, appendLedger, rawWorkpapers } = useApp();

  // Extract token from prop or URL pathname (/e/:token) or query (?token=)
  const token = tokenFromUrl || (() => {
    if (typeof window === 'undefined') return '';
    const path = window.location.pathname;
    const match = path.match(/\/e\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
  })();

  const [validationState, setValidationState] = useState<{
    loading: boolean;
    valid: boolean;
    record?: GlassBoxToken;
    error?: string;
  }>({ loading: true, valid: false });

  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<{
    fileName: string;
    sha256: string;
    sizeBytes: number;
    timestamp: string;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setValidationState({
        loading: false,
        valid: false,
        error: 'No authentication token provided in portal link.',
      });
      return;
    }

    validateGlassBoxToken(token, 'provio-corp-tenant', glassBoxTokens).then((res) => {
      if (!isMounted) return;
      if (res.valid && res.record) {
        setValidationState({
          loading: false,
          valid: true,
          record: res.record,
        });
      } else {
        setValidationState({
          loading: false,
          valid: false,
          error: res.error || 'Token validation failed.',
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [token, glassBoxTokens]);

  const handleFileDrop = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !validationState.record) return;

    setFileError(null);
    const fileValidation = validateEvidenceFile(file.name, file.size, validationState.record);
    if (!fileValidation.allowed) {
      setFileError(fileValidation.error || 'File not permitted.');
      return;
    }

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binaryStr = '';
      for (let i = 0; i < bytes.length; i++) {
        binaryStr += String.fromCharCode(bytes[i]);
      }
      const sha256 = await computeSha256(binaryStr);
      const timestamp = new Date().toISOString();

      // Append immutable ledger event
      await appendLedger({
        actorId: 'auditee-external',
        actorName: 'External Auditee (GlassBox)',
        actorRole: 'auditee',
        eventType: 'evidence_drop',
        entityId: validationState.record.entityId,
        recordId: validationState.record.workpaperId,
        recordType: 'evidence',
        payloadSummary: `GlassBox secure submission: ${file.name} (SHA: ${sha256.slice(0, 16)}...)`,
        payloadHash: sha256,
      });

      // Mark token as used
      validationState.record.used = true;
      validationState.record.usedAt = timestamp;

      setUploadSuccess({
        fileName: file.name,
        sha256,
        sizeBytes: file.size,
        timestamp,
      });
    } catch (err: any) {
      setFileError(err.message || 'Error processing evidence upload.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const targetWp = validationState.record
    ? rawWorkpapers.find((w) => w.id === validationState.record?.workpaperId)
    : null;

  return (
    <div className="min-h-screen bg-canvas text-primary flex flex-col justify-center items-center p-6 select-none">
      <div className="w-full max-w-xl bg-surface border border-hairline rounded-3xl shadow-apple p-8 space-y-6">
        {/* Brand header */}
        <div className="flex items-center justify-between border-b border-hairline pb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary text-canvas flex items-center justify-center font-bold text-apple-17 font-serif-title shadow-xs">
              P
            </div>
            <div>
              <h1 className="font-serif-title text-apple-20 font-bold text-primary">Provio GlassBox</h1>
              <p className="text-apple-11 text-secondary uppercase tracking-wider font-semibold">
                Zero-Trust Auditee Submission Portal
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
            <Lock className="w-3 h-3" /> Encrypted Link
          </span>
        </div>

        {/* Loading state */}
        {validationState.loading && (
          <div className="py-12 text-center text-secondary text-apple-13 space-y-2">
            <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full mx-auto" />
            <p>Verifying cryptographic upload credentials…</p>
          </div>
        )}

        {/* Invalid or Expired Token State */}
        {!validationState.loading && !validationState.valid && (
          <div className="p-6 rounded-2xl bg-cinnabar-subtle border border-cinnabar space-y-3 text-center">
            <ShieldAlert className="w-10 h-10 text-cinnabar mx-auto stroke-[1.5]" />
            <h2 className="text-apple-17 font-bold text-cinnabar">Access Link Invalid or Expired</h2>
            <p className="text-apple-13 text-secondary max-w-md mx-auto">
              {validationState.error || 'This upload link is no longer valid or has already been consumed.'}
            </p>
            <div className="text-apple-11 text-tertiary pt-2">
              For security, GlassBox links expire after 7 days and can only be used once. Please contact your audit engagement lead to request a new token.
            </div>
          </div>
        )}

        {/* Valid Token: Upload Form or Confirmation */}
        {!validationState.loading && validationState.valid && validationState.record && (
          <>
            {uploadSuccess ? (
              <div className="p-6 rounded-2xl bg-verdigris-subtle border border-verdigris space-y-4 text-center">
                <ShieldCheck className="w-12 h-12 text-verdigris mx-auto stroke-[1.5]" />
                <div className="space-y-1">
                  <h2 className="text-apple-17 font-bold text-verdigris">Evidence Attested &amp; Sealed</h2>
                  <p className="text-apple-13 text-secondary">
                    Your evidence artifact was SHA-256 fingerprinted and committed to the immutable audit ledger.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-surface border border-hairline text-left space-y-2 font-mono text-apple-11">
                  <div className="flex justify-between text-secondary">
                    <span>File:</span>
                    <span className="text-primary font-semibold">{uploadSuccess.fileName}</span>
                  </div>
                  <div className="flex justify-between text-secondary">
                    <span>Size:</span>
                    <span className="text-primary">{(uploadSuccess.sizeBytes / 1024).toFixed(1)} KB</span>
                  </div>
                  <div className="flex justify-between text-secondary">
                    <span>SHA-256:</span>
                    <span className="text-primary truncate max-w-xs">{uploadSuccess.sha256}</span>
                  </div>
                  <div className="flex justify-between text-secondary">
                    <span>Committed:</span>
                    <span className="text-primary">{new Date(uploadSuccess.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                <p className="text-apple-11 text-secondary">
                  This link has now been permanently retired (single-use guarantee). You may close this window.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Audit Context */}
                <div className="p-4 rounded-2xl bg-surface-elevated border border-hairline space-y-1.5">
                  <div className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
                    Target Audit Working Paper
                  </div>
                  <div className="text-apple-15 font-semibold text-primary">
                    {targetWp?.refCode || validationState.record.workpaperId} — {targetWp?.title || 'Audit Evidence Request'}
                  </div>
                  <p className="text-apple-12 text-secondary">
                    {targetWp?.objective || 'Please submit the requested population sample files or reports.'}
                  </p>
                </div>

                {/* Dropzone */}
                <div className="p-8 rounded-2xl border-2 border-dashed border-hairline hover:border-accent bg-surface-sunken hover:bg-surface-hover transition-colors text-center relative cursor-pointer group">
                  <input
                    type="file"
                    onChange={handleFileDrop}
                    disabled={uploading}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-surface border border-hairline flex items-center justify-center text-accent group-hover:scale-105 transition-transform">
                      <Upload className="w-6 h-6 stroke-[1.5]" />
                    </div>
                    <div>
                      <span className="text-apple-14 font-semibold text-primary">
                        {uploading ? 'Calculating SHA-256 & Attesting...' : 'Drop file here or click to browse'}
                      </span>
                      <p className="text-apple-11 text-secondary mt-1">
                        Allowed: {validationState.record.allowedExtensions.join(', ')} • Max {(validationState.record.maxSizeBytes / (1024 * 1024)).toFixed(0)} MB
                      </p>
                    </div>
                  </div>
                </div>

                {fileError && (
                  <div className="p-3.5 rounded-xl bg-cinnabar-subtle border border-cinnabar text-apple-12 text-cinnabar flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 stroke-[2] shrink-0" />
                    <span>{fileError}</span>
                  </div>
                )}

                <div className="p-3.5 rounded-xl bg-surface-elevated border border-hairline flex items-center justify-between text-apple-11 text-secondary">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-accent" />
                    <span>Expires: {new Date(validationState.record.expiresAt).toLocaleDateString()}</span>
                  </span>
                  <span>Single-use attested upload</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
export default GlassBoxPublicRoute;
