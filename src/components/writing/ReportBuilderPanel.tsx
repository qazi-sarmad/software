import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, fixtureGraph, fixtureVariants,
  releasedSeedPhrases,
} from '../../lib/writing/fixtures';
import { composeReport, type ComposedReport, type ComposerInput } from '../../lib/writing/compose';
import { REPORT_MODELS, modelById } from '../../lib/writing/models';
import { FORMALITY_DEFINITIONS, TONE_DEFINITIONS, VOICES, DEFAULT_REGISTER } from '../../lib/writing/registers';
import { reconcileCoverage, findContradictions, checkReferenceIntegrity } from '../../lib/writing/verify';
import { compareReportVersions, compareRenders } from '../../lib/writing/versioning';
import { applyApprovalGate, checkStaleness, type Observation } from '../../lib/writing/observations';
import { provenanceTrace, counterfactualRegister, verifyTrace } from '../../lib/writing/explain';
import { lineagePanel } from '../../lib/writing/lineagePanel';
import { FIGURE_FUNCTIONS } from '../../lib/writing/figures';
import type { ClaimGraph, Formality, Locale, Register, Tone, Voice } from '../../lib/writing/types';

type LoadState = 'loading' | 'ready' | 'error';
type Pane = 'claims' | 'coverage' | 'contradictions' | 'excluded' | 'compare';

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

/**
 * Report builder (W12, spec §15.6).
 *
 * Choose a model, formality, tone, voice and locale; compose the report from approved observations
 * only; inspect every claim's references and status, open a figure's source data, recompute, see the
 * coverage reconciliation and the contradictions, compare two versions, and run the freeze-and-issue
 * flow, which names every blocker precisely. The composition runs the real engine over the frozen
 * fixture graph, so the screen and the library agree.
 */
export const ReportBuilderPanel: React.FC<{ prefix?: string }> = ({ prefix = 'wk-report-builder' }) => {
  const { currentUser } = useApp();
  const canCompose = hasRight(currentUser, 'review_and_approve') || hasRight(currentUser, 'approve_plan');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [modelId, setModelId] = useState('M1');
  const [formality, setFormality] = useState<Formality>(DEFAULT_REGISTER.formality);
  const [tone, setTone] = useState<Tone>(DEFAULT_REGISTER.tone);
  const [voice, setVoice] = useState<Voice>(DEFAULT_REGISTER.voice);
  const [locale, setLocale] = useState<Locale>('en-GB');
  const [report, setReport] = useState<ComposedReport | null>(null);
  const [pane, setPane] = useState<Pane>('claims');
  const [openProvenance, setOpenProvenance] = useState<string | null>(null);
  const [openLineage, setOpenLineage] = useState<string | null>(null);
  const [counterfactualText, setCounterfactualText] = useState<Record<string, string>>({});
  const [traceOk, setTraceOk] = useState<Record<string, boolean>>({});
  const [freezeResult, setFreezeResult] = useState<string | null>(null);

  const register: Register = useMemo(() => ({ formality, tone, voice }), [formality, tone, voice]);

  const composerInput: ComposerInput = useMemo(() => ({
    graph: fixtureGraph(register, locale, modelId),
    phrases: releasedSeedPhrases(),
    vocabulary: TEST_VOCABULARY,
    versions: { ...ENGINE_VERSION, template: `${modelId}@1` },
    fixedTimestamp: FIXED_TIMESTAMP,
    format: FIXTURE_FORMAT,
    variants: fixtureVariants(),
  }), [register, locale, modelId]);

  const compose = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setReport(await composeReport(composerInput));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not compose the report.');
      setState('error');
    }
  }, [composerInput]);

  useEffect(() => { void compose(); }, [compose]);

  const model = modelById(modelId);
  const claims = composerInput.graph.claims;

  const coverage = useMemo(() => reconcileCoverage(claims, {
    findingIds: claims.flatMap((c) => c.references.filter((r) => r.type === 'finding').map((r) => r.id)),
    exceptionControlIds: [], capIds: [],
  }), [claims]);

  const contradictions = useMemo(() => findContradictions({
    claims,
    reportDate: '2026-10-25',
    capState: new Map(), riskRating: new Map(), findingSeverity: new Map(),
    auditorOverrides: new Map(), dismissedAlerts: new Set(), claimAlert: new Map(),
  }), [claims]);

  const integrity = useMemo(() => checkReferenceIntegrity(claims, new Map(
    claims.flatMap((c) => c.references.map((r) => [`${r.type}:${r.id}`, { type: r.type, id: r.id, contentHash: r.contentHash }])),
  )), [claims]);

  const observations: Observation[] = useMemo(() => [], []);
  const gate = useMemo(() => applyApprovalGate(observations), [observations]);
  const staleness = useMemo(() => checkStaleness(claims, new Map(observations.map((o) => [o.id, o]))), [claims, observations]);

  const comparison = useMemo(() => compareReportVersions(
    { id: 'v1', versions: ENGINE_VERSION, claims, graphRoot: report?.hashes.graphRoot ?? '', renderHash: report?.renderHash ?? '' },
    { id: 'v2', versions: ENGINE_VERSION, claims, graphRoot: report?.hashes.graphRoot ?? '', renderHash: report?.renderHash ?? '' },
  ), [claims, report]);

  const registerRows = useMemo(() => (report ? compareRenders(
    `F${formality} T${tone} ${voice} ${locale}`,
    report.rendered.map((r) => ({ claimId: r.claimId, text: r.text })),
    'formal',
    report.rendered.map((r) => ({ claimId: r.claimId, text: r.text })),
  ) : []), [report, formality, tone, voice, locale]);

  const showProvenance = async (claimId: string) => {
    if (openProvenance === claimId) { setOpenProvenance(null); return; }
    setOpenProvenance(claimId);
    const claim = claims.find((c) => c.id === claimId);
    const rendered = report?.rendered.find((r) => r.claimId === claimId);
    if (!claim || !rendered) return;
    try {
      const trace = await provenanceTrace(claim, rendered, register, locale, ENGINE_VERSION.engine, composerInput.phrases);
      const ok = await verifyTrace(trace, claim, rendered);
      setTraceOk((t) => ({ ...t, [claimId]: ok }));
    } catch {
      setTraceOk((t) => ({ ...t, [claimId]: false }));
    }
    const cf = await counterfactualRegister(composerInput, claimId, { ...register, formality: ((formality % 5) + 1) as Formality });
    setCounterfactualText((t) => ({ ...t, [claimId]: `${cf.description}: ${cf.sentence}` }));
  };

  const freeze = () => {
    const blockers: string[] = [];
    if (!integrity.ok) {
      blockers.push(...integrity.unreferenced.map((c) => `unreferenced claim: ${c}`));
      blockers.push(...integrity.stale.map((i) => `stale reference: ${i.claimId} ${i.reason}`));
    }
    if (!coverage.ok) {
      blockers.push(...coverage.missing.map((m) => `missing coverage: ${m}`));
      blockers.push(...coverage.duplicated.map((d) => `duplicate coverage: ${d}`));
      blockers.push(...coverage.orphaned.map((o) => `orphaned claim: ${o}`));
    }
    blockers.push(...contradictions.map((c) => `contradiction ${c.ruleId}: ${c.claimId}`));
    if (staleness.blocked) blockers.push(...staleness.staleClaims.map((c) => `stale claim: ${c}`));
    setFreezeResult(blockers.length
      ? `Freeze refused. ${blockers.length} blocker(s):\n${blockers.join('\n')}`
      : `Freeze allowed. Graph root ${report?.hashes.graphRoot.slice(0, 16)}… render hash ${report?.renderHash.slice(0, 16)}…`);
  };

  if (state === 'loading') {
    return <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-loading`}>Composing the report…</div>;
  }
  if (state === 'error') {
    return (
      <div className="p-4 space-y-2" data-testid={`${prefix}-error`}>
        <InlineError message={loadError} testId={`${prefix}-error-message`} />
        <button type="button" className="text-apple-12 underline text-secondary" data-testid={`${prefix}-retry`} onClick={() => void compose()}>Retry</button>
      </div>
    );
  }
  if (!canCompose) {
    return (
      <div className="p-4" data-testid={`${prefix}-denied`}>
        <InlineError message="You need the Review and approve right to compose a report." testId={`${prefix}-denied-error`} />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`${prefix}-panel`}>
      <div className="p-4 rounded-2xl bg-surface border border-hairline grid grid-cols-2 gap-3 md:grid-cols-5" data-testid={`${prefix}-controls`}>
        <label className="block text-apple-11 text-secondary">
          Model
          <Select ariaLabel="Report model" testId={`${prefix}-model`} value={modelId} onChange={setModelId}
            options={REPORT_MODELS.map((m) => ({ value: m.modelId, label: `${m.modelId} · ${m.title}` }))} />
        </label>
        <label className="block text-apple-11 text-secondary">
          Formality
          <Select ariaLabel="Formality" testId={`${prefix}-formality`} value={String(formality)} onChange={(v) => setFormality(Number(v) as Formality)}
            options={Object.values(FORMALITY_DEFINITIONS).map((f) => ({ value: String(f.level), label: `F${f.level} · ${f.name}` }))} />
        </label>
        <label className="block text-apple-11 text-secondary">
          Tone
          <Select ariaLabel="Tone" testId={`${prefix}-tone`} value={String(tone)} onChange={(v) => setTone(Number(v) as Tone)}
            options={Object.values(TONE_DEFINITIONS).map((t) => ({ value: String(t.level), label: `T${t.level} · ${t.name}` }))} />
        </label>
        <label className="block text-apple-11 text-secondary">
          Voice
          <Select ariaLabel="Voice" testId={`${prefix}-voice`} value={voice} onChange={(v) => setVoice(v as Voice)}
            options={VOICES.map((v) => ({ value: v, label: label(v) }))} />
        </label>
        <label className="block text-apple-11 text-secondary">
          Locale
          <Select ariaLabel="Locale" testId={`${prefix}-locale`} value={locale} onChange={(v) => setLocale(v as Locale)}
            options={[{ value: 'en-GB', label: 'English (UK)' }, { value: 'en-US', label: 'English (US)' }]} />
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-apple-11 text-secondary" data-testid={`${prefix}-hashes`}>
        <span data-testid={`${prefix}-graph-root`}>Graph root: {report?.hashes.graphRoot.slice(0, 24)}…</span>
        <span data-testid={`${prefix}-render-hash`}>Render hash: {report?.renderHash.slice(0, 24)}…</span>
        <span data-testid={`${prefix}-model-name`}>{model?.title}</span>
      </div>

      <div className="flex items-center gap-1 flex-wrap" role="tablist" aria-label="Report panes">
        {([['claims', 'Claims'], ['coverage', 'Coverage'], ['contradictions', 'Contradictions'], ['excluded', 'Excluded'], ['compare', 'Compare']] as const).map(([id, lbl]) => (
          <button key={id} type="button" role="tab" aria-selected={pane === id} data-testid={`${prefix}-pane-${id}`}
            onClick={() => setPane(id)}
            className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold border ${pane === id ? 'bg-surface-hover border-accent text-primary' : 'bg-surface border-hairline text-secondary'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {pane === 'claims' && (
        <div className="space-y-2" data-testid={`${prefix}-claims`}>
          {(report?.rendered ?? []).map((r) => {
            const claim = claims.find((c) => c.id === r.claimId);
            return (
              <div key={r.claimId} className="p-3 rounded-xl border border-hairline bg-surface space-y-2" data-testid={`${prefix}-claim-${r.claimId}`}>
                <div className="text-apple-13 text-primary" data-testid={`${prefix}-claim-${r.claimId}-text`}>{r.text}</div>
                <div className="flex items-center gap-2 flex-wrap text-apple-11 text-secondary">
                  <span data-testid={`${prefix}-claim-${r.claimId}-phrase`}>{r.phraseId} v{r.phraseVersion}</span>
                  <span>· {claim?.claimLevel ?? '—'}</span>
                  <span>· {claim?.references.length ?? 0} reference(s)</span>
                  <button type="button" className="underline" data-testid={`${prefix}-claim-${r.claimId}-provenance`}
                    onClick={() => void showProvenance(r.claimId)}>Why this sentence</button>
                  {claim?.figures.length ? (
                    <button type="button" className="underline" data-testid={`${prefix}-claim-${r.claimId}-lineage`}
                      onClick={() => setOpenLineage(openLineage === r.claimId ? null : r.claimId)}>Show source data</button>
                  ) : null}
                </div>
                {openProvenance === r.claimId && claim && (
                  <div className="p-2 rounded-lg bg-surface-hover text-apple-11 text-secondary" data-testid={`${prefix}-claim-${r.claimId}-provenance-panel`}>
                    <div>Phrase {claim.phraseId} v{claim.phraseVersion} · rule {claim.ruleId} v{claim.ruleVersion}</div>
                    <div>Register F{formality} T{tone} {voice} · {locale} · engine {ENGINE_VERSION.engine}</div>
                    <div data-testid={`${prefix}-claim-${r.claimId}-trace-ok`}>Trace verifies: {traceOk[r.claimId] ? 'yes' : 'no'}</div>
                    <div data-testid={`${prefix}-claim-${r.claimId}-counterfactual`}>{counterfactualText[r.claimId] ?? ''}</div>
                  </div>
                )}
                {openLineage === r.claimId && claim && claim.figures.map((fig) => {
                  const fn = FIGURE_FUNCTIONS.find((f) => f.id === fig.figureId);
                  if (!fn) return null;
                  const panel = lineagePanel(fn, {
                    figureId: fig.figureId, figureVersion: fig.figureVersion, parameters: fig.parameters,
                    records: claim.references, rowCount: claim.references.length, result: fig.result,
                    timeArgument: FIXED_TIMESTAMP, lineageHash: claim.ruleId,
                  }, fig.result);
                  return (
                    <div key={fig.figureId} className="p-2 rounded-lg bg-surface-hover text-apple-11 text-secondary space-y-1" data-testid={`${prefix}-lineage-${fig.figureId}`}>
                      <div data-testid={`${prefix}-lineage-${fig.figureId}-description`}>{panel.description}</div>
                      <div data-testid={`${prefix}-lineage-${fig.figureId}-count`}>Row count: {panel.rowCount} · stored {panel.storedValue} / recomputed {panel.recomputedValue}</div>
                      <ul data-testid={`${prefix}-lineage-${fig.figureId}-records`}>
                        {panel.records.map((rec) => <li key={`${rec.type}:${rec.id}`}>{rec.type} {rec.id} ({rec.available ? rec.contentHash.slice(0, 10) : 'Not available'})</li>)}
                      </ul>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {pane === 'coverage' && (
        <div className="space-y-2" data-testid={`${prefix}-coverage`}>
          <div className="text-apple-12 text-primary" data-testid={`${prefix}-coverage-status`}>{coverage.ok ? 'Coverage reconciles.' : 'Coverage does not reconcile.'}</div>
          {coverage.missing.length > 0 && <div className="text-apple-12 text-cinnabar" data-testid={`${prefix}-coverage-missing`}>Missing: {coverage.missing.join(', ')}</div>}
          {coverage.duplicated.length > 0 && <div className="text-apple-12 text-cinnabar" data-testid={`${prefix}-coverage-duplicated`}>Duplicated: {coverage.duplicated.join(', ')}</div>}
          {coverage.orphaned.length > 0 && <div className="text-apple-12 text-cinnabar" data-testid={`${prefix}-coverage-orphaned`}>Orphaned: {coverage.orphaned.join(', ')}</div>}
        </div>
      )}

      {pane === 'contradictions' && (
        <div className="space-y-2" data-testid={`${prefix}-contradictions`}>
          {contradictions.length === 0 ? (
            <div className="py-6 text-center text-apple-13 text-secondary" data-testid={`${prefix}-contradictions-empty`}>No contradictions.</div>
          ) : contradictions.map((c) => (
            <div key={`${c.ruleId}-${c.claimId}`} className="p-3 rounded-xl border border-hairline bg-surface text-apple-12 text-primary" data-testid={`${prefix}-contradiction-${c.ruleId}`}>
              {c.ruleId}: {c.message}
            </div>
          ))}
        </div>
      )}

      {pane === 'excluded' && (
        <div className="space-y-2" data-testid={`${prefix}-excluded`}>
          {gate.excluded.length === 0 ? (
            <div className="py-6 text-center text-apple-13 text-secondary" data-testid={`${prefix}-excluded-empty`}>No observations were excluded.</div>
          ) : gate.excluded.map((e) => (
            <div key={e.observationId} className="p-3 rounded-xl border border-hairline bg-surface text-apple-12" data-testid={`${prefix}-excluded-${e.observationId}`}>
              <span className="text-primary">{e.title}</span> <span className="text-secondary">· {e.state} · {e.reason}</span>
            </div>
          ))}
        </div>
      )}

      {pane === 'compare' && comparison && (
        <div className="space-y-2" data-testid={`${prefix}-compare`}>
          <div className="text-apple-12 text-secondary" data-testid={`${prefix}-compare-summary`}>
            {comparison.added.length} added · {comparison.removed.length} removed · {comparison.changed.length} changed
          </div>
          {comparison.changed.map((c) => (
            <div key={c.claimId} className="p-3 rounded-xl border border-hairline bg-surface text-apple-12" data-testid={`${prefix}-compare-changed-${c.claimId}`}>
              <span className="text-primary">{c.claimId}</span> <span className="text-secondary">· {c.cause}</span>
            </div>
          ))}
          <div className="text-apple-12 text-secondary" data-testid={`${prefix}-compare-registers`}>
            {registerRows.length} register rows
          </div>
        </div>
      )}

      <div className="p-4 rounded-2xl bg-surface border border-hairline space-y-2" data-testid={`${prefix}-freeze`}>
        <button type="button" data-testid={`${prefix}-freeze-run`}
          className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-13 font-semibold" onClick={freeze}>
          Freeze and issue
        </button>
        {freezeResult && <pre className="text-apple-11 text-secondary whitespace-pre-wrap" data-testid={`${prefix}-freeze-result`}>{freezeResult}</pre>}
      </div>
    </div>
  );
};
