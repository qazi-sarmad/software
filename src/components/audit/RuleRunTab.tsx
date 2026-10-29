import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  listPopulationRecords,
  listPopulations,
  type PopulationRecordRead,
  type PopulationRow,
} from '../../data/population';
import { recordSysteligonFindings } from '../../data/systeligon';
import { getReleasedRulePack } from '../../data/rulePacks';
import { runRules, systeligonPopulationRules, resolveReleasedRules, type RuleFinding, type RuleInput, type RuleRunResult, type SysteligonRule } from '../../lib/systeligon';
import { ENGINE_NAME } from '../../lib/product';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { ShieldCheck, ArrowRight, Zap, AlertTriangle, CheckCircle2, Database, RefreshCw } from '../common/Icons';

/**
 * The rule-run screen (S1–S16, spec §4). This is the surface the Systeligon engine exists to feed:
 * pick a population, run the released forensic rules over it, read each finding with the rule id,
 * its version, its severity and the exact source rows it flagged, then record the findings to the
 * ledger (S13) so they sit inside the report's tamper-evident root.
 *
 * The engine is pure: `runRules` is a function of the rows, the rule set and the run instant. The
 * clock is captured here, at the moment the operator presses Run, and passed in — a rule never reads
 * it. Nothing is generated; every finding names the rule and version that produced it.
 */
interface RuleRunTabProps {
  workpaper: { engagementId: string; refCode: string };
}

export const RuleRunTab: React.FC<RuleRunTabProps> = ({ workpaper }) => {
  const { currentUser } = useApp();
  const canRun = hasRight(currentUser, 'perform_work');

  const [populations, setPopulations] = useState<PopulationRow[]>([]);
  const [populationId, setPopulationId] = useState<string | null>(null);
  const [records, setRecords] = useState<PopulationRecordRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowsBusy, setRowsBusy] = useState(false);
  // The population whose rows are in `records`. Run stays disabled until this matches the selected
  // population, so a run can never read a stale or half-loaded row set.
  const [rowsFor, setRowsFor] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<number | null>(null);
  const [result, setResult] = useState<RuleRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The released pack drives the run when one exists; the in-code library is the fallback. `packNote`
  // names which rule set ran and reports any rule the client could not reconstruct.
  const [ruleSet, setRuleSet] = useState<SysteligonRule[]>(systeligonPopulationRules);
  const [packNote, setPackNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listPopulations(workpaper.engagementId);
      setPopulations(rows);
      setPopulationId((prev) => prev ?? rows[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load populations.');
    } finally {
      setLoading(false);
    }
  }, [workpaper.engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve the released pack once, so the run uses what was released. A released pack the client
  // cannot fully reconstruct is reported, never silently swapped for the in-code default.
  useEffect(() => {
    let cancelled = false;
    getReleasedRulePack()
      .then((pack) => {
        if (cancelled || !pack) return;
        const { rules, missing } = resolveReleasedRules(pack);
        setRuleSet(rules.length ? rules : systeligonPopulationRules);
        setPackNote(
          `Running released pack ${pack.name}@${pack.version} (${rules.length} rule(s)).` +
          (missing.length ? ` ${missing.length} rule(s) could not be reconstructed: ${missing.join(', ')}.` : ''),
        );
      })
      .catch(() => { /* no pack reader available: fall back to the shipped library */ });
    return () => { cancelled = true; };
  }, []);

  // Load the selected population's rows on demand. The engine reads the values; the panel never
  // invents one — a missing amount is passed through as null and the rule reports it honestly.
  useEffect(() => {
    if (!populationId) {
      setRecords([]);
      setRowsFor(null);
      return;
    }
    let cancelled = false;
    setRowsBusy(true);
    setRowsFor(null);
    setError(null);
    listPopulationRecords(populationId)
      .then((r) => {
        if (!cancelled) {
          setRecords(r);
          setRowsFor(populationId);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the population rows.');
      })
      .finally(() => {
        if (!cancelled) setRowsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [populationId]);

  const selected = useMemo(
    () => populations.find((p) => p.id === populationId) ?? null,
    [populations, populationId],
  );

  const run = async () => {
    if (!populationId) return;
    setRunning(true);
    setError(null);
    setRecorded(null);
    try {
      const input: RuleInput = {
        rows: records.map((r) => ({
          ref: String(r.rowRef),
          values: { amount: r.amountCents, date: r.date, category: r.category },
        })),
      };
      // The run instant is captured here and passed in: the engine never reads a clock.
      const evaluatedAt = new Date().toISOString();
      setResult(runRules(ruleSet, input, { evaluatedAt }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The rule run failed.');
    } finally {
      setRunning(false);
    }
  };

  const record = async () => {
    if (!result || !populationId) return;
    setRecording(true);
    setError(null);
    try {
      const res = await recordSysteligonFindings(workpaper.engagementId, result.evaluatedAt, result.findings);
      if (!res.ok) {
        setError(res.reason);
      } else {
        setRecorded(result.findings.length);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the findings.');
    } finally {
      setRecording(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="rule-run">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <ShieldCheck className="w-4 h-4 text-verdigris" />
          <span>{ENGINE_NAME} rule run</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Deterministic forensic rules over a locked population. Every finding names the rule, its
          version and the source rows it flagged. No AI.
        </p>
        {packNote && (
          <p className="text-apple-11 text-secondary" data-testid="rule-run-pack-note">{packNote}</p>
        )}
      </div>

      {!canRun && (
        <p className="text-apple-12 text-secondary" data-testid="rule-run-rights-note">
          {rightReason('perform_work')} — you can read this screen, but running rules needs{' '}
          <span className="font-mono">perform_work</span>.
        </p>
      )}

      {loading && (
        <p className="text-apple-12 text-secondary" data-testid="rule-run-loading">
          Loading populations…
        </p>
      )}

      <InlineError message={error} testId="rule-run-error" onDismiss={() => setError(null)} />

      {!loading && populations.length === 0 && (
        <p className="text-apple-12 text-secondary" data-testid="rule-run-empty">
          This engagement has no population yet. Register and lock one in the population panel before
          running rules.
        </p>
      )}

      {!loading && populations.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-apple-11 font-medium text-secondary uppercase" htmlFor="rule-run-population">
              Population
            </label>
            <select
              id="rule-run-population"
              data-testid="rule-run-population"
              value={populationId ?? ''}
              onChange={(e) => {
                setPopulationId(e.target.value || null);
                setResult(null);
                setRecorded(null);
              }}
              className="p-2 text-apple-12 rounded bg-surface border border-hairline text-primary"
            >
              {populations.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.filename ?? p.id} — {p.rowCount ?? '?'} rows{p.status ? ` (${p.status})` : ''}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            data-testid="rule-run-run"
            disabled={!canRun || !populationId || running || rowsBusy || rowsFor !== populationId}
            onClick={() => void run()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium bg-btn-primary-bg text-btn-primary-text disabled:opacity-50"
          >
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
            Run rules
          </button>
          {selected && (
            <span className="text-apple-11 text-secondary inline-flex items-center gap-1">
              <Database className="w-3.5 h-3.5" />
              {rowsBusy ? 'reading rows…' : `${records.length} rows read`}
              {selected.sha256 ? ` · sha256 ${selected.sha256.slice(0, 12)}…` : ''}
            </span>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-apple-12" data-testid="rule-run-summary">
            <span className="inline-flex items-center gap-1 text-verdigris font-medium">
              <Zap className="w-3.5 h-3.5" /> {result.ran.length} rule(s) ran
            </span>
            <span className="inline-flex items-center gap-1 text-primary font-medium">
              <AlertTriangle className="w-3.5 h-3.5" /> {result.findings.length} finding(s)
            </span>
            <span className="text-secondary" data-testid="rule-run-skipped">
              {result.skipped.length} draft rule(s) skipped · run {result.evaluatedAt}
            </span>
          </div>

          {result.findings.length === 0 ? (
            <p className="text-apple-12 text-verdigris inline-flex items-center gap-1" data-testid="rule-run-findings-empty">
              <CheckCircle2 className="w-3.5 h-3.5" /> No rule flagged this population.
            </p>
          ) : (
            <div className="border border-hairline rounded-xl overflow-hidden bg-surface" data-testid="rule-run-findings">
              <table className="w-full text-left border-collapse text-apple-12">
                <thead>
                  <tr className="border-b border-hairline bg-surface-sunken text-secondary">
                    <th className="p-3 font-medium">Rule</th>
                    <th className="p-3 font-medium">Version</th>
                    <th className="p-3 font-medium">Severity</th>
                    <th className="p-3 font-medium">Finding</th>
                    <th className="p-3 font-medium">Source rows</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {result.findings.map((f: RuleFinding, i: number) => (
                    <tr key={`${f.ruleId}@${f.ruleVersion}-${i}`} data-testid={`rule-run-finding-${i}`} className="hover:bg-surface-hover">
                      <td className="p-3 font-mono text-primary">{f.ruleId}</td>
                      <td className="p-3 font-mono text-secondary">v{f.ruleVersion}</td>
                      <td className="p-3">
                        <span
                          className={`text-apple-11 font-semibold uppercase ${
                            f.severity === 'high' || f.severity === 'medium' ? 'text-cinnabar' : 'text-secondary'
                          }`}
                        >
                          {f.severity}
                        </span>
                      </td>
                      <td className="p-3 text-primary">{f.reason}</td>
                      <td className="p-3 font-mono text-secondary">{f.refs.length ? f.refs.join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="rule-run-record"
              disabled={!canRun || recording}
              onClick={() => void record()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {recording ? 'Recording…' : 'Record findings to the ledger'}
            </button>
            {recorded !== null && (
              <span className="text-apple-12 text-verdigris" data-testid="rule-run-recorded">
                Recorded {recorded} finding(s) to the ledger and the report root.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
