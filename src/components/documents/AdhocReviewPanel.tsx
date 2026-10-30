import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { Sliders, ShieldCheck, AlertTriangle, CheckCircle2, Lock } from '../common/Icons';
import {
  buildAdhocRule, runAdhocRule,
  type AdhocRuleSpec, type RuleFinding,
} from '../../lib/systeligon';
import { ENGINE_NAME } from '../../lib/product';

/**
 * The ad-hoc review builder (OA-38, S7) — a SEPARATE module from the document-review screen.
 *
 * The system's own review flow runs independently and asks nothing of the auditor: the document-review
 * screen (OA-36) runs every option selected over the whole set, unprompted. This screen is the
 * opposite and exists only when the auditor asks for it — they describe ONE condition of their own
 * (a source attribute, an operator, a threshold) and preview it over sample rows before releasing it.
 *
 * The built rule is a normal versioned rule: it runs through the same runner and its findings carry
 * its id and version like any shipped rule. It is a declared condition over the data, not a model:
 * nothing is inferred, nothing is generated, and the preview instant is captured here and passed in.
 */

const input = 'h-9 w-full px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent';

/** The operators a builder may pick, in a fixed order. Mirrors `AdhocRuleSpec['condition']`. */
const CONDITIONS: { value: AdhocRuleSpec['condition']; label: string }[] = [
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'eq', label: 'equal to' },
  { value: 'ne', label: 'not equal to' },
  { value: 'between', label: 'between' },
  { value: 'missing', label: 'missing' },
];

const SEVERITIES: AdhocRuleSpec['severity'][] = ['info', 'low', 'medium', 'high'];

/** A fixed sample, so a preview is reproducible and never depends on the clock or the live data. */
const SAMPLE_ROWS = [
  { ref: 's1', values: { amount: 120, status: 'open', owner: null } },
  { ref: 's2', values: { amount: 5, status: 'open', owner: 'A' } },
  { ref: 's3', values: { amount: null, status: 'closed', owner: 'B' } },
];

export const AdhocReviewPanel: React.FC<{ screenId?: string }> = ({ screenId = 'OA-38' }) => {
  const { currentUser } = useApp();
  const canRun = hasRight(currentUser, 'perform_work');

  const [title, setTitle] = useState('Amount above the review threshold');
  const [source, setSource] = useState('amount');
  const [condition, setCondition] = useState<AdhocRuleSpec['condition']>('gt');
  const [threshold, setThreshold] = useState('100');
  const [threshold2, setThreshold2] = useState('200');
  const [severity, setSeverity] = useState<AdhocRuleSpec['severity']>('medium');

  const [preview, setPreview] = useState<RuleFinding[] | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spec = useMemo<AdhocRuleSpec>(() => ({
    id: 'adhoc.review',
    version: 1,
    title,
    source,
    condition,
    threshold: Number(threshold),
    threshold2: condition === 'between' ? Number(threshold2) : undefined,
    severity,
  }), [title, source, condition, threshold, threshold2, severity]);

  const needsSecondBound = condition === 'between';

  const run = () => {
    setError(null);
    try {
      const at = new Date().toISOString();
      // Build first, so the builder's own validation runs before the preview.
      buildAdhocRule(spec, 'draft');
      const result = runAdhocRule(spec, SAMPLE_ROWS, at);
      setPreview(result.findings);
      setRanAt(at);
    } catch (e) {
      setPreview(null);
      setRanAt(null);
      setError(e instanceof Error ? e.message : 'The ad-hoc rule could not be built.');
    }
  };

  return (
    <div className="space-y-6" data-testid="adhoc-review-panel" data-screen={screenId}>
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <Sliders className="w-4 h-4 text-verdigris" />
          <span>{ENGINE_NAME} ad-hoc review</span>
        </div>
        <p className="text-apple-12 text-secondary">
          A separate builder, used only when you ask for it. Describe one condition of your own — a
          source attribute, an operator, a threshold — and preview it over a fixed sample before you
          release it. The engine&rsquo;s own review flow runs independently and needs nothing from this
          screen.
        </p>
      </div>

      {!canRun && (
        <p className="text-apple-12 text-secondary" data-testid="adhoc-review-rights-note">
          <Lock className="inline w-3.5 h-3.5 mr-1" />
          {rightReason('perform_work')} — you can read this screen, but building a rule needs{' '}
          <span className="font-mono">perform_work</span>.
        </p>
      )}

      <InlineError message={error} testId="adhoc-review-error" onDismiss={() => setError(null)} />

      <section className="space-y-3" data-testid="adhoc-review-form">
        <label className="block space-y-1">
          <span className="text-apple-11 uppercase text-secondary">Title</span>
          <input className={input} data-testid="adhoc-review-title" value={title}
            onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-apple-11 uppercase text-secondary">Source attribute</span>
            <input className={input} data-testid="adhoc-review-source" value={source}
              onChange={(e) => setSource(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-apple-11 uppercase text-secondary">Condition</span>
            <select className={input} data-testid="adhoc-review-condition" value={condition}
              onChange={(e) => setCondition(e.target.value as AdhocRuleSpec['condition'])}>
              {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-apple-11 uppercase text-secondary">Threshold</span>
            <input className={input} data-testid="adhoc-review-threshold" type="number" value={threshold}
              onChange={(e) => setThreshold(e.target.value)} />
          </label>
          {needsSecondBound && (
            <label className="block space-y-1">
              <span className="text-apple-11 uppercase text-secondary">Second bound</span>
              <input className={input} data-testid="adhoc-review-threshold2" type="number" value={threshold2}
                onChange={(e) => setThreshold2(e.target.value)} />
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-apple-11 uppercase text-secondary">Severity</span>
            <select className={input} data-testid="adhoc-review-severity" value={severity}
              onChange={(e) => setSeverity(e.target.value as AdhocRuleSpec['severity'])}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <button type="button" data-testid="adhoc-review-preview" disabled={!canRun} onClick={run}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50">
          <ShieldCheck className="w-3.5 h-3.5" /> Preview over the sample
        </button>
      </section>

      {preview && (
        <section className="space-y-2" data-testid="adhoc-review-result">
          <p className="text-apple-12 text-secondary" data-testid="adhoc-review-summary">
            {preview.length} of {SAMPLE_ROWS.length} sample row(s) match · rule{' '}
            <span className="font-mono text-primary">{spec.id}@v{spec.version}</span> · run {ranAt}
          </p>
          {preview.length === 0 ? (
            <p className="text-apple-12 text-verdigris inline-flex items-center gap-1" data-testid="adhoc-review-empty">
              <CheckCircle2 className="w-3.5 h-3.5" /> No sample row matches this condition.
            </p>
          ) : (
            <ul className="space-y-1" data-testid="adhoc-review-findings">
              {preview.map((f, i) => (
                <li key={`${f.refs.join(',')}-${i}`} className="text-apple-12" data-testid={`adhoc-review-finding-${i}`}>
                  <AlertTriangle className="inline w-3.5 h-3.5 mr-1 text-brass" />
                  <span className="font-mono text-primary">{f.refs.join(', ')}</span>
                  {' — '}<span className="text-secondary">{f.reason}</span>
                  <span className="text-apple-11 text-tertiary"> · {f.severity}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};
