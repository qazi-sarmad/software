import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import {
  exportAuditPlan,
  exportCapRegister,
  exportEngagementBundle,
  exportFullTenant,
  exportLedger,
  exportSiraResults,
  exportWorkpaper,
  listExports,
  logExport,
  type ExportFormat,
  type ExportLogRow,
} from '../../data/exports';
import {
  downloadBytes,
  renderExport,
  type BinaryFormat,
} from '../../lib/exportRender';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Download, Hash, RefreshCw, Lock } from '../common/Icons';

type ObjectType = 'workpaper' | 'engagement' | 'sira' | 'audit_plan' | 'cap_register' | 'ledger' | 'full_tenant';

interface ExportObject {
  type: ObjectType;
  label: string;
  /** Rights the database requires for this object (§18, §26). Checked here only as a courtesy. */
  right: 'perform_work' | 'manage_users';
  /** Formats offered for this object, from the §18 table. */
  formats: ExportFormat[];
}

const OBJECTS: ExportObject[] = [
  { type: 'workpaper', label: 'Working paper', right: 'perform_work', formats: ['pdf', 'xlsx', 'docx', 'csv'] },
  { type: 'engagement', label: 'Audit File bundle', right: 'perform_work', formats: ['zip', 'json'] },
  { type: 'sira', label: 'SIRA results', right: 'perform_work', formats: ['pdf', 'xlsx', 'png', 'csv'] },
  { type: 'audit_plan', label: 'Audit Plan (incl. Gantt)', right: 'perform_work', formats: ['pdf', 'xlsx', 'png', 'csv'] },
  { type: 'cap_register', label: 'CAP register', right: 'perform_work', formats: ['xlsx', 'csv', 'pdf'] },
  { type: 'ledger', label: 'Business ledger', right: 'perform_work', formats: ['json', 'csv'] },
  { type: 'full_tenant', label: 'Full tenant export', right: 'manage_users', formats: ['zip', 'json', 'csv'] },
];

export interface ExportPanelProps {
  /** The engagement a per-object export is scoped to, when the panel is opened from an Audit File. */
  engagementId?: string;
  workpaperId?: string;
  universeId?: string;
  cycleId?: string;
}

/**
 * Export panel (7G, spec §18). Each object offers the formats the §18 table lists; the export runs
 * through the data module, the payload is serialised in the browser, its hash is computed and then
 * recorded by log_export, and a confirmation chip shows the recorded hash. Non-blocking; the export
 * history below the controls is the tenant's own exports_log (RLS-scoped).
 */
export const ExportPanel: React.FC<ExportPanelProps> = ({ engagementId, workpaperId, universeId, cycleId }) => {
  const { currentUser } = useApp();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selected, setSelected] = useState<ObjectType>('workpaper');
  const [history, setHistory] = useState<ExportLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<{ object: string; hash: string; filename: string } | null>(null);

  const orgId = currentUser.orgId ?? '';
  const canExport = hasRight(currentUser, 'perform_work');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await listExports());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the export history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = OBJECTS.find((o) => o.type === selected)!;

  const run = async () => {
    setBusy(true);
    setError(null);
    setConfirmed(null);
    try {
      let payload: unknown = null;
      let objectId: string | null = null;
      switch (selected) {
        case 'workpaper':
          if (!workpaperId) throw new Error('Open a working paper before exporting it.');
          payload = await exportWorkpaper(workpaperId);
          objectId = workpaperId;
          break;
        case 'engagement':
          if (!engagementId) throw new Error('Open an engagement before exporting its bundle.');
          payload = await exportEngagementBundle(engagementId);
          objectId = engagementId;
          break;
        case 'sira':
          if (!universeId || !cycleId) throw new Error('Select a SIRA cycle before exporting its results.');
          payload = await exportSiraResults(universeId, cycleId);
          objectId = cycleId;
          break;
        case 'audit_plan':
          if (!universeId) throw new Error('Select an audit universe before exporting its plan.');
          payload = await exportAuditPlan(universeId);
          objectId = universeId;
          break;
        case 'cap_register':
          payload = await exportCapRegister(orgId);
          objectId = orgId;
          break;
        case 'ledger':
          payload = await exportLedger(orgId);
          objectId = orgId;
          break;
        case 'full_tenant':
          payload = await exportFullTenant(orgId);
          objectId = orgId;
          break;
      }
      const rendered = await renderExport({
        objectType: selected,
        data: payload,
        format: format as BinaryFormat,
      });
      await logExport(selected, objectId, format, {}, rendered.hash);
      const filename = `${selected}-export.${rendered.extension}`;
      downloadBytes(rendered.bytes, filename, rendered.contentType);
      setConfirmed({ object: current.label, hash: rendered.hash, filename });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The export could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (!canExport) {
    return (
      <div className="p-6" data-testid="export-no-right">
        <InlineError message="You need a working right to export." testId="export-denied" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="export-panel">
      <div className="flex items-center gap-2 border-b border-hairline pb-3">
        <Download className="w-5 h-5 text-accent" />
        <h2 className="text-apple-16 font-bold text-primary">Export</h2>
      </div>

      <InlineError message={error} testId="export-error" onDismiss={() => setError(null)} />

      <div className="flex flex-wrap items-end gap-3" data-testid="export-controls">
        <label className="space-y-1">
          <span className="block text-apple-11 font-semibold text-secondary uppercase">Object</span>
          <Select
            ariaLabel="Export object"
            value={selected}
            options={OBJECTS.filter((o) => hasRight(currentUser, o.right)).map((o) => ({ value: o.type, label: o.label }))}
            onChange={(v) => { setSelected(v as ObjectType); setFormat(OBJECTS.find((o) => o.type === v)!.formats[0]); }}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-apple-11 font-semibold text-secondary uppercase">Format</span>
          <Select
            ariaLabel="Export format"
            value={format}
            options={current.formats.map((f) => ({ value: f, label: f.toUpperCase() }))}
            onChange={(v) => setFormat(v as ExportFormat)}
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          data-testid="export-run"
          className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-accent-subtle text-primary border border-accent hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          {busy ? 'Exporting…' : 'Export'}
        </button>
        {current.right === 'manage_users' && (
          <span className="text-apple-11 text-secondary flex items-center gap-1">
            <Lock className="w-3.5 h-3.5" /> {rightReason('manage_users')}
          </span>
        )}
      </div>

      {confirmed && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-apple-12 text-primary bg-verdigris-subtle border border-verdigris"
          data-testid="export-confirmation"
        >
          <Hash className="w-4 h-4 shrink-0" />
          <span>
            {confirmed.object} exported as <span className="font-mono">{confirmed.filename}</span>; recorded hash{' '}
            <span className="font-mono" data-testid="export-confirmation-hash">{confirmed.hash.slice(0, 16)}…</span>
          </span>
        </div>
      )}

      <section className="space-y-2" data-testid="export-history">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-13 font-semibold text-primary">Export history</h3>
          <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {loading ? (
          <p className="text-secondary text-apple-13 py-4" data-testid="export-history-loading">Loading export history…</p>
        ) : history.length === 0 ? (
          <p className="text-secondary text-apple-13 py-4" data-testid="export-history-empty">No exports have been recorded yet.</p>
        ) : (
          <table className="w-full text-apple-12">
            <thead className="text-secondary">
              <tr>
                <th className="text-left py-1.5 font-semibold">Object</th>
                <th className="text-left py-1.5 font-semibold">Format</th>
                <th className="text-left py-1.5 font-semibold">Hash</th>
                <th className="text-left py-1.5 font-semibold">When</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-hairline" data-testid={`export-row-${h.id}`}>
                  <td className="py-1.5 text-primary">{h.objectType}</td>
                  <td className="py-1.5 text-secondary uppercase">{h.format}</td>
                  <td className="py-1.5 font-mono text-secondary">{h.contentHash ? `${h.contentHash.slice(0, 12)}…` : '—'}</td>
                  <td className="py-1.5 text-secondary">{h.createdAt ? new Date(h.createdAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
