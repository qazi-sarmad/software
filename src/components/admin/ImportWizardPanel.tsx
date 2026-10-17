import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  commitImport,
  listImportJobs,
  startImport,
  validateImport,
  type ImportJobRow,
  type ImportType,
  type ImportValidation,
} from '../../data/imports';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Upload, CheckCircle2, AlertTriangle, RefreshCw, ChevronRight } from '../common/Icons';
import { isSpreadsheet, parseSpreadsheet } from '../../lib/xlsx';

type Step = 'upload' | 'mapping' | 'confirm';

const IMPORT_TYPES: { type: ImportType; label: string }[] = [
  { type: 'rcm', label: 'RCM and control library' },
  { type: 'entities', label: 'Entities' },
  { type: 'users', label: 'Users' },
  { type: 'populations', label: 'Populations' },
];

/** Product fields a source column can be mapped to, per import type (§19). */
const TARGET_FIELDS: Record<ImportType, string[]> = {
  rcm: ['risk_id', 'risk_description', 'control_id', 'control_description', 'control_type', 'frequency', 'owner'],
  entities: ['name', 'code', 'department', 'head_of_department', 'inherent_risk'],
  users: ['email', 'display_name', 'role', 'department'],
  populations: ['row_ref', 'amount', 'date', 'description'],
};

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line: string) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

export interface ImportWizardPanelProps {
  /** Optional target engagement; some imports (populations) are engagement-scoped. */
  engagementId?: string;
}

/**
 * Import wizard (7G, spec §19). Three steps: upload (choose file + import type), mapping (map each
 * source column to a product field), and a final preview-and-commit step. Validation runs in the
 * database (validate_import) so the org scope is enforced there; invalid rows are listed inline with
 * a field-level reason. Non-blocking throughout; every step is a plain inline surface.
 */
export const ImportWizardPanel: React.FC<ImportWizardPanelProps> = () => {
  const { currentUser } = useApp();
  const [step, setStep] = useState<Step>('upload');
  const [importType, setImportType] = useState<ImportType>('rcm');
  const [filename, setFilename] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ImportValidation | null>(null);
  const [jobs, setJobs] = useState<ImportJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const canImport = hasRight(currentUser, 'manage_engagements');

  const load = useCallback(async () => {
    try {
      setJobs(await listImportJobs());
    } catch {
      /* the history is a convenience; a failed read does not block the wizard */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const { headers: h, rows: r } = isSpreadsheet(file.name)
        ? await parseSpreadsheet(buf)
        : parseCsv(new TextDecoder().decode(buf));
      if (h.length === 0) throw new Error('The file has no header row.');
      setFilename(file.name);
      setHeaders(h);
      setRows(r);
      setMapping(Object.fromEntries(h.map((col) => [col, ''])));
      setStep('mapping');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file.');
    }
  };

  const toMappedRows = () =>
    rows.map((r) => Object.fromEntries(headers.map((h, i) => [mapping[h] || h, r[i] ?? ''])));

  const validate = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = jobId ?? (await startImport(importType, filename));
      setJobId(id);
      if (!id) throw new Error('The import job could not be created.');
      const result = await validateImport(id, toMappedRows());
      setValidation(result);
      setStep('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation failed.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const written = await commitImport(jobId, toMappedRows());
      setDone(written);
      setStep('upload');
      setHeaders([]);
      setRows([]);
      setMapping({});
      setFilename('');
      setJobId(null);
      setValidation(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import could not be committed.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('upload');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setFilename('');
    setJobId(null);
    setValidation(null);
    setError(null);
  };

  if (!canImport) {
    return (
      <div className="p-6" data-testid="import-no-right">
        <InlineError message="You need the manage-engagements right to import." testId="import-denied" />
      </div>
    );
  }

  const preview = rows.slice(0, 5);

  return (
    <div className="p-6 space-y-6" data-testid="import-wizard">
      <div className="flex items-center gap-2 border-b border-hairline pb-3">
        <Upload className="w-5 h-5 text-accent" />
        <h2 className="text-apple-16 font-bold text-primary">Import</h2>
      </div>

      <InlineError message={error} testId="import-error" onDismiss={() => setError(null)} />

      {done !== null && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-apple-12 text-primary bg-verdigris-subtle border border-verdigris" data-testid="import-done">
          <CheckCircle2 className="w-4 h-4" /> Imported {done} row{done === 1 ? '' : 's'}.
        </div>
      )}

      <ol className="flex items-center gap-2 text-apple-11 font-semibold uppercase" data-testid="import-steps">
        {(['upload', 'mapping', 'confirm'] as Step[]).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={step === s ? 'text-accent' : 'text-secondary'}>
              {i + 1}. {s}
            </span>
            {i < 2 && <ChevronRight className="w-3.5 h-3.5 text-tertiary" />}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <section className="space-y-3" data-testid="import-upload">
          <label className="space-y-1 block max-w-xs">
            <span className="block text-apple-11 font-semibold text-secondary uppercase">Import type</span>
            <Select
              ariaLabel="Import type"
              value={importType}
              options={IMPORT_TYPES.map((t) => ({ value: t.type, label: t.label }))}
              onChange={(v) => setImportType(v as ImportType)}
            />
          </label>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-surface border border-hairline text-primary hover:bg-surface-hover transition-colors"
            data-testid="import-choose-file"
          >
            Choose a CSV or XLSX file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,.xlsm"
            className="hidden"
            data-testid="import-file-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          />
          <p className="text-apple-11 text-secondary">CSV and XLSX are parsed in the browser. DOCX table import is recorded in NOT-DONE.</p>
        </section>
      )}

      {step === 'mapping' && (
        <section className="space-y-3" data-testid="import-mapping">
          <p className="text-apple-12 text-secondary">
            <span className="font-mono">{filename}</span> — map each source column to a product field.
          </p>
          <table className="w-full text-apple-12">
            <thead className="text-secondary">
              <tr>
                <th className="text-left py-1.5 font-semibold">Source column</th>
                <th className="text-left py-1.5 font-semibold">Maps to</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((h) => (
                <tr key={h} className="border-t border-hairline">
                  <td className="py-1.5 text-primary font-mono">{h}</td>
                  <td className="py-1.5">
                    <Select
                      ariaLabel={`Map ${h}`}
                      value={mapping[h] ?? ''}
                      options={[{ value: '', label: '— ignore —' }, ...TARGET_FIELDS[importType].map((f) => ({ value: f, label: f }))]}
                      onChange={(v) => setMapping((m) => ({ ...m, [h]: v }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2">
            <button type="button" onClick={() => void validate()} disabled={busy} data-testid="import-validate" className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-accent-subtle text-primary border border-accent hover:bg-surface-hover disabled:opacity-50">
              {busy ? 'Validating…' : 'Validate'}
            </button>
            <button type="button" onClick={reset} className="px-3 py-2 rounded-xl text-apple-12 text-secondary hover:text-primary">
              Cancel
            </button>
          </div>
        </section>
      )}

      {step === 'confirm' && validation && (
        <section className="space-y-3" data-testid="import-confirm">
          <div className="flex gap-4 text-apple-12">
            <span className="text-verdigris font-semibold" data-testid="import-valid-count">{validation.valid} valid</span>
            <span className="text-cinnabar font-semibold" data-testid="import-invalid-count">{validation.invalid} invalid</span>
          </div>
          {validation.errors.length > 0 && (
            <div className="rounded-xl border border-cinnabar bg-cinnabar-subtle p-3 space-y-1" data-testid="import-errors">
              <div className="flex items-center gap-2 text-cinnabar text-apple-12 font-semibold">
                <AlertTriangle className="w-4 h-4" /> Rows needing attention
              </div>
              <ul className="text-apple-12 text-cinnabar space-y-0.5">
                {validation.errors.map((e, i) => (
                  <li key={i}>Row {e.row}: <span className="font-mono">{e.field}</span> — {e.reason}</li>
                ))}
              </ul>
            </div>
          )}
          <table className="w-full text-apple-12" data-testid="import-preview">
            <thead className="text-secondary">
              <tr>
                {headers.map((h) => <th key={h} className="text-left py-1.5 font-semibold font-mono">{mapping[h] || h}</th>)}
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i} className="border-t border-hairline">
                  {headers.map((h, j) => <td key={h} className="py-1.5 text-primary">{r[j]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2">
            <button type="button" onClick={() => void commit()} disabled={busy} data-testid="import-commit" className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-accent-subtle text-primary border border-accent hover:bg-surface-hover disabled:opacity-50">
              {busy ? 'Committing…' : `Confirm and import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" onClick={() => setStep('mapping')} className="px-3 py-2 rounded-xl text-apple-12 text-secondary hover:text-primary">
              Back to mapping
            </button>
          </div>
        </section>
      )}

      <section className="space-y-2" data-testid="import-history">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-13 font-semibold text-primary">Recent imports</h3>
          <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {jobs.length === 0 ? (
          <p className="text-secondary text-apple-13 py-4" data-testid="import-history-empty">No imports have been run yet.</p>
        ) : (
          <ul className="space-y-1">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between text-apple-12 border-t border-hairline py-1.5" data-testid={`import-job-${j.id}`}>
                <span className="text-primary">{j.importType} — <span className="font-mono">{j.sourceFilename ?? 'file'}</span></span>
                <span className="text-secondary uppercase">{j.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
