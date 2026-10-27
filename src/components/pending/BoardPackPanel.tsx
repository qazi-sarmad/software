import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  generateBoardPack, getBoardPack, getOrgSettingsExtra, listBoardPacks, listBoardPackSections,
  saveBoardPackSections, type BoundaryKind,
} from '../../data/boardPack';
import { getBranding } from '../../data/branding';
import {
  collectFigures, deltaAgainst, excludedNote, figureDrillDownUrl, figuresWithoutRefs, visibleSections,
  type BoardPackRow, type BoardPackSection, type BoardPackSnapshot,
} from '../../lib/boardPack';
import {
  barPercentages, ganttLayout, ganttLegend, heatmapGrid,
} from '../../lib/boardPackVisuals';
import { buildBoardPackPdf, buildBoardPackPptx, capAgingRows } from '../../lib/boardPackDocuments';
import { renderPdf } from '../../lib/render/pdf';
import { renderPptx } from '../../lib/render/pptx';
import { renderQrDataUrl, verificationUrl } from '../../lib/render/qr';
import type { BrandingSpec } from '../../lib/render/branding';
import { resolveHexColour } from '../../lib/render/branding';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { TutorialButton } from '../common/TutorialButton';
import { Select } from '../common/Select';
import { AlertTriangle, Download, Eye, FileText, History, RefreshCw, Settings } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';
type View = 'history' | 'config' | 'view';

const BOUNDARIES: { value: BoundaryKind; label: string }[] = [
  { value: 'since_last', label: 'Since the last pack of this scope' },
  { value: 'custom', label: 'Custom date range' },
  { value: 'since_meeting', label: 'Since the last board meeting' },
];

/** The roles a section may be limited to. An empty list means every role with view_board_pack. */
const ROLE_CHOICES: { slug: string; label: string }[] = [
  { slug: 'cia', label: 'Chief Internal Auditor' },
  { slug: 'audit_manager', label: 'Audit Manager' },
  { slug: 'reviewer', label: 'Reviewer' },
  { slug: 'preparer', label: 'Preparer' },
  { slug: 'observer', label: 'Observer' },
  { slug: 'org_admin', label: 'Org Admin' },
  { slug: 'auditee', label: 'Auditee' },
];

function download(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * WK-01 to WK-04: the Board Pack panel (F10).
 *
 * History, Generate, Open, a configurable section list and the web view with a drill-down on every
 * figure. The PDF and the PPTX come from the same snapshot through the shared renderers, so a figure
 * links to its record in all three. Generation needs generate_board_pack and the board_pack feature;
 * opening needs view_board_pack. Every control is gated in the app AND re-checked in the database.
 */
export const BoardPackPanel: React.FC = () => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const roleSlug = currentUser.role;
  const canGenerate = hasRight(currentUser, 'generate_board_pack');
  const canView = hasRight(currentUser, 'view_board_pack');
  const canConfig = hasRight(currentUser, 'edit_config');

  const [view, setView] = useState<View>('history');
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [packs, setPacks] = useState<BoardPackRow[]>([]);
  const [sections, setSections] = useState<BoardPackSection[]>([]);
  const [branding, setBranding] = useState<BrandingSpec | null>(null);
  const [appBaseUrl, setAppBaseUrl] = useState('');
  const [boundary, setBoundary] = useState<BoundaryKind>('since_last');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [scopeKey, setScopeKey] = useState('org');
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const [openPack, setOpenPack] = useState<{ row: BoardPackRow; snapshot: BoardPackSnapshot } | null>(null);
  const [previousSnapshot, setPreviousSnapshot] = useState<BoardPackSnapshot | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [rolesFor, setRolesFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) { setState('ready'); return; }
    setState('loading');
    setLoadError('');
    try {
      const [p, s, b, extra] = await Promise.all([
        canView ? listBoardPacks(orgId) : Promise.resolve([]),
        listBoardPackSections(orgId),
        getBranding(orgId),
        getOrgSettingsExtra(orgId),
      ]);
      setPacks(p);
      setSections(s);
      setBranding(b);
      setAppBaseUrl(extra?.appBaseUrl ?? '');
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the Board Pack.');
      setState('error');
    }
  }, [orgId, canView]);

  useEffect(() => { void load(); }, [load]);

  const lastPack = useMemo(() => {
    const same = packs.filter((p) => p.scopeKey === scopeKey && p.status === 'ready');
    return same.length > 0 ? same[0] : null;
  }, [packs, scopeKey]);

  const missingRefs = useMemo(
    () => (openPack ? figuresWithoutRefs(openPack.snapshot) : []),
    [openPack]
  );
  const delta = useMemo(
    () => deltaAgainst(previousSnapshot, openPack?.snapshot ?? null),
    [previousSnapshot, openPack]
  );
  const visible = useMemo(
    () => visibleSections(sections, [roleSlug]).map((s) => s.sectionKey),
    [sections, roleSlug]
  );
  const heatmap = useMemo(() => heatmapGrid(openPack?.snapshot.sira?.heatmap), [openPack]);
  const gantt = useMemo(
    () => ganttLayout(openPack?.snapshot.plan?.gantt, openPack?.row.generatedAt ?? ''),
    [openPack]
  );
  const ganttCounts = useMemo(() => ganttLegend(openPack?.snapshot.plan?.gantt), [openPack]);
  // Chart colours come from the org's branding, so the printed chart matches the tenant's palette.
  const chartColours = useMemo(() => {
    if (!branding) return undefined;
    return {
      background: resolveHexColour(branding.colourBackground),
      axis: resolveHexColour(branding.colourText),
      text: resolveHexColour(branding.colourText),
    };
  }, [branding]);
  const bandColours = useMemo(() => {
    if (!branding) return {} as Record<string, string>;
    const colour = resolveHexColour(branding.colourAccent);
    const map: Record<string, string> = {};
    for (const b of openPack?.snapshot.sira?.bands ?? []) {
      if (typeof b.band === 'string') map[b.band] = colour;
    }
    return map;
  }, [branding, openPack]);

  const generate = async () => {
    setBusy(true);
    setResult(null);
    const r = await generateBoardPack(orgId, {
      scopeKey, boundaryKind: boundary,
      from: boundary === 'custom' && fromDate ? new Date(fromDate).toISOString() : null,
      to: boundary === 'custom' && toDate ? new Date(toDate).toISOString() : null,
    });
    setResult(r);
    setBusy(false);
    if (r.ok) await load();
  };

  const open = async (row: BoardPackRow) => {
    setBusy(true);
    setResult(null);
    try {
      const pack = await getBoardPack(row.id);
      if (!pack) { setResult({ ok: false, reason: 'That pack is not available to you.' }); setBusy(false); return; }
      setOpenPack(pack);
      setPreviousSnapshot(null);
      if (row.previousPackId) {
        const prev = await getBoardPack(row.previousPackId);
        setPreviousSnapshot(prev?.snapshot ?? null);
      }
      if (appBaseUrl) {
        setQrDataUrl(await renderQrDataUrl(verificationUrl(appBaseUrl, 'pack', row.id)));
      }
      setView('view');
    } catch (err) {
      setResult({ ok: false, reason: err instanceof Error ? err.message : 'Could not open the pack.' });
    }
    setBusy(false);
  };

  const downloadPdf = async () => {
    if (!openPack || !branding || !appBaseUrl) return;
    setBusy(true);
    try {
      const model = buildBoardPackPdf({
        title: openPack.row.scopeDescription, snapshot: openPack.snapshot, branding,
        appBaseUrl, dataHash: openPack.row.dataHash, generatedAt: openPack.row.generatedAt,
        bandColours, chartColours,
      });
      const qr = await renderQrDataUrl(verificationUrl(appBaseUrl, 'pack', openPack.row.id));
      const bytes = await renderPdf(branding, { ...model, qrDataUrl: qr });
      download(bytes, `board-pack-${openPack.row.id}.pdf`, 'application/pdf');
      setResult({ ok: true });
    } catch (err) {
      setResult({ ok: false, reason: err instanceof Error ? err.message : 'Could not build the PDF.' });
    }
    setBusy(false);
  };

  const downloadPptx = async () => {
    if (!openPack || !branding || !appBaseUrl) return;
    setBusy(true);
    try {
      const model = buildBoardPackPptx({
        title: openPack.row.scopeDescription, snapshot: openPack.snapshot, branding,
        appBaseUrl, dataHash: openPack.row.dataHash, generatedAt: openPack.row.generatedAt,
        bandColours, chartColours,
      });
      const bytes = await renderPptx(branding, model);
      download(bytes, `board-pack-${openPack.row.id}.pptx`,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      setResult({ ok: true });
    } catch (err) {
      setResult({ ok: false, reason: err instanceof Error ? err.message : 'Could not build the PPTX.' });
    }
    setBusy(false);
  };

  const moveSection = async (index: number, dir: -1 | 1) => {
    const next = [...sections];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    const reordered = next.map((s, i) => ({ ...s, ordinal: i + 1 }));
    setSections(reordered);
    const r = await saveBoardPackSections(orgId, reordered.map((s) => ({
      sectionKey: s.sectionKey, ordinal: s.ordinal, enabled: s.enabled, visibleRoles: s.visibleRoles,
    })));
    setResult(r);
  };

  /** Persist the current section list as is (used by the label field on blur and the role toggles). */
  const saveSections = async (list: BoardPackSection[]) => {
    const r = await saveBoardPackSections(orgId, list.map((s) => ({
      sectionKey: s.sectionKey, ordinal: s.ordinal, enabled: s.enabled, visibleRoles: s.visibleRoles,
      label: s.label,
    })));
    setResult(r);
  };

  /** Turn a role's visibility of one section on or off, then persist immediately. */
  const toggleRole = async (sectionKey: string, slug: string) => {
    const next = sections.map((s) => {
      if (s.sectionKey !== sectionKey) return s;
      const has = s.visibleRoles.includes(slug);
      return { ...s, visibleRoles: has ? s.visibleRoles.filter((r) => r !== slug) : [...s.visibleRoles, slug] };
    });
    setSections(next);
    await saveSections(next);
  };

  const toggleSection = async (index: number) => {
    const next = sections.map((s, i) => (i === index ? { ...s, enabled: !s.enabled } : s));
    setSections(next);
    await saveSections(next);
  };

  if (!canView) {
    // The panel is hidden entirely for a role without view_board_pack (Observer and CIA have it).
    return null;
  }

  if (state === 'loading') {
    return <p className="text-sm opacity-70 p-6" data-testid="wk-boardpack-loading">Loading the Board Pack…</p>;
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6" data-testid="wk-boardpack">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <h1 className="text-apple-20 font-bold text-primary">Board Pack</h1>
          <p className="text-apple-13 text-secondary mt-0.5">
            {lastPack
              ? `Last pack ${new Date(lastPack.generatedAt).toLocaleString()} · hash ${lastPack.dataHash.slice(0, 12)}…`
              : 'No previous pack: this is the first.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TutorialButton tutorialKey="oa.boardpack-use" title="WK-01 Board Pack" screenId="wk-boardpack" autoplay={false} />
          <button type="button" data-testid="wk-boardpack-tab-history" onClick={() => setView('history')}
            className={`px-3 py-1.5 rounded-xl text-apple-12 border ${view === 'history' ? 'bg-accent-subtle border-accent text-accent' : 'border-hairline text-secondary'}`}>
            <History className="w-3.5 h-3.5 inline mr-1" />History
          </button>
          {canConfig && (
            <button type="button" data-testid="wk-boardpack-tab-config" onClick={() => setView('config')}
              className={`px-3 py-1.5 rounded-xl text-apple-12 border ${view === 'config' ? 'bg-accent-subtle border-accent text-accent' : 'border-hairline text-secondary'}`}>
              <Settings className="w-3.5 h-3.5 inline mr-1" />Sections
            </button>
          )}
          {view === 'view' && (
            <button type="button" data-testid="wk-boardpack-tab-view" onClick={() => setView('view')}
              className="px-3 py-1.5 rounded-xl text-apple-12 border bg-accent-subtle border-accent text-accent">
              <Eye className="w-3.5 h-3.5 inline mr-1" />Open pack
            </button>
          )}
        </div>
      </div>

      <InlineError message={loadError || (result && !result.ok ? result.reason : '')} testId="wk-boardpack-error" />
      {result?.ok && (
        <p className="text-apple-12 text-verdant" data-testid="wk-boardpack-result">Done.</p>
      )}

      {view === 'history' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="wk-boardpack-generator">
            <h2 className="text-apple-15 font-semibold text-primary">Generate a pack</h2>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-apple-12 text-secondary">
                Scope
                <input data-testid="wk-boardpack-scope" value={scopeKey}
                  onChange={(e) => setScopeKey(e.target.value)}
                  className="block mt-1 px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary text-apple-13" />
              </label>
              <label className="text-apple-12 text-secondary">
                Boundary
                <Select testId="wk-boardpack-boundary" ariaLabel="Boundary" value={boundary}
                  onChange={(v) => setBoundary(v as BoundaryKind)}
                  options={BOUNDARIES.map((b) => ({ value: b.value, label: b.label }))} />
              </label>
              {boundary === 'custom' && (
                <>
                  <label className="text-apple-12 text-secondary">
                    From
                    <input type="date" data-testid="wk-boardpack-from" value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="block mt-1 px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary text-apple-13" />
                  </label>
                  <label className="text-apple-12 text-secondary">
                    To
                    <input type="date" data-testid="wk-boardpack-to" value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="block mt-1 px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary text-apple-13" />
                  </label>
                </>
              )}
              <button type="button" data-testid="wk-boardpack-generate" onClick={() => void generate()}
                disabled={!canGenerate || busy}
                className="px-3 py-1.5 rounded-xl text-apple-12 bg-accent text-canvas disabled:opacity-50">
                <RefreshCw className="w-3.5 h-3.5 inline mr-1" />Generate
              </button>
            </div>
            {!canGenerate && (
              <p className="text-apple-12 text-secondary" data-testid="wk-boardpack-no-generate">
                Your role can open a pack but not generate one.
              </p>
            )}
          </div>

          <div data-testid="wk-boardpack-history" className="space-y-2">
            {packs.length === 0 ? (
              <p className="text-apple-13 text-secondary" data-testid="wk-boardpack-empty">
                No pack yet. Generate the first one above.
              </p>
            ) : packs.map((p) => (
              <div key={p.id} data-testid={`wk-boardpack-${p.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface px-4 py-2">
                <div className="text-apple-13">
                  <span className="text-primary font-medium">{p.scopeDescription}</span>
                  <span className="text-secondary"> · {new Date(p.generatedAt).toLocaleString()} · {p.boundaryKind}</span>
                  <span className="text-secondary block text-apple-11">hash {p.dataHash.slice(0, 16)}…{p.previousPackId ? ' · chains to the previous pack' : ''}</span>
                </div>
                <button type="button" data-testid={`wk-boardpack-open-${p.id}`} onClick={() => void open(p)}
                  className="px-2.5 py-1 rounded-lg text-apple-12 border border-hairline text-accent">
                  <Eye className="w-3.5 h-3.5 inline mr-1" />Open
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'config' && (
        <div data-testid="oa-boardpack-config" className="space-y-2">
          <p className="text-apple-13 text-secondary">
            Turn a section on or off, and move it up or down. A section is never deleted.
          </p>
          {sections.map((s, i) => (
            <div key={s.sectionKey} data-testid={`oa-boardpack-section-${s.sectionKey}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-surface px-4 py-2">
              <input
                data-testid={`oa-boardpack-label-${s.sectionKey}`}
                value={s.label}
                onChange={(e) => setSections((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                onBlur={() => void saveSections(sections)}
                aria-label={`Section label for ${s.sectionKey}`}
                className="text-apple-13 text-primary bg-transparent border-b border-transparent hover:border-hairline focus:border-accent focus:outline-none flex-1 min-w-0"
              />
              <span className="flex items-center gap-2">
                <button type="button" data-testid={`oa-boardpack-up-${s.sectionKey}`} onClick={() => void moveSection(i, -1)}
                  disabled={i === 0} className="px-2 py-0.5 rounded-lg border border-hairline text-apple-12 disabled:opacity-40">Up</button>
                <button type="button" data-testid={`oa-boardpack-down-${s.sectionKey}`} onClick={() => void moveSection(i, 1)}
                  disabled={i === sections.length - 1} className="px-2 py-0.5 rounded-lg border border-hairline text-apple-12 disabled:opacity-40">Down</button>
                <label className="text-apple-12 text-secondary flex items-center gap-1">
                  <input type="checkbox" data-testid={`oa-boardpack-enabled-${s.sectionKey}`} checked={s.enabled}
                    onChange={() => void toggleSection(i)} />
                  {s.enabled ? 'On' : 'Off'}
                </label>
                <button type="button" data-testid={`oa-boardpack-roles-${s.sectionKey}`}
                  onClick={() => setRolesFor(rolesFor === s.sectionKey ? null : s.sectionKey)}
                  className={`px-2 py-0.5 rounded-lg border text-apple-12 ${rolesFor === s.sectionKey ? 'border-accent text-accent' : 'border-hairline text-secondary'}`}>
                  Roles
                </button>
              </span>
            </div>
          ))}
          {rolesFor && (
            <div data-testid={`oa-boardpack-roles-panel-${rolesFor}`}
              className="rounded-xl border border-hairline bg-surface px-4 py-3 space-y-1">
              <p className="text-apple-12 text-secondary">Which roles may see this section? An empty list means everyone with view_board_pack.</p>
              {ROLE_CHOICES.map((r) => {
                const section = sections.find((s) => s.sectionKey === rolesFor);
                const on = section?.visibleRoles.includes(r.slug) ?? false;
                return (
                  <label key={r.slug} className="flex items-center gap-2 text-apple-13 text-primary">
                    <input type="checkbox" data-testid={`oa-boardpack-role-${rolesFor}-${r.slug}`} checked={on}
                      onChange={() => void toggleRole(rolesFor, r.slug)} />
                    {r.label}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view === 'view' && openPack && (
        <div data-testid="wk-boardpack-view" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-apple-13 text-secondary">
              Snapshot hash <span className="text-primary">{openPack.row.dataHash.slice(0, 24)}…</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" data-testid="wk-boardpack-pdf" onClick={() => void downloadPdf()}
                disabled={busy || !appBaseUrl} className="px-2.5 py-1 rounded-lg text-apple-12 border border-hairline text-accent disabled:opacity-40">
                <Download className="w-3.5 h-3.5 inline mr-1" />PDF
              </button>
              <button type="button" data-testid="wk-boardpack-pptx" onClick={() => void downloadPptx()}
                disabled={busy || !appBaseUrl} className="px-2.5 py-1 rounded-lg text-apple-12 border border-hairline text-accent disabled:opacity-40">
                <Download className="w-3.5 h-3.5 inline mr-1" />PPTX
              </button>
            </div>
          </div>
          {!appBaseUrl && (
            <InlineError message="Set the application web address before generating a Board Pack."
              testId="wk-boardpack-url-missing" />
          )}
          {missingRefs.length > 0 && (
            <InlineError testId="wk-boardpack-missing-refs"
              message={`${missingRefs.length} figure(s) have no source record: ${missingRefs.join(', ')}.`} />
          )}

          {qrDataUrl && (
            <div className="flex items-center gap-3" data-testid="wk-boardpack-verify-chip">
              <img src={qrDataUrl} alt="Verification QR" className="w-20 h-20" />
              <span className="text-apple-12 text-secondary">Scan to verify this pack</span>
            </div>
          )}

          {visible.includes('sira') && (
            <section data-testid="wk-boardpack-section-sira" className="rounded-2xl border border-hairline bg-surface p-4">
              <h3 className="text-apple-14 font-semibold text-primary mb-2">SIRA residual risk</h3>
              {(openPack.snapshot.sira?.bands ?? []).map((b, i) => (
                <div key={i} data-testid={`wk-boardpack-figure-sira-${i}`}
                  className="flex items-center justify-between text-apple-13 py-1">
                  <span className="text-secondary">{String(b.band ?? `band ${i + 1}`)}</span>
                  <span className="text-primary font-medium">{b.value}</span>
                </div>
              ))}
              {heatmap.total > 0 && (
                <div className="mt-3 overflow-x-auto" data-testid="wk-boardpack-heatmap">
                  <table className="w-full text-apple-12 border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left text-secondary font-medium py-1 pr-2">Entity</th>
                        {heatmap.bands.map((band) => (
                          <th key={band} className="text-right text-secondary font-medium py-1 px-2">{band}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmap.entities.map((entity) => (
                        <tr key={entity} data-testid={`wk-boardpack-heatmap-row-${entity}`} className="border-t border-hairline">
                          <td className="text-left text-primary py-1 pr-2">{entity}</td>
                          {heatmap.bands.map((band) => {
                            const v = heatmap.value(entity, band);
                            const intensity = heatmap.max > 0 ? v / heatmap.max : 0;
                            return (
                              <td key={band} className="text-right py-1 px-2"
                                data-testid={`wk-boardpack-heatmap-${entity}-${band}`}
                                data-heat={intensity >= 0.66 ? 'high' : intensity >= 0.33 ? 'medium' : v > 0 ? 'low' : 'none'}>
                                <span className="text-primary">{v}</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {visible.includes('issues') && (
            <section data-testid="wk-boardpack-section-issues" className="rounded-2xl border border-hairline bg-surface p-4">
              <h3 className="text-apple-14 font-semibold text-primary mb-2">CAP aging</h3>
              {capAgingRows(openPack.snapshot).map((r) => (
                <div key={r.band} data-testid={`wk-boardpack-figure-cap-${r.band}`}
                  className="flex items-center justify-between text-apple-13 py-1">
                  <span className="text-secondary">{r.label}</span>
                  <span className="text-primary font-medium">{r.value}</span>
                </div>
              ))}
            </section>
          )}

          {visible.includes('plan') && gantt.bars.length > 0 && (
            <section data-testid="wk-boardpack-section-plan" className="rounded-2xl border border-hairline bg-surface p-4">
              <h3 className="text-apple-14 font-semibold text-primary mb-2">Audit plan window</h3>
              <p className="text-apple-12 text-secondary mb-2" data-testid="wk-boardpack-gantt-window">
                {gantt.minStart} to {gantt.maxEnd} · {gantt.bars.length} planned item{gantt.bars.length === 1 ? '' : 's'}
              </p>
              <div data-testid="wk-boardpack-gantt" className="space-y-1.5">
                {gantt.bars.map((bar, i) => {
                  const pct = barPercentages(bar, gantt.spanDays);
                  return (
                    <div key={i} className="flex items-center gap-2" data-testid={`wk-boardpack-gantt-row-${i}`}>
                      <span className="text-apple-11 text-secondary w-40 shrink-0 truncate" title={bar.title}>{bar.title}</span>
                      <span className="relative h-3 flex-1 rounded-full bg-accent-subtle overflow-hidden">
                        <span
                          data-testid={`wk-boardpack-gantt-bar-${i}`}
                          data-status={bar.status}
                          className={`absolute top-0 h-3 rounded-full ${bar.open ? 'bg-accent' : 'bg-verdant'}`}
                          style={{ left: `${pct.left}%`, width: `${pct.width}%` }}
                        />
                      </span>
                      <span className="text-apple-11 text-secondary w-20 shrink-0 text-right">{bar.start}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-apple-11 text-secondary mt-2" data-testid="wk-boardpack-gantt-legend">
                {ganttCounts.map((c) => `${c.status}: ${c.count}`).join(' · ')}
              </p>
            </section>
          )}

          {visible.includes('sealed') && (
            <section data-testid="wk-boardpack-section-sealed" className="rounded-2xl border border-hairline bg-surface p-4">
              <h3 className="text-apple-14 font-semibold text-primary mb-2">Sealed work and integrity</h3>
              <div className="flex items-center justify-between text-apple-13 py-1">
                <span className="text-secondary">Sealed workpapers</span>
                <span className="text-primary font-medium" data-testid="wk-boardpack-figure-sealed">
                  {openPack.snapshot.sealed_work?.value ?? 0}
                </span>
              </div>
            </section>
          )}

          {visible.includes('changes') && (
            <section data-testid="wk-boardpack-section-changes" className="rounded-2xl border border-hairline bg-surface p-4">
              <h3 className="text-apple-14 font-semibold text-primary mb-2">What changed since the last pack</h3>
              <p className="text-apple-13 text-secondary" data-testid="wk-boardpack-delta">
                {delta.added.length} added, {delta.changed.length} changed, {delta.removed.length} removed.
              </p>
            </section>
          )}

          <section data-testid="wk-boardpack-section-sources" className="rounded-2xl border border-hairline bg-surface p-4">
            <h3 className="text-apple-14 font-semibold text-primary mb-2">Sources index</h3>
            <p className="text-apple-12 text-secondary">{excludedNote(openPack.snapshot)}</p>
            <ul className="mt-2 space-y-1">
              {collectFigures(openPack.snapshot).map((f) => {
                const ref = f.refs.length > 0 ? f.refs[0] : null;
                const href = ref && appBaseUrl ? figureDrillDownUrl(appBaseUrl, ref) : null;
                return (
                  <li key={f.path} data-testid={`wk-boardpack-source-${f.path}`} className="text-apple-12 text-secondary">
                    <FileText className="w-3 h-3 inline mr-1" />
                    {href ? (
                      <a href={href} data-testid={`wk-boardpack-source-link-${f.path}`}
                        className="text-accent underline-offset-2 hover:underline">
                        {f.label}: {f.value}
                      </a>
                    ) : (
                      <span>{f.label}: {f.value}</span>
                    )}
                    {' · '}{f.refs.length} record{f.refs.length === 1 ? '' : 's'}
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="text-apple-11 text-secondary flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Every figure is a drill-down to the record behind it.
          </p>
        </div>
      )}
    </div>
  );
};
