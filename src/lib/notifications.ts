/**
 * Notification templating (F7). Pure functions that turn a template (a list of blocks) and an event
 * payload into a subject, an HTML body and a text body.
 *
 * Two rules matter here and are tested:
 *   - every variable is escaped, so a payload value can never inject markup;
 *   - a value that looks like a secret is never rendered, even if it slipped into a payload.
 */
import { PRODUCT_NAME } from './product';

export type BlockType = 'heading' | 'paragraph' | 'link' | 'divider';

export interface TemplateBlock {
  type: BlockType;
  text?: string;
  href?: string;
}

export interface RenderedMessage {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

const SECRET_KEY = /(secret|password|token|api[_-]?key|credential|private[_-]?key)/i;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Flatten a payload into readable "field: value" lines, dropping anything secret-looking. */
export function summarisePayload(payload: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (SECRET_KEY.test(key)) continue;
    if (value === null || value === undefined) continue;
    const shown = typeof value === 'object' ? JSON.stringify(value) : String(value);
    lines.push(`${key.replace(/_/g, ' ')}: ${shown}`);
  }
  return lines;
}

/** Render one template against a payload. Deterministic; no randomness, no clock. */
export function renderTemplate(
  subject: string, blocks: TemplateBlock[], payload: Record<string, unknown>
): RenderedMessage {
  const html: string[] = [];
  const text: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        html.push(`<h2>${escapeHtml(block.text ?? '')}</h2>`);
        text.push(`${block.text ?? ''}\n`);
        break;
      case 'paragraph':
        html.push(`<p>${escapeHtml(block.text ?? '')}</p>`);
        text.push(`${block.text ?? ''}\n`);
        break;
      case 'link': {
        const href = block.href ?? '#';
        html.push(`<p><a href="${escapeHtml(href)}">${escapeHtml(block.text ?? href)}</a></p>`);
        text.push(`${block.text ?? href}: ${href}\n`);
        break;
      }
      case 'divider':
        html.push('<hr/>');
        text.push('\n');
        break;
    }
  }

  const facts = summarisePayload(payload);
  if (facts.length) {
    html.push(`<ul>${facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`);
    text.push(...facts.map((f) => `- ${f}`));
  }

  return {
    subject: subject || `${PRODUCT_NAME} notification`,
    bodyHtml: html.join(''),
    bodyText: text.join('\n').trim(),
  };
}

/** The fallback message when an event has no template. */
export function renderFallback(
  eventKey: string, payload: Record<string, unknown>
): RenderedMessage {
  const what = typeof payload.summary === 'string' ? payload.summary : eventKey;
  return {
    subject: `${PRODUCT_NAME}: ${eventKey.replace(/\./g, ' ')}`,
    bodyHtml: `<p>${escapeHtml(what)}</p>`,
    bodyText: what,
  };
}

/** A one-line description of a block, for the template editor's block list. */
export function describeBlock(block: TemplateBlock): string {
  switch (block.type) {
    case 'heading':
      return `Heading: ${block.text ?? ''}`;
    case 'paragraph':
      return `Paragraph: ${(block.text ?? '').slice(0, 60)}`;
    case 'link':
      return `Link: ${block.text ?? block.href ?? ''}`;
    case 'divider':
      return 'Divider';
  }
}

/** Move a block within the list, for the editor's up/down buttons. Returns a new array. */
export function moveBlock(blocks: TemplateBlock[], index: number, delta: number): TemplateBlock[] {
  const target = index + delta;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return blocks;
  const copy = [...blocks];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}
