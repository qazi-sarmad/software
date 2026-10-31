import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { listIntegrityAlerts, type IntegrityAlertRow } from '../../data/archival';
import { dashboardBanner, summariseAlerts } from '../../lib/integrityAlarm';
import { hasRight } from '../../lib/rights';
import { ShieldAlert } from '../common/Icons';

/**
 * The dashboard's integrity alarm banner (T7; docs/SYSTELIGON.md §11.3a).
 *
 * The alarm has to be seen where a human already looks. This loads the organisation's alerts and, when
 * anything is unacknowledged, shows a single non-blocking banner linking to the integrity surface.
 *
 * The read is rights-gated in the database (an integrity owner is required), so a caller without the
 * right gets an error that is treated as "nothing to show" rather than a broken screen. Rights, never
 * role names.
 */
export const IntegrityAlarmBanner: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const { currentUser } = useApp();
  const [alerts, setAlerts] = useState<IntegrityAlertRow[]>([]);

  const isOwner =
    hasRight(currentUser, 'review_and_approve') ||
    hasRight(currentUser, 'edit_config') ||
    hasRight(currentUser, 'manage_engagements');

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listIntegrityAlerts();
        if (!cancelled) setAlerts(rows);
      } catch {
        // A caller without the integrity-owner right is refused by the database; that is not an
        // error state for the dashboard, it is simply no banner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  const text = dashboardBanner(alerts);
  if (!isOwner || !text) return null;
  const summary = summariseAlerts(alerts);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="DB-01-integrity-banner"
      data-severity={summary.incidents > 0 ? 'incident' : 'warning'}
      className={`w-full text-left flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors ${
        summary.incidents > 0
          ? 'border-cinnabar bg-cinnabar-subtle hover:bg-cinnabar-subtle'
          : 'border-brass bg-surface hover:bg-surface-hover'
      }`}
    >
      <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${summary.incidents > 0 ? 'text-cinnabar' : 'text-brass'}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-apple-13 font-medium text-primary" data-testid="DB-01-integrity-banner-text">
          {text}
        </span>
        <span className="block text-apple-11 text-secondary mt-0.5">
          Tamper-evidence: the trail proves what changed. Open the integrity alarm to review and
          acknowledge.
        </span>
      </span>
    </button>
  );
};
