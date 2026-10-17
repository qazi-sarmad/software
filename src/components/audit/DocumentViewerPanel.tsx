import React, { useCallback, useEffect, useState } from 'react';
import {
  listEvidenceFiles,
  searchDocuments,
  requestExtraction,
  isDocumentStage,
  type DocumentHit,
  type DocumentStage,
  type EvidenceFileRow,
} from '../../data/documents';
import { InlineError } from '../common/InlineError';
import { FileText, Search, Upload, ChevronLeft, ChevronRight } from '../common/Icons';

const STAGE_TABS: { id: DocumentStage; label: string }[] = [
  { id: 'planning', label: 'Planning' },
  { id: 'testing', label: 'Testing' },
  { id: 'conclusion', label: 'Conclusion' },
];

const STAGE_BADGE: Record<DocumentStage, string> = {
  planning: 'text-secondary',
  testing: 'text-primary',
  conclusion: 'text-verdigris',
};

/**
 * Document viewer (5G, spec §17.2). A non-blocking right-side panel with a toggleable left list, a
 * stage-aware tab filter and full-text search over extracted text. The search and the stage filter
 * live in the database (0035, `search_documents`); the extraction request is a stub (NOT-DONE).
 * There is no backdrop and no dialog attribute: the panel never blocks the page behind it.
 */
export const DocumentViewerPanel: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const [stage, setStage] = useState<DocumentStage>('planning');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<DocumentHit[]>([]);
  const [files, setFiles] = useState<EvidenceFileRow[]>([]);
  const [listOpen, setListOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [found, all] = await Promise.all([
        searchDocuments(engagementId, query.trim(), stage),
        listEvidenceFiles(engagementId),
      ]);
      setHits(found);
      setFiles(all.filter((f) => f.stage === null || isDocumentStage(f.stage)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load documents.');
    } finally {
      setLoading(false);
    }
  }, [engagementId, query, stage]);

  useEffect(() => {
    void load();
  }, [load]);

  const queueExtraction = async (fileId: string) => {
    setBusy(true);
    setError(null);
    const res = await requestExtraction(fileId);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  return (
    <div className="flex gap-4" data-testid="document-viewer">
      {listOpen && (
        <aside className="w-56 shrink-0 border border-hairline rounded-xl bg-surface overflow-hidden" data-testid="document-list">
          <div className="px-3 py-2 text-apple-11 font-semibold text-secondary uppercase tracking-wider border-b border-hairline">
            Documents
          </div>
          {files.length === 0 ? (
            <div className="p-3 text-apple-12 text-secondary" data-testid="document-list-empty">No files yet.</div>
          ) : (
            <ul className="divide-y divide-hairline">
              {files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(f.id)}
                    className={`w-full text-left px-3 py-2 text-apple-12 hover:bg-surface-hover transition-colors ${
                      selected === f.id ? 'bg-surface-hover text-primary' : 'text-secondary'
                    }`}
                    data-testid={`document-item-${f.id}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{f.filename ?? 'Untitled'}</span>
                    </span>
                    <span className={`text-apple-11 ${f.stage ? STAGE_BADGE[f.stage] : 'text-tertiary'}`}>
                      {f.stage ?? 'unfiled'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="document-list-toggle"
            onClick={() => setListOpen((v) => !v)}
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover"
            aria-label={listOpen ? 'Hide document list' : 'Show document list'}
          >
            {listOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div role="tablist" aria-label="Document stage" className="flex items-center gap-1">
            {STAGE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={stage === t.id}
                data-testid={`document-stage-${t.id}`}
                onClick={() => setStage(t.id)}
                className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold transition-colors ${
                  stage === t.id ? 'bg-surface-hover text-primary' : 'text-secondary hover:text-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
            <input
              data-testid="document-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search extracted text…"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-sunken border border-hairline text-apple-12 text-primary"
            />
          </div>
        </div>

        <InlineError message={error} testId="document-error" />

        {loading ? (
          <div className="h-24 rounded-xl bg-surface-sunken border border-hairline animate-pulse" data-testid="document-loading" />
        ) : hits.length === 0 ? (
          <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="document-empty">
            {query.trim()
              ? 'No documents in this stage match the search.'
              : 'No extracted text is available for this stage yet.'}
          </div>
        ) : (
          <ul className="space-y-2" data-testid="document-results">
            {hits.map((h) => (
              <li key={`${h.fileId}-${h.extractionId ?? 'none'}`} className="p-3 rounded-xl bg-surface border border-hairline" data-testid={`document-hit-${h.fileId}`}>
                <div className="flex items-center justify-between">
                  <span className="text-apple-12 font-semibold text-primary truncate">{h.filename ?? 'Untitled'}</span>
                  <span className="text-apple-11 text-secondary tabular-nums">
                    {h.pageCount != null ? `${h.pageCount} page${h.pageCount === 1 ? '' : 's'}` : h.status}
                  </span>
                </div>
                {h.snippet && <p className="mt-1 text-apple-12 text-secondary line-clamp-2">{h.snippet}</p>}
                {h.status === 'pending' && (
                  <button
                    type="button"
                    data-testid={`document-extract-${h.fileId}`}
                    onClick={() => queueExtraction(h.fileId)}
                    disabled={busy}
                    className="mt-2 px-2.5 py-1 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-11 font-semibold text-primary disabled:opacity-50 flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> Queue extraction
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
