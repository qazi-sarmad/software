import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  listEvidenceRecords,
  listPopulationRecords,
  type PopulationRecordRead,
} from '../../data/population';
import {
  applyFloor,
  buildAcceptedTestingSet,
  carriedOverrides,
  parsePastedBlock,
  requiredRowsFromFindings,
  verifyRows,
  type CarriedOverride,
  type PopulationRow as FlowPopulationRow,
  type RowDecision,
  type RowVerification,
  type TestedRow,
  type VerificationMode,
} from '../../lib/systeligon';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { ArrowRight, CheckCircle2, ClipboardList, RefreshCw, ShieldCheck } from '../common/Icons';

/**
 * The accepted / declined testing flow and Mode A/B verification (S3/S4/S5/S12, spec §2.2, §2.3, §6).
 * This is the surface `flows.ts` exists to feed: the rule findings say which rows *require* evidence,
 * the auditor picks the accepted flow (build the required set) or the declined flow (fix a floor and
 * auto-add until it is met, never fewer), verifies each row under the configured mode, and sees the
 * overrides a reviewer must be shown carried forward.
 *
 * The engine is pure: the clock is captured here and passed in as `evaluatedAt`, and the store's own
 * answer decides whether a piece of evidence is reachable. A row left `open`, a remark left blank, a
 * missing piece of evidence and an unparsed row are each a reason, never a silent pass.
 */
interface FlowVerifyPanelProps {
  workpaper: { engagementId: string; refCode: string };
  /** The findings of the run just performed, so the required rows come from the run, not a re-derivation. */
  findings: ReadonlyArray<{ ruleId: string; ruleVersion: number; reason: string; refs: string[] }>;
  /** The rows the population read produced, in the shape the flow consumes. */
  rows: ReadonlyArray<{ ref: string; values: Record<string, unknown> }>;
}

const DECISIONS: RowDecision[] = ['open', 'effective', 'ineffective'];

export const FlowVerifyPanel: React.FC<FlowVerifyPanelProps> = ({ workpaper, findings, rows }) => {
  const { currentUser } = useApp();
  const canVerify = hasRight(currentUser, 'perform_work');

  const [flow, setFlow] = useState<'accepted' | 'declined'>('accepted');
  const [mode, setMode] = useState<VerificationMode>('completeness');
  const [floor, setFloor] = useState(25);
  const [tested, setTested] = useState<TestedRow[]>([]);
  const [verifications, setVerifications] = useState<RowVerification[] | null>(null);
  const [overrides, setOverrides] = useState<CarriedOverride[]>([]);
  const [evidence, setEvidence] = useState<Record<string, { id: string; reachable: boolean; type: string; contentSha256: string }>>({});
  const [paste, setPaste] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The population the flow builds over, in the flow's own shape.
  const population: FlowPopulationRow[] = useMemo(
    () => rows.map((r) => ({ ref: r.ref, values: r.values })),
    [rows],
  );

  // The rows a rule finding named are the rows that REQUIRE evidence. Re-derived from the run's
  // findings, so the set always matches the run the operator just read.
  const required = useMemo(
    () => requiredRowsFromFindings(findings as never),
    [findings],
  );

  // The evidence the store holds for this workpaper, so a Mode-B check is against real records.
  useEffect(() => {
    let cancelled = false;
    listEvidenceRecords(workpaper.engagementId)
      .then((e) => { if (!cancelled) setEvidence(e); })
      .catch(() => { /* no evidence store: Mode B will honestly report no evidence attached */ });
    return () => { cancelled = true; };
  }, [workpaper.engagementId]);

  const build = useCallback(() => {
    setError(null);
    setVerifications(null);
    setOverrides([]);
    setNote(null);
    if (flow === 'accepted') {
      const set = buildAcceptedTestingSet(required, population, 0);
      setTested(set);
      setNote(
        required.length === 0
          ? 'No rule finding named a row, so the accepted set is empty. Nothing is tested and nothing passes.'
          : `Accepted flow: ${set.length} required row(s) under test. A required row is never dropped.`,
      );
    } else {
      const set = applyFloor(floor, population, []);
      setTested(set);
      setNote(
        `Declined flow: the floor of ${floor} is a minimum, never a ceiling — ${set.length} row(s) under test ` +
        `(${set.filter((r) => r.autoAdded).length} auto-added).`,
      );
    }
  }, [flow, floor, required, population]);

  // Paste-to-fill: deterministic clipboard parsing, mapped onto the flow's columns.
  const applyPaste = useCallback(() => {
    const parsed = parsePastedBlock(paste, ['ref', 'remark', 'decision']);
    if (parsed.rows.length === 0) {
      setError('The pasted block carried no rows.');
      return;
    }
    const byRef = new Map(parsed.rows.map((r) => [r[0], r]));
    setTested((prev) => prev.map((r) => {
      const p = byRef.get(r.ref);
      if (!p) return r;
      const decision = (p[2] ?? '').trim() as RowDecision;
      return {
        ...r,
        remark: (p[1] ?? '').trim(),
        decision: DECISIONS.includes(decision) ? decision : r.decision,
      };
    }));
    setNote(`Pasted ${parsed.rows.length} row(s) onto the tested set.`);
    setError(null);
  }, [paste]);

  const verify = useCallback(() => {
    setError(null);
    const set = verifyRows(tested, mode, mode === 'evidence' ? evidence : {});
    setVerifications(set);
    // §2.2: an override is a row closed despite a failed verification AND carrying a remark. It is
    // carried forward and shown here; the reviewer does not have to discover it.
    setOverrides(carriedOverrides(tested, set));
  }, [tested, mode, evidence]);

  const setRow = (ref: string, patch: Partial<TestedRow>) => {
    setTested((prev) => prev.map((r) => (r.ref === ref ? { ...r, ...patch } : r)));
  };

  const passCount = verifications?.filter((v) => v.ok).length ?? 0;
  const failCount = verifications ? verifications.length - passCount : 0;

  return (
    <div className="space-y-4" data-testid="flow-verify">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <ClipboardList className="w-4 h-4 text-verdigris" />
          <span>Accepted / declined testing flow and verification</span>
        </div>
        <p className="text-apple-12 text-secondary">
          The rules say which rows require evidence. The accepted flow builds exactly those rows; the
          declined flow fixes a floor that is a minimum, never a ceiling. Verification is exact: an
          open row, a blank remark or a missing piece of evidence is a reason, never a pass.
        </p>
      </div>

      {!canVerify && (
        <p className="text-apple-12 text-secondary" data-testid="flow-verify-rights-note">
          {rightReason('perform_work')} — you can read this, but building and verifying needs{' '}
          <span className="font-mono">perform_work</span>.
        </p>
      )}

      <InlineError message={error} testId="flow-verify-error" onDismiss={() => setError(null)} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-apple-11 font-medium text-secondary uppercase" htmlFor="flow-verify-flow">
            Flow
          </label>
          <select
            id="flow-verify-flow"
            data-testid="flow-verify-flow"
            value={flow}
            onChange={(e) => setFlow(e.target.value as 'accepted' | 'declined')}
            className="p-2 text-apple-12 rounded bg-surface border border-hairline text-primary"
          >
            <option value="accepted">Accepted (required rows)</option>
            <option value="declined">Declined (fixed floor)</option>
          </select>
        </div>
        {flow === 'declined' && (
          <div className="space-y-1">
            <label className="text-apple-11 font-medium text-secondary uppercase" htmlFor="flow-verify-floor">
              Floor
            </label>
            <input
              id="flow-verify-floor"
              data-testid="flow-verify-floor"
              type="number"
              min={0}
              value={floor}
              onChange={(e) => setFloor(Math.max(0, Number(e.target.value) || 0))}
              className="p-2 text-apple-12 rounded bg-surface border border-hairline text-primary w-24"
            />
          </div>
        )}
        <div className="space-y-1">
          <label className="text-apple-11 font-medium text-secondary uppercase" htmlFor="flow-verify-mode">
            Mode
          </label>
          <select
            id="flow-verify-mode"
            data-testid="flow-verify-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as VerificationMode)}
            className="p-2 text-apple-12 rounded bg-surface border border-hairline text-primary"
          >
            <option value="completeness">A — completeness</option>
            <option value="evidence">B — evidence vs remark</option>
          </select>
        </div>
        <button
          type="button"
          data-testid="flow-verify-build"
          disabled={!canVerify}
          onClick={build}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium bg-btn-primary-bg text-btn-primary-text disabled:opacity-50"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          Build the tested set
        </button>
      </div>

      {note && <p className="text-apple-12 text-secondary" data-testid="flow-verify-note">{note}</p>}

      {tested.length > 0 && (
        <>
          <div className="space-y-1">
            <label className="text-apple-11 font-medium text-secondary uppercase" htmlFor="flow-verify-paste">
              Paste rows to fill (tab-separated: ref, remark, decision)
            </label>
            <textarea
              id="flow-verify-paste"
              data-testid="flow-verify-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={2}
              className="w-full p-2 text-apple-12 rounded bg-surface border border-hairline text-primary font-mono"
            />
            <button
              type="button"
              data-testid="flow-verify-paste-apply"
              onClick={applyPaste}
              className="px-3 py-1.5 rounded-lg text-apple-12 border border-hairline text-primary hover:bg-surface-hover"
            >
              Apply paste
            </button>
          </div>

          <div className="border border-hairline rounded-xl overflow-hidden bg-surface" data-testid="flow-verify-rows">
            <table className="w-full text-left border-collapse text-apple-12">
              <thead>
                <tr className="border-b border-hairline bg-surface-sunken text-secondary">
                  <th className="p-3 font-medium">Row</th>
                  <th className="p-3 font-medium">Required</th>
                  <th className="p-3 font-medium">Remark</th>
                  <th className="p-3 font-medium">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {tested.map((r, i) => (
                  <tr key={r.ref} data-testid={`flow-verify-row-${i}`}>
                    <td className="p-3 font-mono text-primary">{r.ref}</td>
                    <td className="p-3 text-secondary">{r.required ? 'required' : r.autoAdded ? 'auto-added' : '—'}</td>
                    <td className="p-3">
                      <input
                        aria-label={`remark ${r.ref}`}
                        value={r.remark}
                        onChange={(e) => setRow(r.ref, { remark: e.target.value })}
                        className="w-full p-1.5 text-apple-12 rounded bg-surface border border-hairline text-primary"
                      />
                    </td>
                    <td className="p-3">
                      <select
                        aria-label={`decision ${r.ref}`}
                        value={r.decision}
                        onChange={(e) => setRow(r.ref, { decision: e.target.value as RowDecision })}
                        className="p-1.5 text-apple-12 rounded bg-surface border border-hairline text-primary"
                      >
                        {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            data-testid="flow-verify-verify"
            disabled={!canVerify}
            onClick={verify}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Verify ({mode === 'evidence' ? 'Mode B' : 'Mode A'})
          </button>
        </>
      )}

      {verifications && (
        <div className="space-y-3" data-testid="flow-verify-result">
          <div className="flex flex-wrap items-center gap-3 text-apple-12">
            <span className="inline-flex items-center gap-1 text-verdigris font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> {passCount} verified
            </span>
            <span className="inline-flex items-center gap-1 text-cinnabar font-medium" data-testid="flow-verify-failed">
              <RefreshCw className="w-3.5 h-3.5" /> {failCount} not verified
            </span>
          </div>

          <ul className="space-y-1">
            {verifications.filter((v) => !v.ok).map((v) => (
              <li key={v.ref} className="text-apple-12 text-secondary" data-testid={`flow-verify-fail-${v.ref}`}>
                <span className="font-mono text-primary">{v.ref}</span> — {v.reasons.join('; ')}
              </li>
            ))}
          </ul>

          {overrides.length > 0 && (
            <div className="p-3 rounded-xl border border-hairline bg-surface-sunken space-y-1" data-testid="flow-verify-overrides">
              <p className="text-apple-11 font-semibold uppercase text-secondary">
                Overrides carried to the next stage (§2.2)
              </p>
              {overrides.map((o) => (
                <p key={o.ref} className="text-apple-12 text-secondary">
                  <span className="font-mono text-primary">{o.ref}</span> — “{o.remark}” ({o.reasons.join('; ')})
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
