import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  incidentAction,
  incidentStorageReady,
  listIntegrityIncidents,
  openIntegrityIncident,
  verifyIntegrityIncident,
} from '../../data/incidents';
import { listIntegrityAlerts, type IntegrityAlertRow } from '../../data/archival';
import {
  INCIDENT_BOUNDARY_NOTE,
  incidentModel,
  incidentsHeadline,
  type IncidentAction,
  type IntegrityIncidentRow,
} from '../../lib/incidentWizard';
import { severityOf } from '../../lib/integrityAlarm';
import { getDemoTodayISO } from '../../lib/demoTime';
import { InlineError } from '../common/InlineError';
import { AlertTriangle, Check, Lock, RefreshCw, ShieldAlert, Upload } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-31 guided integrity incident wizard (T6; docs/SYSTELIGON.md §11.3a).
 *
 * The alarm (OA-29) detects and tells. This is the RESPONSE: it shows, in plain words, what changed,
 * when and by whom, and what it affects, then offers restore / re-derive and re-seal / freeze /
 * escalate — each requiring a reason — and re-runs verification at the end so the incident closes on
 * proof rather than assertion. Every step is appended to the incident's own append-only trail.
 *
 * BOUNDARY (never blurred): tamper-EVIDENCE, not tamper-prevention. Restoring a record re-checks that
 * it once again agrees with what was sealed; it cannot conjure back bytes that were never kept.
 *
 * Non-blocking: a panel, never a modal. Every interactive element carries an `OA-31-*` testid.
 */
export interface IncidentWizardPanelProps {
  screenId?: string;
}

/** The reason-bearing steps a human chooses. */
const STEP_ACTIONS: { action: IncidentAction; label: string; hint: string; icon: React.FC<{ className?: string }> }[] = [
  { action: 'restore', label: 'Restore from the sealed copy', hint: 'Re-check the record against what was sealed.', icon: RefreshCw },
  { action: 'rederive', label: 'Re-derive and re-seal', hint: 'Recompute the root from the facts held now.', icon: Upload },
  { action: 'freeze', label: 'Freeze the engagement', hint: 'Stop the engagement moving or sealing.', icon: Lock },
  { action: 'escalate', label: 'Escalate to the platform admin', hint: 'Tell the platform admin on every channel.', icon: ShieldAlert },
  { action: 'annotate', label: 'Add a note', hint: 'Record a finding or decision on the incident.', icon: Check },
];

export const IncidentWizardPanel: React.FC<IncidentWizardPanelProps> = ({ screenId = 'OA-31' }) => {
  const { currentUser, rawEngagements } = useApp();
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [incidents, setIncidents] = useState<IntegrityIncidentRow[]>([]);
  const [alerts, setAlerts] = useState<IntegrityAlertRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  // A build with no Supabase environment must say so rather than render an empty panel as if the org
  // were healthy — a wall of zeros is not an answer (U6).
  const storageReady = incidentStorageReady();

  // Mirror the database's own owner test (0114): review_and_approve or edit_config, or a Head. The
  // client cannot see a Head's level, so a Head session that also holds one of these rights is
  // covered; a caller without either is refused here AND, authoritatively, by every incident RPC.
  const isOwner =
    hasRight(currentUser, 'review_and_approve') || hasRight(currentUser, 'edit_config');

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [inc, al] = await Promise.all([listIntegrityIncidents(), listIntegrityAlerts()]);
      setIncidents(inc);
      setAlerts(al);
      setSelectedId((prev) => prev ?? inc[0]?.id ?? null);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the integrity incidents.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void load();
  }, [isOwner, load]);

  const today = getDemoTodayISO();
  const engagementTitle = useCallback(
    (id: string | null) => (id ? rawEngagements.find((e) => e.id === id)?.title ?? null : null),
    [rawEngagements]
  );

  const models = useMemo(
    () =>
      incidents.map((i) =>
        incidentModel({
          incident: i,
          todayIso: today,
          engagementTitle: engagementTitle(i.engagementId),
        })
      ),
    [incidents, today, engagementTitle]
  );
  const selected = models.find((m) => m.id === selectedId) ?? null;

  /** Alerts that have no incident yet — the wizard's entry points. */
  const openableAlerts = alerts.filter((a) => !incidents.some((i) => i.alertId === a.id));

  const runStep = async (action: IncidentAction) => {
    if (!selected) return;
    if (!reason.trim()) {
      setActionError('A reason is required for every step.');
      return;
    }
    setBusy(true);
    setActionError(null);
    setLastOutcome(null);
    try {
      const res = await incidentAction(selected.id, action, reason.trim());
      if (!res.ok) setActionError(res.reason);
      else {
        setLastOutcome(res.outcome);
        setReason('');
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async () => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    setLastOutcome(null);
    try {
      const res = await verifyIntegrityIncident(selected.id);
      if (!res.ok) setActionError(res.reason);
      else {
        setLastOutcome(res.outcome);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const openFromAlert = async (alertId: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await openIntegrityIncident(alertId);
      if (!res.ok) setActionError(res.reason);
      else {
        await load();
        setSelectedId(res.id);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface p-6 text-center" data-testid={`${screenId}-denied`}>
        <p className="text-apple-13 text-primary font-medium">Integrity incidents are for the organisation's integrity owners.</p>
        <p className="text-apple-12 text-tertiary mt-1">
          This needs the review_and_approve or edit_config right, or a Head role.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`${screenId}-panel`}>
      <div className="flex items-start gap-3 rounded-2xl border border-hairline bg-surface p-5">
        <span className={models.some((m) => m.status === 'open') ? 'text-cinnabar' : 'text-accent'}>
          <ShieldAlert className="w-5 h-5" data-testid={`${screenId}-icon`} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-apple-14 font-semibold text-primary" data-testid={`${screenId}-headline`}>
            {incidentsHeadline(incidents)}
          </h3>
          <p className="text-apple-12 text-secondary" data-testid={`${screenId}-boundary`}>
            {INCIDENT_BOUNDARY_NOTE}
          </p>
        </div>
      </div>

      <InlineError message={actionError} testId={`${screenId}-error`} onDismiss={() => setActionError(null)} />
      <InlineError message={state === 'error' ? loadError : null} testId={`${screenId}-load-error`} />

      {lastOutcome && (
        <p role="status" data-testid={`${screenId}-outcome`} className="px-3 py-2 rounded-xl text-apple-12 border border-hairline bg-surface-elevated text-secondary">
          Recorded outcome: <span className="font-medium text-primary">{lastOutcome}</span>
        </p>
      )}

      {/* Alerts with no incident yet: the wizard's front door. */}
      {openableAlerts.length > 0 && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid={`${screenId}-openable`}>
          <p className="text-apple-12 font-medium text-primary">Alerts with no incident yet</p>
          <ul className="space-y-1">
            {openableAlerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span className="text-apple-12 text-secondary" data-testid={`${screenId}-openable-${a.id}`}>
                  {a.objectType} {a.objectId ?? ''} — {severityOf(a.kind) === 'incident' ? 'incident' : 'warning'}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openFromAlert(a.id)}
                  data-testid={`${screenId}-open-${a.id}`}
                  className="text-apple-12 text-accent hover:underline shrink-0 disabled:opacity-50"
                >
                  Open an incident
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state === 'loading' ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid={`${screenId}-loading`}>
          Loading integrity incidents…
        </div>
      ) : !storageReady ? (
        <div className="rounded-2xl border border-hairline bg-surface p-6 text-center" data-testid={`${screenId}-unconfigured`}>
          <p className="text-apple-13 text-primary font-medium">The integrity incident module is not configured.</p>
          <p className="text-apple-12 text-tertiary mt-1">
            This build has no database connection, so no incident can be read or actioned here.
          </p>
        </div>
      ) : incidents.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface p-6 text-center" data-testid={`${screenId}-empty`}>
          <p className="text-apple-13 text-primary font-medium">No integrity incidents.</p>
          <p className="text-apple-12 text-tertiary mt-1">
            A detected tamper raises an alert; opening an incident from it starts the guided response here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ul className="space-y-2 lg:col-span-1" data-testid={`${screenId}-list`}>
            {models.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  data-testid={`${screenId}-incident-${m.id}`}
                  data-status={m.status}
                  className={`w-full text-left rounded-2xl border p-3 transition-colors ${
                    m.id === selectedId ? 'border-accent bg-accent-subtle' : 'border-hairline bg-surface hover:bg-surface-hover'
                  }`}
                >
                  <span className="flex items-center gap-2 flex-wrap">
                    <span
                      data-testid={`${screenId}-incident-status-${m.id}`}
                      className={`text-apple-11 font-semibold uppercase tracking-wide ${
                        m.status === 'resolved' ? 'text-accent' : m.status === 'mitigated' ? 'text-brass' : 'text-cinnabar'
                      }`}
                    >
                      {m.statusLabel}
                    </span>
                    <span className="text-apple-11 text-tertiary">{m.severityLabel}</span>
                  </span>
                  <span className="block text-apple-12 text-primary mt-1">{m.whatChanged}</span>
                  <span className="block text-apple-11 text-tertiary mt-0.5">Affects {m.affects} · {m.ageLabel}</span>
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <div className="lg:col-span-2 space-y-4" data-testid={`${screenId}-detail`}>
              <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
                <h4 className="text-apple-13 font-semibold text-primary" data-testid={`${screenId}-what-changed`}>
                  {selected.whatChanged}
                </h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-apple-12">
                  <div>
                    <dt className="text-tertiary text-apple-11">Affects</dt>
                    <dd className="text-secondary" data-testid={`${screenId}-affects`}>{selected.affects}</dd>
                  </div>
                  <div>
                    <dt className="text-tertiary text-apple-11">Opened</dt>
                    <dd className="text-secondary" data-testid={`${screenId}-opened`}>
                      {selected.openedAt ?? 'unknown'} · {selected.ageLabel} · by {selected.openedByLabel}
                    </dd>
                  </div>
                  {selected.expectedHash && (
                    <div className="min-w-0">
                      <dt className="text-tertiary text-apple-11">Expected</dt>
                      <dd className="font-mono text-secondary truncate" data-testid={`${screenId}-expected`}>{selected.expectedHash}</dd>
                    </div>
                  )}
                  {selected.actualHash && (
                    <div className="min-w-0">
                      <dt className="text-tertiary text-apple-11">Actual</dt>
                      <dd className="font-mono text-secondary truncate" data-testid={`${screenId}-actual`}>{selected.actualHash}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
                <p className="text-apple-12 font-medium text-primary">Take a step</p>
                <label className="block text-apple-11 text-tertiary" htmlFor={`${screenId}-reason`}>
                  Reason (required)
                </label>
                <input
                  id={`${screenId}-reason`}
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  data-testid={`${screenId}-reason`}
                  className="w-full rounded-xl border border-hairline bg-surface-elevated px-3 py-2 text-apple-12 text-primary"
                  placeholder="Why this step is being taken"
                />
                <div className="flex flex-wrap gap-2">
                  {STEP_ACTIONS.filter((s) => selected.availableActions.includes(s.action)).map((s) => (
                    <button
                      key={s.action}
                      type="button"
                      disabled={busy}
                      onClick={() => void runStep(s.action)}
                      data-testid={`${screenId}-step-${s.action}`}
                      title={s.hint}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline bg-surface-elevated text-apple-12 text-primary hover:bg-surface-hover disabled:opacity-50"
                    >
                      <s.icon className="w-3.5 h-3.5" />
                      {s.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runVerify()}
                    data-testid={`${screenId}-verify`}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                    Re-run verification
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
                <p className="text-apple-12 font-medium text-primary">The trail (append-only)</p>
                <ol className="space-y-2" data-testid={`${screenId}-trail`}>
                  {selected.steps.map((s, idx) => (
                    <li key={`${s.action}-${idx}`} className="flex items-start gap-2" data-testid={`${screenId}-trail-${idx}`}>
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-tertiary" />
                      <div className="min-w-0">
                        <p className="text-apple-12 text-primary">
                          {s.actionLabel} — {s.outcomeLabel}
                        </p>
                        {s.reason && <p className="text-apple-11 text-tertiary">{s.reason}</p>}
                        {s.at && <p className="text-apple-11 text-tertiary">{s.at}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
