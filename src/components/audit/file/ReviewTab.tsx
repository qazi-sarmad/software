import React from 'react';
import { AuditEngagement } from '../../../types';
import { GateSummary, SignOffState } from '../../../lib/auditFile';
import { CheckCircle2, FileText, ShieldCheck } from '../../common/Icons';

interface ReviewTabProps {
  engagement: AuditEngagement;
  gate: GateSummary;
  signOff: SignOffState;
  onSignOff: () => void;
}

export const ReviewTab: React.FC<ReviewTabProps> = ({ engagement, gate, signOff, onSignOff }) => (
  <div className="space-y-6" data-testid="audit-file-review">
    <div className="p-5 rounded-2xl bg-surface-elevated border border-hairline space-y-2">
      <div className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">Seal gate</div>
      <div className="flex items-baseline gap-2">
        <span className="font-serif-numeral text-apple-28 font-bold text-primary tabular-nums" data-testid="gate-count">
          {gate.sealed} / {gate.total}
        </span>
        <span className="text-apple-12 text-secondary">working papers sealed</span>
      </div>
      <div className="text-apple-12 text-secondary">
        {gate.allSealed
          ? 'All papers are sealed. The engagement is ready for attestation.'
          : gate.total === 0
          ? 'There are no working papers yet.'
          : `${gate.unsealed} paper${gate.unsealed === 1 ? '' : 's'} must be sealed before sign-off.`}
      </div>
    </div>

    <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-3">
      <div className="text-apple-13 font-semibold text-primary">Engagement sign-off</div>
      {engagement.status === 'signed_off' ? (
        <div className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-2" data-testid="signed-off-note">
          <ShieldCheck className="w-4 h-4" /> Signed off{engagement.signedOffBy ? ` by ${engagement.signedOffBy}` : ''}. This file is read-only.
        </div>
      ) : (
        <>
          <button
            type="button"
            data-testid="signoff-button"
            onClick={onSignOff}
            disabled={!signOff.enabled}
            title={signOff.enabled ? undefined : signOff.reason}
            className="px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-verdigris" />
            <span>Sign-Off Engagement File</span>
          </button>
          {!signOff.enabled && signOff.reason && (
            <div className="text-apple-11 text-secondary" data-testid="signoff-reason">{signOff.reason}</div>
          )}
        </>
      )}
    </div>

    <div className="p-5 rounded-2xl bg-surface-sunken border border-hairline flex items-start gap-3" data-testid="report-pack-placeholder">
      <FileText className="w-4 h-4 text-secondary mt-0.5 shrink-0" />
      <div>
        <div className="text-apple-13 font-semibold text-primary">Report pack</div>
        <div className="text-apple-12 text-secondary">
          The report pack follows the organization's report format and is not available yet.
        </div>
      </div>
    </div>
  </div>
);
