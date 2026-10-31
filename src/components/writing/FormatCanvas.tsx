import React from 'react';
import { toCssColour } from '../../lib/render/branding';
import type { CanvasPage } from '../../lib/writing/canvas';

/**
 * The live page canvas (WP-C2). A read-only drawing of the page model that `buildCanvas` produced:
 * the paper, the content box, and one placed block per visible section at the resolved typography.
 * It is deliberately presentational — it reads only the page model and the format's colour values —
 * so the canvas and the printed PDF agree and nothing here can change a fact.
 *
 * Colours arrive as design-token names or hex values and are turned into CSS custom-property
 * references by `toCssColour`, so no colour literal is written in this component.
 */
export interface FormatCanvasProps {
  page: CanvasPage;
  /** The four colour values from the format layout (token names or hex). */
  colours: { primary: string; accent: string; text: string; background: string };
  /** The heading and body font family names, already resolved to self-hosted faces. */
  fonts: { heading: string; body: string };
  /** The section currently highlighted by the editor, if any. */
  activeKey?: string | null;
  /** Called when a block is dropped on a new slot. Omit to render a static canvas. */
  onReorder?: (fromKey: string, toKey: string) => void;
  prefix?: string;
}

export const FormatCanvas: React.FC<FormatCanvasProps> = ({
  page, colours, fonts, activeKey = null, onReorder, prefix = 'format-canvas',
}) => {
  const bg = toCssColour(colours.background);
  const fg = toCssColour(colours.text);
  const accent = toCssColour(colours.accent);
  const primary = toCssColour(colours.primary);
  const [dragging, setDragging] = React.useState<string | null>(null);

  return (
    <div className="flex justify-center" data-testid={`${prefix}-wrap`}>
      <div
        data-testid={`${prefix}-page`}
        style={{
          width: `${page.widthPx}px`,
          minHeight: `${page.heightPx}px`,
          background: bg,
          color: fg,
          paddingTop: `${page.marginTopPx}px`,
          paddingRight: `${page.marginRightPx}px`,
          paddingBottom: `${page.marginBottomPx}px`,
          paddingLeft: `${page.marginLeftPx}px`,
          boxShadow: 'var(--shadow-soft)',
          position: 'relative',
        }}
      >
        <div data-testid={`${prefix}-content`} style={{ width: `${page.contentWidthPx}px` }}>
          {page.blocks.map((b, index) => (
            <div
              key={b.key}
              data-testid={`${prefix}-block-${b.key}`}
              data-block-key={b.key}
              draggable={Boolean(onReorder)}
              onDragStart={() => setDragging(b.key)}
              onDragOver={(e) => { if (onReorder) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                if (onReorder && dragging && dragging !== b.key) onReorder(dragging, b.key);
                setDragging(null);
              }}
              style={{
                marginBottom: '10px',
                paddingLeft: '6px',
                borderLeft: activeKey === b.key ? `3px solid ${accent}` : '3px solid transparent',
                outline: dragging === b.key ? `1px dashed ${primary}` : 'none',
              }}
            >
              <div
                data-testid={`${prefix}-heading-${b.key}`}
                style={{ fontFamily: fonts.heading, fontSize: `${b.headingPt}px`, fontWeight: b.headingWeight, color: primary }}
              >
                {index + 1}. {b.label}
              </div>
              <div
                data-testid={`${prefix}-body-${b.key}`}
                style={{ fontFamily: fonts.body, fontSize: `${b.bodyPt}px`, fontWeight: b.bodyWeight, lineHeight: b.lineHeight, color: fg }}
              >
                {b.bodyLines > 0
                  ? Array.from({ length: Math.min(b.bodyLines, 3) }, (_, i) => (
                    <div key={i} style={{ background: 'var(--surface-hover)', height: `${Math.round(b.bodyPt * b.lineHeight * 0.6)}px`, margin: '2px 0', borderRadius: '2px' }} />
                  ))
                  : <span className="text-apple-11" style={{ opacity: 0.5 }}>(heading only)</span>}
              </div>
            </div>
          ))}
          {page.overflowsFirstPage && (
            <div data-testid={`${prefix}-pagebreak`} style={{ borderTop: `1px dashed ${accent}`, marginTop: '12px', paddingTop: '4px', fontSize: '11px', color: accent }}>
              page break — content continues
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
