import React, { useState } from 'react';
import { WorkpaperLock } from '../../lib/workpaperLock';
import { WorkingPaper } from '../../types';
import { useApp } from '../../context/AppContext';
import { checkPopulationCsv, isSupportedPopulationFile, sha256Hex, POPULATION_MAX_BYTES, PopulationCheck, type HeaderDetection } from '../../lib/population';
import { CheckCircle2, ShieldCheck, Hash } from '../common/Icons';
import { ProcedureStepsPanel } from './ProcedureStepsPanel';

interface TestingStepsTabProps {
  workpaper: WorkingPaper;
  lock?: WorkpaperLock;
}

export const TestingStepsTab: React.FC<TestingStepsTabProps> = ({ workpaper, lock }) => {
  const locked = Boolean(workpaper.sealed || lock?.locked);
  const { finalizeTest, registerPopulation, setTestStepCompleted } = useApp();
  // Steps and the verified population live on the working paper itself (the command layer owns them).
  const steps = workpaper.testSteps;
  const verified = Boolean(workpaper.populationSha256);
  const [controlTotal, setControlTotal] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<PopulationCheck | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hasTemplateSteps, setHasTemplateSteps] = useState(false);
  // S2: a candidate header awaiting the auditor's confirmation, and the file bytes held so the check
  // can be re-run once a header row is confirmed without asking the auditor to pick the file again.
  const [pendingHeader, setPendingHeader] = useState<HeaderDetection | null>(null);
  const [pendingBuf, setPendingBuf] = useState<ArrayBuffer | null>(null);

  const handleToggleStep = (stepId: string, completed: boolean) => {
    if (locked) return;
    const r = setTestStepCompleted(workpaper.id, stepId, !completed);
    setMessage(r.ok ? null : r.reason);
  };

  // Run the check for a given file, optionally with a confirmed header row (S2).
  const runCheck = async (buf: ArrayBuffer, fileName: string, headerRow?: number) => {
    const total = controlTotal.trim() === '' ? null : Number(controlTotal.replace(/,/g, ''));
    const result = checkPopulationCsv(new TextDecoder('utf-8').decode(buf), total, headerRow === undefined ? {} : { headerRow });
    setCheck(result);
    setPendingHeader(result.headerConfirmed ? null : result.header);
    if (!result.verified) return;
    const sha256 = await sha256Hex(buf); // raw bytes
    const r = await registerPopulation(workpaper.id, { sha256, fileName, rowCount: result.rowCount, totalCents: result.totalCents });
    if (!r.ok) setMessage(r.reason);
    else setPendingBuf(null);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    setCheck(null);
    setPendingHeader(null);
    setPendingBuf(null);
    const type = isSupportedPopulationFile(file.name);
    if (!type.ok) { setMessage(type.reason ?? 'Unsupported file.'); return; }
    if (file.size > POPULATION_MAX_BYTES) { setMessage('Population file is over the 10 MB limit.'); return; }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      setPendingBuf(buf);
      await runCheck(buf, file.name);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      setBusy(false);
    }
  };

  // The auditor confirmed the detected header row (or moved it): re-count against the held bytes.
  const confirmHeader = async (row: number) => {
    if (!pendingBuf) return;
    setBusy(true);
    setMessage(null);
    try {
      await runCheck(pendingBuf, workpaper.populationFileName ?? 'population.csv', row);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      setBusy(false);
    }
  };

  const allCompleted = steps.every((s) => s.completed) && verified;

  const handleFinalize = async () => {
    const r = await finalizeTest(workpaper.id);
    setMessage(r.ok ? null : r.reason);
  };

  return (
    <div className="space-y-6">
      {/* Law 3: no verified population, no testing. Enforced in the command layer too. */}
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-3" data-testid="population-gate">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-primary font-semibold text-apple-13">
              <Hash className={`w-4 h-4 ${verified ? 'text-verdigris' : 'text-cinnabar'}`} />
              <span>Population verification (Law 3)</span>
            </div>
            <p className="text-apple-12 text-secondary">
              Upload the full population as CSV (reference, date, amount) and enter the control total. It is verified only when every row is valid, there are no duplicate references, and the total matches to the cent.
            </p>
            <div className="text-apple-11 font-mono text-tertiary break-all" data-testid="population-status">
              {verified
                ? `Verified · ${workpaper.populationCount.toLocaleString()} rows · ${workpaper.populationFileName ?? 'seeded population'} · SHA-256 ${workpaper.populationSha256}`
                : 'Not verified. Testing is locked.'}
            </div>
          </div>
          {verified && (
            <span className="shrink-0 px-2 py-1 rounded-full bg-verdigris-subtle text-verdigris text-apple-11 font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Verified
            </span>
          )}
        </div>
        {!verified && !locked && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-apple-11 text-secondary space-y-1">
              <span className="block">Control total</span>
              <input data-testid="control-total" inputMode="decimal" value={controlTotal} onChange={(e) => setControlTotal(e.target.value)} placeholder="e.g. 1,000,000.00" className="h-9 w-44 px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent tabular-nums" />
            </label>
            <label className="text-apple-11 text-secondary space-y-1">
              <span className="block">Population file (.csv, max 10 MB)</span>
              <input data-testid="population-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={handleFile} className="block text-apple-12 text-secondary file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-hairline file:bg-surface-elevated file:text-primary" />
            </label>
            {busy && <span className="text-apple-12 text-secondary">Checking…</span>}
          </div>
        )}
        {/* S2: confirm the header row before the population is counted (spec §2.1). Only the row below
            the header is counted as data; rows above it are treated as preamble. */}
        {pendingHeader && !verified && (
          <div className="rounded-xl border border-hairline bg-surface-elevated p-3 space-y-2" data-testid="header-confirm">
            <div className="text-apple-12 font-semibold text-primary">Confirm the header row</div>
            <div className="text-apple-11 text-secondary">
              {pendingHeader.candidates.length === 0
                ? 'No row looks like a header. Confirm which row is the header, or the first row if the file has no header.'
                : 'The engine detected the header below. Confirm it, or choose the correct row — the header row is not counted and rows above it are ignored.'}
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingHeader.candidates.slice(0, 6).map((c) => (
                <button
                  key={c.index}
                  type="button"
                  data-testid={`header-confirm-${c.index}`}
                  disabled={busy}
                  onClick={() => void confirmHeader(c.index)}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50"
                >
                  Row {c.index + 1}{c.labels.length ? `: ${c.labels.slice(0, 3).join(', ')}` : ''}
                </button>
              ))}
              {pendingHeader.candidates.length === 0 && (
                <button
                  type="button"
                  data-testid="header-confirm-0"
                  disabled={busy}
                  onClick={() => void confirmHeader(0)}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50"
                >
                  Row 1 is the header
                </button>
              )}
            </div>
          </div>
        )}
        {check && !check.verified && !pendingHeader && (
          <div className="rounded-xl border border-cinnabar bg-cinnabar-subtle p-3 space-y-1" role="alert" data-testid="population-errors">
            <div className="text-apple-12 font-semibold text-cinnabar">Not verified: {check.issues.length} issue{check.issues.length === 1 ? '' : 's'}</div>
            <ul className="text-apple-11 text-primary space-y-0.5 max-h-32 overflow-y-auto">
              {check.issues.slice(0, 25).map((i, k) => (<li key={k}>{i.line > 0 ? `Line ${i.line}: ` : ''}{i.message}</li>))}
            </ul>
          </div>
        )}
        {check?.verified && (
          <div className="text-apple-12 text-verdigris">Reconciled: {check.rowCount} rows, total {(check.totalCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}, {check.minDate} to {check.maxDate}.</div>
        )}
        {message && <div className="text-apple-12 text-cinnabar" role="alert" data-testid="gate-message">{message}</div>}
      </div>

      {/* Procedure steps (Phase 4.2): the steps come from the methodology library, not React state. */}
      <ProcedureStepsPanel workpaperId={workpaper.id} locked={locked} onHasTemplateSteps={setHasTemplateSteps} />

      {/* Legacy seed steps: shown only when no procedure has been applied to this workpaper. */}
      {!hasTemplateSteps && steps.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
            Substantive &amp; Control Test Program
          </h3>
          <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
            {steps.map((step, idx) => (
              <div
                key={step.id}
                onClick={() => handleToggleStep(step.id, step.completed)}
                className={`p-4 flex items-start gap-3 transition-colors ${
                  locked ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer hover:bg-surface-hover'
                }`}
              >
                <div className="pt-0.5 shrink-0">
                  <input
                    type="checkbox"
                    checked={step.completed}
                    onChange={() => {}}
                    disabled={locked}
                    className="rounded border-hairline text-verdigris focus:ring-0"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between text-apple-12">
                    <span className="font-medium text-primary">Step {idx + 1}: {step.description}</span>
                    {step.completed && (
                      <span className="text-apple-11 text-verdigris font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Done
                      </span>
                    )}
                  </div>
                  {step.resultNote && (
                    <p className="text-apple-11 text-secondary font-mono bg-surface-sunken p-2 rounded">
                      {step.resultNote}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Finalize Test Gate */}
      <div className="pt-4 border-t border-hairline flex items-center justify-between">
        <span className="text-apple-12 text-secondary">
          {allCompleted ? 'All mandatory test gates satisfied.' : 'Complete all steps and verify population to finalize.'}
        </span>
        <button
          type="button"
          onClick={handleFinalize}
          disabled={!allCompleted || locked}
          data-testid="finalize-test"
          className="px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 transition-colors"
        >
          Finalize Fieldwork Test
        </button>
      </div>
    </div>
  );
};
