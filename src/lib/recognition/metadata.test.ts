import { describe, expect, it } from 'vitest';
import { firstTagText, mergeMetadata, parseAppXml, parseCoreXml, parsePdfInfo } from './metadata';

describe('OOXML metadata (S17)', () => {
  it('reads title, creator and the two timestamps from core.xml', () => {
    const xml = `<?xml version="1.0"?>
      <cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z">
        <dc:title>FY26 Audit Plan</dc:title>
        <dc:creator>Ayesha Khan</dc:creator>
        <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-05T09:00:00Z</dcterms:created>
        <dcterms:modified xsi:type="dcterms:W3CDTF">2026-02-01T12:30:00Z</dcterms:modified>
      </cp:coreProperties>`;
    const m = parseCoreXml(xml);
    expect(m.title).toBe('FY26 Audit Plan');
    expect(m.author).toBe('Ayesha Khan');
    expect(m.created).toBe('2026-01-05T09:00:00Z');
    expect(m.modified).toBe('2026-02-01T12:30:00Z');
  });

  it('falls back to lastModifiedBy when there is no creator', () => {
    const xml = `<cp:coreProperties><cp:lastModifiedBy>Bilal</cp:lastModifiedBy></cp:coreProperties>`;
    expect(parseCoreXml(xml).author).toBe('Bilal');
  });

  it('reads the application and company from app.xml', () => {
    const xml = `<Properties><Application>Microsoft Office Word</Application><Company>Provio Ltd</Company></Properties>`;
    const m = parseAppXml(xml);
    expect(m.application).toBe('Microsoft Office Word');
    expect(m.company).toBe('Provio Ltd');
  });

  it('decodes the five predefined XML entities, and only those', () => {
    expect(firstTagText('<t>a &amp; b &lt;c&gt;</t>', 't')).toBe('a & b <c>');
    expect(firstTagText('<t>&#65;</t>', 't')).toBe('&#65;'); // numeric entities are NOT expanded
  });

  it('returns undefined for a missing tag rather than an empty string', () => {
    expect(firstTagText('<a/>', 'missing')).toBeUndefined();
    expect(firstTagText('<t>   </t>', 't')).toBeUndefined();
  });

  it('merges metadata, later parts filling only the gaps', () => {
    const m = mergeMetadata({ title: 'A', author: 'X' }, { title: 'B', company: 'C' });
    expect(m.title).toBe('A');
    expect(m.author).toBe('X');
    expect(m.company).toBe('C');
  });
});

describe('PDF /Info metadata (S17)', () => {
  const latin1 = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));

  it('reads literal-string Title and Author, and normalises the PDF date', () => {
    const pdf = latin1(`%PDF-1.7\n1 0 obj\n<< /Info 2 0 R >>\nendobj\n2 0 obj\n<< /Title (Report 14) /Author (Ayesha) /CreationDate (D:20260105143000Z) >>\nendobj`);
    const m = parsePdfInfo(pdf);
    expect(m.title).toBe('Report 14');
    expect(m.author).toBe('Ayesha');
    expect(m.created).toBe('2026-01-05T14:30:00Z');
  });

  it('decodes a hex-string field', () => {
    // "Hi" in hex.
    const pdf = latin1(`%PDF-1.7\n<< /Info << /Title <4869> >> >>`);
    expect(parsePdfInfo(pdf).title).toBe('Hi');
  });

  it('returns undefined for a field the PDF does not carry', () => {
    const pdf = latin1(`%PDF-1.7\n<< /Info << /Title (Only) >> >>`);
    const m = parsePdfInfo(pdf);
    expect(m.title).toBe('Only');
    expect(m.author).toBeUndefined();
    expect(m.created).toBeUndefined();
  });

  it('handles an escaped parenthesis in a literal string', () => {
    const pdf = latin1(`%PDF-1.7\n<< /Info << /Title (Audit \\(FY26\\)) >> >>`);
    expect(parsePdfInfo(pdf).title).toBe('Audit (FY26)');
  });
});
