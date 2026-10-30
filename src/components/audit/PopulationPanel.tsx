import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  listPopulations,
  lockPopulation,
  registerPopulation,
  importPopulationRows,
  sha256Hex,
  type PopulationRow,
} from '../../data/population';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import { parsePopulationPaste, toSampleItems } from '../../lib/populationPaste';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { Upload, Hash, Lock, CheckCircle2, Database, RefreshCw, FileSpreadsheet } from '../common/Icons';

/**
 * Population upload panel (4I, spec §11.1, L3). Drag/drop a file, hash it in the browser, register the
 * population and lock it. The database refuses to verify a population without a hash and a row count,
 * and refuses any sample that points at an unverified population (L3). Non-blocking, inline errors.
 */
export const PopulationPanel: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const { currentUser } = useApp();
  const [rows, setRows] = useState<PopulationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteTarget, setPasteTarget] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const canWrite = hasRight(currentUser, 'perform_work');

  // The pasted block, parsed positionally (src/lib/populationPaste.ts). Columns map by index against
  // the header, so the auditor sees exactly which column lands where before anything is stored.
  const paste = parsePopulationPaste(pasteText);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listPopulations(engagementId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load populations.');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const digest = await sha256Hex(buf);
      const text = new TextDecoder().decode(buf);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      setHash(digest);
      setFilename(file.name);
      setRowCount(Math.max(0, lines.length - 1)); // subtract the header row
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hash the file.');
    }
  };

  const register = async () => {
    if (!hash || !filename) return;
    setBusy(true);
    setError(null);
    const res = await registerPopulation(engagementId, filename, hash, rowCount);
    if (!res.ok) setError(res.reason);
    else {
      setHash(null);
      setFilename(null);
      setRowCount(0);
      await load();
    }
    setBusy(false);
  };

  const lock = async (id: string) => {
    setBusy(true);
    setError(null);
    const res = await lockPopulation(id);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  const importRows = async () => {
    if (!pasteTarget || paste.rows.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await importPopulationRows(pasteTarget, toSampleItems(paste.rows), false);
    if (!res.ok) setError(res.reason);
    else {
      setPasteText('');
      await load();
    }
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="population-loading" />;
  }

  return (
    <div className="space-y-5" data-testid="population-panel">
      <InlineError message={error} testId="population-error" />

      {/* Drag/drop */}
      <div
        data-testid="population-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void onFile(f);
        }}
        className="p-6 rounded-2xl border border-dashed border-hairline bg-surface-sunken text-center space-y-2"
      >
        <Upload className="w-5 h-5 text-secondary mx-auto" />
        <div className="text-apple-13 text-primary font-medium">Drop a population file here</div>
        <div className="text-apple-11 text-secondary">
          The SHA-256 is computed in your browser before upload and must match the stored hash.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          data-testid="population-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <button
          type="button"
          data-testid="population-browse"
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary"
        >
          Choose file
        </button>
        {hash && (
          <div className="pt-2 space-y-2" data-testid="population-hash">
            <div className="flex items-center justify-center gap-2 text-apple-11 text-secondary">
              <Hash className="w-3.5 h-3.5" />
              <span className="font-mono break-all">{hash}</span>
            </div>
            <div className="text-apple-11 text-secondary">
              {filename} · {rowCount} data rows
            </div>
            <button
              type="button"
              data-testid="population-register"
              onClick={register}
              disabled={busy || !canWrite || rowCount <= 0}
              title={!canWrite ? rightReason('perform_work') : undefined}
              className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50"
            >
              Register and verify
            </button>
          </div>
        )}
      </div>

      {/* Paste grid (spec §11.1): the auditor pastes a block; columns map BY POSITION and the rows are
          stored against the chosen population. A paste is never auto-padded to the floor — inventing
          rows would fabricate evidence. */}
      <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-3" data-testid="population-paste">
        <div className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-secondary" /> Paste population rows
        </div>
        <label className="block text-apple-11 text-secondary" htmlFor="population-paste-input">
          Paste a table with a header row. The first line is the header; every later line maps to those
          columns by position. Rows are stored against a registered population.
        </label>
        <textarea
          id="population-paste-input"
          data-testid="population-paste-input"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary font-mono"
        />
        {pasteText.trim().length > 0 && (
          <div className="space-y-2" data-testid="population-paste-preview">
            <div className="text-apple-11 text-secondary" data-testid="population-paste-columns">
              {paste.header.length} column(s) mapped by position:{' '}
              <span className="text-primary font-mono">{paste.header.join(' | ')}</span>
            </div>
            <div className="text-apple-11 text-secondary tabular-nums" data-testid="population-paste-count">
              {paste.rows.length} row(s) parsed
            </div>
            {paste.errors.length > 0 && (
              <div className="text-apple-11 text-critical" data-testid="population-paste-errors">
                {paste.errors.length} line(s) rejected:{' '}
                {paste.errors.slice(0, 3).map((e) => e.message).join(' ')}
                {paste.errors.length > 3 ? ' …' : ''}
              </div>
            )}
            {paste.warnings.length > 0 && (
              <div className="text-apple-11 text-secondary" data-testid="population-paste-warnings">
                {paste.warnings.length} line(s) had extra columns that were ignored.
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <label className="text-apple-11 text-secondary" htmlFor="population-paste-target">Store against</label>
          <select
            id="population-paste-target"
            data-testid="population-paste-target"
            value={pasteTarget}
            onChange={(e) => setPasteTarget(e.target.value)}
            className="px-2 py-1 rounded-lg bg-surface-sunken border border-hairline text-apple-12 text-primary"
          >
            <option value="">Select a population…</option>
            {rows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.filename ?? p.id} ({p.rowCount ?? 0} rows)
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="population-paste-import"
            onClick={importRows}
            disabled={busy || !canWrite || !pasteTarget || paste.rows.length === 0}
            title={!canWrite ? rightReason('perform_work') : undefined}
            className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50"
          >
            Store {paste.rows.length > 0 ? paste.rows.length : ''} row{paste.rows.length === 1 ? '' : 's'}
          </button>
        </div>
        {rows.length === 0 && (
          <div className="text-apple-11 text-secondary">
            Register a population above first; pasted rows attach to a registered population.
          </div>
        )}
      </div>

      {/* List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
            Populations ({rows.length})
          </h3>
          <button type="button" onClick={() => void load()} className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover" aria-label="Refresh">
            <RefreshCw className="w-4 h-4 stroke-[1.5]" />
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="population-empty">
            <div className="text-apple-13 font-semibold text-primary mb-1">Upload a population to begin sampling</div>
            No population has been uploaded for this engagement yet. Nothing can be sampled or tested until
            a population is verified. Use the file picker above to choose a CSV or TXT export of the
            population.
          </div>
        ) : (
          <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
            {rows.map((p) => (
              <div key={p.id} className="p-4 flex items-center justify-between gap-3" data-testid={`population-row-${p.id}`}>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-secondary shrink-0" />
                    <span className="text-apple-13 font-medium text-primary truncate">{p.filename ?? 'population'}</span>
                    <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-surface-sunken border border-hairline text-secondary capitalize" data-testid={`population-status-${p.id}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="text-apple-11 text-tertiary font-mono truncate">{p.sha256}</div>
                  <div className="text-apple-11 text-secondary tabular-nums">{p.rowCount ?? 0} rows</div>
                </div>
                {p.status === 'verified' && (
                  <HoldToConfirm
                    label="Lock"
                    testId={`population-lock-${p.id}`}
                    durationMs={2000}
                    onConfirm={() => lock(p.id)}
                    disabled={busy || !canWrite}
                    className="relative overflow-hidden shrink-0 px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 transition-colors"
                  >
                    <Lock className="w-3.5 h-3.5" /> Lock
                  </HoldToConfirm>
                )}
                {p.status === 'locked' && (
                  <span className="shrink-0 text-apple-11 font-semibold text-verdigris flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Locked
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
