import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  getBranding, saveBranding, savePptxTheme, uploadBrandingAsset, type BrandingFields,
} from '../../data/branding';
import { brandingFromRow, DEFAULT_BRANDING, fillTemplate, resolveHexColour, toCssColour, type BrandingSpec } from '../../lib/render/branding';
import { extractPptxTheme } from '../../lib/render/pptx';
import {
  detectTheme, fontFamilyNames, fontByFamily, licenceSummary, loadFont,
  proposeTheme, type DetectedTheme, type ThemeProposal,
} from '../../lib/fonts';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Check, Settings, Upload } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/** The bundled fonts a tenant may pick without uploading (F2, F3). Derived from the repository. */
const BUNDLED_FONTS: readonly string[] = fontFamilyNames();
const COLOUR_SLOTS: { key: keyof BrandingFields; label: string; testid: string }[] = [
  { key: 'colourPrimary', label: 'Primary', testid: 'oa-branding-colour-primary' },
  { key: 'colourAccent', label: 'Accent', testid: 'oa-branding-colour-accent' },
  { key: 'colourText', label: 'Text', testid: 'oa-branding-colour-text' },
  { key: 'colourBackground', label: 'Background', testid: 'oa-branding-colour-background' },
];

/**
 * OA-02 organisation profile and OA-03 branding and report format (F9).
 *
 * A full-page, non-blocking Org Admin surface (no modal). Every control is gated by
 * hasRight(edit_config); the database re-checks the right. The live preview runs through the real
 * BrandingSpec, so what the admin sees is what the renderers produce. No screen accepts JSON: the
 * .pptx theme is extracted in the browser and only the extracted facts are sent.
 */
export const OrgBrandingPanel: React.FC = () => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');
  const orgId = currentUser.orgId ?? '';
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [spec, setSpec] = useState<BrandingSpec>({ orgId, ...DEFAULT_BRANDING });
  const [draft, setDraft] = useState<BrandingFields>({});
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [themeNote, setThemeNote] = useState('');
  /** The theme detected from an uploaded template (F5), and the proposal derived from it (F6). */
  const [detected, setDetected] = useState<DetectedTheme | null>(null);
  const [proposal, setProposal] = useState<ThemeProposal | null>(null);
  /** F4: the licence acknowledgement a font upload requires before it is accepted. */
  const [fontLicenceAck, setFontLicenceAck] = useState(false);
  const [fontNote, setFontNote] = useState('');

  const load = useCallback(async () => {
    if (!orgId) { setState('ready'); return; }
    setState('loading');
    setLoadError('');
    try {
      setSpec(await getBranding(orgId));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the branding.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  /** The preview spec is the saved spec overlaid with unsaved edits, so the admin sees changes live. */
  const preview = useMemo<BrandingSpec>(() => brandingFromRow({
    org_id: orgId,
    font_heading: draft.fontHeading ?? spec.fontHeading,
    font_body: draft.fontBody ?? spec.fontBody,
    colour_primary: draft.colourPrimary ?? spec.colourPrimary,
    colour_accent: draft.colourAccent ?? spec.colourAccent,
    colour_text: draft.colourText ?? spec.colourText,
    colour_background: draft.colourBackground ?? spec.colourBackground,
    page_size: draft.pageSize ?? spec.pageSize,
    margin_top_mm: draft.marginTopMm ?? spec.marginTopMm,
    margin_right_mm: draft.marginRightMm ?? spec.marginRightMm,
    margin_bottom_mm: draft.marginBottomMm ?? spec.marginBottomMm,
    margin_left_mm: draft.marginLeftMm ?? spec.marginLeftMm,
    header_text: draft.headerText ?? spec.headerText,
    footer_text: draft.footerText ?? spec.footerText,
    cover_style: draft.coverStyle ?? spec.coverStyle,
    report_format: draft.reportFormat ?? spec.reportFormat,
    pptx_theme: spec.pptxTheme,
  }), [draft, spec, orgId]);

  const save = async () => {
    setBusy(true);
    setResult(null);
    const r = await saveBranding(orgId, draft);
    setBusy(false);
    setResult(r);
    if (r.ok) { setDraft({}); await load(); }
  };

  const onThemeFile = async (file: File) => {
    setThemeNote('');
    setResult(null);
    setDetected(null);
    setProposal(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const theme = await extractPptxTheme(bytes);
      const r = await savePptxTheme(orgId, theme as unknown as Record<string, unknown>);
      if (!r.ok) { setResult(r); return; }
      setThemeNote(`We match your colours, fonts and logos; we do not reuse your slide layouts. Found ${theme.colours.length} colours.`);
      // F5: read the fonts, colours and page setup out of the file itself, and offer to adopt them.
      const isPptx = /\.(pptx|potx)$/i.test(file.name);
      const det = await detectTheme(bytes, isPptx ? 'pptx' : 'docx');
      setDetected(det);
      setProposal(proposeTheme(det));
      await load();
    } catch (err) {
      setResult({ ok: false, reason: err instanceof Error ? err.message : 'Could not read that file.' });
    }
  };

  /** F6: adopt a detected theme's fonts and colours onto the org format draft (then save). */
  const adoptProposal = () => {
    if (!proposal) return;
    const patch: BrandingFields = {};
    if (proposal.fontHeading) patch.fontHeading = proposal.fontHeading;
    if (proposal.fontBody) patch.fontBody = proposal.fontBody;
    if (proposal.colourPrimary) patch.colourPrimary = proposal.colourPrimary;
    if (proposal.colourAccent) patch.colourAccent = proposal.colourAccent;
    if (proposal.colourText) patch.colourText = proposal.colourText;
    if (proposal.colourBackground) patch.colourBackground = proposal.colourBackground;
    set({ ...patch });
  };

  /** F4: upload a house font. Refused until the licence is acknowledged. */
  const onFontFile = async (file: File) => {
    setResult(null);
    setFontNote('');
    if (!fontLicenceAck) {
      setResult({ ok: false, reason: 'Acknowledge the font licence before uploading it.' });
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const b of buf) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    const r = await uploadBrandingAsset(orgId, 'font', file.name, file.type || 'font/woff2', base64);
    setResult(r.ok ? { ok: true } : r);
    if (r.ok) setFontNote(`Stored ${file.name}. It is yours and is recorded against your licence acknowledgement.`);
  };

  const onLogoFile = async (file: File, kind: 'logo_light' | 'logo_dark') => {
    setResult(null);
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const b of buf) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    const r = await uploadBrandingAsset(orgId, kind, file.name, file.type || 'application/octet-stream', base64);
    setResult(r.ok ? { ok: true } : r);
    if (r.ok) { setDraft((d) => ({ ...d, [kind === 'logo_light' ? 'logoLightAssetId' : 'logoDarkAssetId']: r.id })); }
  };

  const set = (patch: BrandingFields) => setDraft((d) => ({ ...d, ...patch }));

  // F2: lazy-load a chosen family so it renders without shipping every font up front. The chrome
  // families are already loaded; a picked family is fetched on demand.
  useEffect(() => {
    void loadFont(preview.fontHeading).catch(() => false);
    void loadFont(preview.fontBody).catch(() => false);
  }, [preview.fontHeading, preview.fontBody]);

  const headingLicence = fontByFamily(preview.fontHeading);
  const bodyLicence = fontByFamily(preview.fontBody);

  if (state === 'loading') {
    return <div className="p-6 text-sm text-muted" data-testid="oa-branding-loading">Loading branding…</div>;
  }
  if (state === 'error') {
    return <div className="p-6"><InlineError message={loadError} /></div>;
  }

  const cssVars: React.CSSProperties = {
    ['--preview-primary' as string]: toCssColour(preview.colourPrimary),
    ['--preview-accent' as string]: toCssColour(preview.colourAccent),
    ['--preview-text' as string]: toCssColour(preview.colourText),
    ['--preview-bg' as string]: toCssColour(preview.colourBackground),
  };

  return (
    <div className="p-6 space-y-6" data-testid="oa-branding">
      <header className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-muted" />
        <h1 className="text-lg font-semibold" data-testid="oa-branding-title">Branding and report format</h1>
      </header>

      {!canEdit && (
        <p className="text-sm text-muted" data-testid="oa-branding-readonly">
          You can view the branding but you do not have the right to change it.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-4" data-testid="oa-branding-form">
          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="oa-branding-font-heading">Heading font</label>
            <div data-testid="oa-branding-font-heading">
              {canEdit ? (
                <Select ariaLabel="Heading font" value={preview.fontHeading}
                  options={BUNDLED_FONTS.map((f) => ({ value: f, label: f }))}
                  onChange={(v) => set({ fontHeading: v })} />
              ) : <span className="text-sm">{preview.fontHeading}</span>}
            </div>
            <p className="text-xs text-muted mt-1" data-testid="oa-branding-font-heading-licence">
              {headingLicence ? licenceSummary(headingLicence) : 'Only upload fonts you are licensed to embed.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="oa-branding-font-body">Body font</label>
            <div data-testid="oa-branding-font-body">
              {canEdit ? (
                <Select ariaLabel="Body font" value={preview.fontBody}
                  options={BUNDLED_FONTS.map((f) => ({ value: f, label: f }))}
                  onChange={(v) => set({ fontBody: v })} />
              ) : <span className="text-sm">{preview.fontBody}</span>}
            </div>
            {bodyLicence && (
              <p className="text-xs text-muted mt-1" data-testid="oa-branding-font-body-licence">
                {licenceSummary(bodyLicence)}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Brand colours</legend>
            {COLOUR_SLOTS.map((slot) => (
              <div key={slot.key as string} className="flex items-center gap-2">
                <span className="w-28 text-xs text-muted">{slot.label}</span>
                <input
                  type="color"
                  data-testid={slot.testid}
                  className="h-7 w-10 rounded border border-border"
                  value={resolveHexColour(preview[slot.key as keyof BrandingSpec] as string)}
                  disabled={!canEdit}
                  onChange={(e) => set({ [slot.key]: e.target.value } as BrandingFields)}
                />
                <span className="text-xs text-muted">{String(preview[slot.key as keyof BrandingSpec])}</span>
              </div>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" htmlFor="oa-branding-page-size">Page size</label>
              <div data-testid="oa-branding-page-size">
                {canEdit ? (
                  <Select ariaLabel="Page size" value={preview.pageSize}
                    options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]}
                    onChange={(v) => set({ pageSize: v as 'A4' | 'Letter' })} />
                ) : <span className="text-sm">{preview.pageSize}</span>}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" htmlFor="oa-branding-cover-style">Cover style</label>
              <div data-testid="oa-branding-cover-style">
                {canEdit ? (
                  <Select ariaLabel="Cover style" value={preview.coverStyle}
                    options={[
                      { value: 'standard', label: 'Standard' },
                      { value: 'minimal', label: 'Minimal' },
                      { value: 'bold', label: 'Bold' },
                    ]}
                    onChange={(v) => set({ coverStyle: v as BrandingSpec['coverStyle'] })} />
                ) : <span className="text-sm">{preview.coverStyle}</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {(['marginTopMm', 'marginRightMm', 'marginBottomMm', 'marginLeftMm'] as const).map((k, i) => (
              <div key={k}>
                <label className="block text-xs font-medium mb-1" htmlFor={`oa-branding-margin-${i}`}>
                  {['Top', 'Right', 'Bottom', 'Left'][i]} (mm)
                </label>
                <input id={`oa-branding-margin-${i}`} data-testid={`oa-branding-margin-${i}`} type="number"
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  value={preview[k]} disabled={!canEdit}
                  onChange={(e) => set({ [k]: Number(e.target.value) } as BrandingFields)} />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="oa-branding-header">Header text</label>
            <input id="oa-branding-header" data-testid="oa-branding-header"
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              value={preview.headerText} disabled={!canEdit}
              onChange={(e) => set({ headerText: e.target.value })} placeholder="{org} — {engagement}" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" htmlFor="oa-branding-footer">Footer text</label>
            <input id="oa-branding-footer" data-testid="oa-branding-footer"
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              value={preview.footerText} disabled={!canEdit}
              onChange={(e) => set({ footerText: e.target.value })} placeholder="Page {page} of {pages}" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="oa-branding-logo-light" disabled={!canEdit}
              className="px-3 py-1.5 rounded border border-border text-sm"
              onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 inline mr-1" /> Upload light logo
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/svg+xml" className="hidden"
              data-testid="oa-branding-logo-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onLogoFile(f, 'logo_light'); }} />
            <button type="button" data-testid="oa-branding-theme-upload" disabled={!canEdit}
              className="px-3 py-1.5 rounded border border-border text-sm"
              onClick={() => {
                const el = document.createElement('input');
                el.type = 'file';
                el.accept = '.pptx,.potx,.docx';
                el.onchange = () => { const f = el.files?.[0]; if (f) void onThemeFile(f); };
                el.click();
              }}>
              Upload a template (.docx/.pptx)
            </button>
            <button type="button" data-testid="oa-branding-font-upload" disabled={!canEdit}
              className="px-3 py-1.5 rounded border border-border text-sm"
              onClick={() => {
                const el = document.createElement('input');
                el.type = 'file';
                el.accept = '.woff2,.woff,.ttf,.otf';
                el.onchange = () => { const f = el.files?.[0]; if (f) void onFontFile(f); };
                el.click();
              }}>
              <Upload className="w-4 h-4 inline mr-1" /> Upload a house font
            </button>
          </div>
          {themeNote && <p className="text-xs text-muted" data-testid="oa-branding-theme-note">{themeNote}</p>}

          {/* F4: a font upload requires a licence acknowledgement, recorded with the asset. */}
          <label className="flex items-start gap-2 text-xs text-muted" data-testid="oa-branding-font-licence-label">
            <input type="checkbox" data-testid="oa-branding-font-licence-ack"
              checked={fontLicenceAck} disabled={!canEdit}
              onChange={(e) => setFontLicenceAck(e.target.checked)} />
            <span>I confirm we are licensed to embed and redistribute this font in our reports.</span>
          </label>
          {fontNote && <p className="text-xs text-muted" data-testid="oa-branding-font-note">{fontNote}</p>}

          {/* F5/F6: what we read from the uploaded template, and the offer to adopt it. */}
          {detected && proposal && (
            <div className="rounded border border-border p-3 space-y-2" data-testid="oa-branding-detected">
              <p className="text-xs font-medium text-primary" data-testid="oa-branding-detected-note">{detected.note}</p>
              <ul className="text-xs text-muted space-y-0.5">
                <li data-testid="oa-branding-detected-heading">Heading font: {detected.headingFont ?? 'not set'}</li>
                <li data-testid="oa-branding-detected-body">Body font: {detected.bodyFont ?? 'not set'}</li>
                <li data-testid="oa-branding-detected-colours">Colours: {detected.colours.join(', ') || 'none'}</li>
                {proposal.fontsToUpload.length > 0 && (
                  <li className="text-cinnabar" data-testid="oa-branding-detected-toupload">
                    Not in the repository, upload to use: {proposal.fontsToUpload.join(', ')}
                  </li>
                )}
              </ul>
              {canEdit && proposal.adoptable && (
                <button type="button" data-testid="oa-branding-adopt"
                  className="px-3 py-1.5 rounded border border-border text-sm"
                  onClick={adoptProposal}>
                  Adopt detected fonts and colours
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            {canEdit && (
              <button type="button" data-testid="oa-branding-save" disabled={busy}
                className="px-3 py-1.5 rounded bg-accent text-accent-foreground text-sm disabled:opacity-50"
                onClick={() => void save()}>
                <Check className="w-4 h-4 inline mr-1" /> Save branding
              </button>
            )}
            {result && !result.ok && <span className="text-xs text-danger" data-testid="oa-branding-error">{result.reason}</span>}
            {result && result.ok && <span className="text-xs text-muted" data-testid="oa-branding-saved">Saved.</span>}
          </div>
        </section>

        <section data-testid="oa-branding-preview" style={cssVars}
          className="rounded border border-border p-6"
          // The preview background and text come from the org's own colours (data), applied as CSS
          // variables above; no literal colour is written in this component.
          >
          <div style={{ background: 'var(--preview-bg)', color: 'var(--preview-text)' }} className="p-4 rounded">
            <div className="text-xs" data-testid="oa-branding-preview-header">
              {fillTemplate(preview.headerText || '{org}', { org: 'Your organisation', engagement: 'Sample engagement' })}
            </div>
            <h2 className="mt-3 text-xl font-semibold" style={{ color: 'var(--preview-primary)' }}>Assurance report</h2>
            <div className="mt-1 h-1 w-16" style={{ background: 'var(--preview-accent)' }} />
            <p className="mt-3 text-sm">This is how the issued report, the Board Pack and the certificate will look.</p>
            <div className="mt-4 text-xs" data-testid="oa-branding-preview-footer">
              {fillTemplate(preview.footerText || 'Page {page} of {pages}', { page: 1, pages: 3 })}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted" data-testid="oa-branding-preview-note">
            Page size {preview.pageSize}, margins {preview.marginTopMm}/{preview.marginRightMm}/{preview.marginBottomMm}/{preview.marginLeftMm} mm.
          </p>
        </section>
      </div>
    </div>
  );
};

/** A colour input needs a #rrggbb value; the resolution (and its neutral fallback) lives in the lib. */
