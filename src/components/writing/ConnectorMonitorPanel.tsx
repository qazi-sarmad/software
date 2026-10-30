import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import {
  listAlerts, listConnectorInstances, listConnectorRuns, listMonitorRules, listStagedRecords,
  releaseMonitorRule, saveConnectorInstance, saveMonitorRule, triageAlert, connectorEgressAllowed,
  type AlertRow, type ConnectorInstanceRow, type ConnectorRunRow, type MonitorRuleRow, type StagedRecordRow,
} from '../../data/writing';
import { catalogue, connectorById } from '../../lib/writing/connectorCatalogue';
import { MONITOR_KINDS } from '../../lib/writing/monitors';
import type { ConnectorInstance } from '../../lib/writing/connectors';
import { browserTransport, runConnector } from '../../data/connectors';
import { AlertActionsPanel } from './AlertActionsPanel';

type LoadState = 'loading' | 'ready' | 'error';
type Tab = 'catalogue' | 'runs' | 'staged' | 'rules' | 'alerts';

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

/**
 * Connectors and continuous monitoring (W11, W11.6, W12).
 *
 * Five tabs in one panel: the connector catalogue and instance setup (mapping through dropdowns, never
 * raw JSON), run history and health, the staged-record browser, the monitor rules, and the alert
 * triage queue with a detail pane showing the alert's lineage. Every write goes through an RPC; the
 * credential is a reference the platform stores, never a value this screen sees.
 */
export const ConnectorMonitorPanel: React.FC<{ prefix?: string; initialTab?: Tab }> = ({
  prefix = 'wk-connectors', initialTab = 'catalogue',
}) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canEdit = hasRight(currentUser, 'edit_config');
  const entries = catalogue();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [instances, setInstances] = useState<ConnectorInstanceRow[]>([]);
  const [runs, setRuns] = useState<ConnectorRunRow[]>([]);
  const [staged, setStaged] = useState<StagedRecordRow[]>([]);
  const [rules, setRules] = useState<MonitorRuleRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [draft, setDraft] = useState({ connectorId: entries[0]?.id ?? '', label: '', credentialRef: '' });
  const [ruleDraft, setRuleDraft] = useState({ ruleId: '', kind: MONITOR_KINDS[0] as string, description: '' });
  const [triage, setTriage] = useState<{ alertId: string; disposition: AlertRow['disposition']; reason: string; snoozeUntil: string } | null>(null);
  const [egressHost, setEgressHost] = useState('');
  const [egressOk, setEgressOk] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [i, r, s, m, a] = await Promise.all([
        listConnectorInstances(orgId), listConnectorRuns(orgId), listStagedRecords(orgId),
        listMonitorRules(orgId), listAlerts(orgId),
      ]);
      setInstances(i); setRuns(r); setStaged(s); setRules(m); setAlerts(a);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load connectors.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setResult(null);
    const r = await action();
    setResult(r.ok ? 'Saved.' : (r.reason ?? 'The change was refused.'));
    if (r.ok) await load();
  };

  const [running, setRunning] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /**
   * Run one connector instance now: fetch through the egress-checked browser transport, map each row,
   * stage it, and record the run. The run is closed whatever happens, so the instance is never left
   * 'running'. Nothing is reported as staged unless the RPC said the row was inserted.
   */
  const runNow = async (row: ConnectorInstanceRow) => {
    const connector = connectorById(row.connectorId);
    if (!connector) { setRunMessage({ ok: false, text: `No adapter is registered for ${row.connectorId}.` }); return; }
    const base = typeof row.config.base_url === 'string' ? row.config.base_url : '';
    let host = '';
    try { host = base ? new URL(base).host : ''; } catch { host = ''; }
    if (!host) { setRunMessage({ ok: false, text: 'The instance has no valid base URL to fetch from.' }); return; }
    setRunning(row.id);
    setRunMessage(null);
    const instance: ConnectorInstance = {
      id: row.id, orgId, connectorId: row.connectorId, config: row.config as Record<string, string>,
      cursor: { value: null }, enabled: row.enabled,
    };
    const r = await runConnector({
      orgId, connector, instance, transport: browserTransport([host]),
      fetchedAt: new Date().toISOString(),
    });
    setRunning(null);
    setRunMessage(r.ok
      ? { ok: true, text: `Run finished: fetched ${r.fetched}, staged ${r.staged}, skipped ${r.skipped}.` }
      : { ok: false, text: `Run refused: ${r.reason ?? 'unknown reason'}` });
    await load();
  };

  if (state === 'loading') {
    return <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-loading`}>Loading connectors…</div>;
  }
  if (state === 'error') {
    return (
      <div className="p-4 space-y-2" data-testid={`${prefix}-error`}>
        <InlineError message={loadError} testId={`${prefix}-error-message`} />
        <button type="button" className="text-apple-12 underline text-secondary" data-testid={`${prefix}-retry`} onClick={() => void load()}>Retry</button>
      </div>
    );
  }

  const alert = alerts.find((a) => a.alertId === selectedAlert) ?? null;

  return (
    <div className="space-y-4" data-testid={`${prefix}-panel`}>
      <InlineError message={result && result !== 'Saved.' ? result : null} testId={`${prefix}-result`} />
      {result === 'Saved.' && <div className="text-apple-12 text-verdigris" data-testid={`${prefix}-saved`}>Saved.</div>}
      {runMessage && (
        runMessage.ok
          ? <div className="text-apple-12 text-verdigris" data-testid={`${prefix}-run-result`}>{runMessage.text}</div>
          : <InlineError message={runMessage.text} testId={`${prefix}-run-result`} />
      )}
      <div className="flex items-center gap-1 flex-wrap" role="tablist" aria-label="Connectors and monitoring">
        {([['catalogue', 'Catalogue'], ['runs', 'Runs'], ['staged', 'Staged records'], ['rules', 'Monitor rules'], ['alerts', 'Alerts']] as const).map(([id, lbl]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`${prefix}-tab-${id}`}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold border ${tab === id ? 'bg-surface-hover border-accent text-primary' : 'bg-surface border-hairline text-secondary'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'catalogue' && (
        <div className="space-y-4" data-testid={`${prefix}-catalogue`}>
          <div className="p-4 rounded-2xl bg-surface border border-hairline space-y-3" data-testid={`${prefix}-new`}>
            <div className="text-apple-13 font-semibold text-primary">Add a connector instance</div>
            <Select ariaLabel="Connector" testId={`${prefix}-connector`} value={draft.connectorId}
              onChange={(v) => setDraft((d) => ({ ...d, connectorId: v }))}
              options={entries.map((c) => ({ value: c.id, label: `${c.label} (${c.kind})`, hint: c.liveVerified ? 'live-verified' : 'fixture-verified' }))} />
            <input type="text" placeholder="Instance label" data-testid={`${prefix}-label`}
              className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
              value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
            <input type="text" placeholder="Credential reference (stored by the platform)" data-testid={`${prefix}-credential`}
              className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
              value={draft.credentialRef} onChange={(e) => setDraft((d) => ({ ...d, credentialRef: e.target.value }))} />
            <button type="button" data-testid={`${prefix}-save`} disabled={!canEdit || !draft.label.trim()}
              className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-13 font-semibold disabled:opacity-50"
              onClick={() => void run(() => saveConnectorInstance(orgId, null, draft.connectorId, draft.label, {}, draft.credentialRef || null))}>
              Save instance
            </button>
          </div>
          <div className="p-4 rounded-2xl bg-surface border border-hairline space-y-2" data-testid={`${prefix}-egress`}>
            <div className="text-apple-13 font-semibold text-primary">Egress allow-list check</div>
            <div className="flex items-center gap-2">
              <input type="text" placeholder="host.example" data-testid={`${prefix}-egress-host`}
                className="flex-1 rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
                value={egressHost} onChange={(e) => setEgressHost(e.target.value)} />
              <button type="button" data-testid={`${prefix}-egress-check`} disabled={!egressHost.trim()}
                className="px-3 py-2 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold disabled:opacity-50"
                onClick={() => void connectorEgressAllowed(orgId, egressHost).then(setEgressOk).catch(() => setEgressOk(false))}>
                Check
              </button>
            </div>
            {egressOk !== null && (
              <div className="text-apple-12 text-secondary" data-testid={`${prefix}-egress-result`}>
                {egressOk ? 'The host is on the allow-list.' : 'The host is not on the allow-list; a run would be refused.'}
              </div>
            )}
          </div>
          {instances.length === 0 ? (
            <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-empty`}>No connector instances yet.</div>
          ) : (
            <ul className="space-y-2" data-testid={`${prefix}-instances`}>
              {instances.map((i) => (
                <li key={i.id} className="p-3 rounded-xl border border-hairline bg-surface" data-testid={`${prefix}-instance-${i.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-apple-13 text-primary font-medium">{i.label}</span>
                    <span className="text-apple-11 uppercase tracking-wide text-secondary" data-testid={`${prefix}-instance-${i.id}-health`}>{i.health}</span>
                  </div>
                  <div className="text-apple-11 text-secondary">{i.connectorId}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!canEdit || running !== null}
                      onClick={() => void runNow(i)}
                      data-testid={`${prefix}-instance-${i.id}-run`}
                      className="px-3 py-1.5 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold disabled:opacity-50"
                    >
                      {running === i.id ? 'Running…' : 'Run now'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'runs' && (
        <div className="space-y-2" data-testid={`${prefix}-runs`}>
          {runs.length === 0 ? (
            <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-runs-empty`}>No runs recorded.</div>
          ) : runs.map((r) => (
            <div key={r.id} className="p-3 rounded-xl border border-hairline bg-surface flex items-center justify-between gap-2" data-testid={`${prefix}-run-${r.id}`}>
              <div className="min-w-0">
                <div className="text-apple-12 text-primary">{r.startedAt}</div>
                <div className="text-apple-11 text-secondary truncate">{r.detail || r.error || '—'}</div>
              </div>
              <div className="text-apple-11 text-secondary shrink-0" data-testid={`${prefix}-run-${r.id}-counts`}>
                {r.status} · {r.rowsFetched} fetched · {r.rowsStaged} staged · {r.rowsSkipped} skipped
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'staged' && (
        <div className="space-y-2" data-testid={`${prefix}-staged`}>
          {staged.length === 0 ? (
            <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-staged-empty`}>No staged records.</div>
          ) : staged.map((s) => (
            <div key={s.id} className="p-3 rounded-xl border border-hairline bg-surface" data-testid={`${prefix}-staged-${s.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-apple-12 text-primary">{s.source} · {s.sourceId}</span>
                <span className="text-apple-11 text-secondary" data-testid={`${prefix}-staged-${s.id}-hash`}>{s.contentHash.slice(0, 12)}…</span>
              </div>
              <div className="text-apple-11 text-secondary">{s.fetchedAt}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-4" data-testid={`${prefix}-rules`}>
          <div className="p-4 rounded-2xl bg-surface border border-hairline space-y-3" data-testid={`${prefix}-rule-new`}>
            <div className="text-apple-13 font-semibold text-primary">New monitor rule</div>
            <input type="text" placeholder="Rule id (e.g. m.threshold)" data-testid={`${prefix}-rule-id`}
              className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
              value={ruleDraft.ruleId} onChange={(e) => setRuleDraft((d) => ({ ...d, ruleId: e.target.value }))} />
            <Select ariaLabel="Monitor kind" testId={`${prefix}-rule-kind`} value={ruleDraft.kind}
              onChange={(v) => setRuleDraft((d) => ({ ...d, kind: v }))}
              options={MONITOR_KINDS.map((k) => ({ value: k, label: label(k) }))} />
            <input type="text" placeholder="Plain-words description" data-testid={`${prefix}-rule-description`}
              className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
              value={ruleDraft.description} onChange={(e) => setRuleDraft((d) => ({ ...d, description: e.target.value }))} />
            <button type="button" data-testid={`${prefix}-rule-save`} disabled={!canEdit || !ruleDraft.ruleId.trim()}
              className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-13 font-semibold disabled:opacity-50"
              onClick={() => void run(() => saveMonitorRule(orgId, ruleDraft.ruleId, ruleDraft.kind, ruleDraft.description, {}, ''))}>
              Save as draft
            </button>
          </div>
          {rules.length === 0 ? (
            <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-rules-empty`}>No monitor rules.</div>
          ) : (
            <ul className="space-y-2" data-testid={`${prefix}-rules-list`}>
              {rules.map((r) => (
                <li key={r.id} className="p-3 rounded-xl border border-hairline bg-surface flex items-center justify-between gap-2" data-testid={`${prefix}-rule-${r.ruleId}`}>
                  <div className="min-w-0">
                    <div className="text-apple-13 text-primary">{r.ruleId} · v{r.version}</div>
                    <div className="text-apple-11 text-secondary truncate">{r.description || r.kind}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-apple-11 uppercase text-secondary" data-testid={`${prefix}-rule-${r.ruleId}-status`}>{r.status}</span>
                    {r.status === 'draft' && (
                      <button type="button" data-testid={`${prefix}-rule-${r.ruleId}-release`}
                        className="px-2 py-1 rounded-lg bg-accent-subtle text-primary text-apple-11 font-semibold"
                        onClick={() => void run(() => releaseMonitorRule(r.id))}>Release</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'alerts' && (
        <div className="space-y-3" data-testid={`${prefix}-alerts`}>
          {alerts.length === 0 ? (
            <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-alerts-empty`}>No alerts.</div>
          ) : (
            <ul className="space-y-2" data-testid={`${prefix}-alerts-list`}>
              {alerts.map((a) => (
                <li key={a.alertId}>
                  <button type="button" data-testid={`${prefix}-alert-${a.alertId}`}
                    onClick={() => setSelectedAlert(a.alertId)}
                    className="w-full text-left p-3 rounded-xl border border-hairline bg-surface">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-apple-12 text-primary">{a.ruleId} · {a.kind}</span>
                      <span className="text-apple-11 uppercase text-secondary" data-testid={`${prefix}-alert-${a.alertId}-disposition`}>{a.disposition}</span>
                    </div>
                    <div className="text-apple-11 text-secondary truncate">{a.reason}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {alert && (
            <div className="p-4 rounded-2xl bg-surface border border-hairline space-y-2" data-testid={`${prefix}-alert-detail`}>
              <div className="text-apple-13 font-semibold text-primary">{alert.ruleId} v{alert.ruleVersion}</div>
              <div className="text-apple-12 text-secondary" data-testid={`${prefix}-alert-detail-reason`}>{alert.reason}</div>
              {/* C2 enrichment: what the alert is about, so it can be acted on. Absent when the
                  alert has no linked records (an internal signal, a connector staging outside a
                  population); the block simply does not render. */}
              {(alert.department || alert.entityId || alert.residualBand || alert.inherentRiskLabel) && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-apple-11" data-testid={`${prefix}-alert-detail-enrichment`}>
                  {alert.department && (
                    <div><dt className="text-secondary">Department</dt>
                      <dd className="text-primary" data-testid={`${prefix}-alert-detail-department`}>{alert.department}</dd></div>
                  )}
                  {alert.inherentRiskLabel && (
                    <div><dt className="text-secondary">Inherent risk</dt>
                      <dd className="text-primary" data-testid={`${prefix}-alert-detail-inherent`}>{alert.inherentRiskLabel}</dd></div>
                  )}
                  {alert.residualBand && (
                    <div><dt className="text-secondary">SIRA residual risk</dt>
                      <dd className="text-primary" data-testid={`${prefix}-alert-detail-residual`}>
                        {alert.residualBand}{alert.residualRisk != null ? ` (${alert.residualRisk})` : ''}</dd></div>
                  )}
                  {alert.siraRiskName && (
                    <div><dt className="text-secondary">Risk</dt>
                      <dd className="text-primary" data-testid={`${prefix}-alert-detail-risk`}>{alert.siraRiskName}</dd></div>
                  )}
                  {alert.controlIds.length > 0 && (
                    <div><dt className="text-secondary">Affected controls</dt>
                      <dd className="text-primary" data-testid={`${prefix}-alert-detail-controls`}>{alert.controlIds.length}</dd></div>
                  )}
                </dl>
              )}
              <div className="text-apple-11 text-secondary" data-testid={`${prefix}-alert-detail-lineage`}>lineage {alert.lineageHash.slice(0, 16)}… · chain {alert.hash.slice(0, 16)}…</div>
              <div className="flex items-center gap-2 flex-wrap">
                {(['dismissed', 'snoozed', 'escalated'] as const).map((d) => (
                  <button key={d} type="button" data-testid={`${prefix}-alert-${alert.alertId}-${d}`}
                    className="px-3 py-1.5 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold"
                    onClick={() => setTriage({ alertId: alert.alertId, disposition: d, reason: '', snoozeUntil: '' })}>
                    {label(d)}
                  </button>
                ))}
              </div>
              {triage?.alertId === alert.alertId && (
                <div className="space-y-2" data-testid={`${prefix}-alert-triage-form`}>
                  <input type="text" placeholder="Reason (required to dismiss)" data-testid={`${prefix}-alert-triage-reason`}
                    className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
                    value={triage.reason} onChange={(e) => setTriage({ ...triage, reason: e.target.value })} />
                  {triage.disposition === 'snoozed' && (
                    <input type="text" placeholder="Snooze until (ISO date)" data-testid={`${prefix}-alert-triage-snooze`}
                      className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
                      value={triage.snoozeUntil} onChange={(e) => setTriage({ ...triage, snoozeUntil: e.target.value })} />
                  )}
                  <button type="button" data-testid={`${prefix}-alert-triage-save`}
                    className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-13 font-semibold"
                    onClick={() => void run(() => triageAlert(orgId, triage.alertId, triage.disposition,
                      triage.reason || null, triage.snoozeUntil || null))}>
                    Record disposition
                  </button>
                </div>
              )}
              {/* C4/C5/C6: what the triager can DO with the alert, pre-filled from the enrichment. */}
              <AlertActionsPanel prefix={`${prefix}-actions`} alert={alert} onDone={() => void load()} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
