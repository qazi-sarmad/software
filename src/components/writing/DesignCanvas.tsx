import React, { useCallback, useMemo, useRef, useState } from 'react';
import { toCssColour } from '../../lib/render/branding';
import {
  buildDesignCanvas, itemTestId, snapPxToMm, snapWidthPxToMm, ZOOM_LIMITS,
  type CanvasItem, type DesignCanvasInput, type DesignCanvasModel,
} from '../../lib/writing/designCanvas';
import { SHAPE_LABELS, type ShapeSpec } from '../../lib/writing/shapes';
import type { GridSpec } from '../../lib/writing/grid';
import type { PlacedBlock } from '../../lib/writing/pageDesign';

/**
 * The interactive design canvas (WP-D). A designer's page: rulers, a snap grid, zoom, drag to move a
 * block to a free x/y, resize by handle, multi-column flow, and the design shapes drawn behind the
 * text. It is presentational apart from the drag maths, which are pure functions in designCanvas.
 *
 * Every interactive element carries a data-testid `<prefix>-<element>` so the parallel UI track and
 * the E2E suite can drive it. Colours arrive as design tokens or hex and go through `toCssColour`, so
 * no colour literal is written here.
 */
export interface DesignCanvasProps {
  input: Omit<DesignCanvasInput, 'zoom'>;
  colours: { primary: string; accent: string; text: string; background: string };
  fonts: { heading: string; body: string };
  activeKey?: string | null;
  onSelect?: (key: string | null) => void;
  /** Move a block to a free position, in millimetres, or back to the flow (x/y null). */
  onPlace?: (key: string, placement: { xMm: number | null; yMm: number | null; page: number; wMm?: number }) => void;
  /** Resize a placed block, in millimetres. */
  onResize?: (key: string, wMm: number) => void;
  /** Reorder a flowed block by dropping it on another. */
  onReorder?: (fromKey: string, toKey: string) => void;
  /** Move a shape to a free position, in millimetres. */
  onShapeMove?: (id: string, placement: { xMm: number; yMm: number; page: number }) => void;
  prefix?: string;
}

export const DesignCanvas: React.FC<DesignCanvasProps> = ({
  input, colours, fonts, activeKey = null, onSelect, onPlace, onResize, onReorder, onShapeMove, prefix = 'wk-canvas',
}) => {
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(input.grid.visible);
  const [snap, setSnap] = useState(input.grid.snap);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dropHint, setDropHint] = useState<{ page: number; xMm: number; yMm: number } | null>(null);
  const [resize, setResize] = useState<{ key: string; startX: number; startW: number } | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const grid: GridSpec = useMemo(() => ({ ...input.grid, visible: showGrid, snap }), [input.grid, showGrid, snap]);
  const model: DesignCanvasModel = useMemo(
    () => buildDesignCanvas({ ...input, grid, zoom }),
    [input, grid, zoom],
  );

  const bg = toCssColour(colours.background);
  const fg = toCssColour(colours.text);
  const accent = toCssColour(colours.accent);
  const primary = toCssColour(colours.primary);
  const theme = model.theme;

  const shapeFill = (fill: string): string => {
    if (fill === 'none') return 'transparent';
    if (fill === 'brand') return toCssColour(theme.primary);
    if (fill === 'accent') return toCssColour(theme.accent);
    if (fill === 'surface') return toCssColour(theme.surface);
    if (fill === 'callout') return toCssColour(theme.calloutFill);
    return toCssColour(fill);
  };
  const shapeStroke = (stroke: string): string => (stroke === 'none' ? 'transparent' : toCssColour(stroke === '' ? theme.rule : stroke));

  /** Pointer-down on a block body starts a move; on the handle starts a resize. */
  const startMove = useCallback((item: CanvasItem, pageIndex: number, e: React.PointerEvent) => {
    if (!onPlace) return;
    const page = pageRefs.current[pageIndex];
    if (!page) return;
    const rect = page.getBoundingClientRect();
    setDragKey(item.id);
    setDragOffset({ x: e.clientX - rect.left - item.xPx, y: e.clientY - rect.top - item.yPx });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [onPlace]);

  const onPointerMove = useCallback((pageIndex: number, e: React.PointerEvent) => {
    if (!dragKey) return;
    const page = pageRefs.current[pageIndex];
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const px = e.clientX - rect.left - dragOffset.x;
    const py = e.clientY - rect.top - dragOffset.y;
    setDropHint({
      page: pageIndex,
      xMm: snapPxToMm(Math.max(0, px), zoom, grid),
      yMm: snapPxToMm(Math.max(0, py), zoom, grid),
    });
  }, [dragKey, dragOffset, zoom, grid]);

  const endMove = useCallback((pageIndex: number) => {
    if (dragKey && dropHint && onPlace) {
      onPlace(dragKey, { xMm: dropHint.xMm, yMm: dropHint.yMm, page: dropHint.page });
    }
    setDragKey(null);
    setDropHint(null);
  }, [dragKey, dropHint, onPlace]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resize) return;
    const delta = e.clientX - resize.startX;
    const mm = snapWidthPxToMm(Math.max(10, resize.startW + delta), zoom, grid);
    onResize?.(resize.key, mm);
  }, [resize, zoom, grid, onResize]);

  return (
    <div data-testid={`${prefix}-shell`} className="flex flex-col gap-2">
      {/* The toolbar: zoom, grid and snapping. */}
      <div className="flex items-center gap-2" data-testid={`${prefix}-toolbar`}>
        <button
          type="button"
          data-testid={`${prefix}-zoom-out`}
          onClick={() => setZoom((z) => Math.max(ZOOM_LIMITS.min, Math.round((z - 0.1) * 100) / 100))}
          className="text-apple-12"
        >
          −
        </button>
        <span data-testid={`${prefix}-zoom-value`} className="text-apple-12 tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          data-testid={`${prefix}-zoom-in`}
          onClick={() => setZoom((z) => Math.min(ZOOM_LIMITS.max, Math.round((z + 0.1) * 100) / 100))}
          className="text-apple-12"
        >
          +
        </button>
        <button type="button" data-testid={`${prefix}-zoom-reset`} onClick={() => setZoom(1)} className="text-apple-12">100%</button>
        <label className="flex items-center gap-1 text-apple-12">
          <input type="checkbox" data-testid={`${prefix}-grid-toggle`} checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Grid
        </label>
        <label className="flex items-center gap-1 text-apple-12">
          <input type="checkbox" data-testid={`${prefix}-snap-toggle`} checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Snap
        </label>
        <span data-testid={`${prefix}-page-count`} className="text-apple-12 text-tertiary">
          {model.pageCount} {model.pageCount === 1 ? 'page' : 'pages'}
        </span>
      </div>

      <div className="overflow-auto" data-testid={`${prefix}-viewport`}>
        {model.pages.map((page) => (
          <div key={page.index} className="mb-4" data-testid={`${prefix}-page-${page.index}`}>
            {/* Rulers: the top ruler is horizontal, the left ruler vertical. */}
            {model.grid.rulers && (
              <div data-testid={`${prefix}-ruler-top-${page.index}`} style={{ position: 'relative', height: '14px', width: `${page.widthPx}px`, marginLeft: 0 }}>
                {page.rulerTop.map((x, i) => (
                  <span key={i} style={{ position: 'absolute', left: `${x}px`, top: 0, width: '1px', height: '6px', background: 'var(--border-subtle)' }} />
                ))}
              </div>
            )}
            <div className="flex">
              {model.grid.rulers && (
                <div data-testid={`${prefix}-ruler-left-${page.index}`} style={{ position: 'relative', width: '14px', height: `${page.heightPx}px` }}>
                  {page.rulerLeft.map((y, i) => (
                    <span key={i} style={{ position: 'absolute', top: `${y}px`, left: 0, height: '1px', width: '6px', background: 'var(--border-subtle)' }} />
                  ))}
                </div>
              )}
              <div
                ref={(el) => { pageRefs.current[page.index] = el; }}
                data-testid={`${prefix}-paper-${page.index}`}
                onPointerMove={(e) => onPointerMove(page.index, e)}
                onPointerUp={() => endMove(page.index)}
                onPointerLeave={() => { if (resize) setResize(null); }}
                style={{
                  position: 'relative', width: `${page.widthPx}px`, height: `${page.heightPx}px`,
                  background: bg, color: fg, boxShadow: 'var(--shadow-soft)', overflow: 'hidden',
                }}
              >
                {/* The chrome: the header and footer strings, with the rule lines. */}
                {model.chrome.headerEnabled && (
                  <div
                    data-testid={`${prefix}-header-${page.index}`}
                    style={{
                      position: 'absolute', top: `${Math.round(page.marginTopPx * 0.3)}px`, left: `${page.marginLeftPx}px`,
                      width: `${page.contentWidthPx}px`, display: 'flex', justifyContent: 'space-between',
                      fontSize: '9px', color: fg,
                      borderBottom: model.chrome.rule ? `1px solid ${toCssColour(theme.rule)}` : 'none',
                    }}
                  >
                    <span>{page.header.left}</span><span>{page.header.centre}</span><span>{page.header.right}</span>
                  </div>
                )}
                {model.chrome.footerEnabled && (
                  <div
                    data-testid={`${prefix}-footer-${page.index}`}
                    style={{
                      position: 'absolute', bottom: `${Math.round(page.marginTopPx * 0.3)}px`, left: `${page.marginLeftPx}px`,
                      width: `${page.contentWidthPx}px`, display: 'flex', justifyContent: 'space-between',
                      fontSize: '9px', color: fg,
                      borderTop: model.chrome.rule ? `1px solid ${toCssColour(theme.rule)}` : 'none',
                    }}
                  >
                    <span>{page.footer.left}</span><span>{page.footer.centre}</span><span>{page.footer.right}</span>
                  </div>
                )}

                {/* The snap grid. */}
                {showGrid && (
                  <div data-testid={`${prefix}-grid-${page.index}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    {page.gridVertical.map((x, i) => (
                      <span key={`v${i}`} style={{ position: 'absolute', left: `${page.contentXPx + x}px`, top: `${page.contentYPx}px`, width: '1px', height: `${page.contentHeightPx}px`, background: 'var(--border-subtle)', opacity: 0.5 }} />
                    ))}
                    {page.gridHorizontal.map((y, i) => (
                      <span key={`h${i}`} style={{ position: 'absolute', top: `${page.contentYPx + y}px`, left: `${page.contentXPx}px`, height: '1px', width: `${page.contentWidthPx}px`, background: 'var(--border-subtle)', opacity: 0.5 }} />
                    ))}
                  </div>
                )}

                {/* The shapes, behind the text, in z order. */}
                {page.items.filter((i) => i.kind === 'shape').map((item) => (
                  <div
                    key={item.id}
                    data-testid={itemTestId(prefix, item)}
                    data-shape-kind={item.shape?.kind}
                    onPointerDown={(e) => { if (onShapeMove) { e.stopPropagation(); setDragKey(item.id); } }}
                    style={{
                      position: 'absolute', left: `${item.xPx}px`, top: `${item.yPx}px`,
                      width: `${item.wPx}px`, height: `${item.hPx}px`,
                      background: shapeFill(item.shape?.fill ?? 'none'),
                      border: `${item.shape?.strokePt ?? 0}px solid ${shapeStroke(item.shape?.stroke ?? 'none')}`,
                      borderRadius: `${item.shape?.radiusMm ?? 0}px`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: `${item.bodyPx}px`, color: toCssColour(theme.calloutText), textAlign: 'center',
                    }}
                  >
                    {item.shape?.kind === 'callout' ? item.shape.text : null}
                  </div>
                ))}

                {/* The blocks. */}
                {page.items.filter((i) => i.kind === 'block').map((item) => (
                  <div
                    key={item.id}
                    data-testid={itemTestId(prefix, item)}
                    data-block-key={item.id}
                    data-free={item.free ? 'true' : 'false'}
                    onPointerDown={(e) => { if (onPlace) { onSelect?.(item.id); startMove(item, page.index, e); } else { onSelect?.(item.id); } }}
                    style={{
                      position: 'absolute', left: `${item.xPx}px`, top: `${item.yPx}px`,
                      width: `${item.wPx}px`, minHeight: `${item.hPx}px`,
                      cursor: onPlace ? 'move' : 'default',
                      outline: activeKey === item.id ? `2px solid ${accent}` : 'none',
                      paddingLeft: '4px',
                    }}
                  >
                    <div
                      data-testid={`${prefix}-heading-${item.id}`}
                      style={{ fontFamily: fonts.heading, fontSize: `${item.headingPx}px`, fontWeight: item.headingWeight, color: toCssColour(theme.heading) }}
                    >
                      {item.label}
                    </div>
                    <div
                      data-testid={`${prefix}-body-${item.id}`}
                      style={{ fontFamily: fonts.body, fontSize: `${item.bodyPx}px`, fontWeight: item.bodyWeight, lineHeight: item.lineHeight, color: toCssColour(theme.body) }}
                    >
                      <div style={{ background: 'var(--surface-hover)', height: '6px', margin: '3px 0', borderRadius: '2px' }} />
                      <div style={{ background: 'var(--surface-hover)', height: '6px', width: '70%', margin: '3px 0', borderRadius: '2px' }} />
                    </div>
                    {onResize && (
                      <span
                        data-testid={`${prefix}-resize-${item.id}`}
                        onPointerDown={(e) => { e.stopPropagation(); setResize({ key: item.id, startX: e.clientX, startW: item.wPx }); }}
                        onPointerMove={onResizeMove}
                        onPointerUp={() => setResize(null)}
                        style={{ position: 'absolute', right: '-4px', top: '50%', width: '8px', height: '8px', background: accent, borderRadius: '50%', cursor: 'ew-resize' }}
                      />
                    )}
                  </div>
                ))}

                {/* The drop hint while dragging. */}
                {dropHint && dropHint.page === page.index && (
                  <span data-testid={`${prefix}-drophint-${page.index}`} style={{ position: 'absolute', left: `${Math.round(dropHint.xMm * 96 / 25.4 * zoom)}px`, top: `${Math.round(dropHint.yMm * 96 / 25.4 * zoom)}px`, width: '2px', height: '20px', background: accent }} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* The reference list, resolved to the pages the targets landed on. */}
      {model.references.length > 0 && (
        <div data-testid={`${prefix}-references`} className="text-apple-12 text-tertiary">
          {model.references.map((r) => <div key={r.id}>{r.text}</div>)}
        </div>
      )}
      {/* The link list. */}
      {model.links.length > 0 && (
        <div data-testid={`${prefix}-links`} className="text-apple-12 text-tertiary">
          {model.links.map((l) => <div key={l.id}>{l.label} — {l.url}</div>)}
        </div>
      )}
    </div>
  );
};

/** The shape picker, so a designer can drop a shape. Kept here so the canvas owns its own controls. */
export const ShapePicker: React.FC<{ onAdd: (kind: ShapeSpec['kind']) => void; prefix?: string }> = ({ onAdd, prefix = 'wk-canvas' }) => (
  <div className="flex flex-wrap gap-1" data-testid={`${prefix}-shape-picker`}>
    {(Object.keys(SHAPE_LABELS) as ShapeSpec['kind'][]).map((kind) => (
      <button
        key={kind}
        type="button"
        data-testid={`${prefix}-add-shape-${kind}`}
        onClick={() => onAdd(kind)}
        className="text-apple-12"
      >
        {SHAPE_LABELS[kind]}
      </button>
    ))}
  </div>
);

export type { PlacedBlock };
