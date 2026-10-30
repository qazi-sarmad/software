import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { FileText, ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw, Lock, Layers } from '../common/Icons';
import {
  listEvidenceFiles, loadExtractionText, readEvidenceBytes, recordDocumentReviewFindings,
  type EvidenceFileRow, type ExtractionText,
} from '../../data/documentReview';
import {
  runRules, parseDocumentStructure, buildActionRegister, compareDocuments,
  needsOcr, runOcr, bundledOcrEngine,
  REVIEW_OPTIONS, ALL_REVIEW_OPTIONS, resolveReviewOptions, rulesForOptions,
  assessDocType, DOC_KINDS,
  type DocKind, type DocTypeAssessment, type ParsedDocument, type RuleFinding, type RuleInput,
  type RuleRunResult, type ActionFinding, type ComparisonResult, type StructuredExtraction,
} from '../../lib/systeligon';
import { ENGINE_NAME } from '../../lib/product';

/** The kind the auditor claims for a document, or `other` when they make no claim. */
type DeclaredKind = DocKind;

interface FileState {
  file: EvidenceFileRow;
  /** The auditor's declared type. `other` means "no claim", so the type check skips it. */
  declared: DeclaredKind;
  /** Whether this file is part of the run. */
  included: boolean;
}

interface DocumentResult {
  ref: string;
  declared: DeclaredKind;
  extraction: ExtractionText;
  structured: StructuredExtraction | null;
  assessment: DocTypeAssessment | null;
}

const input = 'h-9 w-full px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent';

/** The engine kind the OCR seam keys on, from the filename's extension. */
function ocrKind(filename: string | null): 'pdf' | 'unknown' {
  return (filename ?? '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'unknown';
}

/**
 * Read a scan locally (tier 2). The seam decides whether OCR is needed; the bundled engine reads the
 * bytes; a remote engine is refused by `runOcr` itself. Returns the read text as an extraction, or
 * null when the scan stays unread (no text layer, engine unavailable, or nothing recognised) — a
 * scan that is not read is reported as a scan, never as an empty document.
 */
async function tryLocalOcr(file: EvidenceFileRow, prior: ExtractionText): Promise<ExtractionText | null> {
  const bytes = await readEvidenceBytes(file.id);
  if (!bytes) return null;
  const hint = { status: 'done' as const, text: null, kind: ocrKind(file.filename) };
  if (!needsOcr(hint)) return null;
  const outcome = await runOcr(bytes, hint, bundledOcrEngine());
  if (outcome.status !== 'done' || !outcome.text) return null;
  return { ...prior, ok: true, text: outcome.text, scan: false, reason: undefined };
}

/**
 * The document-review screen (OA-36, S7). The auditor attaches the documents to review, says what
 * each one IS, and chooses which reviews to run — then the engine runs every option selected, over
 * the whole set, and the auditor reads the findings. The engine asks; it does not assume.
 *
 * Two things this screen exists to make honest:
 *
 *   1. **The declared-type check.** A document filed as minutes that reads as a regulation is
 *      highlighted before any other review is trusted — because a "missing quorum" on a document that
 *      is not minutes is a false finding. The check is a declared marker table, not a model, and when
 *      it recognises nothing it says `unconfirmable`, never a fabricated disagreement.
 *   2. **Coverage.** Every review reports what it parsed and what it could not interpret, so an
 *      unparsed clause is never presented as a clean one.
 *
 * The engine is pure: the run instant and the "as of" date are captured here, at Run, and passed in.
 * Nothing is generated and nothing calls out; the OCR seam (tier 2) refuses a remote engine, so a
 * scan is read locally or reported unread.
 */
export const DocumentReviewPanel: React.FC<{ screenId?: string; engagementId?: string | null }> = ({
  screenId = 'OA-36', engagementId = null,
}) => {
  const { currentUser } = useApp();
  const canRun = hasRight(currentUser, 'perform_work');

  const [files, setFiles] = useState<FileState[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<string[]>(ALL_REVIEW_OPTIONS);
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentResult[]>([]);
  const [result, setResult] = useState<RuleRunResult | null>(null);
  const [actions, setActions] = useState<ActionFinding[] | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!engagementId) { setFiles([]); setLoading(false); return; }
    setLoading(true);
    setLoadError('');
    try {
      const rows = await listEvidenceFiles(engagementId);
      setFiles(rows.map((file) => ({ file, declared: 'other', included: true })));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the engagement documents.');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { void load(); }, [load]);

  const included = useMemo(() => files.filter((f) => f.included), [files]);
  const options = useMemo(() => resolveReviewOptions(selected), [selected]);
  const rules = useMemo(() => rulesForOptions(options), [options]);

  const toggleOption = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setResult(null);
    setRecorded(null);
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    setRecorded(null);
    try {
      // Read every included document's text, then parse it to structure under the auditor's claim.
      const loaded: DocumentResult[] = [];
      for (const f of included) {
        const ref = f.file.filename ?? f.file.id;
        let extraction = await loadExtractionText(f.file.id);
        let structured: StructuredExtraction | null = null;
        let assessment: DocTypeAssessment | null = null;
        if (extraction.ok && extraction.text) {
          structured = parseDocumentStructure(extraction.text, f.declared, ref);
          assessment = assessDocType(extraction.text, f.declared);
        } else if (extraction.scan && canRun) {
          // The tier-2 seam: a done extraction with no text layer is a scan. Read it locally with the
          // bundled engine; a remote engine is refused by the seam itself, so nothing leaves the tenant.
          const ocr = await tryLocalOcr(f.file, extraction);
          if (ocr) {
            extraction = ocr;
            structured = parseDocumentStructure(ocr.text as string, f.declared, ref);
            assessment = assessDocType(ocr.text as string, f.declared);
          }
        }
        loaded.push({ ref, declared: f.declared, extraction, structured, assessment });
      }
      setDocs(loaded);

      const parsedDocs: ParsedDocument[] = loaded
        .map((d) => d.structured?.document)
        .filter((d): d is ParsedDocument => Boolean(d));
      const scope: Record<string, string> = {};
      for (const d of loaded) if (d.extraction.text) scope[`docText:${d.ref}`] = d.extraction.text;

      const ruleInput: RuleInput = {
        rows: [],
        documents: parsedDocs,
        sourceFiles: loaded
          .filter((d) => d.extraction.text)
          .map((d) => ({ ref: d.ref, text: d.extraction.text as string })),
        scope,
      };

      // The run instant and the "as of" date are captured here, once, and passed in.
      const now = new Date();
      const evaluatedAt = now.toISOString();
      const asOf = evaluatedAt.slice(0, 10);
      setRanAt(evaluatedAt);

      setResult(runRules(rules, ruleInput, { evaluatedAt }));
      setActions(options.some((o) => o.analysis === 'action_register')
        ? buildActionRegister(parsedDocs.filter((d) => d.kind === 'minutes'), asOf)
        : null);
      setComparison(options.some((o) => o.analysis === 'policy_diff') ? compareDocuments(parsedDocs) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The document review failed.');
    } finally {
      setRunning(false);
    }
  };

  const record = async () => {
    if (!result) return;
    setRecording(true);
    setError(null);
    try {
      const res = await recordDocumentReviewFindings(engagementId, result.evaluatedAt, result.findings);
      if (!res.ok) setError(res.reason);
      else setRecorded(result.findings.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the findings.');
    } finally {
      setRecording(false);
    }
  };

  const discrepant = useMemo(
    () => docs.filter((d) => d.assessment?.verdict === 'discrepant'),
    [docs],
  );

  return (
    <div className="space-y-6" data-testid="docreview-panel" data-screen={screenId}>
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <FileText className="w-4 h-4 text-verdigris" />
          <span>{ENGINE_NAME} document review</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Attach the documents, say what each one is, and choose the reviews to run. The engine runs
          every option selected over the whole set and reports what it parsed and what it could not.
          The declared-type check flags a document whose text does not match the type it was filed as.
        </p>
      </div>

      {!canRun && (
        <p className="text-apple-12 text-secondary" data-testid="docreview-rights-note">
          <Lock className="inline w-3.5 h-3.5 mr-1" />
          {rightReason('perform_work')} — you can read this screen, but running a review needs{' '}
          <span className="font-mono">perform_work</span>.
        </p>
      )}

      <InlineError message={error} testId="docreview-error" onDismiss={() => setError(null)} />

      {loading && (
        <p className="text-apple-12 text-secondary" data-testid="docreview-loading">Loading documents…</p>
      )}
      {!loading && loadError && (
        <p className="text-apple-12 text-cinnabar" data-testid="docreview-load-error">{loadError}</p>
      )}
      {!loading && !loadError && !engagementId && (
        <p className="text-apple-12 text-secondary" data-testid="docreview-no-engagement">
          No engagement is selected. Open a document review from inside an engagement.
        </p>
      )}
      {!loading && !loadError && engagementId && files.length === 0 && (
        <p className="text-apple-12 text-secondary" data-testid="docreview-empty">
          This engagement has no evidence documents yet. Attach a file in the evidence vault, then
          return to review it.
        </p>
      )}

      {!loading && !loadError && files.length > 0 && (
        <>
          {/* Which reviews to run — the auditor chooses; the engine does not assume. */}
          <section className="space-y-2" data-testid="docreview-options">
            <div className="flex items-center justify-between">
              <h3 className="text-apple-12 font-medium text-primary uppercase inline-flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-secondary" /> Reviews to run
              </h3>
              <button
                type="button"
                data-testid="docreview-option-toggle-all"
                onClick={() => {
                  setSelected(selected.length === REVIEW_OPTIONS.length ? [] : ALL_REVIEW_OPTIONS);
                  setResult(null);
                }}
                className="text-apple-11 font-medium text-accent underline"
              >
                {selected.length === REVIEW_OPTIONS.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {REVIEW_OPTIONS.map((o) => (
                <label
                  key={o.id}
                  data-testid={`docreview-option-${o.id}`}
                  className="flex items-start gap-2 p-3 rounded-xl border border-hairline bg-surface hover:bg-surface-hover cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(o.id)}
                    disabled={!canRun}
                    onChange={() => toggleOption(o.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-apple-12 font-medium text-primary">{o.label}</span>
                    <span className="block text-apple-11 text-secondary">{o.description}</span>
                    <span className="block text-apple-11 text-tertiary font-mono">scope: {o.scope}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* The documents, with the auditor's declared type. */}
          <section className="space-y-2" data-testid="docreview-file-list">
            <h3 className="text-apple-12 font-medium text-primary uppercase">Documents</h3>
            <div className="border border-hairline rounded-xl overflow-hidden bg-surface">
              <table className="w-full text-left border-collapse text-apple-12">
                <thead>
                  <tr className="border-b border-hairline bg-surface-sunken text-secondary">
                    <th className="p-3 font-medium">Include</th>
                    <th className="p-3 font-medium">Document</th>
                    <th className="p-3 font-medium">Declared type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {files.map((f, i) => (
                    <tr key={f.file.id} data-testid={`docreview-file-${i}`} className="hover:bg-surface-hover">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          data-testid={`docreview-file-include-${i}`}
                          checked={f.included}
                          disabled={!canRun}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, included: on } : x)));
                            setResult(null);
                          }}
                          aria-label={`Include ${f.file.filename ?? f.file.id}`}
                        />
                      </td>
                      <td className="p-3 text-primary">{f.file.filename ?? f.file.id}</td>
                      <td className="p-3">
                        <select
                          data-testid={`docreview-declared-${i}`}
                          className={input}
                          value={f.declared}
                          disabled={!canRun}
                          onChange={(e) => {
                            const kind = e.target.value as DeclaredKind;
                            setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, declared: kind } : x)));
                            setResult(null);
                          }}
                        >
                          {DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="docreview-run"
                disabled={!canRun || running || options.length === 0 || included.length === 0}
                onClick={() => void run()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium bg-btn-primary-bg text-btn-primary-text disabled:opacity-50"
              >
                {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Run {options.length} review{options.length === 1 ? '' : 's'}
              </button>
              <span className="text-apple-11 text-secondary">
                {included.length} of {files.length} document(s) selected · {rules.length} rule(s)
              </span>
            </div>
          </section>
        </>
      )}

      {/* The declared-type verdicts, shown first because everything else depends on them. */}
      {docs.length > 0 && (
        <section className="space-y-2" data-testid="docreview-verdicts">
          <h3 className="text-apple-12 font-medium text-primary uppercase">Declared-type check</h3>
          {discrepant.length > 0 && (
            <p className="text-apple-12 text-cinnabar inline-flex items-center gap-1" data-testid="docreview-verdict-discrepant-note">
              <AlertTriangle className="w-3.5 h-3.5" />
              {discrepant.length} document(s) do not match the type they were filed as. Read this before
              trusting any other finding below.
            </p>
          )}
          <ul className="space-y-1">
            {docs.map((d) => {
              const v = d.assessment?.verdict ?? 'unconfirmable';
              const tone = v === 'discrepant' ? 'text-cinnabar' : v === 'confirmed' ? 'text-verdigris' : 'text-secondary';
              return (
                <li key={d.ref} className="text-apple-12" data-testid={`docreview-verdict-${d.ref}`}>
                  <span className="font-mono text-primary">{d.ref}</span>{' '}
                  <span className={`text-apple-11 font-semibold uppercase ${tone}`} data-testid={`docreview-verdict-state-${d.ref}`}>{v}</span>
                  {' — '}
                  <span className="text-secondary">
                    {d.extraction.ok
                      ? d.assessment?.reason
                      : d.extraction.scan
                        ? 'No text layer: this is a scan. The tier-2 OCR seam can read it locally; nothing leaves the tenant.'
                        : `Could not read the text: ${d.extraction.reason}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Parse coverage — what the structure parser could and could not interpret. */}
      {docs.some((d) => d.structured) && (
        <section className="space-y-1" data-testid="docreview-coverage">
          <h3 className="text-apple-12 font-medium text-primary uppercase">Extraction coverage</h3>
          <ul className="space-y-1">
            {docs.filter((d) => d.structured).map((d) => {
              const c = d.structured!.coverage;
              return (
                <li key={d.ref} className="text-apple-12 text-secondary" data-testid={`docreview-coverage-${d.ref}`}>
                  <span className="font-mono text-primary">{d.ref}</span> — {c.lines} line(s), {c.parsed} element(s),{' '}
                  <span className={c.uninterpreted > 0 ? 'text-brass' : 'text-secondary'}>{c.uninterpreted} not interpreted</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* The rule-run result. */}
      {result && (
        <section className="space-y-4" data-testid="docreview-results">
          <div className="flex flex-wrap items-center gap-3 text-apple-12" data-testid="docreview-summary">
            <span className="inline-flex items-center gap-1 text-verdigris font-medium">
              <ShieldCheck className="w-3.5 h-3.5" /> {result.ran.length} rule(s) ran
            </span>
            <span className="inline-flex items-center gap-1 text-primary font-medium">
              <AlertTriangle className="w-3.5 h-3.5" /> {result.findings.length} finding(s)
            </span>
            <span className="text-secondary" data-testid="docreview-skipped">
              {result.skipped.length} draft rule(s) skipped · run {ranAt}
            </span>
          </div>

          {result.findings.length === 0 ? (
            <p className="text-apple-12 text-verdigris inline-flex items-center gap-1" data-testid="docreview-findings-empty">
              <CheckCircle2 className="w-3.5 h-3.5" /> No rule flagged the selected documents.
            </p>
          ) : (
            <div className="border border-hairline rounded-xl overflow-hidden bg-surface" data-testid="docreview-findings">
              <table className="w-full text-left border-collapse text-apple-12">
                <thead>
                  <tr className="border-b border-hairline bg-surface-sunken text-secondary">
                    <th className="p-3 font-medium">Rule</th>
                    <th className="p-3 font-medium">Version</th>
                    <th className="p-3 font-medium">Severity</th>
                    <th className="p-3 font-medium">Finding</th>
                    <th className="p-3 font-medium">Refs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {result.findings.map((f: RuleFinding, i: number) => (
                    <tr key={`${f.ruleId}@${f.ruleVersion}-${i}`} data-testid={`docreview-finding-${i}`} className="hover:bg-surface-hover">
                      <td className="p-3 font-mono text-primary">{f.ruleId}</td>
                      <td className="p-3 font-mono text-secondary">v{f.ruleVersion}</td>
                      <td className="p-3">
                        <span className={`text-apple-11 font-semibold uppercase ${f.severity === 'high' || f.severity === 'medium' ? 'text-cinnabar' : 'text-secondary'}`}>
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
              data-testid="docreview-record"
              disabled={!canRun || recording}
              onClick={() => void record()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {recording ? 'Recording…' : 'Record findings to the ledger'}
            </button>
            {recorded !== null && (
              <span className="text-apple-12 text-verdigris" data-testid="docreview-recorded">
                Recorded {recorded} finding(s) to the ledger and the report root.
              </span>
            )}
          </div>
        </section>
      )}

      {/* The action-item register (minutes). */}
      {actions && (
        <section className="space-y-2" data-testid="minutes-register">
          <h3 className="text-apple-12 font-medium text-primary uppercase">Action-item register</h3>
          {actions.length === 0 ? (
            <p className="text-apple-12 text-secondary" data-testid="minutes-register-empty">
              No action item was raised in the selected minutes.
            </p>
          ) : (
            <ul className="space-y-1">
              {actions.map((a, i) => (
                <li key={`${a.itemId}-${a.kind}-${i}`} className="text-apple-12" data-testid={`minutes-item-${i}`}>
                  <span className="font-mono text-primary">{a.itemId}</span>{' '}
                  <span className="text-apple-11 font-semibold uppercase text-brass">{a.kind}</span>
                  {' — '}<span className="text-secondary">{a.detail}</span>
                  <span className="text-apple-11 text-tertiary"> · {a.history.length} appearance(s)</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* The policy / procedure / regulation comparison. */}
      {comparison && (
        <section className="space-y-2" data-testid="policydiff">
          <h3 className="text-apple-12 font-medium text-primary uppercase">Policy / procedure comparison</h3>
          <p className="text-apple-11 text-secondary" data-testid="policydiff-coverage">
            {comparison.coverage.clausesParsed} clause(s) parsed, {comparison.coverage.matched} matched,{' '}
            <span className={comparison.coverage.couldNotInterpret > 0 ? 'text-brass' : 'text-secondary'}>
              {comparison.coverage.couldNotInterpret} could not be interpreted
            </span>
            {comparison.coverage.uninterpreted.length > 0 && ` (${comparison.coverage.uninterpreted.join(', ')})`}
          </p>
          {comparison.findings.length === 0 ? (
            <p className="text-apple-12 text-secondary" data-testid="policydiff-empty">
              No mismatch was found between the selected policy, procedure and regulation documents.
            </p>
          ) : (
            <ul className="space-y-1" data-testid="policydiff-findings">
              {comparison.findings.map((m, i) => (
                <li key={`${m.kind}-${m.key}-${i}`} className="text-apple-12" data-testid={`policydiff-finding-${i}`}>
                  <span className="text-apple-11 font-semibold uppercase text-brass">{m.kind}</span>{' '}
                  <span className="font-mono text-primary">{m.key}</span>
                  {' — '}<span className="text-secondary">{m.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};
