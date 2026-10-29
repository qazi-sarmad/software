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
import { parseSpreadsheet } from '../../lib/xlsx';
import { parseDocxTables } from '../../lib/docxImport';
import { recogniseBytes, sniffBytes, buildInventory, type Inventory } from '../../lib/recognition';
import { sha256Bytes } from '../../lib/render/inspect';

type Step = 'upload' | 'mapping' | 'confirm';

const IMPORT_TYPES: { type: ImportType; label: string }[] = [
  { type: 'rcm', label: 'RCM and control library' },
  { type: 'entities', label: 'Entities' },
  { type: 'users', label: 'Users' },
  { type: 'populations', label: 'Populations' },
];

interface ParsedSheetChoice { name: string; headers: string[]; rows: string[][] }

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
  // When the bytes and the extension disagree, say so rather than silently importing under the name.
  const [recognitionNote, setRecognitionNote] = useState<string | null>(null);
  // The inventory line for the file just chosen (S17): what it IS, and its hash.
  const [recognised, setRecognised] = useState<{ kind: string; sha256: string; byteSize: number } | null>(null);
  // The full S17 inventory for the chosen file: metadata, archive members, and any refusal.
  const [inventory, setInventory] = useState<Inventory | null>(null);
  // A DOCX can hold several tables; when it does, the operator picks which one to import.
  const [docxSheets, setDocxSheets] = useState<ParsedSheetChoice[]>([]);
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

  const applySheet = (name: string, h: string[], r: string[][]) => {
    if (h.length === 0) throw new Error('The file has no header row.');
    setFilename(name);
    setHeaders(h);
    setRows(r);
    setMapping(Object.fromEntries(h.map((col) => [col, ''])));
    setStep('mapping');
  };

  const onFile = async (file: File) => {
    setError(null);
    setRecognitionNote(null);
    setDocxSheets([]);
    setInventory(null);
    try {
      const buf = await file.arrayBuffer();
      // Recognise the bytes before routing (S17). The extension is a claim; the magic bytes are the
      // fact. A file whose bytes disagree with its name is still imported when the bytes are a format
      // the wizard can read — with the disagreement stated — and refused when they are not, rather
      // than being handed to a parser that would misread it.
      const bytes = new Uint8Array(buf);
      const kind = await sniffBytes(file.name, bytes);
      const recognition = recogniseBytes(file.name, bytes);
      if (!recognition.agrees && recognition.claimed !== 'unknown') {
        setRecognitionNote(recognition.detail);
      }
      // The full inventory (S17): metadata the file carries, an archive's members under the safety
      // limits, and any refusal (a zip bomb or an unsafe path) — stated, never hidden.
      setInventory(await buildInventory([{ filename: file.name, bytes }], sha256Bytes));
      // The inventory line the operator confirms: what the file IS and its fingerprint (S17). The
      // hash is of the file the user chose, computed in their own browser; nothing leaves the tenant.
      setRecognised({ kind, sha256: await sha256Bytes(bytes), byteSize: bytes.length });
      if (kind === 'docx') {
        const sheets = await parseDocxTables(buf);
        if (sheets.length === 0) throw new Error('The document has no table to import.');
        if (sheets.length === 1) {
          applySheet(file.name, sheets[0].headers, sheets[0].rows);
          return;
        }
        // More than one table: ask which. The operator sees a header list and row count per table.
        setDocxSheets(sheets.map((s) => ({ name: s.name, headers: s.headers, rows: s.rows })));
        setFilename(file.name);
        setStep('mapping');
        return;
      }
      if (kind === 'xlsx' || kind === 'csv' || kind === 'text') {
        const { headers: h, rows: r } = kind === 'xlsx'
          ? await parseSpreadsheet(buf)
          : parseCsv(new TextDecoder().decode(bytes));
        applySheet(file.name, h, r);
        return;
      }
      // Anything else cannot be imported as a table. Name what it really is.
      throw new Error(
        kind === 'unknown'
          ? 'This file is not a CSV, XLSX or DOCX; its contents are not a table.'
          : `This file is a ${kind.toUpperCase()} file, not a table. Choose a CSV, XLSX or DOCX.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file.');
    }
  };

  const chooseDocxTable = (choice: ParsedSheetChoice) => {
    setError(null);
    try {
      applySheet(`${filename} — ${choice.name}`, choice.headers, choice.rows);
      setDocxSheets([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the table.');
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
    setRecognitionNote(null);
    setRecognised(null);
    setInventory(null);
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

      {recognitionNote && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-apple-12 text-primary bg-cinnabar-subtle border border-cinnabar" data-testid="import-recognition-note">
          <AlertTriangle className="w-4 h-4 text-cinnabar" /> {recognitionNote} The file was read as what its bytes say.
        </div>
      )}

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
            Choose a CSV, XLSX or DOCX file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,.xlsm,.docx"
            className="hidden"
            data-testid="import-file-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          />
          <p className="text-apple-11 text-secondary">CSV, XLSX and DOCX tables are parsed in the browser, on the file you chose.</p>
          {recognised && (
            <p className="text-apple-11 text-secondary" data-testid="import-recognised">
              Recognised: <span className="font-semibold text-primary">{recognised.kind.toUpperCase()}</span>
              {' · '}{(recognised.byteSize / 1024).toFixed(1)} KB
              {recognised.sha256 && <> · SHA-256 <span className="font-mono text-tertiary">{recognised.sha256.slice(0, 16)}…</span></>}
            </p>
          )}
          {inventory && inventory.items[0] && (
            <div className="space-y-1.5 text-apple-11 text-secondary" data-testid="import-inventory">
              <p data-testid="import-inventory-counts">
                Inventory: {inventory.importable} importable
                {inventory.unrecognised > 0 && <> · {inventory.unrecognised} unrecognised</>}
                {inventory.refused > 0 && <> · <span className="text-cinnabar">{inventory.refused} refused</span></>}
              </p>
              {(inventory.items[0].metadata.title || inventory.items[0].metadata.author || inventory.items[0].metadata.application || inventory.items[0].metadata.created) && (
                <p data-testid="import-inventory-metadata">
                  Metadata the file carries:{' '}
                  {[
                    inventory.items[0].metadata.title && `title "${inventory.items[0].metadata.title}"`,
                    inventory.items[0].metadata.author && `author ${inventory.items[0].metadata.author}`,
                    inventory.items[0].metadata.application && `application ${inventory.items[0].metadata.application}`,
                    inventory.items[0].metadata.created && `created ${inventory.items[0].metadata.created}`,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              {inventory.items[0].archive && (
                <p data-testid="import-inventory-archive">
                  Archive: {inventory.items[0].archive!.entries.length} member{inventory.items[0].archive!.entries.length === 1 ? '' : 's'},{' '}
                  {(inventory.items[0].archive!.totalBytes / 1024).toFixed(1)} KB uncompressed
                  {inventory.items[0].archive!.ratio > 0 && <> · compression ratio {inventory.items[0].archive!.ratio.toFixed(1)}×</>}
                  {' — '}
                  <span className="font-mono text-tertiary">
                    {inventory.items[0].archive!.entries.slice(0, 4).map((e) => e.path).join(', ')}
                    {inventory.items[0].archive!.entries.length > 4 ? ', …' : ''}
                  </span>
                </p>
              )}
              {inventory.items[0].note && (
                <p className="text-cinnabar" data-testid="import-inventory-note">{inventory.items[0].note}</p>
              )}
            </div>
          )}
        </section>
      )}

      {docxSheets.length > 1 && (
        <section className="space-y-2" data-testid="import-docx-tables">
          <p className="text-apple-12 text-secondary">
            This document holds {docxSheets.length} tables. Choose the one to import.
          </p>
          <ul className="space-y-1">
            {docxSheets.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => chooseDocxTable(t)}
                  data-testid={`import-docx-${t.name.replace(/\s+/g, '-').toLowerCase()}`}
                  className="px-3 py-1.5 rounded-lg text-apple-12 border border-hairline text-primary hover:bg-surface-hover"
                >
                  {t.name} — {t.headers.slice(0, 4).join(', ')}
                  {t.headers.length > 4 ? '…' : ''} ({t.rows.length} rows)
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 'mapping' && headers.length > 0 && (
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
