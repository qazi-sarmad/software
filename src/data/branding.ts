/**
 * Branding and report format (F9). Every call goes through a typed function here; components never
 * import the database client. The renderers consume the BrandingSpec this module returns.
 */
import { callRpc, getClient } from './db';
import { brandingFromRow, DEFAULT_BRANDING, type BrandingSpec } from '../lib/render/branding';

export interface BrandingAsset {
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  byteSize: number;
}

export interface BrandingFields {
  fontHeading?: string;
  fontBody?: string;
  colourPrimary?: string;
  colourAccent?: string;
  colourText?: string;
  colourBackground?: string;
  logoLightAssetId?: string | null;
  logoDarkAssetId?: string | null;
  pageSize?: 'A4' | 'Letter';
  marginTopMm?: number;
  marginRightMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  headerText?: string;
  footerText?: string;
  coverStyle?: 'standard' | 'minimal' | 'bold';
  reportFormat?: string;
}

/** Read the org's branding spec, or the defaults when nothing is set. Never throws on empty. */
export async function getBranding(orgId: string | null): Promise<BrandingSpec> {
  const sb = getClient();
  if (!sb || !orgId) return { orgId: orgId ?? '', ...DEFAULT_BRANDING };
  const { data, error } = await sb.rpc('get_branding', { p_org: orgId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { orgId, ...DEFAULT_BRANDING };
  return brandingFromRow(row as Record<string, unknown>);
}

/** Write branding fields (F9). Requires edit_config (or an active consultation session). */
export async function saveBranding(orgId: string, fields: BrandingFields): Promise<{ ok: true } | { ok: false; reason: string }> {
  const payload: Record<string, unknown> = {};
  const map: Record<string, string> = {
    fontHeading: 'font_heading', fontBody: 'font_body',
    colourPrimary: 'colour_primary', colourAccent: 'colour_accent',
    colourText: 'colour_text', colourBackground: 'colour_background',
    logoLightAssetId: 'logo_light_asset_id', logoDarkAssetId: 'logo_dark_asset_id',
    pageSize: 'page_size',
    marginTopMm: 'margin_top_mm', marginRightMm: 'margin_right_mm',
    marginBottomMm: 'margin_bottom_mm', marginLeftMm: 'margin_left_mm',
    headerText: 'header_text', footerText: 'footer_text',
    coverStyle: 'cover_style', reportFormat: 'report_format',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (fields as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) payload[col] = v;
  }
  return callRpc('admin_set_branding', { p_org: orgId, p_fields: payload });
}

/** Upload a small asset (<= 512 KB) as base64; larger files use Storage (D-S4-assets-storage). */
export async function uploadBrandingAsset(
  orgId: string, kind: 'logo_light' | 'logo_dark' | 'font' | 'theme',
  filename: string, mime: string, base64: string
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: 'The data module is not configured.' };
  const { data, error } = await sb.rpc('admin_upload_branding_asset', {
    p_org: orgId, p_kind: kind, p_filename: filename, p_mime: mime, p_base64: base64,
  });
  return error ? { ok: false, reason: error.message } : { ok: true, id: String(data) };
}

/** Store an extracted PPTX theme (F9). The browser extracts; this writes the facts. */
export async function savePptxTheme(orgId: string, theme: Record<string, unknown>): Promise<{ ok: true } | { ok: false; reason: string }> {
  return callRpc('admin_upload_pptx_theme', { p_org: orgId, p_theme: theme });
}

/** List the org's branding assets (logos, fonts). Read-only. */
export async function listBrandingAssets(orgId: string): Promise<BrandingAsset[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('branding_assets')
    .select('id, kind, filename, mime_type, byte_size')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), kind: String(r.kind ?? ''), filename: String(r.filename ?? ''),
    mimeType: String(r.mime_type ?? ''), byteSize: Number(r.byte_size ?? 0),
  }));
}
