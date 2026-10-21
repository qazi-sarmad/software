/**
 * Chart rendering (C2.7, spec §18 "Charts and graphs: PNG, SVG, PDF").
 *
 * One chart model, three outputs: PNG pixels (through the dependency-free encoder in ./png), SVG text
 * and a draw list the PDF renderer can replay. All three are pure functions of the same data, so the
 * formats cannot drift apart, and each is deterministic (no timestamps, no randomness).
 *
 * Colours are passed in as hex; the caller reads them from the design tokens or the org branding, so
 * no palette is hard-coded here.
 */
import { PixelCanvas, parseHexColour, type Rgba } from './png';

export interface ChartSeries {
  label: string;
  /** One value per category, in the same order as `categories`. */
  values: number[];
  colour: string;
}

export interface ChartModel {
  title: string;
  categories: string[];
  series: ChartSeries[];
  kind: 'bar' | 'line';
}

export interface ChartSize { width: number; height: number }

const DEFAULT_SIZE: ChartSize = { width: 640, height: 360 };

/** The plot rectangle inside the canvas, leaving room for the title and the axes labels. */
function plotBox(size: ChartSize) {
  return { left: 56, top: 44, right: size.width - 20, bottom: size.height - 40 };
}

function maxValue(model: ChartModel): number {
  let max = 0;
  for (const s of model.series) for (const v of s.values) if (v > max) max = v;
  return max > 0 ? max : 1;
}

/** Render the chart to PNG bytes. Deterministic for the same model, size and colours. */
export function renderChartPng(
  model: ChartModel, colours: { background: string; axis: string; text: string }, size: ChartSize = DEFAULT_SIZE,
): Uint8Array {
  const canvas = new PixelCanvas(size.width, size.height, parseHexColour(colours.background));
  const axis = parseHexColour(colours.axis);
  const box = plotBox(size);
  const max = maxValue(model);

  // Axes.
  canvas.line(box.left, box.top, box.left, box.bottom, axis);
  canvas.line(box.left, box.bottom, box.right, box.bottom, axis);

  const plotW = box.right - box.left;
  const plotH = box.bottom - box.top;
  const groups = model.categories.length || 1;
  const groupW = plotW / groups;

  if (model.kind === 'bar') {
    const barW = Math.max(2, Math.floor(groupW / (model.series.length + 1)));
    model.series.forEach((s, si) => {
      const colour = parseHexColour(s.colour);
      s.values.forEach((v, ci) => {
        const h = Math.round((v / max) * plotH);
        const x = box.left + ci * groupW + (si + 0.5) * (groupW / (model.series.length + 1));
        canvas.fillRect(x, box.bottom - h, barW, h, colour);
      });
    });
  } else {
    model.series.forEach((s) => {
      const colour = parseHexColour(s.colour);
      let prev: { x: number; y: number } | null = null;
      s.values.forEach((v, ci) => {
        const x = box.left + ci * groupW + groupW / 2;
        const y = box.bottom - Math.round((v / max) * plotH);
        if (prev) canvas.line(prev.x, prev.y, x, y, colour);
        prev = { x, y };
      });
    });
  }

  return canvas.png();
}

/** Escape text for XML; keeps the SVG valid for any label. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render the same chart as an SVG document. Vector, so it is identical at any scale. */
export function renderChartSvg(
  model: ChartModel, colours: { background: string; axis: string; text: string }, size: ChartSize = DEFAULT_SIZE,
): string {
  const box = plotBox(size);
  const max = maxValue(model);
  const plotW = box.right - box.left;
  const plotH = box.bottom - box.top;
  const groups = model.categories.length || 1;
  const groupW = plotW / groups;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`);
  parts.push(`<rect width="${size.width}" height="${size.height}" fill="${esc(colours.background)}"/>`);
  parts.push(`<text x="${box.left}" y="24" font-family="sans-serif" font-size="14" fill="${esc(colours.text)}">${esc(model.title)}</text>`);

  if (model.kind === 'bar') {
    const barW = Math.max(2, Math.floor(groupW / (model.series.length + 1)));
    model.series.forEach((s, si) => {
      s.values.forEach((v, ci) => {
        const h = (v / max) * plotH;
        const x = box.left + ci * groupW + (si + 0.5) * (groupW / (model.series.length + 1));
        parts.push(`<rect x="${x.toFixed(2)}" y="${(box.bottom - h).toFixed(2)}" width="${barW}" height="${h.toFixed(2)}" fill="${esc(s.colour)}"/>`);
      });
    });
  } else {
    model.series.forEach((s) => {
      const pts = s.values.map((v, ci) => {
        const x = box.left + ci * groupW + groupW / 2;
        const y = box.bottom - (v / max) * plotH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="${esc(s.colour)}" stroke-width="2"/>`);
    });
  }

  model.categories.forEach((c, ci) => {
    const x = box.left + ci * groupW + groupW / 2;
    parts.push(`<text x="${x.toFixed(2)}" y="${box.bottom + 18}" font-family="sans-serif" font-size="10" text-anchor="middle" fill="${esc(colours.text)}">${esc(c)}</text>`);
  });
  parts.push(`<line x1="${box.left}" y1="${box.top}" x2="${box.left}" y2="${box.bottom}" stroke="${esc(colours.axis)}"/>`);
  parts.push(`<line x1="${box.left}" y1="${box.bottom}" x2="${box.right}" y2="${box.bottom}" stroke="${esc(colours.axis)}"/>`);
  parts.push('</svg>');
  return parts.join('\n');
}

export interface DrawList {
  size: ChartSize;
  rects: Array<{ x: number; y: number; w: number; h: number; colour: string }>;
}

/** A draw list the PDF renderer replays, so a chart appears in the PDF with the same geometry. */
export function chartDrawList(model: ChartModel, size: ChartSize = DEFAULT_SIZE): DrawList {
  const box = plotBox(size);
  const max = maxValue(model);
  const plotW = box.right - box.left;
  const plotH = box.bottom - box.top;
  const groups = model.categories.length || 1;
  const groupW = plotW / groups;
  const rects: DrawList['rects'] = [];
  if (model.kind === 'bar') {
    const barW = Math.max(2, Math.floor(groupW / (model.series.length + 1)));
    model.series.forEach((s, si) => {
      s.values.forEach((v, ci) => {
        const h = (v / max) * plotH;
        const x = box.left + ci * groupW + (si + 0.5) * (groupW / (model.series.length + 1));
        rects.push({ x, y: box.bottom - h, w: barW, h, colour: s.colour });
      });
    });
  }
  return { size, rects };
}

export { parseHexColour, type Rgba };
