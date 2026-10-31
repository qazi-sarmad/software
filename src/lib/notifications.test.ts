import { describe, expect, it } from 'vitest';
import {
  describeBlock, escapeHtml, moveBlock, renderFallback, renderTemplate, summarisePayload,
} from './notifications';
import { PRODUCT_NAME } from './product';

describe('notification templating (F7, F5)', () => {
  it('escapes every variable so a payload cannot inject markup', () => {
    const out = renderTemplate('Subject', [{ type: 'paragraph', text: 'Hello <script>alert(1)</script>' }], {});
    expect(out.bodyHtml).not.toContain('<script>');
    expect(out.bodyHtml).toContain('&lt;script&gt;');
  });

  it('escapes a value used in a link href', () => {
    const out = renderTemplate('S', [{ type: 'link', text: 'Open', href: 'https://x/?a="b"' }], {});
    expect(out.bodyHtml).toContain('&quot;');
  });

  it('never renders a secret-looking payload field', () => {
    const lines = summarisePayload({ severity: 'high', api_key: 'super-secret', password: 'hunter2' });
    expect(lines.join(' ')).toContain('severity');
    expect(lines.join(' ')).not.toContain('super-secret');
    expect(lines.join(' ')).not.toContain('hunter2');
  });

  it('renders the payload facts as a list', () => {
    const out = renderTemplate('S', [{ type: 'paragraph', text: 'Body' }], { severity: 'high' });
    expect(out.bodyHtml).toContain('<ul>');
    expect(out.bodyText).toContain('severity: high');
  });

  it('renders each block type', () => {
    const out = renderTemplate('S', [
      { type: 'heading', text: 'H' },
      { type: 'paragraph', text: 'P' },
      { type: 'link', text: 'L', href: 'https://a' },
      { type: 'divider' },
    ], {});
    expect(out.bodyHtml).toContain('<h2>H</h2>');
    expect(out.bodyHtml).toContain('<p>P</p>');
    expect(out.bodyHtml).toContain('<a href="https://a">L</a>');
    expect(out.bodyHtml).toContain('<hr/>');
  });

  it('falls back to a default subject when none is given', () => {
    expect(renderTemplate('', [], {}).subject).toBe(`${PRODUCT_NAME} notification`);
  });

  it('the fallback message uses the event summary when present', () => {
    expect(renderFallback('config.changed', { summary: 'Email sender changed' }).bodyText)
      .toBe('Email sender changed');
  });

  it('the fallback message uses the event key when there is no summary', () => {
    expect(renderFallback('cap.overdue', {}).subject).toContain('cap overdue');
  });

  it('describes a block for the editor list', () => {
    expect(describeBlock({ type: 'heading', text: 'Hi' })).toBe('Heading: Hi');
    expect(describeBlock({ type: 'divider' })).toBe('Divider');
  });

  it('moves a block up and down, and refuses to move past either end', () => {
    const blocks = [{ type: 'heading' as const, text: 'A' }, { type: 'paragraph' as const, text: 'B' }];
    expect(moveBlock(blocks, 1, -1)[0].text).toBe('B');
    expect(moveBlock(blocks, 0, -1)).toEqual(blocks);
    expect(moveBlock(blocks, 1, 1)).toEqual(blocks);
    expect(moveBlock(blocks, 5, 1)).toEqual(blocks);
  });

  it('escaping handles all five characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
