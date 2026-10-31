import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildInventory, inspectFile, type Sha256 } from './index';

const ascii = (s: string) => new TextEncoder().encode(s);

/** A tiny deterministic hasher for tests: the byte length and first byte, so distinct files differ. */
const sha256: Sha256 = async (b) => `h:${b.length}:${b[0] ?? 0}`;

async function docxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', '<w:document/>');
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0"?><cp:coreProperties><dc:title>Q1 Plan</dc:title><dc:creator>Ayesha</dc:creator></cp:coreProperties>`
  );
  zip.file('docProps/app.xml', `<Properties><Application>Microsoft Word</Application></Properties>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function plainZipBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('readme.txt', 'hello');
  zip.file('data/rows.csv', 'a,b\n1,2\n');
  return zip.generateAsync({ type: 'uint8array' });
}

describe('inventory from real bytes (S17)', () => {
  it('classifies a .docx by its entries and reads its metadata', async () => {
    const item = await inspectFile('plan.docx', await docxBytes(), sha256);
    expect(item.kind).toBe('docx');
    expect(item.recognition.agrees).toBe(true);
    expect(item.metadata.title).toBe('Q1 Plan');
    expect(item.metadata.author).toBe('Ayesha');
    expect(item.metadata.application).toBe('Microsoft Word');
    expect(item.archive?.entries.map((e) => e.path)).toContain('word/document.xml');
  });

  it('recognises an office document renamed to .zip, and says the name disagreed', async () => {
    const item = await inspectFile('mislabelled.zip', await docxBytes(), sha256);
    expect(item.kind).toBe('docx');
    expect(item.recognition.agrees).toBe(false);
    expect(item.note).toMatch(/bytes are docx/i);
  });

  it('lists a genuine archive as an inventory, not a refusal', async () => {
    const item = await inspectFile('bundle.zip', await plainZipBytes(), sha256);
    expect(item.kind).toBe('zip');
    expect(item.archive?.entries.map((e) => e.path).sort()).toEqual(['data/rows.csv', 'readme.txt']);
    expect(item.note).toBeUndefined();
  });

  it('reads PDF /Info metadata', async () => {
    const pdf = ascii('%PDF-1.7\n<< /Info << /Title (Evidence) /Author (Bilal) >> >>');
    const item = await inspectFile('evidence.pdf', pdf, sha256);
    expect(item.kind).toBe('pdf');
    expect(item.metadata.title).toBe('Evidence');
    expect(item.metadata.author).toBe('Bilal');
  });

  it('reports a RAR as recognised-but-not-unpackable, without reflex-installing a library', async () => {
    const rar = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0, 0, 0]);
    const item = await inspectFile('evidence.rar', rar, sha256);
    expect(item.kind).toBe('rar');
    expect(item.recognition.agrees).toBe(true);
    expect(item.note).toMatch(/licence-restricted/);
  });

  it('reports a file it cannot recognise AS unrecognised', async () => {
    const item = await inspectFile('mystery.bin', new Uint8Array([0x00, 0x01, 0x02, 0x03]), sha256);
    expect(item.kind).toBe('unknown');
  });

  it('builds an inventory with honest counts', async () => {
    const inv = await buildInventory(
      [
        { filename: 'plan.docx', bytes: await docxBytes() },
        { filename: 'mystery.bin', bytes: new Uint8Array([0, 1, 2, 3]) },
        { filename: 'bundle.zip', bytes: await plainZipBytes() },
        { filename: 'legacy.rar', bytes: new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) },
      ],
      sha256
    );
    expect(inv.items.map((i) => i.kind)).toEqual(['docx', 'unknown', 'zip', 'rar']);
    expect(inv.importable).toBe(1); // the docx
    expect(inv.unrecognised).toBe(1); // the mystery.bin
    expect(inv.refused).toBe(0);
  });

  it('counts a refused archive and states the reason', async () => {
    // A member that declares a size far over the per-member limit is refused before inflation.
    const zip = new JSZip();
    zip.file('huge.bin', new Uint8Array(200));
    const item = await inspectFile('bomb.zip', await zip.generateAsync({ type: 'uint8array' }), sha256, {
      maxEntries: 10,
      maxEntryBytes: 100,
      maxTotalBytes: 1000,
      maxCompressionRatio: 1000,
      maxDepth: 1,
    });
    expect(item.note).toMatch(/^Refused:/);
  });
});
