import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { Search, FileText, ExternalLink, Lock, Layers } from '../common/Icons';
import { searchDocumentsGlobal, type GlobalSearchHit } from '../../data/globalSearch';
import { ENGINE_NAME } from '../../lib/product';

type LoadState = 'idle' | 'searching' | 'ready' | 'error';

const input = 'h-9 w-full px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent';

/** The read rights that may search. A configuration-only principal holds none of them. */
const READ_RIGHTS = ['perform_work', 'review_and_approve', 'read_only', 'view_all_scopes'] as const;

/**
 * Render a database headline as React nodes, turning its `<mark>…</mark>` wrappers into highlighted
 * spans. The headline is the document's own text with only the mark wrappers added by `ts_headline`;
 * this splits on those wrappers and renders every part as TEXT, so no document content is ever
 * interpreted as HTML (never `dangerouslySetInnerHTML`).
 */
function renderHeadline(headline: string): React.ReactNode {
  return headline.split(/(<mark>[\s\S]*?<\/mark>)/g).map((part, i) => {
    const m = /^<mark>([\s\S]*)<\/mark>$/.exec(part);
    return m ? <mark key={i}>{m[1]}</mark> : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

/**
 * Global document search (S7, OA-39).
 *
 * One box that full-text-searches the whole tenant's extracted document text and returns only the
 * documents the caller may see. This is the tenant-wide counterpart to the engagement-scoped
 * Document Viewer (OA-35/§17.2): where that one searches inside one engagement, this one answers
 * "where in this organisation does this phrase appear?" — always within the caller's scope.
 *
 * The search, the org filter and the scope filter are all the database's (`global_document_search`,
 * 0190): the component performs no access decision of its own (Law L2) and never imports the client
 * (rule M8). A document outside the caller's scope is simply absent from the results — the screen
 * cannot surface it and does not learn that it exists.
 *
 * A blank query is refused by name, so the screen shows the reason rather than an unbounded list.
 * Every hit names the file, its stage, and the engagement, entity and universe it belongs to, so a
 * result is never an unplaceable snippet.
 */
export const GlobalSearchPanel: React.FC<{ screenId?: string }> = ({ screenId = 'OA-39' }) => {
  const { currentUser, setActiveTab, setSelectedEngagementId, openInspector } = useApp();
  const canSearch = READ_RIGHTS.some((r) => hasRight(currentUser, r));

  const [query, setQuery] = useState('');
  const [state, setState] = useState<LoadState>('idle');
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed === '') {
      setState('idle');
      setHits([]);
      setCount(0);
      setError(null);
      setRefusal(null);
      return;
    }
    setState('searching');
    setError(null);
    setRefusal(null);
    try {
      const result = await searchDocumentsGlobal(trimmed);
      if (!result.ok) {
        setRefusal(result.reason ?? 'The search was refused.');
        setHits([]);
        setCount(0);
      } else {
        setHits(result.hits ?? []);
        setCount(result.count ?? 0);
      }
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The search could not be run.');
      setState('error');
    }
  }, []);

  // Debounce the search so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => { void run(query); }, 250);
    return () => window.clearTimeout(t);
  }, [query, run]);

  const open = (hit: GlobalSearchHit) => {
    setSelectedEngagementId(hit.engagementId);
    setActiveTab('audit_file');
    openInspector('audit_file', { engagement: { id: hit.engagementId } });
  };

  const searchable = state === 'ready' && !refusal && hits.length > 0;
  const noResults = state === 'ready' && !refusal && query.trim() !== '' && hits.length === 0;

  return (
    <section data-testid="globalsearch-panel" data-screen-id={screenId} className="max-w-5xl mx-auto w-full px-6 py-6">
      <header className="mb-4">
        <h2 className="text-apple-17 font-semibold text-primary flex items-center gap-2">
          <Layers className="w-4 h-4 text-accent stroke-[1.5]" />
          Search all documents
        </h2>
        <p className="text-apple-12 text-secondary mt-1">
          Full-text search over every extracted document in this organisation, filtered to what you may
          read. Powered by the {ENGINE_NAME} engine's deterministic text search — nothing leaves the tenant.
        </p>
      </header>

      {!canSearch ? (
        <div data-testid="globalsearch-rights-note" className="flex items-start gap-2 px-3 py-2 rounded-xl text-apple-12 text-secondary bg-surface-elevated border border-hairline">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{rightReason('read_only') ?? 'A read right is required to search documents.'}</span>
        </div>
      ) : (
        <>
          <div className="relative mb-4">
            <Search className="w-4 h-4 text-secondary stroke-[1.5] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="globalsearch-input"
              aria-label="Search all documents"
              placeholder="Search the text of every document you may read…"
              className={`${input} pl-9`}
            />
          </div>

          {state === 'searching' && (
            <div data-testid="globalsearch-loading" className="text-apple-12 text-secondary py-3">Searching…</div>
          )}

          {refusal && (
            <div data-testid="globalsearch-refusal" className="flex items-start gap-2 px-3 py-2 rounded-xl text-apple-12 text-secondary bg-surface-elevated border border-hairline">
              <Lock className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{refusal}</span>
            </div>
          )}

          {error && <InlineError message={error} testId="globalsearch-error" />}

          {state === 'idle' && !error && (
            <div data-testid="globalsearch-idle" className="text-apple-12 text-tertiary py-3">
              Type a phrase to search every document you may read.
            </div>
          )}

          {noResults && (
            <div data-testid="globalsearch-empty" className="text-apple-12 text-secondary py-3">
              No document within your access matches “{query.trim()}”.
            </div>
          )}

          {searchable && (
            <>
              <div data-testid="globalsearch-count" className="text-apple-12 text-secondary mb-2">
                {count} {count === 1 ? 'document' : 'documents'} match, within your access.
              </div>
              <ul data-testid="globalsearch-results" className="space-y-2">
                {hits.map((h) => (
                  <li
                    key={h.fileId}
                    data-testid={`globalsearch-hit-${h.fileId}`}
                    className="p-3 rounded-xl bg-surface-elevated border border-hairline"
                  >
                    <button
                      type="button"
                      onClick={() => open(h)}
                      className="w-full text-left group"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-accent stroke-[1.5] shrink-0" />
                          <span className="text-apple-13 font-medium text-primary truncate">{h.filename}</span>
                          <span className="text-apple-11 text-tertiary shrink-0">{h.stage}</span>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-tertiary group-hover:text-primary stroke-[1.5] shrink-0" />
                      </div>
                      {/* The headline carries <mark> around the matched terms; it is the document's own
                          text, so every part is rendered as text with the marks preserved. */}
                      <p
                        data-testid={`globalsearch-snippet-${h.fileId}`}
                        className="text-apple-12 text-secondary mt-1.5 [&>mark]:bg-accent-subtle [&>mark]:text-primary [&>mark]:rounded"
                      >
                        {renderHeadline(h.headline)}
                      </p>
                      <div data-testid={`globalsearch-place-${h.fileId}`} className="text-apple-11 text-tertiary mt-1">
                        {h.engagementTitle} · {h.entityName} · {h.universeName}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
};
