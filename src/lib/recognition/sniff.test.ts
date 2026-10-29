import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  classifyOfficeArchive,
  classifyOle2,
  extensionOf,
  isOle2,
  kindFromExtension,
  looksLikeCsv,
  looksLikeText,
  recognise,
  sniffKind,
  sniffKindDeep,
} from './sniff';

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);

describe('magic-byte sniffing (S17)', () => {
  it('reads a PDF, PNG, GIF, JPEG and TIFF from their signatures', () => {
    expect(sniffKind(ascii('%PDF-1.7\n'))).toBe('pdf');
    expect(sniffKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe('png');
    expect(sniffKind(ascii('GIF89a'))).toBe('gif');
    expect(sniffKind(ascii('GIF87a'))).toBe('gif');
    expect(sniffKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniffKind(bytes(0x49, 0x49, 0x2a, 0x00))).toBe('tiff');
  });

  it('reads a ZIP, RAR, 7z and gzip from their signatures', () => {
    expect(sniffKind(bytes(0x50, 0x4b, 0x03, 0x04, 0, 0))).toBe('zip');
    expect(sniffKind(ascii('Rar!\x1a\x07\x00'))).toBe('rar');
    expect(sniffKind(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c))).toBe('7z');
    expect(sniffKind(bytes(0x1f, 0x8b, 0x08))).toBe('gzip');
  });

  it('reads the OLE2 compound container and resolves its sub-kind from stream names', () => {
    const ole2 = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0);
    expect(isOle2(ole2)).toBe(true);
    expect(sniffKind(ole2)).toBe('doc');
    expect(classifyOle2(['WordDocument', '1Table'])).toBe('doc');
    expect(classifyOle2(['Workbook'])).toBe('xls');
    expect(classifyOle2(['PowerPoint Document'])).toBe('ppt');
    expect(classifyOle2(['Something Else'])).toBe('unknown');
  });

  it('treats an unknown prefix as unknown, never as text just because it is short', () => {
    expect(sniffKind(bytes(0x00, 0x01, 0x02, 0x03))).toBe('unknown');
  });

  it('calls printable bytes text, and a NUL-bearing prefix not text', () => {
    expect(looksLikeText(ascii('name,amount\nTreasury,100\n'))).toBe(true);
    expect(looksLikeText(bytes(0x41, 0x42, 0x00, 0x43))).toBe(false);
    expect(looksLikeText(new Uint8Array(0))).toBe(false);
  });

  it('claims CSV only when a delimiter is actually present', () => {
    expect(looksLikeCsv(ascii('a,b,c\n1,2,3\n'))).toBe(true);
    expect(looksLikeCsv(ascii('a\tb\n1\t2\n'))).toBe(true);
    expect(looksLikeCsv(ascii('a;b\n1;2\n'))).toBe(true);
    expect(looksLikeCsv(ascii('just a sentence with no delimiter'))).toBe(false);
  });
});

describe('OOXML classification by entry name (S17)', () => {
  it('distinguishes docx, xlsx and pptx by their parts', () => {
    expect(classifyOfficeArchive(['[Content_Types].xml', 'word/document.xml'])).toBe('docx');
    expect(classifyOfficeArchive(['[Content_Types].xml', 'xl/workbook.xml'])).toBe('xlsx');
    expect(classifyOfficeArchive(['[Content_Types].xml', 'ppt/presentation.xml'])).toBe('pptx');
  });

  it('calls a ZIP with no office part a plain archive', () => {
    expect(classifyOfficeArchive(['a.txt', 'b/c.bin'])).toBe('zip');
  });

  it('is not fooled by a leading slash on an entry name', () => {
    expect(classifyOfficeArchive(['/word/document.xml'])).toBe('docx');
  });
});

describe('extension mapping and the honest agreement verdict (S17)', () => {
  it('maps the extensions the importer knows', () => {
    expect(kindFromExtension('a.DOCX')).toBe('docx');
    expect(kindFromExtension('a.xlsm')).toBe('xlsx');
    expect(kindFromExtension('a.csv')).toBe('csv');
    expect(kindFromExtension('a.jpeg')).toBe('jpeg');
    expect(kindFromExtension('a.rar')).toBe('rar');
    expect(kindFromExtension('noextension')).toBe('unknown');
  });

  it('extracts the extension with its dot, lower-cased', () => {
    expect(extensionOf('Report.PDF')).toBe('.pdf');
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
    expect(extensionOf('bare')).toBe('');
  });

  it('reports a PDF named .csv as a disagreement, not a CSV', () => {
    const r = recognise('population.csv', ascii('%PDF-1.7\n'));
    expect(r.kind).toBe('pdf');
    expect(r.claimed).toBe('csv');
    expect(r.agrees).toBe(false);
    expect(r.detail).toMatch(/name says csv but the bytes are pdf/i);
  });

  it('accepts text for a CSV claim, and a CSV for a text claim', () => {
    expect(recognise('notes.txt', ascii('hello world\n')).agrees).toBe(true);
    expect(recognise('notes.txt', ascii('a,b\n1,2\n')).agrees).toBe(true);
  });

  it('never disagrees when the extension said nothing', () => {
    expect(recognise('noextension', ascii('%PDF-1.7\n')).agrees).toBe(true);
  });

  it('resolves a ZIP named .docx to the real office kind, and agrees', () => {
    const kind = sniffKindDeep(bytes(0x50, 0x4b, 0x03, 0x04), { zipEntries: ['word/document.xml'] });
    expect(kind).toBe('docx');
  });
});

describe('a real OOXML archive, sniffed (S17)', () => {
  it('classifies a generated .docx by its entries, not its name', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('word/document.xml', '<w:document/>');
    const bytesOut = await zip.generateAsync({ type: 'uint8array' });
    expect(sniffKind(bytesOut)).toBe('zip');
    expect(sniffKindDeep(bytesOut, { zipEntries: Object.keys((await JSZip.loadAsync(bytesOut)).files) })).toBe('docx');
  });
});
