import React, { useEffect, useState } from 'react';
import {
  endConsultation, formatRemaining, getActiveConsultation, secondsLeft,
  type ConsultationSession,
} from '../../data/consultation';
import { InlineError } from './InlineError';
import { Shield, Clock, X } from './Icons';

/**
 * GL-01 consultation banner (F4).
 *
 * A persistent, non-blocking banner shown to BOTH parties while a Dual Session is active: who,
 * which tier, how long is left, and an End button. A plain strip below the header — never a modal,
 * never a scrim. It polls every 5 seconds as the fallback for the Realtime stream.
 */
export const ConsultationBanner: React.FC<{ orgId?: string }> = ({ orgId }) => {
  const [session, setSession] = useState<ConsultationSession | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    const poll = () => {
      getActiveConsultation(orgId)
        .then((s) => {
          if (live) setSession(s);
        })
        .catch((err) => {
          if (live) setError(err instanceof Error ? err.message : '');
        });
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [orgId]);

  useEffect(() => {
    if (!session) return;
    const tick = () => setRemaining(secondsLeft(session.expiresAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session || dismissed) return null;

  const tier = session.kind === 'full_admin' ? 'Full admin help (tier 2)' : 'Configuration help (tier 1)';

  return (
    <div className="w-full" data-testid="consultation-banner">
      <div className="max-w-7xl mx-auto px-6 pt-3">
        <div className="flex items-center gap-3 rounded-xl border border-hairline bg-accent-subtle px-4 py-2">
          <Shield className="w-4 h-4 text-accent shrink-0" />
          <div className="flex-1 text-apple-12 text-primary">
            <span className="font-semibold">A QSCorp consultant is in this session.</span>{' '}
            {tier}. {session.status === 'requested' ? 'Waiting to be acknowledged.' : 'Active.'}
          </div>
          <span className="inline-flex items-center gap-1 text-apple-12 text-secondary" data-testid="consultation-banner-time">
            <Clock className="w-3.5 h-3.5" />
            {formatRemaining(remaining)} left
          </span>
          <button
            type="button"
            onClick={() => void endConsultation(session.id).then(() => setSession(null))}
            data-testid="consultation-banner-end"
            className="px-2.5 py-1 rounded-lg text-apple-12 text-cinnabar border border-hairline hover:bg-surface"
          >
            End
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Hide for now"
            data-testid="consultation-banner-dismiss"
            className="p-1 rounded-lg hover:bg-surface"
          >
            <X className="w-3.5 h-3.5 text-secondary" />
          </button>
        </div>
        {error && <InlineError message={error} testId="consultation-banner-error" />}
      </div>
    </div>
  );
};
