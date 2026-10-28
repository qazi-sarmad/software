import React, { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeIntegrityAlert,
  ledgerContinuityCheck,
  listIntegrityAlerts,
  type IntegrityAlertRow,
} from '../../data/archival';
import {
  ALARM_BOUNDARY_NOTE,
  alertSentence,
  kindLabel,
  severityLabel,
  severityOf,
  summariseAlerts,
} from '../../lib/integrityAlarm';
import { InlineError } from '../common/InlineError';
import { AlertTriangle, Check, RefreshCw, ShieldAlert } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-29 integrity alarm (T7; docs/SYSTELIGON.md §11.3a).
 *
 * The tamper alarm's surface. Detection was complete and nothing told a human; this reads the
 * organisation's alerts through `integrity_alerts_list` (rights-gated, severity-annotated by the
 * database) and lets an integrity owner acknowledge one and re-verify the ledger chain on demand.
 *
 * BOUNDARY (never blurred): this is tamper-EVIDENCE, not tamper-prevention. It proves a change
 * happened and preserves the before/after hashes. It does not, and does not claim to, stop a person
 * with direct database access from changing a row.
 */
export const IntegrityAlarmPanel: React.FC<{ screenId?: string }> = ({ screenId = 'OA-29' }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [alerts, setAlerts] = useState<IntegrityAlertRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setAlerts(await listIntegrityAlerts());
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the integrity alerts.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const acknowledge = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await acknowledgeIntegrityAlert(id);
      if (!res.ok) setActionError(res.reason);
      else await load();
    } finally {
      setBusyId(null);
    }
  };

  const verifyLedger = async () => {
    setVerifying(true);
    setActionError(null);
    setVerifyResult(null);
    try {
      const broken = await ledgerContinuityCheck();
      setVerifyResult(
        broken === null
          ? 'The ledger chain verifies: every link is intact.'
          : `The ledger chain is BROKEN at sequence ${broken.toString()}. An incident has been raised.`
      );
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not verify the ledger chain.');
    } finally {
      setVerifying(false);
    }
  };

  const summary = summariseAlerts(alerts);

  return (
    <div className="space-y-4" data-testid={`${screenId}-panel`}>
      <div className="flex items-start gap-3 rounded-2xl border border-hairline bg-surface p-5">
        <span className={summary.incidents > 0 ? 'text-cinnabar' : 'text-accent'}>
          {summary.incidents > 0 ? (
            <ShieldAlert className="w-5 h-5" data-testid={`${screenId}-icon-incident`} />
          ) : (
            <Check className="w-5 h-5" data-testid={`${screenId}-icon-ok`} />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-apple-14 font-semibold text-primary" data-testid={`${screenId}-headline`}>
            {summary.headline}
          </h3>
          <p className="text-apple-12 text-secondary">{ALARM_BOUNDARY_NOTE}</p>
        </div>
        <button
          type="button"
          disabled={verifying}
          onClick={() => void verifyLedger()}
          data-testid={`${screenId}-verify-ledger`}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
          Verify the ledger now
        </button>
      </div>

      {verifyResult && (
        <p
          role="status"
          data-testid={`${screenId}-verify-result`}
          className="px-3 py-2 rounded-xl text-apple-12 border border-hairline bg-surface-elevated text-secondary"
        >
          {verifyResult}
        </p>
      )}

      <InlineError message={actionError} testId={`${screenId}-error`} onDismiss={() => setActionError(null)} />
      <InlineError message={state === 'error' ? loadError : null} testId={`${screenId}-load-error`} />

      {state === 'loading' ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid={`${screenId}-loading`}>
          Loading integrity alerts…
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-surface p-6 text-center" data-testid={`${screenId}-empty`}>
          <p className="text-apple-13 text-primary font-medium">No integrity alerts.</p>
          <p className="text-apple-12 text-tertiary mt-1">
            Every recorded root still matches. A new alert appears here the moment one does not.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid={`${screenId}-list`}>
          {alerts.map((a) => {
            const severity = severityOf(a.kind);
            return (
              <li
                key={a.id}
                data-testid={`${screenId}-alert-${a.id}`}
                data-severity={severity}
                className={`rounded-2xl border p-4 space-y-2 ${
                  severity === 'incident' ? 'border-cinnabar bg-cinnabar-subtle' : 'border-hairline bg-surface'
                }`}
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className={`w-4 h-4 mt-0.5 shrink-0 ${severity === 'incident' ? 'text-cinnabar' : 'text-brass'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        data-testid={`${screenId}-alert-severity-${a.id}`}
                        className={`text-apple-11 font-semibold uppercase tracking-wide ${
                          severity === 'incident' ? 'text-cinnabar' : 'text-brass'
                        }`}
                      >
                        {severityLabel(severity)}
                      </span>
                      <span className="text-apple-11 text-tertiary" data-testid={`${screenId}-alert-kind-${a.id}`}>
                        {kindLabel(a.kind)}
                      </span>
                    </div>
                    <p className="text-apple-13 text-primary mt-1" data-testid={`${screenId}-alert-sentence-${a.id}`}>
                      {alertSentence(a)}
                    </p>
                    {a.expectedHash && a.actualHash && (
                      <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-apple-11">
                        <div className="min-w-0">
                          <dt className="text-tertiary">Expected</dt>
                          <dd className="font-mono text-secondary truncate" data-testid={`${screenId}-alert-expected-${a.id}`}>
                            {a.expectedHash}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-tertiary">Actual</dt>
                          <dd className="font-mono text-secondary truncate" data-testid={`${screenId}-alert-actual-${a.id}`}>
                            {a.actualHash}
                          </dd>
                        </div>
                      </dl>
                    )}
                    {a.raisedAt && (
                      <p className="text-apple-11 text-tertiary mt-1" data-testid={`${screenId}-alert-raised-${a.id}`}>
                        Raised {a.raisedAt}
                      </p>
                    )}
                  </div>
                  {a.acknowledgedAt ? (
                    <span
                      data-testid={`${screenId}-alert-acknowledged-${a.id}`}
                      className="text-apple-11 text-tertiary shrink-0"
                    >
                      Acknowledged
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => void acknowledge(a.id)}
                      data-testid={`${screenId}-alert-acknowledge-${a.id}`}
                      className="text-apple-12 text-accent hover:underline shrink-0 disabled:opacity-50"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
