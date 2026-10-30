import React, { useCallback, useEffect, useState } from 'react';
import { getOrgDiagnosticSnapshot, getPlatformDiagnosticSnapshot } from '../../data/diagnostics';
import {
  ORG_DIAGNOSTIC_RULES,
  PLATFORM_DIAGNOSTIC_RULES,
  runDiagnostics,
  summariseFindings,
  type DiagnosticFinding,
  type OrgDiagnosticFacts,
  type PlatformDiagnosticFacts,
} from '../../lib/diagnostics';
import { destinationForScreen, type DiagnosticDestination } from '../../lib/diagnosticNav';
import { InlineError } from '../common/InlineError';
import { AlertTriangle, Check, RefreshCw, ShieldAlert, Activity } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

interface DiagnosticPanelProps {
  scope?: 'org' | 'platform';
  screenId?: string;
  /**
   * Opens a finding's screen. Optional: the platform console runs outside the app shell and has no
   * navigation context, so it renders the screen id as plain text rather than a button that goes
   * nowhere. The dashboard supplies a callback that uses the shell's own open action.
   */
  onOpen?: (dest: DiagnosticDestination) => void;
}

/**
 * The self-diagnostic surface (spec §11.1; the owner's "diagnose itself" requirement).
 *
 * It reads a SNAPSHOT OF COUNTS AND FLAGS (Law L2 — never a row of tenant content), runs the pure
 * rule engine (`src/lib/diagnostics.ts`) over it, and reports what is wrong, how serious it is, the
 * exact numbers behind it and where to go to act. Each finding carries its rule id so a reader can
 * re-derive it; the same snapshot always yields the same findings.
 *
 * Two scopes: the org view (DB-03 dashboard surface) and the platform view (SA-02, the super admin).
 * The platform view is only requested by a platform admin; a non-admin's RPC refusal is a fact, not a
 * crash, and renders as the honest "not available" state rather than an error.
 *
 * BOUNDARY (never blurred): a diagnostic is tamper-EVIDENCE and a self-check, never a claim of
 * prevention. A finding names a fact that is wrong NOW.
 */
export const DiagnosticPanel: React.FC<DiagnosticPanelProps> = ({
  scope = 'org',
  screenId = 'DB-03',
  onOpen,
}) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [orgFacts, setOrgFacts] = useState<OrgDiagnosticFacts | null>(null);
  const [platformFacts, setPlatformFacts] = useState<PlatformDiagnosticFacts | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      if (scope === 'platform') {
        const facts = await getPlatformDiagnosticSnapshot();
        setPlatformFacts(facts);
        setState(facts === null ? 'empty' : 'ready');
      } else {
        const facts = await getOrgDiagnosticSnapshot();
        setOrgFacts(facts);
        setState(facts === null ? 'empty' : 'ready');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read the diagnostic snapshot.');
      setState('error');
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const findings: DiagnosticFinding[] = (() => {
    if (scope === 'platform') {
      return platformFacts ? runDiagnostics(PLATFORM_DIAGNOSTIC_RULES, platformFacts) : [];
    }
    return orgFacts ? runDiagnostics(ORG_DIAGNOSTIC_RULES, orgFacts) : [];
  })();
  const summary = summariseFindings(findings);

  if (state === 'loading') {
    return (
      <div
        className="p-5 rounded-2xl bg-surface-sunken border border-hairline animate-pulse h-24"
        data-testid="diagnostic-loading"
      />
    );
  }

  if (state === 'empty') {
    return (
      <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-1" data-testid="diagnostic-unavailable">
        <div className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Activity className="w-4 h-4 text-secondary" /> Self-diagnostic
        </div>
        <p className="text-apple-12 text-secondary">
          {scope === 'platform'
            ? 'The platform diagnostic is available to platform administrators only.'
            : 'The diagnostic snapshot is not available in this environment.'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-4" data-testid="diagnostic-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-apple-13 font-semibold text-primary flex items-center gap-2">
            <Activity className="w-4 h-4 text-secondary" />
            Self-diagnostic <span className="text-tertiary text-apple-11">{screenId}</span>
          </div>
          <p className="text-apple-12 text-secondary" data-testid="diagnostic-headline">
            {summary.headline}
          </p>
        </div>
        <button
          type="button"
          data-testid="diagnostic-refresh"
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Re-run
        </button>
      </div>

      <InlineError message={state === 'error' ? loadError : null} testId="diagnostic-error" />

      <div className="flex items-center gap-3 text-apple-11 tabular-nums" data-testid="diagnostic-counts">
        <span className="text-critical">{summary.critical} critical</span>
        <span className="text-secondary">{summary.warning} warning</span>
        <span className="text-tertiary">{summary.info} info</span>
        {(scope === 'platform' ? platformFacts?.as_of : orgFacts?.as_of) ? (
          <span className="text-tertiary">
            as of {scope === 'platform' ? platformFacts?.as_of : orgFacts?.as_of}
          </span>
        ) : null}
      </div>

      {findings.length === 0 ? (
        <div className="flex items-center gap-2 text-apple-12 text-verdigris" data-testid="diagnostic-clean">
          <Check className="w-4 h-4" /> Every check passed on this snapshot.
        </div>
      ) : (
        <ul className="divide-y divide-hairline" data-testid="diagnostic-findings">
          {findings.map((f) => {
            const dest = destinationForScreen(f.screenId);
            const tone = f.severity === 'critical' ? 'text-critical' : f.severity === 'warning' ? 'text-secondary' : 'text-tertiary';
            return (
              <li key={f.ruleId} className="py-3" data-testid={`diagnostic-finding-${f.ruleId}`}>
                <div className="flex items-start gap-2">
                  {f.severity === 'critical' ? (
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-critical" />
                  ) : (
                    <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${tone}`} />
                  )}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-apple-13 font-semibold ${tone}`} data-testid={`diagnostic-title-${f.ruleId}`}>
                        {f.title}
                      </span>
                      <span className="text-apple-10 font-mono text-tertiary" data-testid={`diagnostic-rule-${f.ruleId}`}>
                        {f.ruleId}
                      </span>
                      <span className="text-apple-10 font-mono text-tertiary" data-testid={`diagnostic-screen-${f.ruleId}`}>
                        {f.screenId ?? '—'}
                      </span>
                    </div>
                    <p className="text-apple-12 text-secondary">{f.detail}</p>
                    <p className="text-apple-12 text-primary">→ {f.remedy}</p>
                    <div className="text-apple-10 font-mono text-tertiary" data-testid={`diagnostic-evidence-${f.ruleId}`}>
                      evidence:{' '}
                      {Object.entries(f.evidence)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(' ')}
                    </div>
                  </div>
                  {dest && onOpen && (
                    <button
                      type="button"
                      data-testid={`diagnostic-open-${f.ruleId}`}
                      onClick={() => onOpen(dest)}
                      className="px-2.5 py-1 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-11 font-semibold text-primary shrink-0"
                    >
                      Open {f.screenId}
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
