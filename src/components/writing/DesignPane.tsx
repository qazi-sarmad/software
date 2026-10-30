import React, { useMemo } from 'react';
import { resolveHexColour } from '../../lib/render/branding';
import { toPdfTypography, type FormatBlock, type FormatLayout, type ReportFormat } from '../../lib/writing/reportFormat';
import { designInputFromFormat, themeFromLayout } from '../../lib/writing/formatDesign';
import { buildDesignCanvas, type DesignCanvasInput } from '../../lib/writing/designCanvas';
import {
  PAGE_NUMBER_STYLES, PAGE_SETUP_LIMITS, defaultPlacedBlock, type ChromeSpec, type PlacedBlock,
} from '../../lib/writing/pageDesign';
import { GRID_LIMITS, type GridSpec } from '../../lib/writing/grid';
import { SHAPE_LABELS, defaultShape, type ShapeKind, type ShapeSpec } from '../../lib/writing/shapes';
import { TABLE_STYLE_NAMES, TABLE_STYLE_LABELS, type TableStyleName } from '../../lib/writing/tableStyleDefaults';
import { hyperlinkError, type CrossReferenceSpec, type HyperlinkSpec, type ReferenceKind } from '../../lib/writing/links';
import { DesignCanvas, ShapePicker } from './DesignCanvas';
import { Select } from '../common/Select';
import {
  recommendDesign, summariseRecommendations, designQualityScore,
  REPORT_PURPOSE_LABELS, type ReportPurpose,
} from '../../lib/writing/designRecommendations';

/**
 * The design pane of the report format editor (WP-D).
 *
 * The controls a designer needs to set the page up: page size and orientation, margins, columns and
 * their gap, the snap grid and rulers, the header and footer, numbered headings, the default table
 * style, the design shapes, the hyperlinks and the cross-references — over the interactive canvas.
 *
 * Every control writes into the format's layout through `onLayout`, so the draft, the canvas and the
 * printed files all read the same data. Presentation only: no control here changes a fact.
 */
export interface DesignPaneProps {
  draft: ReportFormat;
  applied: { key: string; label: string; role: FormatBlock['role'] }[] | null;
  prefix: string;
  onLayout: (patch: Partial<FormatLayout>) => void;
  chromeVars: Record<string, string | number>;
  colours: { primary: string; accent: string; text: string; background: string };
  fonts: { heading: string; body: string };
  onReorder: (fromKey: string, toKey: string) => void;
  /** What the report is for, so the design adviser reads the right conditions. */
  purpose?: ReportPurpose;
  onPurposeChange?: (p: ReportPurpose) => void;
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

export const DesignPane: React.FC<DesignPaneProps> = ({
  draft, applied, prefix, onLayout, chromeVars, colours, fonts, onReorder,
  purpose = 'audit_report', onPurposeChange = () => {},
}) => {
  const layout = draft.layout;
  const p = `${prefix}-design`;

  const setGrid = (patch: Partial<GridSpec>) => onLayout({ grid: { ...layout.grid, ...patch } });
  const setChrome = (patch: Partial<ChromeSpec>) => onLayout({ chrome: { ...layout.chrome, ...patch } });

  const theme = useMemo(() => themeFromLayout(layout, resolveHexColour), [layout]);

  const canvasInput = useMemo<Omit<DesignCanvasInput, 'zoom'> | null>(() => {
    if (!applied) return null;
    const typo = toPdfTypography(layout);
    const blocks = applied.map((b) => ({ key: b.key, label: b.label, bodyLines: 4 }));
    const base = designInputFromFormat(layout, {
      headingPt: typo.headingPt, bodyPt: typo.bodyPt, lineHeight: typo.lineHeight,
    }, theme, blocks);
    return {
      ...base,
      headingWeight: typo.headingWeight, bodyWeight: typo.bodyWeight,
      links: layout.links, crossReferences: layout.crossReferences, chromeVars,
    };
  }, [applied, layout, theme, chromeVars]);

  const pageCount = useMemo(
    () => (canvasInput ? buildDesignCanvas({ ...canvasInput, zoom: 1 }).pageCount : 0),
    [canvasInput],
  );

  /** Set a block's placement, creating its row when it has none. */
  const setPlaced = (key: string, patch: Partial<PlacedBlock>) => {
    const existing = layout.placed.find((x) => x.key === key) ?? defaultPlacedBlock(key);
    const next = layout.placed.filter((x) => x.key !== key);
    onLayout({ placed: [...next, { ...existing, ...patch }] });
  };

  const place = (key: string, placement: { xMm: number | null; yMm: number | null; page: number; wMm?: number }) => {
    const existing = layout.placed.find((x) => x.key === key) ?? defaultPlacedBlock(key);
    setPlaced(key, { ...placement, wMm: placement.wMm ?? existing.wMm });
  };

  const addShape = (kind: ShapeKind) => {
    const id = `shape-${layout.shapes.length + 1}-${kind}`;
    const z = layout.shapes.length + 1;
    onLayout({ shapes: [...layout.shapes, defaultShape(kind, id, 1, layout.marginLeftMm, layout.marginTopMm, z)] });
  };

  const patchShape = (id: string, patch: Partial<ShapeSpec>) => onLayout({
    shapes: layout.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  });

  const removeShape = (id: string) => onLayout({ shapes: layout.shapes.filter((s) => s.id !== id) });

  const addLink = () => {
    const link: HyperlinkSpec = { id: `link-${layout.links.length + 1}`, label: '', url: 'https://', underline: true };
    onLayout({ links: [...layout.links, link] });
  };
  const patchLink = (id: string, patch: Partial<HyperlinkSpec>) => onLayout({
    links: layout.links.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  });
  const removeLink = (id: string) => onLayout({ links: layout.links.filter((l) => l.id !== id) });

  const addReference = () => {
    const first = applied?.[0]?.key ?? '';
    const ref: CrossReferenceSpec = { id: `ref-${layout.crossReferences.length + 1}`, kind: 'heading', targetKey: first, label: 'see' };
    onLayout({ crossReferences: [...layout.crossReferences, ref] });
  };
  const patchReference = (id: string, patch: Partial<CrossReferenceSpec>) => onLayout({
    crossReferences: layout.crossReferences.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  });
  const removeReference = (id: string) => onLayout({ crossReferences: layout.crossReferences.filter((r) => r.id !== id) });

  const placedFree = layout.placed.filter((x) => x.xMm !== null || x.yMm !== null);

  // The design adviser: a deterministic, explained suggestion list, ranked defect-first. It reads the
  // live layout and the derived theme and returns patches the designer applies verbatim.
  const recommendations = useMemo(
    () => recommendDesign({
      purpose,
      theme,
      layout: {
        pageSize: layout.pageSize,
        marginTopMm: layout.marginTopMm, marginRightMm: layout.marginRightMm,
        marginBottomMm: layout.marginBottomMm, marginLeftMm: layout.marginLeftMm,
        fontSizePt: layout.fontSizePt, lineHeightPct: layout.lineHeightPct,
        headingScalePct: layout.headingScalePct,
        columns: layout.columns, columnGapMm: layout.columnGapMm,
        grid: { sizeMm: layout.grid.sizeMm },
        chrome: layout.chrome,
        numberedHeadings: layout.numberedHeadings,
        shapes: layout.shapes.map((s) => ({ kind: s.kind })),
      },
    }),
    [purpose, theme, layout],
  );
  const recSummary = summariseRecommendations(recommendations);
  const quality = designQualityScore(recommendations);

  return (
    <div className="space-y-4" data-testid={`${p}-pane`}>
      {/* The design adviser */}
      <div className="p-3 rounded-xl bg-surface-sunken border border-hairline space-y-2" data-testid={`${p}-recommendations`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-apple-12 text-primary font-medium">Design adviser</span>
          <label className="text-apple-11 text-secondary">
            Purpose
            <Select ariaLabel="Report purpose" data-testid={`${p}-purpose`} value={purpose}
              onChange={(v) => onPurposeChange(v as ReportPurpose)}
              options={(Object.keys(REPORT_PURPOSE_LABELS) as ReportPurpose[]).map((k) => ({ value: k, label: REPORT_PURPOSE_LABELS[k] }))} />
          </label>
          <span className="text-apple-11 text-secondary" data-testid={`${p}-quality`}>Quality {quality}/100</span>
          <span className="text-apple-11 text-secondary" data-testid={`${p}-rec-summary`}>
            {recSummary.defects} defect(s) · {recSummary.warnings} warning(s) · {recSummary.advice} suggestion(s)
          </span>
          {recommendations.length > 0 && (
            <button type="button" className="text-apple-11 text-primary" data-testid={`${p}-apply-all`}
              onClick={() => recommendations.filter((r) => Object.keys(r.apply).length).forEach((r) => onLayout(r.apply as Partial<FormatLayout>))}>
              Apply all
            </button>
          )}
        </div>
        {recommendations.length === 0 && (
          <div className="text-apple-11 text-secondary" data-testid={`${p}-recommendations-empty`}>
            This format satisfies every design rule. Nothing to suggest.
          </div>
        )}
        {recommendations.map((r) => (
          <div key={r.id} className="flex items-start gap-2 text-apple-11" data-testid={`${p}-rec-${r.id}`}>
            <span className={
              r.severity === 'defect' || r.severity === 'warning' ? 'text-cinnabar' : 'text-secondary'
            }>{r.severity}</span>
            <span className="flex-1">
              <span className="text-primary">{r.title}</span>
              <span className="text-secondary"> — {r.rationale}</span>
            </span>
            {Object.keys(r.apply).length > 0 && (
              <button type="button" className="text-apple-11 text-primary" data-testid={`${p}-rec-${r.id}-apply`}
                onClick={() => onLayout(r.apply as Partial<FormatLayout>)}>Apply</button>
            )}
          </div>
        ))}
      </div>

      {/* Page setup */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid={`${p}-page-setup`}>
        <label className="text-apple-11 text-secondary">
          Page size
          <Select ariaLabel="Page size" data-testid={`${p}-page-size`} value={layout.pageSize} onChange={(v) => onLayout({ pageSize: v as FormatLayout['pageSize'] })}
            options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]} />
        </label>
        <label className="text-apple-11 text-secondary">
          Orientation
          <Select ariaLabel="Orientation" data-testid={`${p}-orientation`} value={layout.orientation} onChange={(v) => onLayout({ orientation: v as FormatLayout['orientation'] })}
            options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
        </label>
        <label className="text-apple-11 text-secondary">
          Columns
          <input type="number" min={PAGE_SETUP_LIMITS.columns.min} max={PAGE_SETUP_LIMITS.columns.max}
            data-testid={`${p}-columns`} value={layout.columns}
            className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
            onChange={(e) => onLayout({ columns: Number(e.target.value) })} />
        </label>
        <label className="text-apple-11 text-secondary">
          Column gap (mm)
          <input type="number" min={0} max={PAGE_SETUP_LIMITS.columnGapMm.max}
            data-testid={`${p}-column-gap`} value={layout.columnGapMm}
            className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
            onChange={(e) => onLayout({ columnGapMm: Number(e.target.value) })} />
        </label>
        {(['marginTopMm', 'marginRightMm', 'marginBottomMm', 'marginLeftMm'] as const).map((k) => (
          <label key={k} className="text-apple-11 text-secondary">
            {label(k)}
            <input type="number" min={0} max={PAGE_SETUP_LIMITS.marginMm.max}
              data-testid={`${p}-${k}`} value={layout[k]}
              className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
              onChange={(e) => onLayout({ [k]: Number(e.target.value) } as Partial<FormatLayout>)} />
          </label>
        ))}
      </div>

      {/* Grid and rulers */}
      <div className="flex flex-wrap items-center gap-3" data-testid={`${p}-grid-controls`}>
        <label className="flex items-center gap-1 text-apple-12">
          <input type="checkbox" data-testid={`${p}-grid-visible`} checked={layout.grid.visible} onChange={(e) => setGrid({ visible: e.target.checked })} />
          Show grid
        </label>
        <label className="flex items-center gap-1 text-apple-12">
          <input type="checkbox" data-testid={`${p}-grid-snap`} checked={layout.grid.snap} onChange={(e) => setGrid({ snap: e.target.checked })} />
          Snap to grid
        </label>
        <label className="flex items-center gap-1 text-apple-12">
          <input type="checkbox" data-testid={`${p}-grid-rulers`} checked={layout.grid.rulers} onChange={(e) => setGrid({ rulers: e.target.checked })} />
          Rulers
        </label>
        <label className="text-apple-11 text-secondary">
          Grid step (mm)
          <input type="number" min={GRID_LIMITS.sizeMm.min} max={GRID_LIMITS.sizeMm.max}
            data-testid={`${p}-grid-size`} value={layout.grid.sizeMm}
            className="w-20 px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
            onChange={(e) => setGrid({ sizeMm: Number(e.target.value) })} />
        </label>
        <label className="text-apple-11 text-secondary">
          Subdivisions
          <Select ariaLabel="Grid subdivisions" data-testid={`${p}-grid-subdivisions`} value={String(layout.grid.subdivisions)}
            onChange={(v) => setGrid({ subdivisions: Number(v) as GridSpec['subdivisions'] })}
            options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '4', label: '4' }]} />
        </label>
        <label className="flex items-center gap-1 text-apple-12">
          <input type="checkbox" data-testid={`${p}-numbered-headings`} checked={layout.numberedHeadings} onChange={(e) => onLayout({ numberedHeadings: e.target.checked })} />
          Number headings
        </label>
      </div>

      {/* Header and footer */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid={`${p}-chrome`}>
        <div className="space-y-2">
          <label className="flex items-center gap-1 text-apple-12">
            <input type="checkbox" data-testid={`${p}-header-enabled`} checked={layout.chrome.headerEnabled} onChange={(e) => setChrome({ headerEnabled: e.target.checked })} />
            Header
          </label>
          {(['headerLeft', 'headerCentre', 'headerRight'] as const).map((k) => (
            <input key={k} className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
              placeholder={`{org} / {engagement} / {classification}`}
              aria-label={label(k)} data-testid={`${p}-${k}`} value={layout.chrome[k]}
              onChange={(e) => setChrome({ [k]: e.target.value } as Partial<ChromeSpec>)} />
          ))}
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-1 text-apple-12">
            <input type="checkbox" data-testid={`${p}-footer-enabled`} checked={layout.chrome.footerEnabled} onChange={(e) => setChrome({ footerEnabled: e.target.checked })} />
            Footer
          </label>
          {(['footerLeft', 'footerCentre', 'footerRight'] as const).map((k) => (
            <input key={k} className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
              placeholder={`{org} / {page} of {pages}`}
              aria-label={label(k)} data-testid={`${p}-${k}`} value={layout.chrome[k]}
              onChange={(e) => setChrome({ [k]: e.target.value } as Partial<ChromeSpec>)} />
          ))}
          <label className="text-apple-11 text-secondary">
            Page number
            <Select ariaLabel="Page number style" data-testid={`${p}-page-number`} value={layout.chrome.pageNumber}
              onChange={(v) => setChrome({ pageNumber: v as ChromeSpec['pageNumber'] })}
              options={PAGE_NUMBER_STYLES.map((s) => ({ value: s, label: label(s) }))} />
          </label>
          <div className="flex gap-3">
            <label className="flex items-center gap-1 text-apple-12">
              <input type="checkbox" data-testid={`${p}-chrome-rule`} checked={layout.chrome.rule} onChange={(e) => setChrome({ rule: e.target.checked })} />
              Rule
            </label>
            <label className="flex items-center gap-1 text-apple-12">
              <input type="checkbox" data-testid={`${p}-chrome-first-page`} checked={layout.chrome.onFirstPage} onChange={(e) => setChrome({ onFirstPage: e.target.checked })} />
              On the cover too
            </label>
          </div>
        </div>
      </div>

      {/* The canvas */}
      {canvasInput && (
        <DesignCanvas
          input={canvasInput}
          colours={colours}
          fonts={fonts}
          onPlace={place}
          onResize={(key, wMm) => setPlaced(key, { wMm })}
          onReorder={onReorder}
          onShapeMove={(id, placement) => patchShape(id, placement)}
          prefix={`${prefix}-canvas`}
        />
      )}
      <div className="text-apple-11 text-secondary" data-testid={`${p}-summary`}>
        {pageCount} {pageCount === 1 ? 'page' : 'pages'} · {layout.columns} column(s) · {layout.shapes.length} shape(s)
      </div>

      {/* Placed blocks */}
      <div className="space-y-1" data-testid={`${p}-placed`}>
        <div className="text-apple-12 text-primary">Placement</div>
        {placedFree.length === 0 && <div className="text-apple-11 text-secondary">Every block flows in the column order.</div>}
        {placedFree.map((pb) => (
          <div key={pb.key} className="flex items-center gap-2 text-apple-11" data-testid={`${p}-placed-${pb.key}`}>
            <span className="text-secondary">{pb.key}: page {pb.page} at {pb.xMm ?? 0}, {pb.yMm ?? 0} mm</span>
            <button type="button" className="text-apple-11 text-primary" data-testid={`${p}-unplace-${pb.key}`}
              onClick={() => setPlaced(pb.key, { xMm: null, yMm: null, page: 1 })}>Return to flow</button>
          </div>
        ))}
      </div>

      {/* Shapes */}
      <div className="space-y-2" data-testid={`${p}-shapes`}>
        <div className="text-apple-12 text-primary">Shapes</div>
        <ShapePicker onAdd={addShape} prefix={p} />
        {layout.shapes.map((s) => (
          <div key={s.id} className="flex items-center gap-2 flex-wrap text-apple-11" data-testid={`${p}-shape-${s.id}`}>
            <span className="text-secondary">{SHAPE_LABELS[s.kind]} · page</span>
            <input type="number" min={1} className="w-14 px-1 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
              aria-label={`Page for ${s.id}`} data-testid={`${p}-shape-${s.id}-page`} value={s.page}
              onChange={(e) => patchShape(s.id, { page: Number(e.target.value) })} />
            <input type="number" className="w-16 px-1 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
              aria-label={`X for ${s.id}`} data-testid={`${p}-shape-${s.id}-x`} value={s.xMm}
              onChange={(e) => patchShape(s.id, { xMm: Number(e.target.value) })} />
            <input type="number" className="w-16 px-1 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
              aria-label={`Y for ${s.id}`} data-testid={`${p}-shape-${s.id}-y`} value={s.yMm}
              onChange={(e) => patchShape(s.id, { yMm: Number(e.target.value) })} />
            <input type="number" className="w-16 px-1 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
              aria-label={`Width for ${s.id}`} data-testid={`${p}-shape-${s.id}-w`} value={s.wMm}
              onChange={(e) => patchShape(s.id, { wMm: Number(e.target.value) })} />
            <input type="number" className="w-16 px-1 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
              aria-label={`Height for ${s.id}`} data-testid={`${p}-shape-${s.id}-h`} value={s.hMm}
              onChange={(e) => patchShape(s.id, { hMm: Number(e.target.value) })} />
            {s.kind === 'callout' && (
              <input className="px-2 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
                aria-label={`Text for ${s.id}`} data-testid={`${p}-shape-${s.id}-text`} value={s.text}
                onChange={(e) => patchShape(s.id, { text: e.target.value })} />
            )}
            <button type="button" className="text-apple-11 text-primary" data-testid={`${p}-shape-${s.id}-remove`} onClick={() => removeShape(s.id)}>Remove</button>
          </div>
        ))}
      </div>

      {/* Table styles */}
      <div className="space-y-2" data-testid={`${p}-tables`}>
        <div className="text-apple-12 text-primary">Tables</div>
        <label className="text-apple-11 text-secondary">
          Default style
          <Select ariaLabel="Default table style" data-testid={`${p}-default-table-style`} value={layout.defaultTableStyle}
            onChange={(v) => onLayout({ defaultTableStyle: v as TableStyleName })}
            options={TABLE_STYLE_NAMES.map((s) => ({ value: s, label: TABLE_STYLE_LABELS[s] }))} />
        </label>
        {applied?.map((b) => (
          <div key={b.key} className="flex items-center gap-2 text-apple-11" data-testid={`${p}-table-${b.key}`}>
            <span className="text-secondary">{b.label}</span>
            <Select ariaLabel={`Table style for ${b.key}`} data-testid={`${p}-table-${b.key}-style`}
              value={layout.tableStyles.find((t) => t.key === b.key)?.style ?? layout.defaultTableStyle}
              onChange={(v) => {
                const next = layout.tableStyles.filter((t) => t.key !== b.key);
                onLayout({ tableStyles: [...next, { key: b.key, style: v as TableStyleName }] });
              }}
              options={TABLE_STYLE_NAMES.map((s) => ({ value: s, label: TABLE_STYLE_LABELS[s] }))} />
          </div>
        ))}
      </div>

      {/* Links */}
      <div className="space-y-2" data-testid={`${p}-links-editor`}>
        <div className="flex items-center gap-2">
          <span className="text-apple-12 text-primary">Links</span>
          <button type="button" className="text-apple-11 text-primary" data-testid={`${p}-add-link`} onClick={addLink}>Add link</button>
        </div>
        {layout.links.map((l) => (
          <div key={l.id} className="flex items-center gap-2 flex-wrap text-apple-11" data-testid={`${p}-link-${l.id}`}>
            <input className="px-2 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
              aria-label={`Label for ${l.id}`} data-testid={`${p}-link-${l.id}-label`} value={l.label}
              onChange={(e) => patchLink(l.id, { label: e.target.value })} />
            <input className="flex-1 px-2 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
              aria-label={`Address for ${l.id}`} data-testid={`${p}-link-${l.id}-url`} value={l.url}
              onChange={(e) => patchLink(l.id, { url: e.target.value })} />
            {hyperlinkError(l) && <span className="text-apple-11" data-testid={`${p}-link-${l.id}-error`}>{hyperlinkError(l)}</span>}
            <button type="button" className="text-apple-11 text-primary" data-testid={`${p}-link-${l.id}-remove`} onClick={() => removeLink(l.id)}>Remove</button>
          </div>
        ))}
      </div>

      {/* Cross-references */}
      <div className="space-y-2" data-testid={`${p}-references-editor`}>
        <div className="flex items-center gap-2">
          <span className="text-apple-12 text-primary">Cross-references</span>
          <button type="button" className="text-apple-11 text-primary" data-testid={`${p}-add-reference`} onClick={addReference}>Add reference</button>
        </div>
        {layout.crossReferences.map((r) => (
          <div key={r.id} className="flex items-center gap-2 flex-wrap text-apple-11" data-testid={`${p}-reference-${r.id}`}>
            <Select ariaLabel={`Reference kind for ${r.id}`} data-testid={`${p}-reference-${r.id}-kind`} value={r.kind}
              onChange={(v) => patchReference(r.id, { kind: v as ReferenceKind })}
              options={[{ value: 'heading', label: 'Heading' }, { value: 'figure', label: 'Figure' }, { value: 'table', label: 'Table' }]} />
            <Select ariaLabel={`Reference target for ${r.id}`} data-testid={`${p}-reference-${r.id}-target`} value={r.targetKey}
              onChange={(v) => patchReference(r.id, { targetKey: v })}
              options={(applied ?? []).map((b) => ({ value: b.key, label: b.label }))} />
            <input className="w-20 px-2 py-0.5 rounded-lg bg-surface-hover text-apple-11 text-primary"
              aria-label={`Label for ${r.id}`} data-testid={`${p}-reference-${r.id}-label`} value={r.label}
              onChange={(e) => patchReference(r.id, { label: e.target.value })} />
            <button type="button" className="text-apple-11 text-primary" data-testid={`${p}-reference-${r.id}-remove`} onClick={() => removeReference(r.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
};
