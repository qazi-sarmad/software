import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Check, Plus, X } from '../common/Icons';
import {
  listReportTemplates, saveReportTemplate,
  REPORT_SECTION_IDS, type ReportSectionId, type ReportTemplateRow,
} from '../../data/governance';

type LoadState = 'loading' | 'ready' | 'error';

const SECTION_LABELS: Record<ReportSectionId, string> = {
  executive_summary: 'Executive Summary',
  scope: 'Scope and Objectives',
  findings: 'Findings and Issues',
  opinion: 'Overall Opinion',
  appendices: 'Appendices',
};

const DEFAULT_SECTIONS: ReportSectionId[] = ['executive_summary', 'scope', 'findings', 'opinion', 'appendices'];

/**
 * Report template editor (Phase 3.4, §15.2).
 *
 * The organisation's report template is the section plan `compose_report` follows when it drafts a
 * report. This screen makes that plan configurable: choose which of the five report sections appear,
 * and in what order. Saving writes a new versioned, logged template (0088's hash chain) and the next
 * composed report uses it. With no template saved the default five-section order applies.
 *
 * The section ids are a closed set: the product can only render the sections it knows, and the
 * database refuses anything else, so the screen cannot produce an unrenderable report.
 */
export const ReportTemplatePanel: React.FC = () => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<ReportTemplateRow[]>([]);
  const [sections, setSections] = useState<ReportSectionId[]>(DEFAULT_SECTIONS);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const rows = await listReportTemplates();
      setTemplates(rows);
      const current = rows.find((r) => r.modelId === 'M1');
      setSections(current && current.sections.length
        ? current.sections.sort((a, b) => a.order - b.order).map((s) => s.id)
        : DEFAULT_SECTIONS);
      setState('ready');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the report template.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const move = (index: number, delta: number) => {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
  };

  const remove = (id: ReportSectionId) => setSections(sections.filter((s) => s !== id));
  const add = (id: ReportSectionId) => setSections([...sections, id]);

  const save = async () => {
    setBusy(true); setResult(null); setLoadError('');
    const res = await saveReportTemplate('M1', 'Report template', sections);
    if (!res.ok) setLoadError(res.reason);
    else { setResult('Report template saved. The next composed report uses this section plan.'); await load(); }
    setBusy(false);
  };

  if (!canEdit) {
    return (
      <div data-testid="report-template-no-right">
        <InlineError message="You need the Edit configuration right to change the report template." testId="report-template-denied" />
      </div>
    );
  }

  if (state === 'loading') {
    return <p className="text-apple-12 text-secondary" data-testid="report-template-loading">Loading report template…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="report-template-error" />;
  }

  const current = templates.find((r) => r.modelId === 'M1');
  const available = REPORT_SECTION_IDS.filter((id) => !sections.includes(id));

  return (
    <section className="space-y-4" data-testid="report-template-panel">
      <header className="space-y-1">
        <h3 className="text-apple-15 font-semibold text-primary">Report template</h3>
        <p className="text-apple-12 text-secondary">
          Choose which sections a composed report contains, and their order. Saving writes a new
          version; the next composed report follows it. With nothing saved, the default five-section
          order applies.
        </p>
        {current && (
          <p className="text-apple-12 text-secondary" data-testid="report-template-version">
            Current version {current.version}{current.title ? ` — ${current.title}` : ''}
          </p>
        )}
      </header>

      {loadError && <InlineError message={loadError} testId="report-template-save-error" />}
      {result && (
        <p className="text-apple-12 text-secondary" data-testid="report-template-result">{result}</p>
      )}

      <ul className="space-y-1" data-testid="report-template-sections">
        {sections.length === 0 && (
          <li className="text-apple-12 text-secondary" data-testid="report-template-empty">
            No sections selected; the report would be empty. Add at least one.
          </li>
        )}
        {sections.map((id, i) => (
          <li key={id} className="flex items-center justify-between rounded-xl border border-hairline px-3 py-2"
              data-testid={`report-template-section-${id}`}>
            <span className="text-apple-13 text-primary">{SECTION_LABELS[id]}</span>
            <span className="flex items-center gap-1">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)}
                data-testid={`report-template-up-${id}`}
                className="px-2 py-1 rounded-lg border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40">
                ↑
              </button>
              <button type="button" disabled={i === sections.length - 1} onClick={() => move(i, 1)}
                data-testid={`report-template-down-${id}`}
                className="px-2 py-1 rounded-lg border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40">
                ↓
              </button>
              <button type="button" onClick={() => remove(id)}
                data-testid={`report-template-remove-${id}`}
                className="px-2 py-1 text-cinnabar hover:opacity-80">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3" data-testid="report-template-add-row">
          {available.map((id) => (
            <button key={id} type="button" onClick={() => add(id)}
              data-testid={`report-template-add-${id}`}
              className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle">
              <Plus className="w-3.5 h-3.5" /> {SECTION_LABELS[id]}
            </button>
          ))}
        </div>
      )}

      <button type="button" disabled={busy || sections.length === 0} onClick={() => void save()}
        data-testid="report-template-save"
        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50">
        <Check className="w-3.5 h-3.5" /> Save template
      </button>
    </section>
  );
};
