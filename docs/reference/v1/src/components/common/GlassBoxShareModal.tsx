import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { createGlassBoxTokenRecord } from '../../lib/glassbox';
import { Share2, Check, Clock, ShieldCheck, Lock } from './Icons';

export const GlassBoxShareModal: React.FC = () => {
  const { inspector, closeInspector, appendLedger, currentUser } = useApp();
  const workpaper = inspector.data?.workpaper;

  const [copied, setCopied] = useState(false);
  const [tokenLink, setTokenLink] = useState<string | null>(null);
  const [validityDays, setValidityDays] = useState(7);

  const handleGenerateLink = async () => {
    if (!workpaper) return;

    const { rawToken, record } = await createGlassBoxTokenRecord({
      workpaperId: workpaper.id,
      entityId: workpaper.entityId,
      orgId: 'provio-corp-tenant',
      validityDays,
    });

    const shareUrl = `${window.location.origin}/e/${rawToken}`;
    setTokenLink(shareUrl);

    // Ledger audit event
    await appendLedger({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      eventType: 'evidence_drop',
      entityId: workpaper.entityId,
      recordId: workpaper.id,
      recordType: 'workpaper',
      payloadSummary: `Issued GlassBox secure upload token for WP ${workpaper.refCode} (Expires in ${validityDays} days)`,
      payloadData: { tokenHash: record.tokenHash, expiresAt: record.expiresAt },
    });
  };

  const handleCopy = () => {
    if (!tokenLink) return;
    navigator.clipboard.writeText(tokenLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <Share2 className="w-4 h-4 text-verdigris" />
          <span>GlassBox — Zero-Trust Evidence Collection Portal</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Generate an ephemeral, single-use upload URL for external auditees. Uploaded files are SHA-256 hashed and attested to the ledger before storage.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-apple-12 font-medium text-secondary mb-1">
            Target Working Paper
          </label>
          <div className="p-3 rounded-lg bg-surface border border-hairline text-apple-13 font-medium text-primary">
            {workpaper?.refCode || 'WP-TREAS-01'} • {workpaper?.title || 'Treasury Intraday Liquidity'}
          </div>
        </div>

        <div>
          <label className="block text-apple-12 font-medium text-secondary mb-1">
            Token Validity Window
          </label>
          <select
            value={validityDays}
            onChange={(e) => setValidityDays(Number(e.target.value))}
            className="w-full p-2.5 rounded-lg bg-surface border border-hairline text-apple-13 text-primary focus:outline-none"
          >
            <option value={1}>24 Hours (High Security)</option>
            <option value={7}>7 Days (Standard SLA)</option>
            <option value={14}>14 Days (Extended Audit Cycle)</option>
          </select>
        </div>

        {!tokenLink ? (
          <button
            type="button"
            onClick={handleGenerateLink}
            className="w-full py-2.5 px-4 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary transition-colors flex items-center justify-center gap-2"
          >
            <Lock className="w-4 h-4 text-verdigris" />
            Generate Cryptographic Upload Token
          </button>
        ) : (
          <div className="space-y-3 p-4 rounded-xl bg-surface border border-hairline">
            <div className="flex items-center justify-between text-apple-12 text-secondary">
              <span className="font-semibold text-primary flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-verdigris" />
                Active Upload Link
              </span>
              <span className="flex items-center gap-1 text-apple-11">
                <Clock className="w-3.5 h-3.5" /> Single-Use Token
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={tokenLink}
                className="w-full p-2 rounded-lg bg-surface-sunken font-mono text-apple-11 text-secondary border border-hairline select-all"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-2 rounded-lg bg-surface-sunken border border-hairline text-apple-13 font-medium text-primary hover:bg-surface-hover transition-colors shrink-0"
              >
                {copied ? <Check className="w-4 h-4 text-verdigris" /> : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-hairline flex justify-end">
        <button
          type="button"
          onClick={closeInspector}
          className="px-4 py-2 text-apple-13 font-medium rounded-lg bg-surface border border-hairline text-primary hover:bg-surface-hover transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};
