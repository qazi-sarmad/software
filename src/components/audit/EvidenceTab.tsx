import React, { useState } from 'react';
import { WorkingPaper } from '../../types';
import { useApp } from '../../context/AppContext';
import { computeSha256 } from '../../lib/ledger';
import { Upload, FileCheck, ShieldCheck, Download, Clock } from '../common/Icons';

interface EvidenceTabProps {
  workpaper: WorkingPaper;
}

export const EvidenceTab: React.FC<EvidenceTabProps> = ({ workpaper }) => {
  const { attachEvidenceToWorkpaper, currentUser } = useApp();
  const [evidenceList, setEvidenceList] = useState(workpaper.evidenceItems || []);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || workpaper.sealed) return;

    setIsUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binaryStr = '';
      for (let i = 0; i < bytes.length; i++) {
        binaryStr += String.fromCharCode(bytes[i]);
      }
      const sha256 = await computeSha256(binaryStr);

      await attachEvidenceToWorkpaper(
        workpaper.id,
        {
          name: file.name,
          sizeBytes: file.size,
          sha256,
        },
        currentUser.name
      );

      const newItem = {
        id: `ev-${Date.now()}`,
        name: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: currentUser.name,
        sha256,
        sizeBytes: file.size,
      };

      setEvidenceList((prev) => [newItem, ...prev]);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <FileCheck className="w-4 h-4 text-verdigris" />
          <span>Cryptographic Evidence Vault &amp; Chain Attestation</span>
        </div>
        <p className="text-apple-12 text-secondary">
          All uploaded evidence documents are fingerprinted with SHA-256 in memory before attachment. Every file drop creates an immutable hash-chained event.
        </p>
      </div>

      {!workpaper.sealed && (
        <div className="p-6 rounded-xl border border-dashed border-hairline bg-surface hover:bg-surface-hover transition-colors text-center cursor-pointer relative">
          <input
            type="file"
            onChange={handleFileUpload}
            disabled={isUploading}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-6 h-6 text-secondary" />
            <span className="text-apple-13 font-semibold text-primary">
              {isUploading ? 'Computing SHA-256 & Attesting...' : 'Drop evidence file or click to browse'}
            </span>
            <span className="text-apple-11 text-secondary">
              PDF, XLSX, CSV, PNG up to 25MB • Auto-hashed with SHA-256
            </span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          Attested Workpaper Artifacts ({evidenceList.length})
        </h3>
        <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
          {evidenceList.map((item) => (
            <div key={item.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-verdigris shrink-0" />
                  <span className="text-apple-13 font-medium text-primary truncate">{item.name}</span>
                </div>
                <div className="flex items-center gap-3 text-apple-11 text-secondary">
                  <span>{(item.sizeBytes / 1024).toFixed(1)} KB</span>
                  <span>•</span>
                  <span>Uploaded by {item.uploadedBy}</span>
                  <span>•</span>
                  <span className="font-mono text-tertiary">SHA: {item.sha256.slice(0, 16)}...</span>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> Hash-Locked
                </span>
              </div>
            </div>
          ))}
          {evidenceList.length === 0 && (
            <div className="p-6 text-center text-apple-12 text-secondary">
              No evidence artifacts attached yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
