import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectTheme, proposeTheme, resolveBundledFont } from './detect';

/** Build an in-memory OOXML zip from a map of part name → text. Deterministic test fixture. */
async function makeZip(parts: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(parts)) zip.file(name, text);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

const PPTX_THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="x"><a:themeElements>
<a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="14161B"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="F6F5F2"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2>
<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="2F6F5E"/></a:accent1>
<a:accent2><a:srgbClr val="C2410C"/></a:accent2>
<a:accent3><a:srgbClr val="C9A227"/></a:accent3>
</a:clrScheme>
<a:fontScheme name="Office">
<a:majorFont><a:latin typeface="Source Serif 4"/></a:majorFont>
<a:minorFont><a:latin typeface="Inter"/></a:minorFont>
</a:fontScheme></a:themeElements></a:theme>`;

const PPTX_PRES = `<p:presentation xmlns:p="x"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`;

const DOCX_THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="x"><a:themeElements>
<a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="14161B"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:accent1><a:srgbClr val="1F4E79"/></a:accent1>
<a:accent2><a:srgbClr val="C00000"/></a:accent2>
</a:clrScheme>
<a:fontScheme name="Office">
<a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
</a:fontScheme></a:themeElements></a:theme>`;

const DOCX_STYLES = `<w:styles xmlns:w="x"><w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;

describe('theme auto-detection from DOCX and PPTX (F5)', () => {
  it('reads the PPTX colour scheme, fonts and slide size', async () => {
    const bytes = await makeZip({ 'ppt/theme/theme1.xml': PPTX_THEME, 'ppt/presentation.xml': PPTX_PRES });
    const theme = await detectTheme(bytes, 'pptx');
    expect(theme.source).toBe('pptx');
    expect(theme.headingFont).toBe('Source Serif 4');
    expect(theme.bodyFont).toBe('Inter');
    expect(theme.colours).toContain('#2F6F5E');
    expect(theme.colours).toContain('#C2410C');
    expect(theme.slideWidthEmu).toBe(12192000);
    expect(theme.slideHeightEmu).toBe(6858000);
    expect(theme.note).toMatch(/Read \d+ theme colour/);
  });

  it('resolves the DOCX theme colours and fonts', async () => {
    const bytes = await makeZip({ 'word/theme/theme1.xml': DOCX_THEME });
    const theme = await detectTheme(bytes, 'docx');
    expect(theme.source).toBe('docx');
    expect(theme.bodyFont).toBe('Calibri');
    expect(theme.colours).toContain('#1F4E79');
  });

  it('falls back to the DOCX styles docDefaults when the theme sets no font', async () => {
    const noFontTheme = DOCX_THEME.replace(/<a:fontScheme[\s\S]*?<\/a:fontScheme>/, '');
    const bytes = await makeZip({ 'word/theme/theme1.xml': noFontTheme, 'word/styles.xml': DOCX_STYLES });
    const theme = await detectTheme(bytes, 'docx');
    expect(theme.bodyFont).toBe('Aptos');
  });

  it('reports honestly when nothing could be read', async () => {
    const bytes = await makeZip({ 'word/document.xml': '<w:document xmlns:w="x"/>' });
    const theme = await detectTheme(bytes, 'docx');
    expect(theme.colours).toEqual([]);
    expect(theme.bodyFont).toBeNull();
    expect(theme.note).toMatch(/No theme colours or fonts could be read/);
  });

  it('lists the media parts the archive carries', async () => {
    const bytes = await makeZip({ 'ppt/theme/theme1.xml': PPTX_THEME, 'ppt/media/logo.png': 'x' });
    const theme = await detectTheme(bytes, 'pptx');
    expect(theme.mediaParts).toEqual(['ppt/media/logo.png']);
  });
});

describe('resolving a detected font to a bundled family (F5)', () => {
  it('matches an exact family name', () => {
    expect(resolveBundledFont('Inter')).toBe('Inter');
    expect(resolveBundledFont('Source Serif 4')).toBe('Source Serif 4');
  });

  it('matches a variant suffix and a parenthesised alias', () => {
    expect(resolveBundledFont('Inter Light')).toBe('Inter');
    expect(resolveBundledFont('Calibri (Body)')).toBeNull();
    expect(resolveBundledFont('Roboto Slab Bold')).toBe('Roboto Slab');
  });

  it('returns null for a family the repository does not bundle', () => {
    expect(resolveBundledFont('Calibri')).toBeNull();
    expect(resolveBundledFont('Comic Sans MS')).toBeNull();
    expect(resolveBundledFont(null)).toBeNull();
  });
});

describe('the theme proposal (F6)', () => {
  it('maps the detected scheme onto the org format fields', async () => {
    const bytes = await makeZip({ 'ppt/theme/theme1.xml': PPTX_THEME, 'ppt/presentation.xml': PPTX_PRES });
    const proposal = proposeTheme(await detectTheme(bytes, 'pptx'));
    expect(proposal.fontHeading).toBe('Source Serif 4');
    expect(proposal.fontBody).toBe('Inter');
    expect(proposal.colourPrimary).toBe('#2F6F5E');
    expect(proposal.colourAccent).toBe('#C2410C');
    expect(proposal.colourBackground).toBe('#F6F5F2');
    expect(proposal.colourText).toBe('#14161B');
    expect(proposal.fontsBundled).toEqual(['Source Serif 4', 'Inter']);
    expect(proposal.fontsToUpload).toEqual([]);
    expect(proposal.adoptable).toBe(true);
  });

  it('flags a detected font that is not in the repository for upload', async () => {
    const bytes = await makeZip({ 'word/theme/theme1.xml': DOCX_THEME });
    const proposal = proposeTheme(await detectTheme(bytes, 'docx'));
    expect(proposal.fontsBundled).toEqual([]);
    expect(proposal.fontsToUpload).toEqual(['Calibri Light', 'Calibri']);
    expect(proposal.adoptable).toBe(true);
  });

  it('is not adoptable when nothing was detected', async () => {
    const bytes = await makeZip({ 'word/document.xml': '<w:document xmlns:w="x"/>' });
    const proposal = proposeTheme(await detectTheme(bytes, 'docx'));
    expect(proposal.adoptable).toBe(false);
  });
});
